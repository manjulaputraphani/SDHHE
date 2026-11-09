/**
 * The "Message info" panel (Seen by / Delivered to) — the 1:1 fix.
 *
 * The recipients of a message are ALWAYS the members of that conversation
 * minus the sender (never the team or all-users list), and every receipt
 * carries its joined user data (id, name, initials, avatar), so the panel
 * shows "Unknown member" instead of a raw "#id" when a user is gone.
 *
 * The rules are pure so the web screen and its tests agree.
 */
import { formatChatDayLabel, formatChatTime } from "./chat";

/** The joined user behind a recipient or a receipt row. */
export type ReceiptUser = {
  id: number;
  name: string | null;
  initials: string | null;
  avatar: string | null;
};

/** One receipt: who got the message, and when they got / read it. */
export type MessageReceipt = {
  userId: number;
  user: ReceiptUser | null;
  deliveredAt: string | null;
  readAt: string | null;
};

/** What the Message info API returns for one message. */
export type MessageInfo = {
  /** The members of the conversation, excluding the sender. */
  recipients: ReceiptUser[];
  /** One receipt per member that got the message — NEVER the sender. */
  receipts: MessageReceipt[];
};

/** The name to show for a user — "Unknown member", never "#id". */
export function receiptUserLabel(user: { name?: string | null } | null | undefined): string {
  return user?.name?.trim() || "Unknown member";
}

/** "Today, 04:20 PM" — or "—" when it has not happened yet. */
export function receiptTimeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatChatDayLabel(iso, now)}, ${formatChatTime(iso)}`;
}

/** The recipients still waiting — the "Pending" list of a group. */
export function pendingRecipients(info: MessageInfo): ReceiptUser[] {
  const done = new Set(
    info.receipts
      .filter((receipt) => receipt.deliveredAt !== null || receipt.readAt !== null)
      .map((receipt) => receipt.userId),
  );
  return info.recipients.filter((recipient) => !done.has(recipient.id));
}

/**
 * The two times of a 1:1 chat — read and delivered by the ONE recipient.
 *
 * The recipients already exclude the sender, so this is the other person of
 * the chat (or me, when their message is being inspected).
 */
export function directTimes(
  info: MessageInfo,
): { deliveredAt: string | null; readAt: string | null } {
  const wanted = info.recipients[0]?.id;
  const receipt =
    (wanted != null ? info.receipts.find((entry) => entry.userId === wanted) : undefined) ??
    info.receipts[0] ??
    null;
  return { deliveredAt: receipt?.deliveredAt ?? null, readAt: receipt?.readAt ?? null };
}
