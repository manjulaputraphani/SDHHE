import { describe, expect, it } from "vitest";
import {
  CHAT_SESSION_TOKEN_TTL_SECONDS,
  CHAT_TOKEN_TTL_SECONDS,
  chatTokenExpiry,
  signChatToken,
  verifyChatToken,
} from "./chatToken";

const SECRET = "test-secret-value";

function payload(overrides: Partial<{ uid: number; name: string; role: "owner" | "ca" | "staff"; exp: number }> = {}) {
  return {
    uid: 3,
    name: "ANITA",
    role: "staff" as const,
    exp: chatTokenExpiry(),
    ...overrides,
  };
}

describe("signChatToken", () => {
  it("round-trips the payload", () => {
    const token = signChatToken(payload(), SECRET);
    expect(verifyChatToken(token, SECRET)).toEqual(payload());
  });

  it("refuses a token signed with another secret", () => {
    const token = signChatToken(payload(), SECRET);
    expect(verifyChatToken(token, "another-secret")).toBeNull();
  });

  it("refuses an expired token", () => {
    const token = signChatToken(payload({ exp: Math.floor(Date.now() / 1000) - 10 }), SECRET);
    expect(verifyChatToken(token, SECRET)).toBeNull();
  });

  it("refuses a token whose payload was changed", () => {
    const token = signChatToken(payload(), SECRET);
    const [body, signature] = token.split(".");
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body!)));
    decoded.uid = 99;
    const forged = `${base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(decoded)))}.${signature}`;
    expect(verifyChatToken(forged, SECRET)).toBeNull();
  });

  it("refuses rubbish", () => {
    expect(verifyChatToken("", SECRET)).toBeNull();
    expect(verifyChatToken("not-a-token", SECRET)).toBeNull();
    expect(verifyChatToken("a.b", SECRET)).toBeNull();
  });
});

describe("chatTokenExpiry", () => {
  it("is twelve hours away for the desktop app", () => {
    expect(CHAT_TOKEN_TTL_SECONDS).toBe(12 * 60 * 60);
    const now = 1_700_000_000_000;
    expect(chatTokenExpiry(now)).toBe(Math.floor(now / 1000) + CHAT_TOKEN_TTL_SECONDS);
  });

  it("is one hour for the web app, so the chat ends with the sign-on", () => {
    expect(CHAT_SESSION_TOKEN_TTL_SECONDS).toBe(60 * 60);
    const now = 1_700_000_000_000;
    expect(chatTokenExpiry(now, CHAT_SESSION_TOKEN_TTL_SECONDS)).toBe(
      Math.floor(now / 1000) + 3600,
    );
  });
});

// --- tiny helpers so the test does not depend on the implementation ---
function base64UrlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 ? "=".repeat(4 - (value.length % 4)) : "";
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
