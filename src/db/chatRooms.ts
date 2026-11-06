/**
 * Direct chat (Phase 13) — conversations, members and unread counts.
 *
 * The shop room ("main") is a group conversation. Every other conversation is
 * a private chat between two members; its room name is `dm-<smallId>-<bigId>`
 * so both people always end up in the same room.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import { appUsers, chatConversationMembers, chatConversations } from "./schema";

export const SHARED_ROOM = "main";

export type ConversationKind = "group" | "direct";

export type ChatMember = {
  id: number;
  name: string;
  role: string;
};

export type ChatConversation = {
  id: number;
  room: string;
  kind: ConversationKind;
  /** The name the owner gave the group (null = the default name). */
  title: string | null;
  /** The other member of a direct chat (null for the shop room). */
  other: ChatMember | null;
  unread: number;
  lastMessageAt: string | null;
};

/** The room name of a private chat (null when the two people are the same). */
export function directRoomName(userId: number, otherId: number): string | null {
  if (userId === otherId) return null;
  const small = Math.min(userId, otherId);
  const large = Math.max(userId, otherId);
  return `dm-${small}-${large}`;
}

/** Is this the same room? */
export function isSameRoom(a: string, b: string): boolean {
  return a === b;
}

/** The name shown above a conversation. */
export function roomTitleFor(
  room: string,
  other: ChatMember | null,
  title?: string | null,
): string {
  // A group can be renamed by the owner; a private chat is named after the
  // other person.
  if (room === SHARED_ROOM) return title?.trim() || "Shop room";
  return other?.name ?? room;
}

/** Rename a group (only the owner may do this — the Worker checks that). */
export async function renameConversation(
  db: Db | TxDb,
  room: string,
  title: string,
): Promise<string | null> {
  const name = title.trim().slice(0, 60);
  if (!name) return null;
  const [updated] = await db
    .update(chatConversations)
    .set({ title: name })
    .where(eq(chatConversations.room, room))
    .returning();
  return updated?.title ?? null;
}

/** Make sure the shop room exists and that this member is in it. */
export async function ensureGroupConversation(
  db: Db | TxDb,
  userId?: number,
): Promise<ChatConversation | null> {
  const [conversation] = await db
    .insert(chatConversations)
    .values({ room: SHARED_ROOM, kind: "group", title: "Shop room" })
    .onConflictDoNothing({ target: chatConversations.room })
    .returning();
  const row =
    conversation ??
    (await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.room, SHARED_ROOM))
      .limit(1))[0];
  if (!row) throw new Error("The shop room could not be created");
  if (userId) {
    try {
      await db
        .insert(chatConversationMembers)
        .values({ conversationId: row.id, userId })
        .onConflictDoNothing({
          target: [chatConversationMembers.conversationId, chatConversationMembers.userId],
        });
    } catch {
      // The member does not exist (a made-up id) — no row, so no access.
      return null;
    }
  }
  return {
    id: row.id,
    room: row.room,
    kind: row.kind as ConversationKind,
    title: row.title ?? null,
    other: null,
    unread: 0,
    lastMessageAt: null,
  };
}

/** Find (or create) the private chat between two members. */
export async function ensureDirectConversation(
  db: Db | TxDb,
  userId: number,
  otherId: number,
): Promise<ChatConversation | null> {
  const room = directRoomName(userId, otherId);
  if (!room) return null;

  const [conversation] = await db
    .insert(chatConversations)
    .values({ room, kind: "direct" })
    .onConflictDoNothing({ target: chatConversations.room })
    .returning();
  const row =
    conversation ??
    (await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.room, room))
      .limit(1))[0];
  if (!row) return null;

  for (const member of [userId, otherId]) {
    await db
      .insert(chatConversationMembers)
      .values({ conversationId: row.id, userId: member })
      .onConflictDoNothing({
        target: [chatConversationMembers.conversationId, chatConversationMembers.userId],
      });
  }

  const other = await db
    .select({ id: appUsers.id, name: appUsers.name, role: appUsers.role })
    .from(appUsers)
    .where(eq(appUsers.id, otherId))
    .limit(1);

  return {
    id: row.id,
    room: row.room,
    kind: row.kind as ConversationKind,
    title: row.title ?? null,
    other: other[0] ?? null,
    unread: 0,
    lastMessageAt: null,
  };
}

/** Is this member part of the room? */
export async function isMember(
  db: Db | TxDb,
  room: string,
  userId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: chatConversationMembers.conversationId })
    .from(chatConversationMembers)
    .innerJoin(chatConversations, eq(chatConversations.id, chatConversationMembers.conversationId))
    .where(
      and(
        eq(chatConversations.room, room),
        eq(chatConversationMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Every conversation of a member: the shop room first, then the direct chats
 * by recent activity, with the unread count of each.
 */
export async function listConversations(db: Db, userId: number): Promise<ChatConversation[]> {
  await ensureGroupConversation(db, userId);
  const rows = await db.execute(sql`
    select c.id,
           c.room,
           c.kind,
           c.title,
           coalesce((
             select count(*) from chat_messages m
             where m.room = c.room
               and m.id > coalesce(cm.last_read_message_id, 0)
               and (m.user_id is null or m.user_id <> ${userId})
           ), 0)::int as unread,
           (select max(m.created_at) from chat_messages m where m.room = c.room)::text as last_message_at,
           (
             select json_build_object('id', u.id, 'name', u.name, 'role', u.role)
             from chat_conversation_members cm2
             join app_users u on u.id = cm2.user_id
             where cm2.conversation_id = c.id and cm2.user_id <> ${userId}
             limit 1
           ) as other
    from chat_conversations c
    join chat_conversation_members cm
      on cm.conversation_id = c.id and cm.user_id = ${userId}
    order by (c.room = 'main') desc, last_message_at desc nulls last, c.id desc
  `);

  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return (list as Array<{
    id: number;
    room: string;
    kind: ConversationKind;
    title: string | null;
    unread: number;
    last_message_at: string | null;
    other: ChatMember | null;
  }>).map((row) => ({
    id: row.id,
    room: row.room,
    kind: row.kind,
    title: row.title ?? null,
    other: row.other ?? null,
    unread: Number(row.unread ?? 0),
    lastMessageAt: row.last_message_at ?? null,
  }));
}

/** Mark a conversation as read up to a message. */
export async function markRead(
  db: Db | TxDb,
  room: string,
  userId: number,
  messageId?: number,
): Promise<void> {
  await db.execute(sql`
    update chat_conversation_members
    set last_read_message_id = greatest(coalesce(last_read_message_id, 0), coalesce(${messageId ?? 0}, 0)),
        last_read_at = now()
    where user_id = ${userId}
      and conversation_id = (select id from chat_conversations where room = ${room})
  `);
}

/**
 * How many unread messages does this member have in total?
 *
 * NOTE: the hand-written fragment below must use the **qualified column
 * names** (`${chatConversations.room}`), not the aliases `c` / `cm` — those
 * only exist in the raw query of `listConversations`. The query builder
 * generates `from "chat_conversations" inner join "chat_conversation_members"`
 * without any alias, so an alias here would fail with
 * "missing FROM-clause entry for table c".
 */
export async function unreadCount(db: Db, userId: number): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(
        (select count(*) from chat_messages m
         where m.room = ${chatConversations.room}
           and m.id > coalesce(${chatConversationMembers.lastReadMessageId}, 0)
           and (m.user_id is null or m.user_id <> ${userId})
        )), 0)::int`.mapWith(Number),
    })
    .from(chatConversations)
    .innerJoin(
      chatConversationMembers,
      eq(chatConversationMembers.conversationId, chatConversations.id),
    )
    .where(eq(chatConversationMembers.userId, userId));
  return row?.total ?? 0;
}

/** The members of the shop (who may be chatted with). */
export async function listChatMembers(db: Db): Promise<ChatMember[]> {
  const rows = await db
    .select({ id: appUsers.id, name: appUsers.name, role: appUsers.role })
    .from(appUsers)
    .where(eq(appUsers.active, true))
    .orderBy(desc(appUsers.name));
  return rows;
}
