import { describe, it, expect } from "vitest";
import { normaliseGstin } from "./customers";

describe("normaliseGstin", () => {
  it("treats NA / N/A / dash / blank as no GSTIN", () => {
    expect(normaliseGstin("NA")).toBeNull();
    expect(normaliseGstin(" n/a ")).toBeNull();
    expect(normaliseGstin("-")).toBeNull();
    expect(normaliseGstin("")).toBeNull();
    expect(normaliseGstin(undefined)).toBeNull();
  });

  it("trims and uppercases a real GSTIN", () => {
    expect(normaliseGstin(" 29abcde1234f1z5 ")).toBe("29ABCDE1234F1Z5");
  });
});
