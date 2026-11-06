/**
 * Web Push (RFC 8291 + VAPID) — written with WebCrypto only, so it runs in
 * the Cloudflare Worker without any npm dependency.
 */
export type PushMessage = { title: string; body: string; url?: string };

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
async function vapidJwt(
  privateKey: string,
  publicKey: string,
  audience: string,
  subject: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    // The stored key is the raw 32-byte scalar; wrap it in a PKCS8 EC key.
    pkcs8FromRaw(unb64u(privateKey)),
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

/** Wrap a raw 32-byte EC private scalar into a PKCS8 structure. */
function pkcs8FromRaw(raw: Uint8Array): ArrayBuffer {
  // RFC 5915 ECPrivateKey inside PKCS8: a fixed 26-byte prefix + the scalar.
  const prefix = new Uint8Array([
    0x30, 0x77, 0x02, 0x01, 0x01, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce,
    0x3d, 0x02, 0x01, 0x30, 0x06, 0x2b, 0x81, 0x04, 0x00, 0x22, 0x03, 0x42, 0x00,
  ]);
  const out = new Uint8Array(prefix.length + raw.length + 3);
  out.set(prefix, 0);
  // the BIT STRING: 04 || 30 || len || 00 || 04 || scalar
  out[prefix.length] = 0x04;
  out[prefix.length + 1] = 0x63;
  out[prefix.length + 2] = raw.length + 2;
  out.set([0x04, raw.length], prefix.length + 3);
  out.set(raw, prefix.length + 5);
  return out.buffer as ArrayBuffer;
}

/** Encrypt one payload for one subscription (RFC 8291, aes128gcm). */
async function encryptPayload(
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
 * Push one message to one subscription. Returns false when the subscription
 * is gone (the browser tells us to stop).
 */
export async function sendWebPush(
  config: { privateKey: string; publicKey: string; subject: string },
  subscription: { endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
): Promise<boolean> {
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
  // 201 = delivered; 404/410 = the subscription is gone.
  return res.status !== 404 && res.status !== 410;
}
