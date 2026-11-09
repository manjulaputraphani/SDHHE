/**
 * Delivery and read marks (Phase 14).
 *
 * `delivered` = the member's device has the message, `read` = the member has
 * seen it. The rows are per (message, member), so a shop room with five
 * people can show "read by 3".
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import { appUsers, chatMessageStates, chatMessages } from "./schema";
import type { MemberState } from "../logic/chatStates";

export type MessageMark = {
  messageId: number;
  userId: number;
  delivered: boolean;
  read: boolean;
};

/**
 * Mark a message as delivered to this member (their device got it).
 *
 * The sender NEVER gets a receipt for their own message — the row is only
 * written when `userId` is somebody else. Returns whether a row exists now
 * (false for an own message), so the caller can skip the broadcast too.
 */
export async function markDelivered(
  db: Db | TxDb,
  messageId: number,
  userId: number,
): Promise<boolean> {
  const rows = await db.execute(sql`
    insert into chat_message_states (message_id, user_id, delivered_at)
    select m.id, ${userId}, now()
    from chat_messages m
    where m.id = ${messageId} and m.user_id is distinct from ${userId}
    on conflict (message_id, user_id) do update
      set delivered_at = coalesce(chat_message_states.delivered_at, now())
    returning message_id
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return (list as unknown[]).length > 0;
}

/**
 * Mark the messages of a room as read by this member.
 *
 * Marks every message `sender_id != userId` up to `messageId` (or the whole
 * room when omitted) as read, and bumps the member's
 * `chat_conversation_members.last_read_message_id` so the unread badge
 * clears server-side for both 1:1 and group chats.
 *
 * Returns the message ids whose read state changed, so the Worker can push a
 * "read" frame to the room.
 */
export async function markRead(
  db: Db | TxDb,
  room: string,
  userId: number,
  messageId?: number,
): Promise<number[]> {
  // High-water mark: up to messageId when given, otherwise the newest message
  // in the room (marking the whole room as read).
  let highWater: number;
  if (messageId != null && Number.isInteger(messageId) && messageId > 0) {
    highWater = messageId;
  } else {
    const [newest] = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(eq(chatMessages.room, room))
      .orderBy(desc(chatMessages.id))
      .limit(1);
    highWater = newest?.id ?? 0;
  }

  const target = sql`select m.id from chat_messages m where m.room = ${room} and m.id <= ${highWater} and m.user_id is distinct from ${userId}`;

  const rows = await db.execute(sql`
    insert into chat_message_states (message_id, user_id, delivered_at, read_at)
    select t.id, ${userId}, now(), now()
    from (${target}) t
    on conflict (message_id, user_id) do update
      set read_at = coalesce(chat_message_states.read_at, now()),
          delivered_at = coalesce(chat_message_states.delivered_at, now())
    returning message_id
  `);
  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  const changedIds = (list as Array<{ message_id: number }>).map((row) => Number(row.message_id));

  // Bump the conversation member's high-water read pointer so the unread
  // count (computed from last_read_message_id) drops for this room.
  await db.execute(sql`
    update chat_conversation_members
    set last_read_message_id = greatest(coalesce(last_read_message_id, 0), ${highWater}),
        last_read_at = now()
    where user_id = ${userId}
      and conversation_id = (select id from chat_conversations where room = ${room})
  `);

  return changedIds;
}

/** The marks of a list of messages. */
export async function statesForMessages(
  db: Db,
  messageIds: number[],
): Promise<Map<number, MemberState[]>> {
  const result = new Map<number, MemberState[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({
      messageId: chatMessageStates.messageId,
      userId: chatMessageStates.userId,
      deliveredAt: chatMessageStates.deliveredAt,
      readAt: chatMessageStates.readAt,
    })
    .from(chatMessageStates)
    .where(inArray(chatMessageStates.messageId, messageIds));

  for (const row of rows) {
    const list = result.get(Number(row.messageId)) ?? [];
    list.push({
      userId: Number(row.userId),
      delivered: row.deliveredAt !== null,
      read: row.readAt !== null,
    });
    result.set(Number(row.messageId), list);
  }
  return result;
}

/** The marks of one message. */
export async function statesForMessage(
  db: Db,
  messageId: number,
): Promise<MemberState[]> {
  const map = await statesForMessages(db, [messageId]);
  return map.get(messageId) ?? [];
}

/** One receipt of a message, with the user joined in (null name = gone user). */
export type MessageReceiptRow = {
  userId: number;
  name: string | null;
  deliveredAt: string | null;
  readAt: string | null;
};

/**
 * The receipts of one message for the Message info panel.
 *
 * The user is joined in (LEFT JOIN, so a receipt survives its user); the
 * caller renders "Unknown member" when the name is null. `excludeUserId`
 * leaves out the sender — the sender is never a recipient of their own
 * message.
 */
export async function receiptsForMessage(
  db: Db,
  messageId: number,
  excludeUserId?: number | null,
): Promise<MessageReceiptRow[]> {
  const rows = await db
    .select({
      userId: chatMessageStates.userId,
      name: appUsers.name,
      deliveredAt: chatMessageStates.deliveredAt,
      readAt: chatMessageStates.readAt,
    })
    .from(chatMessageStates)
    .leftJoin(appUsers, eq(appUsers.id, chatMessageStates.userId))
    .where(eq(chatMessageStates.messageId, messageId));
  return rows
    .map((row) => ({
      userId: Number(row.userId),
      name: row.name ?? null,
      deliveredAt: row.deliveredAt ? new Date(row.deliveredAt).toISOString() : null,
      readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    }))
    .filter((row) => excludeUserId == null || row.userId !== excludeUserId);
}
