/**
 * Chat view helpers — the SAME rules as the web app.
 *
 * Mirrors src/logic/chatView.ts and src/logic/chat.ts so the phone shows the
 * identical names, row times and presence labels as the web chat list.
 * Copied rather than imported because Metro only resolves modules inside
 * mobile/ (no metro.config.js watchFolders in this project).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "RS" from "Ravi Sharma", "R" from "Ravi". */
export function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Parse a timestamp returned by the API.
 *
 * The worker used to send Postgres' `timestamptz::text` form
 * ("2026-11-15 09:55:51.840273+00"). Chrome and Safari accept it, but Hermes
 * (the React Native engine) requires a two-part UTC offset and rejects the
 * hour-only `+00` — `new Date(...)` then returns Invalid Date, which showed up
 * in a 1:1 chat as "Last seen Invalid Date at Invalid Date". Normalise the
 * space and the short offset to strict ISO 8601 before parsing.
 */
export function parseChatDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2})[ T]/, "$1T")
    .replace(/(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/, "$1$2:00");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Online if the member was seen in the last 60 seconds. */
export function isOnline(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  const at = parseChatDate(lastSeenAt);
  return at !== null && now - at.getTime() < 60_000;
}

/** "Online" / "Last seen today at 16:20" / "Offline". */
export function presenceLabel(lastSeenAt: string | null | undefined, now: Date = new Date()): string {
  if (isOnline(lastSeenAt, now.getTime())) return "Online";
  const at = parseChatDate(lastSeenAt);
  if (!at) return "Offline";
  const time = at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (days <= 0) return `Last seen today at ${time}`;
  if (days === 1) return `Last seen yesterday at ${time}`;
  return `Last seen ${at.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} at ${time}`;
}

function formatChatTime(iso: string): string {
  const date = parseChatDate(iso);
  if (!date) return "";
  const meridiem = date.getHours() < 12 ? "AM" : "PM";
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${String(hours).padStart(2, "0")}:${minutes} ${meridiem}`;
}

/** Chat-list row time: "04:20 PM" · "Yesterday" · "Tue, 3 Nov". */
export function formatChatListTime(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parseChatDate(iso);
  if (!date) return "";
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days <= 0) return formatChatTime(iso!);
  if (days === 1) return "Yesterday";
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

// ---- message-level helpers (same rules as src/logic/chat.ts) ----

/** The edit window — a message can be fixed within 15 minutes. */
export const EDIT_WINDOW_MS = 15 * 60_000;

/** The reactions a member can leave. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "🙏", "✅", "🔥"] as const;

/** Is the message still inside the 15-minute edit window? */
export function withinEditWindow(createdAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - createdAtMs <= EDIT_WINDOW_MS;
}

export type ReactionChip = { emoji: string; count: number; mine: boolean };

/** The reactions of a message grouped per emoji, most-used first. */
export function groupReactions(
  reactions: { emoji: string; userId: number; name: string }[] | undefined,
  myId?: number | null,
): ReactionChip[] {
  const map = new Map<string, ReactionChip>();
  for (const reaction of reactions ?? []) {
    const chip = map.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false };
    chip.count += 1;
    if (myId != null && reaction.userId === myId) chip.mine = true;
    map.set(reaction.emoji, chip);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/** Why the AI polish is skipped for this text (null = polish it). */
export function polishSkipReason(text: string): "short" | "emoji" | null {
  const trimmed = text.trim();
  if (trimmed.length < 15) return "short";
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return "emoji";
  return null;
}

/** Every `@Name` in the text mapped to a member id (exact, case-insensitive). */
export function mentionIdsFor(
  text: string,
  members: { id: number; name: string }[],
): number[] {
  const found = new Set<number>();
  const pattern = /@([^\s@]+)/g;
  for (const match of text.matchAll(pattern)) {
    const needle = match[1]!.toLowerCase();
    const member = members.find((m) => m.name.toLowerCase() === needle);
    if (member) found.add(member.id);
  }
  return Array.from(found);
}

// ---- receipts (same as src/logic/chat.ts + units.ts) ----

export type ReceiptStatus = "pending" | "approved" | "rejected";

/** The label for a receipt status. */
export function receiptStatusLabel(status: ReceiptStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending approval";
}

/** The badge tone for a status: warn (gold), ok (sage) or bad (red). */
export function receiptStatusTone(status: ReceiptStatus): "warn" | "ok" | "bad" {
  if (status === "approved") return "ok";
  if (status === "rejected") return "bad";
  return "warn";
}

/** Paise → "₹1234.56" (whole rupees with a 2-digit paise part). */
export function formatRupees(paise: number): string {
  if (!Number.isFinite(paise)) return "₹0.00";
  const rounded = Math.round(paise);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}₹${rupees}.${String(remainder).padStart(2, "0")}`;
}
