/**
 * Shared Team Chat rules (Phase 12).
 *
 * The limits and file rules live here so the desktop app, the web app and the
 * Cloudflare Worker all agree on what a chat message and a receipt are.
 */

export const CHAT_ROOM_DEFAULT = "main";

/** Longest chat message we accept (characters). */
export const MAX_MESSAGE_CHARS = 2000;

/** Biggest receipt file we accept (bytes) — 4 MB. */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

/** Receipts are photographs of bills or PDF scans — nothing else. */
export const RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
  "application/pdf",
] as const;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/** Is this mime type a receipt we may store? Case and parameters are ignored. */
export function isReceiptMimeAllowed(mime: unknown): boolean {
  if (typeof mime !== "string") return false;
  const clean = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return (RECEIPT_MIME_TYPES as readonly string[]).includes(clean);
}

/** File extension for a receipt mime type ("bin" when we do not know it). */
export function receiptFileExtension(mime: unknown): string {
  if (typeof mime !== "string") return "bin";
  const clean = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSIONS[clean] ?? "bin";
}
