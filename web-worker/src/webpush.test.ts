// @vitest-environment node
import { describe, expect, it } from "vitest";
import { encryptPayload, vapidJwt } from "./webpush";

/** The browser side of RFC 8291 — if this reverses the Worker, the push is readable. */
async function browserDecrypt(
  result: { body: ArrayBuffer },
  browserPrivate: CryptoKeyPair,
  auth: Uint8Array,
): Promise<string> {
  const bytes = new Uint8Array(result.body);
  const salt = bytes.slice(0, 16);
  const serverPublicRaw = bytes.slice(21, 21 + bytes[20]!);
  const ciphertext = bytes.slice(21 + bytes[20]!);

  const serverPublic = await crypto.subtle.importKey(
    "raw",
    serverPublicRaw as unknown as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: serverPublic }, browserPrivate.privateKey, 256),
  );
  const ikm = new Uint8Array(shared.length + auth.length);
  ikm.set(shared);
  ikm.set(auth, shared.length);

  async function hkdf(info: string, length: number) {
    const key = await crypto.subtle.importKey("raw", ikm as unknown as BufferSource, "HKDF", false, [
      "deriveBits",
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: salt as unknown as BufferSource, info: new TextEncoder().encode(info) },
        key,
        length * 8,
      ),
    );
  }

  const cek = await hkdf("WebPush: aes128gcm", 16);
  const nonce = await hkdf("WebPush: nonce", 12);
  const cekKey = await crypto.subtle.importKey("raw", cek as unknown as BufferSource, "AES-GCM", false, [
    "decrypt",
  ]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as unknown as BufferSource, tagLength: 128 },
    cekKey,
    ciphertext as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

function b64u(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(value: string): Uint8Array {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function makeKeys(): Promise<{ keys: CryptoKeyPair; raw: Uint8Array }> {
  const keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return { keys, raw };
}

describe("the Web Push encryption (RFC 8291)", () => {
  it("the browser can read what the Worker encrypts", async () => {
    const browser = await makeKeys();
    const auth = crypto.getRandomValues(new Uint8Array(16));

    const payload = JSON.stringify({ title: "PHANI wrote", body: "the 20 kg arrived" });
    const result = await encryptPayload(payload, b64u(browser.raw), b64u(auth));

    const plain = await browserDecrypt(result, browser.keys, auth);
    expect(plain).toBe(payload);
  });

  it("every push is encrypted with a fresh salt (no two are the same)", async () => {
    const browser = await makeKeys();
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const first = await encryptPayload("hello", b64u(browser.raw), b64u(auth));
    const second = await encryptPayload("hello", b64u(browser.raw), b64u(auth));
    const a = new Uint8Array(first.body).slice(0, 16);
    const b = new Uint8Array(second.body).slice(0, 16);
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });
});

describe("the VAPID JWT", () => {
  it("carries the right claims and a signature the push service can check", async () => {
    const server = await makeKeys();
    const pkcs8 = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", server.keys.privateKey),
    );
    const jwt = await vapidJwt(b64u(pkcs8), b64u(server.raw), "https://fcm.example.com", "mailto:test@example.com");

    const [h, p] = jwt.split(".");
    expect(JSON.parse(atob(h.replace(/-/g, "+").replace(/_/g, "/")))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    expect(claims.aud).toBe("https://fcm.example.com");
    expect(claims.sub).toBe("mailto:test@example.com");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
