/**
 * Shared Team Chat rules (Phase 12).
 *
 * The limits and file rules live here so the desktop app, the web app and the
 * Cloudflare Worker all agree on what a chat message and a receipt are.
 */
import { allowed, type RolePermissions } from "./permissions";

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

// ------------------------------------------------------------ receipt status

export type ReceiptStatus = "pending" | "approved" | "rejected";

/** The label shown on a receipt badge. */
export function receiptStatusLabel(status: ReceiptStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending approval";
}

/** The app badge tone for a status: warn (gold), ok (sage) or bad (red). */
export function receiptStatusTone(status: ReceiptStatus): "warn" | "ok" | "bad" {
  if (status === "approved") return "ok";
  if (status === "rejected") return "bad";
  return "warn";
}

/** Only a receipt that is still pending can be decided. */
export function canDecideReceipt(status: ReceiptStatus): boolean {
  return status === "pending";
}

/** May this role approve or reject a receipt? (needs `chat:edit`) */
export function canApproveReceipts(permissions: RolePermissions | null | undefined): boolean {
  return allowed(permissions, "chat", "edit");
}

/** The badge on the nav link: the number of receipts waiting, or nothing. */
export function pendingBadgeLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return String(Math.floor(count));
}

// -------------------------------------------------------------- presentation

/** One line summary of a message (used for notifications and previews). */
export function chatMessagePreview(message: { author: string; body: string }): string {
  const text = message.body.replace(/\s+/g, " ").trim();
  if (!text) return `${message.author} sent a receipt`;
  return `${message.author}: ${text}`;
}

/** Clock time of a message — "09:42 AM" (the shop's local time, 12-hour). */
export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const meridiem = date.getHours() < 12 ? "AM" : "PM";
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${String(hours).padStart(2, "0")}:${minutes} ${meridiem}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day separator — "Today", "Yesterday" or "Fri, 2 Jan" (Phase 2 shows the weekday). */
export function formatChatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * The time shown in the chat list (Phase 2) — "09:42" for today,
 * "Yesterday", or "Tue, 3 Nov" for older days.
 */
export function formatChatListTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return formatChatTime(iso);
  if (days === 1) return "Yesterday";
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * The one-line preview of a conversation's last message in the chat list
 * (Phase 2). Receipts are marked, group messages keep the author.
 */
export function conversationPreview(
  message: { body: string; kind: string; author?: string | null } | null | undefined,
  inGroup = false,
): string {
  if (!message) return "";
  const text = message.body.replace(/\s+/g, " ").trim();
  if (message.kind === "receipt") return text ? `Receipt: ${text}` : "Receipt";
  if (message.kind === "system") return text;
  if (inGroup && message.author) return `${message.author}: ${text}`;
  return text;
}
