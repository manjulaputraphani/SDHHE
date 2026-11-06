import { describe, it, expect } from "vitest";
import { parseMessageInput, parseReceiptInput, parseDecision, toMessage, toReceipt } from "./chat";
import { MAX_MESSAGE_CHARS, MAX_RECEIPT_BYTES } from "../logic/chat";

const file = {
  r2Key: "receipts/2026-11-06/12.jpg",
  filename: "transport.jpg",
  mime: "image/jpeg",
  sizeBytes: 1024,
};

describe("parseMessageInput", () => {
  it("trims a text message", () => {
    const parsed = parseMessageInput({ kind: "text", body: "  Baki stock?  " });
    expect(parsed.kind).toBe("text");
    expect(parsed.body).toBe("Baki stock?");
    expect(parsed.receipt).toBeUndefined();
  });

  it("refuses an empty message", () => {
    expect(() => parseMessageInput({ kind: "text", body: "   " })).toThrow(/Message cannot be empty/i);
  });

  it("refuses a message that is too long", () => {
    expect(() => parseMessageInput({ kind: "text", body: "x".repeat(MAX_MESSAGE_CHARS + 1) })).toThrow(
      /too long/i,
    );
  });

  it("refuses an unknown kind", () => {
    expect(() => parseMessageInput({ kind: "system", body: "hi" })).toThrow(/text or receipt/i);
  });

  it("accepts a receipt message and keeps the file details", () => {
    const parsed = parseMessageInput({
      kind: "receipt",
      body: "Transport bill",
      receipt: { ...file, title: "Transport", amountPaise: 45000, note: "Today" },
    });
    expect(parsed.kind).toBe("receipt");
    expect(parsed.body).toBe("Transport bill");
    expect(parsed.receipt?.amountPaise).toBe(45000);
    expect(parsed.receipt?.r2Key).toBe(file.r2Key);
  });

  it("refuses a receipt message without the receipt details", () => {
    expect(() => parseMessageInput({ kind: "receipt", body: "hi" })).toThrow(/receipt/i);
  });
});

describe("parseReceiptInput", () => {
  it("keeps the amount in paise and trims the text", () => {
    const parsed = parseReceiptInput({
      ...file,
      title: "  Transport bill  ",
      amountPaise: 45000,
      note: "  Paid today  ",
    });
    expect(parsed.title).toBe("Transport bill");
    expect(parsed.amountPaise).toBe(45000);
    expect(parsed.note).toBe("Paid today");
  });

  it("requires a title", () => {
    expect(() => parseReceiptInput({ ...file, title: "  ", amountPaise: 100 })).toThrow(
      /Title is required/i,
    );
  });

  it("requires a positive whole amount in paise", () => {
    expect(() => parseReceiptInput({ ...file, title: "x", amountPaise: 0 })).toThrow(/more than 0/i);
    expect(() => parseReceiptInput({ ...file, title: "x", amountPaise: -5 })).toThrow(/more than 0/i);
    expect(() => parseReceiptInput({ ...file, title: "x", amountPaise: 12.5 })).toThrow(
      /whole number/i,
    );
  });

  it("refuses a file type that is not an image or a pdf", () => {
    expect(() => parseReceiptInput({ ...file, mime: "text/plain", title: "x", amountPaise: 100 })).toThrow(
      /image or PDF/i,
    );
  });

  it("refuses a file bigger than 4 MB", () => {
    expect(() =>
      parseReceiptInput({ ...file, sizeBytes: MAX_RECEIPT_BYTES + 1, title: "x", amountPaise: 100 }),
    ).toThrow(/4 MB/i);
  });

  it("refuses a negative file size", () => {
    expect(() => parseReceiptInput({ ...file, sizeBytes: -1, title: "x", amountPaise: 100 })).toThrow(
      /size/i,
    );
  });

  it("requires the file itself", () => {
    expect(() => parseReceiptInput({ title: "x", amountPaise: 100 })).toThrow(/file/i);
  });
});

describe("parseDecision", () => {
  it("accepts approve and reject", () => {
    expect(parseDecision({ decision: "approve" }).decision).toBe("approved");
    expect(parseDecision({ decision: "reject" }).decision).toBe("rejected");
  });

  it("trims the note", () => {
    expect(parseDecision({ decision: "approve", note: "  ok  " }).note).toBe("ok");
  });

  it("refuses any other decision", () => {
    expect(() => parseDecision({ decision: "maybe" })).toThrow(/approve or reject/i);
  });
});

describe("row mapping", () => {
  it("maps a message row to the API shape", () => {
    const at = new Date("2026-11-06T09:42:00.000Z");
    expect(
      toMessage({
        id: 7,
        room: "main",
        userId: 3,
        author: "ANITA",
        role: "staff",
        kind: "text",
        body: "Baki stock?",
        receiptId: null,
        createdAt: at,
      }),
    ).toEqual({
      id: 7,
      room: "main",
      userId: 3,
      author: "ANITA",
      role: "staff",
      kind: "text",
      body: "Baki stock?",
      receiptId: null,
      createdAt: "2026-11-06T09:42:00.000Z",
    });
  });

  it("maps a receipt row to the API shape", () => {
    const at = new Date("2026-11-06T09:45:00.000Z");
    const decided = new Date("2026-11-06T09:47:00.000Z");
    expect(
      toReceipt({
        id: 12,
        submittedBy: 5,
        submitterName: "RAJU",
        title: "Transport bill",
        amountPaise: 45000,
        note: null,
        r2Key: "receipts/2026-11-06/12.jpg",
        filename: "transport.jpg",
        mime: "image/jpeg",
        sizeBytes: 1024,
        status: "approved",
        decidedBy: 1,
        deciderName: "B PHANI KUMAR",
        decisionNote: "ok",
        decidedAt: decided,
        messageId: 9,
        createdAt: at,
      }),
    ).toEqual({
      id: 12,
      submittedBy: 5,
      submitterName: "RAJU",
      title: "Transport bill",
      amountPaise: 45000,
      note: null,
      r2Key: "receipts/2026-11-06/12.jpg",
      filename: "transport.jpg",
      mime: "image/jpeg",
      sizeBytes: 1024,
      status: "approved",
      decidedBy: 1,
      deciderName: "B PHANI KUMAR",
      decisionNote: "ok",
      decidedAt: "2026-11-06T09:47:00.000Z",
      messageId: 9,
      createdAt: "2026-11-06T09:45:00.000Z",
    });
  });
});
