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

/** Online if the member was seen in the last 60 seconds. */
export function isOnline(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const at = new Date(lastSeenAt).getTime();
  return Number.isFinite(at) && now - at < 60_000;
}

/** "Online" / "Last seen today at 16:20" / "Offline". */
export function presenceLabel(lastSeenAt: string | null | undefined, now: Date = new Date()): string {
  if (isOnline(lastSeenAt, now.getTime())) return "Online";
  if (!lastSeenAt) return "Offline";
  const at = new Date(lastSeenAt);
  const time = at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (days <= 0) return `Last seen today at ${time}`;
  if (days === 1) return `Last seen yesterday at ${time}`;
  return `Last seen ${at.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} at ${time}`;
}

function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const meridiem = date.getHours() < 12 ? "AM" : "PM";
  const hours = date.getHours() % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${String(hours).padStart(2, "0")}:${minutes} ${meridiem}`;
}

/** Chat-list row time: "04:20 PM" · "Yesterday" · "Tue, 3 Nov". */
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
