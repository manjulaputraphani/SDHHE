// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildReceiptKey,
  decodeReceiptKey,
  encodeReceiptKey,
  isSafeReceiptKey,
  readReceipt,
  receiptContentType,
  uploadReceipt,
  type R2BucketLike,
  type R2ObjectBodyLike,
} from "./receipts";

/** A tiny in-memory stand-in for an R2 bucket. */
function fakeBucket(): R2BucketLike & { store: Map<string, { bytes: Uint8Array; type: string }> } {
  const store = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    store,
    async put(key, value, options) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, { bytes, type: options?.httpMetadata?.contentType ?? "application/octet-stream" });
      return { key };
    },
    async get(key) {
      const found = store.get(key);
      if (!found) return null;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(found.bytes);
            controller.close();
          },
        }),
        size: found.bytes.byteLength,
        httpMetadata: { contentType: found.type },
      };
    },
  };
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

describe("buildReceiptKey", () => {
  it("uses the date and the extension", () => {
    expect(buildReceiptKey(new Date("2026-11-06T09:00:00.000Z"), 12, "image/jpeg")).toBe(
      "receipts/2026-11-06/12.jpg",
    );
    expect(buildReceiptKey(new Date("2026-11-06T09:00:00.000Z"), 3, "application/pdf")).toBe(
      "receipts/2026-11-06/3.pdf",
    );
  });

  it("falls back to bin for an unknown type", () => {
    expect(buildReceiptKey(new Date("2026-11-06T09:00:00.000Z"), 3, "application/zip")).toBe(
      "receipts/2026-11-06/3.bin",
    );
  });
});

describe("isSafeReceiptKey", () => {
  it("accepts a key we build ourselves", () => {
    expect(isSafeReceiptKey("receipts/2026-11-06/12.jpg")).toBe(true);
    expect(isSafeReceiptKey("receipts/2026-11-06/3.pdf")).toBe(true);
  });

  it("refuses anything that tries to climb out", () => {
    expect(isSafeReceiptKey("receipts/../../etc/passwd")).toBe(false);
    expect(isSafeReceiptKey("../secret")).toBe(false);
    expect(isSafeReceiptKey("receipts/2026-11-06/12.jpg/../x")).toBe(false);
    expect(isSafeReceiptKey("other/12.jpg")).toBe(false);
    expect(isSafeReceiptKey("")).toBe(false);
  });
});

describe("uploadReceipt", () => {
  it("stores the file and returns its details", async () => {
    const bucket = fakeBucket();
    const file = await uploadReceipt(bucket, {
      name: "transport.jpg",
      type: "image/jpeg",
      bytes: png,
    });

    expect(file.r2Key).toMatch(/^receipts\/\d{4}-\d{2}-\d{2}\/\d+\.jpg$/);
    expect(file.filename).toBe("transport.jpg");
    expect(file.mime).toBe("image/jpeg");
    expect(file.sizeBytes).toBe(png.byteLength);
    expect(bucket.store.size).toBe(1);
  });

  it("keeps the mime type on the object", async () => {
    const bucket = fakeBucket();
    const file = await uploadReceipt(bucket, { name: "bill.pdf", type: "application/pdf", bytes: png });
    expect(bucket.store.get(file.r2Key)?.type).toBe("application/pdf");
  });

  it("refuses a file that is not an image or a pdf", async () => {
    const bucket = fakeBucket();
    await expect(
      uploadReceipt(bucket, { name: "notes.txt", type: "text/plain", bytes: png }),
    ).rejects.toThrow(/image or PDF/i);
    expect(bucket.store.size).toBe(0);
  });

  it("refuses a file bigger than 4 MB", async () => {
    const bucket = fakeBucket();
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    await expect(
      uploadReceipt(bucket, { name: "big.jpg", type: "image/jpeg", bytes: big }),
    ).rejects.toThrow(/4 MB/i);
    expect(bucket.store.size).toBe(0);
  });

  it("refuses an empty file", async () => {
    const bucket = fakeBucket();
    await expect(
      uploadReceipt(bucket, { name: "empty.jpg", type: "image/jpeg", bytes: new Uint8Array(0) }),
    ).rejects.toThrow(/empty/i);
  });

  it("takes the name apart — no folders, no tricks", async () => {
    const bucket = fakeBucket();
    const file = await uploadReceipt(bucket, {
      name: "../../etc/passwd.jpg",
      type: "image/jpeg",
      bytes: png,
    });
    expect(file.filename).toBe("passwd.jpg");
  });
});

describe("readReceipt", () => {
  it("gives the object back", async () => {
    const bucket = fakeBucket();
    const file = await uploadReceipt(bucket, { name: "a.jpg", type: "image/jpeg", bytes: png });

    const stored = await readReceipt(bucket, file.r2Key);
    expect(stored).not.toBeNull();
    expect(stored?.size).toBe(png.byteLength);
    expect(stored?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("returns null for a key that is not there", async () => {
    expect(await readReceipt(fakeBucket(), "receipts/2026-11-06/99.jpg")).toBeNull();
  });

  it("refuses an unsafe key", async () => {
    await expect(readReceipt(fakeBucket(), "../../etc/passwd")).rejects.toThrow();
  });
});

describe("receiptContentType", () => {
  it("maps the extension back to a mime type", () => {
    expect(receiptContentType("receipts/2026-11-06/12.jpg")).toBe("image/jpeg");
    expect(receiptContentType("receipts/2026-11-06/12.png")).toBe("image/png");
    expect(receiptContentType("receipts/2026-11-06/3.pdf")).toBe("application/pdf");
    expect(receiptContentType("receipts/2026-11-06/3.bin")).toBe("application/octet-stream");
  });
});

describe("receipt key in a URL", () => {
  it("round-trips through one path segment", () => {
    const key = "receipts/2026-11-06/1770000000000123.jpg";
    const encoded = encodeReceiptKey(key);
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("+");
    expect(decodeReceiptKey(encoded)).toBe(key);
  });

  it("refuses a segment that does not hold a receipt key", () => {
    expect(() => decodeReceiptKey(encodeReceiptKey("../../etc/passwd"))).toThrow();
    expect(() => decodeReceiptKey("!!!")).toThrow();
  });
});

// keep the type import used
export type { R2ObjectBodyLike };
