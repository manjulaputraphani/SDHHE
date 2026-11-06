import { describe, it, expect } from "vitest";
import {
  CHAT_ROOM_DEFAULT,
  MAX_MESSAGE_CHARS,
  MAX_RECEIPT_BYTES,
  RECEIPT_MIME_TYPES,
  canApproveReceipts,
  canDecideReceipt,
  chatMessagePreview,
  formatChatDayLabel,
  formatChatTime,
  isReceiptMimeAllowed,
  pendingBadgeLabel,
  receiptFileExtension,
  receiptStatusLabel,
  receiptStatusTone,
} from "./chat";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions";

describe("chat limits", () => {
  it("uses one room for the whole shop", () => {
    expect(CHAT_ROOM_DEFAULT).toBe("main");
  });

  it("caps a message at 2000 characters", () => {
    expect(MAX_MESSAGE_CHARS).toBe(2000);
  });

  it("caps a receipt file at 4 MB", () => {
    expect(MAX_RECEIPT_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("isReceiptMimeAllowed", () => {
  it("allows the listed image types and pdf", () => {
    for (const mime of RECEIPT_MIME_TYPES) {
      expect(isReceiptMimeAllowed(mime)).toBe(true);
    }
    expect(isReceiptMimeAllowed("image/jpeg")).toBe(true);
    expect(isReceiptMimeAllowed("application/pdf")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isReceiptMimeAllowed("text/plain")).toBe(false);
    expect(isReceiptMimeAllowed("application/zip")).toBe(false);
    expect(isReceiptMimeAllowed("application/octet-stream")).toBe(false);
    expect(isReceiptMimeAllowed("")).toBe(false);
  });

  it("ignores the case and any parameters", () => {
    expect(isReceiptMimeAllowed("IMAGE/PNG")).toBe(true);
    expect(isReceiptMimeAllowed("application/pdf; charset=binary")).toBe(true);
  });
});

describe("receiptFileExtension", () => {
  it("maps the mime type to an extension", () => {
    expect(receiptFileExtension("image/jpeg")).toBe("jpg");
    expect(receiptFileExtension("image/png")).toBe("png");
    expect(receiptFileExtension("image/webp")).toBe("webp");
    expect(receiptFileExtension("image/heic")).toBe("heic");
    expect(receiptFileExtension("image/gif")).toBe("gif");
    expect(receiptFileExtension("application/pdf")).toBe("pdf");
  });

  it("falls back to bin for an unknown type", () => {
    expect(receiptFileExtension("application/octet-stream")).toBe("bin");
  });
});

describe("receipt status", () => {
  it("labels every status", () => {
    expect(receiptStatusLabel("pending")).toBe("Pending approval");
    expect(receiptStatusLabel("approved")).toBe("Approved");
    expect(receiptStatusLabel("rejected")).toBe("Rejected");
  });

  it("uses the app badge tones", () => {
    expect(receiptStatusTone("pending")).toBe("warn");
    expect(receiptStatusTone("approved")).toBe("ok");
    expect(receiptStatusTone("rejected")).toBe("bad");
  });

  it("only a pending receipt can still be decided", () => {
    expect(canDecideReceipt("pending")).toBe(true);
    expect(canDecideReceipt("approved")).toBe(false);
    expect(canDecideReceipt("rejected")).toBe(false);
  });
});

describe("canApproveReceipts", () => {
  it("needs the chat:edit permission", () => {
    expect(canApproveReceipts(DEFAULT_ROLE_PERMISSIONS.owner)).toBe(true);
    expect(canApproveReceipts(DEFAULT_ROLE_PERMISSIONS.ca)).toBe(true);
    expect(canApproveReceipts(DEFAULT_ROLE_PERMISSIONS.staff)).toBe(false);
  });

  it("is safe without permissions", () => {
    expect(canApproveReceipts(null)).toBe(false);
    expect(canApproveReceipts(undefined)).toBe(false);
  });
});

describe("pendingBadgeLabel", () => {
  it("shows the number of receipts waiting", () => {
    expect(pendingBadgeLabel(3)).toBe("3");
  });

  it("shows nothing when there is nothing to approve", () => {
    expect(pendingBadgeLabel(0)).toBe("");
  });
});

describe("chat message preview", () => {
  it("shows the author and the text", () => {
    expect(chatMessagePreview({ author: "ANITA", body: "Baki stock?" })).toBe("ANITA: Baki stock?");
  });

  it("keeps it on one line", () => {
    expect(chatMessagePreview({ author: "ANITA", body: "one\ntwo" })).toBe("ANITA: one two");
  });

  it("says when there is no text", () => {
    expect(chatMessagePreview({ author: "ANITA", body: "" })).toBe("ANITA sent a receipt");
  });
});

describe("chat time", () => {
  it("shows the clock time", () => {
    const at = new Date(2026, 0, 2, 9, 42);
    expect(formatChatTime(at.toISOString())).toBe("09:42");
  });

  it("labels today and yesterday", () => {
    const now = new Date(2026, 0, 2, 12, 0);
    expect(formatChatDayLabel(new Date(2026, 0, 2, 9, 0).toISOString(), now)).toBe("Today");
    expect(formatChatDayLabel(new Date(2026, 0, 1, 9, 0).toISOString(), now)).toBe("Yesterday");
  });

  it("shows the weekday and date for older days (Phase 2: \"Fri, 2 Jan\")", () => {
    const now = new Date(2026, 0, 20, 12, 0);
    expect(formatChatDayLabel(new Date(2026, 0, 2, 9, 0).toISOString(), now)).toBe("Fri, 2 Jan");
  });
});
