/**
 * How the chat is drawn (Phase 14) — shared by the web and the desktop screen.
 *
 * The rules are pure so both screens look the same:
 * - messages of the same author close together form a group (one name, one
 *   avatar, tight bubbles),
 * - my messages sit on the right in the brand colour,
 * - the ticks show sent / delivered / read.
 */
import { formatChatDayLabel, formatChatListTime } from "./chat";
import { tickState, type MemberState } from "./chatStates";

/** The part of a message the view needs (both apps use their own type). */
export type ViewMessage = {
  id: number;
  author: string;
  userId: number | null;
  kind: string;
  body: string;
  receiptId: number | null;
  createdAt: string;
  /** Who has received it (Phase 14). */
  deliveredBy?: number[];
  /** Who has read it (Phase 14). */
  readBy?: number[];
};

export type ChatGroup = {
  key: string;
  author: string;
  authorId: number | null;
  mine: boolean;
  messages: ViewMessage[];
};

/** Messages of the same author within five minutes belong to one group. */
export function groupMessages(messages: ViewMessage[], myId: number | null): ChatGroup[] {
  const groups: ChatGroup[] = [];
  let lastAt = 0;
  for (const message of messages) {
    const at = new Date(message.createdAt).getTime();
    const last = groups[groups.length - 1];
    const sameAuthor = last && last.author === message.author && last.authorId === message.userId;
    const close = at - lastAt < 5 * 60 * 1000;
    if (last && sameAuthor && close) {
      last.messages.push(message);
    } else {
      groups.push({
        key: `${message.id}`,
        author: message.author,
        authorId: message.userId,
        mine: message.userId !== null && message.userId === myId,
        messages: [message],
      });
    }
    lastAt = at;
  }
  return groups;
}

/** The states of a message for the members of the conversation. */
export function messageStates(message: ViewMessage): MemberState[] {
  const delivered = message.deliveredBy ?? [];
  const read = message.readBy ?? [];
  const ids = Array.from(new Set([...delivered, ...read]));
  return ids.map((userId) => ({
    userId,
    delivered: delivered.includes(userId),
    read: read.includes(userId),
  }));
}

/** Which tick does this message get? */
export function messageTick(
  message: ViewMessage,
  otherMemberIds: number[],
): "sent" | "delivered" | "read" {
  return tickState(messageStates(message), otherMemberIds);
}

/**
 * "Read by 3" — how many of the other members have read the message.
 *
 * Everyone in the room can see it, so the sender knows how many people have
 * seen the message (and the members can see that it was read).
 */
export function readCount(
  message: ViewMessage,
  otherMemberIds: number[],
): { read: number; delivered: number; total: number } {
  const delivered = message.deliveredBy ?? [];
  const read = message.readBy ?? [];
  const others = otherMemberIds.filter((id) => id > 0);
  let deliveredCount = 0;
  let readCountValue = 0;
  for (const id of others) {
    if (delivered.includes(id)) deliveredCount += 1;
    if (read.includes(id)) readCountValue += 1;
  }
  return { read: readCountValue, delivered: deliveredCount, total: others.length };
}

/** The first letter of a name (for the avatar). */
export function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Is this member online? (a heartbeat in the last 60 seconds) */
export function isOnline(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const at = new Date(lastSeenAt).getTime();
  return Number.isFinite(at) && now - at < 60_000;
}

/** "Online" or "Last seen today at 16:20" (Phase 1). */
export function presenceLabel(
  lastSeenAt: string | null | undefined,
  now: Date = new Date(),
): string {
  if (isOnline(lastSeenAt, now.getTime())) return "Online";
  if (!lastSeenAt) return "Offline";
  const at = new Date(lastSeenAt);
  const time = at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (days <= 0) return `Last seen today at ${time}`;
  if (days === 1) return `Last seen yesterday at ${time}`;
  return `Last seen ${at.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} at ${time}`;
}

/** The file name of an exported chat (the group name wins). */
export function exportNameFor(room: string, title: string | null | undefined): string {
  const base = (title && title.trim()) || (room === "main" ? "shop room" : room);
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `chat-${slug || room}.txt`;
}

// ----------------------------------------------------------------------
// Phase 2 — the redesigned web chat (list, search, date separators)
// ----------------------------------------------------------------------

/** The part of a conversation the list needs to name it (Phase 2). */
export type ConversationListEntry = {
  room: string;
  kind: "group" | "direct";
  title?: string | null;
  other?: { name: string } | null;
};

/** The name shown in the chat list and in the room header (Phase 2). */
export function conversationName(conversation: ConversationListEntry): string {
  if (conversation.kind === "direct") {
    return conversation.other?.name ?? conversation.room;
  }
  // The shop room has a default name; a group the owner made is never untitled.
  return conversation.title?.trim() || (conversation.room === "main" ? "Shop room" : conversation.room);
}

/** The chat list filtered by the search bar (Phase 2) — matches the name only. */
export function filterConversations<T extends ConversationListEntry>(
  list: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((entry) => conversationName(entry).toLowerCase().includes(needle));
}

/** The messages of the open room filtered by the header search (Phase 2). */
export function filterMessages<T extends ViewMessage>(messages: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return messages;
  return messages.filter(
    (message) =>
      message.body.toLowerCase().includes(needle) ||
      message.author.toLowerCase().includes(needle),
  );
}

/** One day of the room, with its separator label (Phase 2). */
export type ChatDaySection = {
  /** The calendar day, unique per section — safe as a React key. */
  key: string;
  label: string;
  messages: ViewMessage[];
};

/**
 * Split the (chronological) messages into day sections for the date
 * separators ("Today", "Yesterday", "Fri, 3 Nov"). Pure — the web and the
 * desktop can share it.
 */
export function chatDaySections(messages: ViewMessage[], now: Date = new Date()): ChatDaySection[] {
  const sections: ChatDaySection[] = [];
  for (const message of messages) {
    const date = new Date(message.createdAt);
    const key = Number.isNaN(date.getTime())
      ? `id-${message.id}`
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const last = sections[sections.length - 1];
    if (last && last.key === key) {
      last.messages.push(message);
    } else {
      sections.push({ key, label: formatChatDayLabel(message.createdAt, now), messages: [message] });
    }
  }
  return sections;
}

/** The time in a chat-list row (Phase 2) — today: "09:42", else "Yesterday"/"Tue, 3 Nov". */
export function formatChatListTimeRow(iso: string | null | undefined, now: Date = new Date()): string {
  return formatChatListTime(iso, now);
}

export { formatChatListTime };
