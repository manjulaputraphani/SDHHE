import { beforeEach, describe, expect, it } from "vitest";
import { resetAll, setupTestDb } from "./test-utils";
import { insertMessage } from "./chat";
import {
  SHARED_ROOM,
  ensureDirectConversation,
  ensureGroupConversation,
  isMember,
  listConversations,
  markRead,
  unreadCount,
} from "./chatRooms";
import { appUsers } from "./schema";

const db = await setupTestDb();
const suite = db ? describe : describe.skip;

suite("Team Chat — conversations and unread", () => {
  beforeEach(async () => {
    if (db) await resetAll(db);
  });

  it("puts every member in the shop room", async () => {
    const [owner, staff] = await db!
      .insert(appUsers)
      .values([
        { name: "OWNER", phone: "9000000001", passwordHash: "x", role: "owner" },
        { name: "STAFF", phone: "9000000002", passwordHash: "x", role: "staff" },
      ])
      .returning();

    const room = await ensureGroupConversation(db!);
    expect(room.room).toBe(SHARED_ROOM);
    expect(room.kind).toBe("group");

    // The shop room is a conversation every member belongs to.
    await db!
      .insert((await import("./schema")).chatConversationMembers)
      .values([
        { conversationId: room.id, userId: owner.id },
        { conversationId: room.id, userId: staff.id },
      ])
      .onConflictDoNothing();

    expect(await isMember(db!, SHARED_ROOM, owner.id)).toBe(true);
    expect(await isMember(db!, SHARED_ROOM, staff.id)).toBe(true);
  });

  it("creates the same private room for both people", async () => {
    const [a, b] = await db!
      .insert(appUsers)
      .values([
        { name: "A", phone: "9000000003", passwordHash: "x", role: "staff" },
        { name: "B", phone: "9000000004", passwordHash: "x", role: "staff" },
      ])
      .returning();

    const first = await ensureDirectConversation(db!, a.id, b.id);
    const second = await ensureDirectConversation(db!, b.id, a.id);
    expect(first?.room).toBe(second?.room);
    expect(first?.kind).toBe("direct");
    expect(first?.other?.name).toBe("B");
    expect(second?.other?.name).toBe("A");

    expect(await isMember(db!, first!.room, a.id)).toBe(true);
    expect(await isMember(db!, first!.room, b.id)).toBe(true);
  });

  it("counts the unread messages of the other member and clears them", async () => {
    const [a, b] = await db!
      .insert(appUsers)
      .values([
        { name: "A", phone: "9000000005", passwordHash: "x", role: "staff" },
        { name: "B", phone: "9000000006", passwordHash: "x", role: "staff" },
      ])
      .returning();
    const conversation = await ensureDirectConversation(db!, a.id, b.id);
    const room = conversation!.room;

    const message = await insertMessage(db!, {
      userId: b.id,
      author: "B",
      role: "staff",
      kind: "text",
      body: "Are you there?",
      room,
    });

    expect(await unreadCount(db!, a.id)).toBe(1);
    expect(await unreadCount(db!, b.id)).toBe(0);

    const list = await listConversations(db!, a.id);
    const entry = list.find((c) => c.room === room);
    expect(entry?.unread).toBe(1);

    await markRead(db!, room, a.id, message.id);
    expect(await unreadCount(db!, a.id)).toBe(0);
  });
});
