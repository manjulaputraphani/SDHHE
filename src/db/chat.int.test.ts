import { beforeEach, describe, expect, it } from "vitest";
import { resetAll, setupTestDb } from "./test-utils";
import {
  createReceipt,
  decideReceipt,
  getReceipt,
  insertMessage,
  linkReceiptMessage,
  listMessages,
  listReceipts,
  pendingReceiptCount,
} from "./chat";

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
