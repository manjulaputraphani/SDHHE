import { describe, expect, it } from "vitest";
import {
  chatSocketUrl,
  chatReceiptUrl,
  normaliseWorkerUrl,
  receiptKeyFromUrl,
} from "./chatClient";

describe("normaliseWorkerUrl", () => {
  it("keeps a full address", () => {
    expect(normaliseWorkerUrl("https://sdhhe-api.blvphani.workers.dev")).toBe(
      "https://sdhhe-api.blvphani.workers.dev",
    );
  });

  it("drops the trailing slash", () => {
    expect(normaliseWorkerUrl("https://sdhhe-api.blvphani.workers.dev/")).toBe(
      "https://sdhhe-api.blvphani.workers.dev",
    );
  });

  it("adds https:// when the address has no scheme", () => {
    expect(normaliseWorkerUrl("sdhhe-api.blvphani.workers.dev")).toBe(
      "https://sdhhe-api.blvphani.workers.dev",
    );
  });

  it("keeps http:// for a local worker", () => {
    expect(normaliseWorkerUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("is empty for an empty address", () => {
    expect(normaliseWorkerUrl("   ")).toBe("");
  });
});

describe("chatSocketUrl", () => {
  it("uses wss for a secure worker and ws for a local one", () => {
    expect(chatSocketUrl("https://worker.dev", "abc")).toBe("wss://worker.dev/api/chat/ws?token=abc");
    expect(chatSocketUrl("http://127.0.0.1:8787", "abc")).toBe(
      "ws://127.0.0.1:8787/api/chat/ws?token=abc",
    );
  });

  it("escapes the token", () => {
    expect(chatSocketUrl("https://worker.dev", "a+b/c")).toContain("token=a%2Bb%2Fc");
  });
});

describe("chatReceiptUrl", () => {
  it("puts the key into one path segment", () => {
    const url = chatReceiptUrl("https://worker.dev", "receipts/2026-11-06/12.jpg");
    expect(url.startsWith("https://worker.dev/api/chat/receipts/")).toBe(true);
    expect(url).not.toContain("/2026-11-06/");
    expect(receiptKeyFromUrl(url)).toBe("receipts/2026-11-06/12.jpg");
  });
});
