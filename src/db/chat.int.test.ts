import { beforeEach, describe, expect, it } from "vitest";
import { resetAll, setupTestDb } from "./test-utils";
import {
  createReceipt,
  decideReceipt,
  deleteMessage,
  getReceipt,
  insertMessage,
  linkReceiptMessage,
  listMessages,
  listPinnedMessages,
  listReceipts,
  pendingReceiptCount,
  pinMessage,
  setReaction,
  unpinMessage,
  updateMessage,
} from "./chat";
import { sql } from "drizzle-orm";
import { chatMessageEdits } from "./schema";

const db = await setupTestDb();
const suite = db ? describe : describe.skip;

const receipt = {
  r2Key: "receipts/2026-11-06/1.jpg",
  filename: "transport.jpg",
  mime: "image/jpeg",
  sizeBytes: 2048,
  title: "Transport bill",
  amountPaise: 45000,
};

suite("Team Chat — messages and receipt approvals", () => {
  beforeEach(async () => {
    if (db) await resetAll(db);
  });

  it("keeps the room history oldest first", async () => {
    await insertMessage(db!, { userId: null, author: "ANITA", kind: "text", body: "one" });
    await insertMessage(db!, { userId: null, author: "RAJU", kind: "text", body: "two" });

    const messages = await listMessages(db!);
    expect(messages.map((m) => m.body)).toEqual(["one", "two"]);
    expect(messages[0].createdAt).not.toBe(messages[1].createdAt);
  });

  it("stores and returns a multi-line message with the exact lines (T-16.1)", async () => {
    await insertMessage(db!, { userId: null, author: "ANITA", kind: "text", body: "A\n\nB\nC" });
    const [message] = await listMessages(db!);
    expect(message.body).toBe("A\n\nB\nC");
  });

  it("keeps the previous version of an edit in the audit table (T-16.2)", async () => {
    const message = await insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "first" });
    const edited = await updateMessage(db!, message.id, { userId: 7, body: "second" });
    expect(edited.body).toBe("second");
    expect(edited.editedAt).toBeDefined();

    const rows = await db!.select().from(chatMessageEdits);
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe(message.id);
    expect(rows[0].oldBody).toBe("first");
    expect(rows[0].editedBy).toBe(7);
  });

  it("refuses an edit after the 15-minute window (T-16.2)", async () => {
    const message = await insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "first" });
    // The message pretends to be 16 minutes old.
    await db!.execute(sql`update chat_messages set created_at = now() - interval '16 minutes' where id = ${message.id}`);
    await expect(
      updateMessage(db!, message.id, { userId: 7, body: "too late" }),
    ).rejects.toThrow(/15 minutes/);
  });

  it("soft-deletes an own message; others may not; the owner may delete any (T-16.2)", async () => {
    const message = await insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "mine" });
    const deleted = await deleteMessage(db!, message.id, { userId: 7, role: "staff" });
    expect(deleted.deleted).toBe(true);

    const other = await insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "theirs" });
    await expect(deleteMessage(db!, other.id, { userId: 8, role: "staff" })).rejects.toThrow(
      /Not authorized/,
    );
    const byOwner = await deleteMessage(db!, other.id, { userId: 1, role: "owner" });
    expect(byOwner.deleted).toBe(true);
  });

  it("stores and returns the reply target of a message (T-16.4)", async () => {
    const original = await insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "First" });
    const reply = await insertMessage(db!, {
      userId: 8,
      author: "RAJU",
      kind: "text",
      body: "Reply",
      replyToId: original.id,
    });
    expect(reply.replyToId).toBe(original.id);
    const [loaded] = await listMessages(db!);
    expect(loaded.replyToId).toBe(original.id);
  });

  it("adds, replaces and removes one reaction per member (T-16.4)", async () => {
    const message = await insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "Nice" });
    expect((await setReaction(db!, message.id, 7, "👍")).map((r) => r.emoji)).toEqual(["👍"]);
    expect((await setReaction(db!, message.id, 8, "👍")).map((r) => r.emoji)).toEqual(["👍", "👍"]);
    // A new emoji replaces the old one.
    expect((await setReaction(db!, message.id, 7, "🔥")).map((r) => r.emoji).sort()).toEqual(["🔥", "👍"]);
    // The same member again removes it.
    expect((await setReaction(db!, message.id, 7, null)).map((r) => r.emoji)).toEqual(["👍"]);
  });

  it("pins at most three messages per room (T-16.4)", async () => {
    const make = () => insertMessage(db!, { userId: 7, author: "ANITA", kind: "text", body: "pin me" });
    const a = await make();
    const b = await make();
    const c = await make();
    const d = await make();
    expect(await pinMessage(db!, "main", a.id, 1)).toHaveLength(1);
    expect(await pinMessage(db!, "main", b.id, 1)).toHaveLength(2);
    expect(await pinMessage(db!, "main", c.id, 1)).toHaveLength(3);
    await expect(pinMessage(db!, "main", d.id, 1)).rejects.toThrow(/Only 3/);
    await unpinMessage(db!, a.id);
    expect(await listPinnedMessages(db!, "main")).toHaveLength(2);
  });

  it("returns only the newest messages when a limit is given", async () => {
    for (const body of ["one", "two", "three"]) {
      await insertMessage(db!, { userId: null, author: "ANITA", kind: "text", body });
    }
    const messages = await listMessages(db!, { limit: 2 });
    expect(messages.map((m) => m.body)).toEqual(["two", "three"]);
  });

  it("creates a pending receipt and counts it", async () => {
    const created = await createReceipt(db!, {
      submittedBy: null,
      submitterName: "RAJU",
      receipt,
    });
    expect(created.status).toBe("pending");
    expect(created.amountPaise).toBe(45000);
    expect(await pendingReceiptCount(db!)).toBe(1);
    expect(await listReceipts(db!, { status: "pending" })).toHaveLength(1);
  });

  it("approves a receipt once and refuses a second decision", async () => {
    const created = await createReceipt(db!, {
      submittedBy: null,
      submitterName: "RAJU",
      receipt,
    });

    const decided = await decideReceipt(
      db!,
      created.id,
      { decision: "approve", note: "checked" },
      { userId: 1, name: "B PHANI KUMAR" },
    );
    expect(decided.status).toBe("approved");
    expect(decided.deciderName).toBe("B PHANI KUMAR");
    expect(decided.decisionNote).toBe("checked");
    expect(decided.decidedAt).not.toBeNull();

    await expect(
      decideReceipt(db!, created.id, { decision: "reject" }, { userId: 1, name: "X" }),
    ).rejects.toThrow(/already decided/i);
    expect(await pendingReceiptCount(db!)).toBe(0);
  });

  it("links a receipt to the message that shows it", async () => {
    const created = await createReceipt(db!, {
      submittedBy: null,
      submitterName: "RAJU",
      receipt,
    });
    const message = await insertMessage(db!, {
      userId: null,
      author: "RAJU",
      kind: "receipt",
      body: "Transport bill",
      receiptId: created.id,
    });
    await linkReceiptMessage(db!, created.id, message.id);

    const stored = await getReceipt(db!, created.id);
    expect(stored?.messageId).toBe(message.id);
    expect((await listMessages(db!))[0].receiptId).toBe(created.id);
  });
});
