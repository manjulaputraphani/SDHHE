import { describe, it, expect } from "vitest";
import { parseItemInput } from "./items";

const base = { name: "Rice", unit: "kg", category: "", minStockBase: 0 };

describe("parseItemInput (zod)", () => {
  it("accepts a valid item and trims the name", () => {
    const parsed = parseItemInput({ ...base, name: "  Rice  " });
    expect(parsed.name).toBe("Rice");
    expect(parsed.unit).toBe("kg");
  });

  it("requires a name", () => {
    expect(() => parseItemInput({ ...base, name: "   " })).toThrow(/Name is required/i);
  });

  it("accepts only kg | l | pcs", () => {
    expect(() => parseItemInput({ ...base, unit: "g" })).toThrow(/kg, l or pcs/i);
    expect(parseItemInput({ ...base, unit: "l" }).unit).toBe("l");
    expect(parseItemInput({ ...base, unit: "pcs" }).unit).toBe("pcs");
  });

  it("rejects negative min stock", () => {
    expect(() => parseItemInput({ ...base, minStockBase: -1 })).toThrow(/cannot be negative/i);
  });

  it("rejects fractional base quantities (qty must be integer base units)", () => {
    expect(() => parseItemInput({ ...base, minStockBase: 1.5 })).toThrow(/whole number/i);
  });

  it("treats category as optional", () => {
    expect(parseItemInput({ name: "Salt", unit: "kg", minStockBase: 0 }).category).toBeUndefined();
  });

  it("trims and accepts an optional HSN code", () => {
    expect(parseItemInput({ ...base, hsnCode: "  090111  " }).hsnCode).toBe("090111");
    expect(parseItemInput(base).hsnCode).toBeUndefined();
  });

  it("rejects an HSN longer than 20 characters", () => {
    expect(() => parseItemInput({ ...base, hsnCode: "1".repeat(21) })).toThrow(/HSN is too long/i);
  });
});
