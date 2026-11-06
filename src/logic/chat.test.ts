import { describe, it, expect } from "vitest";
import {
  CHAT_ROOM_DEFAULT,
  MAX_MESSAGE_CHARS,
  MAX_RECEIPT_BYTES,
  RECEIPT_MIME_TYPES,
  isReceiptMimeAllowed,
  receiptFileExtension,
} from "./chat";

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
