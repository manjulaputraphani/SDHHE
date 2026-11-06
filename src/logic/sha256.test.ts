import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode, hmacSha256, sha256 } from "./sha256";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("sha256", () => {
  it("matches the known vector for 'abc'", () => {
    expect(hex(sha256(utf8("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the known vector for the empty string", () => {
    expect(hex(sha256(utf8("")))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes a long message", () => {
    expect(hex(sha256(utf8("a".repeat(1000))))).toBe(
      "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
    );
  });
});

describe("hmacSha256", () => {
  it("matches the RFC 4231 test vector", () => {
    expect(hex(hmacSha256(utf8("key"), utf8("The quick brown fox jumps over the lazy dog")))).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });

  it("changes when the key changes", () => {
    const a = hex(hmacSha256(utf8("key-a"), utf8("hello")));
    const b = hex(hmacSha256(utf8("key-b"), utf8("hello")));
    expect(a).not.toBe(b);
  });
});

describe("base64url", () => {
  it("encodes without padding and with url-safe characters", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190]));
    expect(encoded).not.toContain("=");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
  });

  it("round-trips", () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    expect(Array.from(base64UrlDecode(base64UrlEncode(bytes)))).toEqual(Array.from(bytes));
  });

  it("refuses rubbish instead of throwing", () => {
    expect(() => base64UrlDecode("!!!not base64!!!")).toThrow();
  });
});
