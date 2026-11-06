/**
 * Delivery and read marks (Phase 14).
 *
 * `delivered` = the member's device has the message, `read` = the member has
 * seen it. The rows are per (message, member), so a shop room with five
 * people can show "read by 3".
 */
import { inArray, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import { chatMessageStates } from "./schema";
import type { MemberState } from "../logic/chatStates";

export type MessageMark = {
  messageId: number;
  userId: number;
  delivered: boolean;
  read: boolean;
};

/** Mark a message as delivered to this member (their device got it). */
export async function markDelivered(
  db: Db | TxDb,
  messageId: number,
  userId: number,
): Promise<void> {
  await db
    .insert(chatMessageStates)
    .values({ messageId, userId, deliveredAt: new Date() })
    .onConflictDoUpdate({
      target: [chatMessageStates.messageId, chatMessageStates.userId],
      set: { deliveredAt: sql`coalesce(${chatMessageStates.deliveredAt}, now())` },
    });
}

/**
 * Mark the messages of a room as read by this member.
 *
 * Returns the ids that changed, so the Worker can push a "read" frame to the
 * room and the sender sees the tick turn blue at once.
 */
export async function markRead(
  db: Db | TxDb,
  room: string,
  userId: number,
  messageId?: number,
): Promise<number[]> {
  const target = messageId
    ? sql`select m.id from chat_messages m where m.room = ${room} and m.id <= ${messageId} and m.user_id is distinct from ${userId}`
    : sql`select m.id from chat_messages m where m.room = ${room} and m.user_id is distinct from ${userId}`;

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
  return (list as Array<{ message_id: number }>).map((row) => Number(row.message_id));
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
    const list = result.get(row.messageId) ?? [];
    list.push({
      userId: row.userId,
      delivered: row.deliveredAt !== null,
      read: row.readAt !== null,
    });
    result.set(row.messageId, list);
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
