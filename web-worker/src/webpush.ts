/**
 * Web Push (RFC 8291 + VAPID) — written with WebCrypto only, so it runs in
 * the Cloudflare Worker without any npm dependency.
 */
export type PushMessage = { title: string; body: string; url?: string; messageId?: number };

function b64u(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.replace(/-/g, "+").replace(/_/g, "/").length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The VAPID JWT (ES256) that proves the push comes from this server. */
export async function vapidJwt(
  privateKey: string,
  publicKey: string,
  audience: string,
  subject: string,
): Promise<string> {
  // The stored private key IS a PKCS8 (base64url) — generated once with node.
  const key = await crypto.subtle.importKey(
    "pkcs8",
    unb64u(privateKey) as unknown as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64u(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(
    new TextEncoder().encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`)),
  );
  return `${header}.${payload}.${b64u(signature)}`;
}

/** Encrypt one payload for one subscription (RFC 8291, aes128gcm). */
export async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string,
): Promise<{ body: ArrayBuffer; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const encoder = new TextEncoder();
  const uaPublic = await crypto.subtle.importKey(
    "raw",
    unb64u(p256dh) as unknown as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublic }, serverKeys.privateKey, 256),
  );
  const serverPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeys.publicKey),
  );

  const ikm = new Uint8Array(sharedSecret.length + 16);
  ikm.set(sharedSecret);
  ikm.set(unb64u(auth), sharedSecret.length);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  async function hkdf(info: string, length: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", ikm as unknown as BufferSource, "HKDF", false, [
      "deriveBits",
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: salt as unknown as BufferSource, info: encoder.encode(info) },
        key,
        length * 8,
      ),
    );
  }

  const cek = await hkdf("WebPush: aes128gcm", 16);
  const nonce = await hkdf("WebPush: nonce", 12);
  const cekKey = await crypto.subtle.importKey("raw", cek as unknown as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as unknown as BufferSource, tagLength: 128 },
      cekKey,
      encoder.encode(payload),
    ),
  );

  // The aes128gcm header: salt | rs(4) | idlen(1) | the server public key.
  const header = new Uint8Array(21 + serverPublicKey.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = serverPublicKey.length;
  header.set(serverPublicKey, 21);

  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header);
  body.set(ciphertext, header.length);

  return { body: body.buffer as ArrayBuffer, salt, serverPublicKey };
}

/**
 * Push one message to one subscription. Returns `{ delivered, gone }`.
 *
 * `delivered` is true only when the push service accepted it (HTTP 201).
 * `gone` is true when the subscription is dead (404/410) and should be removed.
 * Anything else (400/401 VAPID-invalid, 403, 500, network) is a failure that is
 * logged but NOT auto-removed — the subscription may recover on its own.
 */
export type PushResult = { delivered: boolean; gone: boolean };

export async function sendWebPush(
  config: { privateKey: string; publicKey: string; subject: string },
  subscription: { endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
): Promise<PushResult> {
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(config.privateKey, config.publicKey, audience, config.subject);
  const { body } = await encryptPayload(JSON.stringify(message), subscription.p256dh, subscription.auth);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: `vapid t=${jwt}, k=${config.publicKey}`,
    },
    body,
  });
  // 201 = delivered to the push service. 404/410 = subscription is gone.
  // Anything else (400/401 VAPID-invalid, 403, 500, network error) is a failure.
  if (res.status === 201) return { delivered: true, gone: false };
  const gone = res.status === 404 || res.status === 410;
  if (!gone) {
    let detail = "";
    try { detail = await res.text(); } catch { /* body unreadable */ }
    console.error("web push failed:", res.status, res.statusText, detail, subscription.endpoint);
  }
  return { delivered: false, gone };
}
