/**
 * Short-lived chat token for the desktop app (Phase 12).
 *
 * The Tauri app has no worker session cookie, so it signs in to the chat with
 * the same phone + password and gets a bearer token instead. The token is
 * HMAC-SHA256 signed with the worker's SESSION_SECRET and expires after
 * twelve hours.
 */
import { base64UrlDecode, base64UrlEncode, hmacSha256 } from "./sha256";
import type { Role } from "./permissions";

export const CHAT_TOKEN_TTL_SECONDS = 12 * 60 * 60;

export type ChatTokenPayload = {
  uid: number;
  name: string;
  role: Role;
  /** Expiry in seconds since the epoch. */
  exp: number;
};

/** The expiry a fresh token gets (seconds since the epoch). */
export function chatTokenExpiry(now: number = Date.now()): number {
  return Math.floor(now / 1000) + CHAT_TOKEN_TTL_SECONDS;
}

function sign(data: string, secret: string): string {
  const key = new TextEncoder().encode(secret);
  const message = new TextEncoder().encode(data);
  return base64UrlEncode(hmacSha256(key, message));
}

/** Sign a payload into `body.signature`. */
export function signChatToken(payload: ChatTokenPayload, secret: string): string {
  if (!secret) throw new Error("A signing secret is required");
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${sign(body, secret)}`;
}

/**
 * Verify a token. Returns null when the signature does not match, the token
 * is malformed or it has expired.
 */
export function verifyChatToken(token: string, secret: string): ChatTokenPayload | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!body || !signature) return null;

  let expected: string;
  try {
    expected = sign(body, secret);
  } catch {
    return null;
  }
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let payload: ChatTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as ChatTokenPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== "number" || typeof payload.exp !== "number") return null;
  if (payload.exp * 1000 <= Date.now()) return null;
  return payload;
}
