import { beforeEach, describe, expect, it } from "vitest";
import { resetAll, setupTestDb } from "./test-utils";
import { insertMessage } from "./chat";
import {
  SHARED_ROOM,
  addConversationMember,
  ensureGroupConversation,
  isMember,
  listConversations,
  markRead,
  unreadCount,
} from "./chatRooms";
import { appUsers } from "./schema";

const db = await setupTestDb();
const suite = db ? describe : describe.skip;

suite("Team Chat — read marks clear unread (groups + 1:1)", () => {
  beforeEach(async () => {
    if (db) await resetAll(db);
  });

  it("clears the group badge for every member when one reads up to a message", async () => {
    const [owner, ravi, suresh] = await db!
      .insert(appUsers)
      .values([
        { name: "OWNER", phone: "9000000010", passwordHash: "x", role: "owner" },
        { name: "RAVI", phone: "9000000011", passwordHash: "x", role: "staff" },
        { name: "SURESH", phone: "9000000012", passwordHash: "x", role: "staff" },
      ])
      .returning();

    const room = await ensureGroupConversation(db!, owner.id);
    expect(room?.room).toBe(SHARED_ROOM);
    for (const u of [owner.id, ravi.id, suresh.id]) {
      await addConversationMember(db!, SHARED_ROOM, u);
      expect(await isMember(db!, SHARED_ROOM, u)).toBe(true);
    }

    // RAVI sends two messages to the shop room.
    const m1 = await insertMessage(db!, {
      userId: ravi.id,
      author: "RAVI",
      role: "staff",
      kind: "text",
      body: "first",
      room: SHARED_ROOM,
    });
    const m2 = await insertMessage(db!, {
      userId: ravi.id,
      author: "RAVI",
      role: "staff",
      kind: "text",
      body: "second",
      room: SHARED_ROOM,
    });

    // OWNER has 2 unread.
    expect(await unreadCount(db!, owner.id)).toBe(2);
    const before = await listConversations(db!, owner.id);
    expect(before.find((c) => c.room === SHARED_ROOM)?.unread).toBe(2);

    // OWNER reads up to m2 → everything <= m2 is read, badge clears.
    await markRead(db!, SHARED_ROOM, owner.id, m2.id);
    expect(await unreadCount(db!, owner.id)).toBe(0);
    const after = await listConversations(db!, owner.id);
    expect(after.find((c) => c.room === SHARED_ROOM)?.unread).toBe(0);

    // SURESH still has 2 unread (read is per-member).
    expect(await unreadCount(db!, suresh.id)).toBe(2);
  });

  it("marks all messages in the room read when no message id is given", async () => {
    const [a, b] = await db!
      .insert(appUsers)
      .values([
        { name: "A", phone: "9000000013", passwordHash: "x", role: "staff" },
        { name: "B", phone: "9000000014", passwordHash: "x", role: "staff" },
      ])
      .returning();
    const conversation = await ensureGroupConversation(db!, a.id);
    for (const u of [a.id, b.id]) await addConversationMember(db!, conversation!.room, u);

    await insertMessage(db!, {
      userId: b.id,
      author: "B",
      role: "staff",
      kind: "text",
      body: "hello",
      room: conversation!.room,
    });

    expect(await unreadCount(db!, a.id)).toBe(1);
    await markRead(db!, conversation!.room, a.id);
    expect(await unreadCount(db!, a.id)).toBe(0);
  });
});
