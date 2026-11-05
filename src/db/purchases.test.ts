import { describe, it, expect } from "vitest";
import { isValidIsoDate } from "./purchases";

describe("purchase date validation", () => {
  it("accepts real ISO dates", () => {
    expect(isValidIsoDate("2026-11-05")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects malformed or impossible dates", () => {
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate("05-11-2026")).toBe(false);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
  });
});
