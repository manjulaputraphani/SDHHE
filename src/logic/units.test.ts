import { describe, it, expect } from "vitest";
import { baseFactor, costPaise, formatQuantity, formatRupees, fromBase, toBase } from "./units";

describe("units — docs/TESTING.md §A1", () => {
  it("kg→g: toBase(1.5,'kg') === 1500", () => {
    expect(toBase(1.5, "kg")).toBe(1500);
  });

  it("cost: costPaise(250 g, 1200 paise/kg) === 300 (₹3.00)", () => {
    expect(costPaise(250, 1200)).toBe(300);
  });

  it("rounding: costPaise(333 g, 1000) === 333", () => {
    expect(costPaise(333, 1000)).toBe(333);
  });

  it('format: formatRupees(2200) === "₹22.00"', () => {
    expect(formatRupees(2200)).toBe("₹22.00");
  });

  it("pcs: costPaise(3 pcs, 500, 'pcs') === 1500", () => {
    expect(costPaise(3, 500, "pcs")).toBe(1500);
  });

  it("bag: costPaise(2 bags, ₹3000/bag) === ₹6000", () => {
    expect(costPaise(120000, 300000, "60 kg bag")).toBe(600000);
  });
});

describe("units — edge cases", () => {
  it("base factors", () => {
    expect(baseFactor("g")).toBe(1);
    expect(baseFactor("ml")).toBe(1);
    expect(baseFactor("pcs")).toBe(1);
    expect(baseFactor("kg")).toBe(1000);
    expect(baseFactor("l")).toBe(1000);
    expect(baseFactor("60 kg bag")).toBe(60000);
  });

  it("toBase handles every unit and always returns integers", () => {
    expect(toBase(1, "g")).toBe(1);
    expect(toBase(2, "l")).toBe(2000);
    expect(toBase(0.25, "kg")).toBe(250);
    expect(toBase(3, "pcs")).toBe(3);
    expect(toBase(1, "60 kg bag")).toBe(60000);
    expect(toBase(2, "60 kg bag")).toBe(120000);
    expect(Number.isInteger(toBase(1.1, "kg"))).toBe(true);
    expect(toBase(1.1, "kg")).toBe(1100);
  });

  it("fromBase is the inverse of toBase", () => {
    expect(fromBase(1500, "kg")).toBe(1.5);
    expect(fromBase(2000, "l")).toBe(2);
    expect(fromBase(7, "pcs")).toBe(7);
    expect(fromBase(toBase(0.333, "kg"), "kg")).toBeCloseTo(0.333, 10);
  });

  it("formatRupees always shows 2 decimals and never uses floats", () => {
    expect(formatRupees(0)).toBe("₹0.00");
    expect(formatRupees(5)).toBe("₹0.05");
    expect(formatRupees(99)).toBe("₹0.99");
    expect(formatRupees(100)).toBe("₹1.00");
    expect(formatRupees(123456789)).toBe("₹1234567.89");
    expect(formatRupees(-150)).toBe("-₹1.50");
  });

  it("costPaise rounds to the nearest paise", () => {
    // 1 g at ₹1.50/kg = 0.15 paise → 0
    expect(costPaise(1, 150)).toBe(0);
    // 2 g at ₹1.50/kg = 0.3 paise → 0
    expect(costPaise(2, 150)).toBe(0);
    // 5 g at ₹1.50/kg = 0.75 paise → 1
    expect(costPaise(5, 150)).toBe(1);
    // 1500 g at ₹1.50/kg = 225 paise
    expect(costPaise(1500, 150)).toBe(225);
  });

  it("costPaise is exact for the BLUEPRINT §5 worked example", () => {
    // Batch A: 1000 g @ 1000 paise/kg → ₹10.00 ; Batch B: 1000 g @ 1200 paise/kg → ₹12.00
    expect(costPaise(1000, 1000)).toBe(1000);
    expect(costPaise(1000, 1200)).toBe(1200);
    expect(costPaise(2000, 1200)).toBe(2400);
  });

  it("zero quantity costs nothing", () => {
    expect(costPaise(0, 12345)).toBe(0);
  });

  it("formatQuantity shows grams as kg with 2 decimals", () => {
    expect(formatQuantity(1500, "kg")).toBe("1.50 kg");
    expect(formatQuantity(2000, "kg")).toBe("2.00 kg");
    expect(formatQuantity(0, "kg")).toBe("0.00 kg");
    expect(formatQuantity(500, "l")).toBe("0.50 l");
    expect(formatQuantity(3, "pcs")).toBe("3 pcs");
    expect(formatQuantity(120000, "60 kg bag")).toBe("2.00 60 kg bag");
  });

  it("rejects negative quantity or price (money must never go negative by accident)", () => {
    expect(() => costPaise(-1, 100)).toThrow();
    expect(() => costPaise(10, -100)).toThrow();
    expect(() => toBase(-1, "kg")).toThrow();
  });
});
