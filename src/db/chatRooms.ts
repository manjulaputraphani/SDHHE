/**
 * Direct chat (Phase 13) — conversations, members and unread counts.
 *
 * The shop room ("main") is a group conversation. Every other conversation is
 * a private chat between two members; its room name is `dm-<smallId>-<bigId>`
 * so both people always end up in the same room.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import { isGroupRoom } from "../logic/chatPrivacy";
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
  /** The newest message of the room — shown as a one-line preview in the list (Phase 2). */
  lastMessage: { author: string; body: string; kind: string; createdAt: string } | null;
  /** AI polish (Phase 15): the owner turned it on for this group. */
  aiPolish: boolean;
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
    .where(and(eq(chatConversations.room, room), isNull(chatConversations.archivedAt)))
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
    lastMessage: null,
    aiPolish: Boolean(row.aiPolish),
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
    lastMessage: null,
    aiPolish: Boolean(row.aiPolish),
  };
}

/** Is this member part of the room? (a retired group lets nobody in) */
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
        isNull(chatConversations.archivedAt),
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
           c.ai_polish,
           coalesce((
             select count(*) from chat_messages m
             where m.room = c.room
               and m.id > coalesce(cm.last_read_message_id, 0)
               and (m.user_id is null or m.user_id <> ${userId})
           ), 0)::int as unread,
           (select max(m.created_at) from chat_messages m where m.room = c.room)::text as last_message_at,
            (
              select json_build_object(
                'author', m.author, 'body', m.body, 'kind', m.kind, 'createdAt', m.created_at
              )
              from chat_messages m where m.room = c.room
              order by m.id desc limit 1
            ) as last_message,
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
    where c.archived_at is null
    order by (c.room = 'main') desc, last_message_at desc nulls last, c.id desc
  `);

  const list = (rows as unknown as { rows?: unknown[] }).rows ?? (rows as unknown as unknown[]);
  return (list as Array<{
    id: number;
    room: string;
    kind: ConversationKind;
    title: string | null;
    ai_polish: boolean;
    unread: number;
    last_message_at: string | null;
    last_message: { author: string; body: string; kind: string; createdAt: Date | string } | null;
    other: ChatMember | null;
  }>).map((row) => ({
    id: row.id,
    room: row.room,
    kind: row.kind,
    title: row.title ?? null,
    other: row.other ?? null,
    unread: Number(row.unread ?? 0),
    lastMessageAt: row.last_message_at ?? null,
    aiPolish: Boolean(row.ai_polish),
    lastMessage: row.last_message
      ? {
          author: row.last_message.author,
          body: row.last_message.body,
          kind: row.last_message.kind,
          createdAt: new Date(row.last_message.createdAt).toISOString(),
        }
      : null,
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
    .where(
      and(
        eq(chatConversationMembers.userId, userId),
        isNull(chatConversations.archivedAt),
      ),
    );
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

// ---- Chat groups (Phase 14) — the owner makes them and picks the members ----

/** A member of a conversation, with the online dot of the header popup. */
export type ConversationMember = ChatMember & {
  lastSeenAt: string | null;
};

/** The live conversation of a room (null when it does not exist or is retired). */
async function liveConversation(
  db: Db | TxDb,
  room: string,
): Promise<{ id: number; kind: string } | null> {
  const [row] = await db
    .select({ id: chatConversations.id, kind: chatConversations.kind })
    .from(chatConversations)
    .where(and(eq(chatConversations.room, room), isNull(chatConversations.archivedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a group the owner made (Phase 14).
 *
 * Null when the name is empty, the room is not a group room, or one of the
 * members does not exist — nothing is written in that case.
 */
export async function createGroupConversation(
  db: Db | TxDb,
  options: { room: string; title: string; memberIds: number[] },
): Promise<ChatConversation | null> {
  const name = options.title.trim().slice(0, 60);
  if (!name || !isGroupRoom(options.room)) return null;

  const wanted = [...new Set(options.memberIds)].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (wanted.length === 0) return null;
  // Every picked member must exist — a group is never created half-full.
  const known = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(inArray(appUsers.id, wanted));
  if (known.length !== wanted.length) return null;

  const [conversation] = await db
    .insert(chatConversations)
    .values({ room: options.room, kind: "group", title: name })
    .onConflictDoNothing({ target: chatConversations.room })
    .returning();
  const row =
    conversation ??
    (await db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.room, options.room))
      .limit(1))[0];
  if (!row) throw new Error("The group could not be created");

  for (const member of wanted) {
    await db
      .insert(chatConversationMembers)
      .values({ conversationId: row.id, userId: member })
      .onConflictDoNothing({
        target: [chatConversationMembers.conversationId, chatConversationMembers.userId],
      });
  }

  return {
    id: row.id,
    room: row.room,
    kind: row.kind as ConversationKind,
    title: row.title ?? null,
    other: null,
    unread: 0,
    lastMessageAt: null,
    lastMessage: null,
    aiPolish: Boolean(row.aiPolish),
  };
}

/** The members of a conversation — the header popup and the owner's menu. */
export async function listConversationMembers(
  db: Db | TxDb,
  room: string,
): Promise<ConversationMember[]> {
  const rows = await db
    .select({
      id: appUsers.id,
      name: appUsers.name,
      role: appUsers.role,
      lastSeenAt: appUsers.lastSeenAt,
    })
    .from(chatConversationMembers)
    .innerJoin(chatConversations, eq(chatConversations.id, chatConversationMembers.conversationId))
    .innerJoin(appUsers, eq(appUsers.id, chatConversationMembers.userId))
    .where(
      and(
        eq(chatConversations.room, room),
        isNull(chatConversations.archivedAt),
        eq(appUsers.active, true),
      ),
    )
    .orderBy(desc(appUsers.name));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
  }));
}

/** Add a member to an owner-made group (false: not a live group, or a made-up id). */
export async function addConversationMember(
  db: Db | TxDb,
  room: string,
  userId: number,
): Promise<boolean> {
  if (!isGroupRoom(room) || room === SHARED_ROOM) return false;
  const conversation = await liveConversation(db, room);
  if (!conversation || conversation.kind !== "group") return false;
  try {
    await db
      .insert(chatConversationMembers)
      .values({ conversationId: conversation.id, userId })
      .onConflictDoNothing({
        target: [chatConversationMembers.conversationId, chatConversationMembers.userId],
      });
  } catch {
    // A made-up member id — the row is not written, so no access.
    return false;
  }
  return true;
}

/** Remove a member from an owner-made group (false: not a live group, or not a member). */
export async function removeConversationMember(
  db: Db | TxDb,
  room: string,
  userId: number,
): Promise<boolean> {
  if (!isGroupRoom(room) || room === SHARED_ROOM) return false;
  const conversation = await liveConversation(db, room);
  if (!conversation || conversation.kind !== "group") return false;
  const removed = await db
    .delete(chatConversationMembers)
    .where(
      and(
        eq(chatConversationMembers.conversationId, conversation.id),
        eq(chatConversationMembers.userId, userId),
      ),
    )
    .returning();
  return removed.length > 0;
}

/** Retire a group — it leaves every list, but is never hard-deleted. */
export async function archiveConversation(db: Db | TxDb, room: string): Promise<boolean> {
  if (!isGroupRoom(room) || room === SHARED_ROOM) return false;
  const [updated] = await db
    .update(chatConversations)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(chatConversations.room, room),
        eq(chatConversations.kind, "group"),
        isNull(chatConversations.archivedAt),
      ),
    )
    .returning();
  return Boolean(updated);
}

// ---- AI polish (Phase 15, T-15.1) — per group, switched by the owner ----

/**
 * Turn AI polish on or off for a room (the Worker checks that the owner is
 * asking). Only a live group can carry it — never a private chat, never a
 * retired room. The shop room counts as a group.
 */
export async function setAiPolish(
  db: Db | TxDb,
  room: string,
  enabled: boolean,
): Promise<boolean> {
  const [updated] = await db
    .update(chatConversations)
    .set({ aiPolish: enabled })
    .where(
      and(
        eq(chatConversations.room, room),
        eq(chatConversations.kind, "group"),
        isNull(chatConversations.archivedAt),
      ),
    )
    .returning();
  return Boolean(updated);
}

/** Is AI polish turned on for this room? (false for private and retired rooms) */
export async function polishEnabled(db: Db | TxDb, room: string): Promise<boolean> {
  const [row] = await db
    .select({ aiPolish: chatConversations.aiPolish })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.room, room),
        eq(chatConversations.kind, "group"),
        isNull(chatConversations.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row?.aiPolish);
}
