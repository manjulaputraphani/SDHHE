import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { resetAll, setupTestDb } from "./test-utils";
import { insertMessage } from "./chat";
import {
  SHARED_ROOM,
  addConversationMember,
  archiveConversation,
  createGroupConversation,
  ensureDirectConversation,
  ensureGroupConversation,
  isMember,
  listConversationMembers,
  listConversations,
  markRead,
  polishEnabled,
  removeConversationMember,
  renameConversation,
  setAiPolish,
  unreadCount,
} from "./chatRooms";
import { appUsers, chatConversations } from "./schema";

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
    expect(room?.room).toBe(SHARED_ROOM);
    expect(room?.kind).toBe("group");

    // The shop room is a conversation every member belongs to.
    await db!
      .insert((await import("./schema")).chatConversationMembers)
      .values([
        { conversationId: room!.id, userId: owner.id },
        { conversationId: room!.id, userId: staff.id },
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

suite("Chat groups (Phase 14)", () => {
  beforeEach(async () => {
    if (db) await resetAll(db);
  });

  /** The owner and two staff — the people the owner can group. */
  async function seed() {
    return db!
      .insert(appUsers)
      .values([
        { name: "OWNER", phone: "9000000010", passwordHash: "x", role: "owner" },
        { name: "RAVI", phone: "9000000011", passwordHash: "x", role: "staff" },
        { name: "SURESH", phone: "9000000012", passwordHash: "x", role: "staff" },
      ])
      .returning();
  }

  it("creates a group with the members the owner picked", async () => {
    const [owner, ravi, suresh] = await seed();
    const group = await createGroupConversation(db!, {
      room: "group-purchase-team",
      title: "  Purchase team ",
      memberIds: [owner.id, ravi.id, suresh.id],
    });

    expect(group?.kind).toBe("group");
    expect(group?.title).toBe("Purchase team");
    expect(await isMember(db!, "group-purchase-team", ravi.id)).toBe(true);
    expect(await isMember(db!, "group-purchase-team", suresh.id)).toBe(true);

    const names = await listConversationMembers(db!, "group-purchase-team");
    expect(names.map((member) => member.name).sort()).toEqual(["OWNER", "RAVI", "SURESH"]);
  });

  it("refuses a group without a name or with a made-up room", async () => {
    const [owner] = await seed();
    expect(
      await createGroupConversation(db!, { room: "group-x", title: "   ", memberIds: [owner.id] }),
    ).toBeNull();
    expect(
      await createGroupConversation(db!, { room: "dm-1-2", title: "No", memberIds: [owner.id] }),
    ).toBeNull();
  });

  it("adds and removes a member", async () => {
    const [owner, ravi, suresh] = await seed();
    const group = await createGroupConversation(db!, {
      room: "group-buy",
      title: "Buyers",
      memberIds: [owner.id, ravi.id],
    });

    expect(await addConversationMember(db!, group!.room, suresh.id)).toBe(true);
    expect(await isMember(db!, group!.room, suresh.id)).toBe(true);

    expect(await removeConversationMember(db!, group!.room, suresh.id)).toBe(true);
    expect(await isMember(db!, group!.room, suresh.id)).toBe(false);
    // A member who is already gone cannot be removed twice.
    expect(await removeConversationMember(db!, group!.room, suresh.id)).toBe(false);
  });

  it("never touches the shop room or a private chat", async () => {
    const [owner, ravi, suresh] = await seed();
    const direct = await ensureDirectConversation(db!, ravi.id, suresh.id);

    expect(await addConversationMember(db!, SHARED_ROOM, ravi.id)).toBe(false);
    expect(await removeConversationMember(db!, SHARED_ROOM, ravi.id)).toBe(false);
    expect(await addConversationMember(db!, direct!.room, owner.id)).toBe(false);
    expect(await removeConversationMember(db!, direct!.room, ravi.id)).toBe(false);
    expect(await archiveConversation(db!, SHARED_ROOM)).toBe(false);
    expect(await archiveConversation(db!, direct!.room)).toBe(false);
  });

  it("archives a group — it leaves the lists and nobody may read it", async () => {
    const [owner, ravi] = await seed();
    const group = await createGroupConversation(db!, {
      room: "group-old",
      title: "Old crew",
      memberIds: [owner.id, ravi.id],
    });

    expect(await archiveConversation(db!, group!.room)).toBe(true);
    // A retired group cannot be archived twice…
    expect(await archiveConversation(db!, group!.room)).toBe(false);
    // …and its members may no longer read it.
    expect(await isMember(db!, group!.room, ravi.id)).toBe(false);

    const list = await listConversations(db!, owner.id);
    expect(list.some((entry) => entry.room === group!.room)).toBe(false);
    expect(await unreadCount(db!, ravi.id)).toBe(0);

    // The messages stay in the database (a group is never hard-deleted).
    const [kept] = await db!
      .select()
      .from(chatConversations)
      .where(sql`${chatConversations.room} = ${group!.room}`);
    expect(kept.archivedAt).not.toBeNull();
  });

  it("cannot rename a retired group", async () => {
    const [owner] = await seed();
    const group = await createGroupConversation(db!, {
      room: "group-renamed",
      title: "Before",
      memberIds: [owner.id],
    });
    expect(await archiveConversation(db!, group!.room)).toBe(true);
    expect(await renameConversation(db!, group!.room, "After")).toBeNull();
  });
});

suite("AI polish per group (Phase 15 — T-15.1)", () => {
  beforeEach(async () => {
    if (db) await resetAll(db);
  });

  async function seed() {
    return db!
      .insert(appUsers)
      .values([
        { name: "OWNER", phone: "9000000020", passwordHash: "x", role: "owner" },
        { name: "RAVI", phone: "9000000021", passwordHash: "x", role: "staff" },
        { name: "SURESH", phone: "9000000022", passwordHash: "x", role: "staff" },
      ])
      .returning();
  }

  it("is off until the owner turns it on — for the shop room too", async () => {
    const [owner] = await seed();

    expect(await polishEnabled(db!, SHARED_ROOM)).toBe(false);
    expect(await setAiPolish(db!, SHARED_ROOM, true)).toBe(true);
    expect(await polishEnabled(db!, SHARED_ROOM)).toBe(true);
    expect(await setAiPolish(db!, SHARED_ROOM, false)).toBe(true);
    expect(await polishEnabled(db!, SHARED_ROOM)).toBe(false);
    expect(owner.id).toBeGreaterThan(0);
  });

  it("the conversation list carries the flag", async () => {
    await seed();
    await setAiPolish(db!, SHARED_ROOM, true);

    const list = await listConversations(db!, 1);
    const shop = list.find((entry) => entry.room === SHARED_ROOM);
    expect(shop?.aiPolish).toBe(true);
  });

  it("is never on for a private chat or a retired group", async () => {
    const [, ravi, suresh] = await seed();
    const direct = await ensureDirectConversation(db!, ravi.id, suresh.id);
    const group = await createGroupConversation(db!, {
      room: "group-polish",
      title: "Polish crew",
      memberIds: [ravi.id],
    });

    expect(await setAiPolish(db!, direct!.room, true)).toBe(false);
    expect(await polishEnabled(db!, direct!.room)).toBe(false);

    expect(await setAiPolish(db!, group!.room, true)).toBe(true);
    await archiveConversation(db!, group!.room);
    expect(await polishEnabled(db!, group!.room)).toBe(false);
  });
});
