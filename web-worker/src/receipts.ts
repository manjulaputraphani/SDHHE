/**
 * Receipt files in Cloudflare R2 (Phase 12, T-12.3).
 *
 * The paperwork (a bill photo or a PDF scan) never goes into Postgres — only
 * the object key does. Files are private: the Worker streams them back only
 * after the caller passed the chat permission check.
 */
import {
  MAX_RECEIPT_BYTES,
  isReceiptMimeAllowed,
  receiptFileExtension,
} from "../../src/logic/chat";

export const RECEIPT_PREFIX = "receipts";

/**
 * The tiny part of the R2 API we use.
 *
 * `@cloudflare/workers-types` is not a dependency of this repo, so the two
 * methods we call are declared here — the real `R2Bucket` binding satisfies
 * them structurally.
 */
export interface R2ObjectBodyLike {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<{ key: string }>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

export type ReceiptFile = {
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
};

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  pdf: "application/pdf",
};

/** The object key for a receipt: `receipts/<date>/<id>.<ext>`. */
export function buildReceiptKey(date: Date, id: number, mime: string): string {
  const day = date.toISOString().slice(0, 10);
  return `${RECEIPT_PREFIX}/${day}/${id}.${receiptFileExtension(mime)}`;
}

/** Only keys we build ourselves may be read (no `..`, no other folders). */
export function isSafeReceiptKey(key: unknown): boolean {
  if (typeof key !== "string") return false;
  return /^receipts\/\d{4}-\d{2}-\d{2}\/\d{1,20}\.[a-z0-9]{1,8}$/.test(key);
}

/** Put a key into one URL segment (base64url, no padding). */
export function encodeReceiptKey(key: string): string {
  let text = "";
  for (const byte of new TextEncoder().encode(key)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Read a key back out of the URL segment. */
export function decodeReceiptKey(encoded: string): string {
  const cleaned = encoded.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new Error("Invalid receipt key");
  const pad = cleaned.length % 4 ? "=".repeat(4 - (cleaned.length % 4)) : "";
  const binary = atob(cleaned + pad);
  const key = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  if (!isSafeReceiptKey(key)) throw new Error("Invalid receipt key");
  return key;
}

/** The mime type to serve a stored object with. */
export function receiptContentType(key: string): string {
  const extension = key.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** Keep the name, drop any folders the browser may have added. */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").trim();
  return cleaned.slice(0, 120) || "receipt";
}

/**
 * Store a receipt file and return what the database has to remember.
 *
 * Only images and PDF scans up to 4 MB are accepted.
 */
export async function uploadReceipt(
  bucket: R2BucketLike,
  file: { name: string; type: string; bytes: Uint8Array },
  now: Date = new Date(),
): Promise<ReceiptFile> {
  const mime = (file.type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!isReceiptMimeAllowed(mime)) {
    throw new Error("Receipt must be an image or PDF");
  }
  if (!file.bytes || file.bytes.byteLength === 0) {
    throw new Error("Receipt file is empty");
  }
  if (file.bytes.byteLength > MAX_RECEIPT_BYTES) {
    throw new Error("Receipt file must be 4 MB or smaller");
  }

  const filename = safeFileName(file.name);
  // The id is a timestamp+random suffix, so two uploads never collide.
  const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const key = buildReceiptKey(now, id, mime);

  await bucket.put(key, file.bytes, { httpMetadata: { contentType: mime } });

  return { r2Key: key, filename, mime, sizeBytes: file.bytes.byteLength };
}

/** Read a stored receipt back (null when it is not there). */
export async function readReceipt(
  bucket: R2BucketLike,
  key: string,
): Promise<R2ObjectBodyLike | null> {
  if (!isSafeReceiptKey(key)) throw new Error("Invalid receipt key");
  const object = await bucket.get(key);
  if (!object) return null;
  return {
    body: object.body,
    size: object.size,
    httpMetadata: { contentType: receiptContentType(key) },
  };
}
