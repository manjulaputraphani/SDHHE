import { describe, it, expect } from "vitest";
import {
  DEFAULT_YIELD_BP,
  costPerKgPaise,
  planRoast,
  roastChargePaise,
  roastedQtyBase,
  suggestedPricePaise,
} from "./roasting";

describe("roasting maths", () => {
  it("default yield is 1.200 kg raw → 1 kg roasted", () => {
    expect(DEFAULT_YIELD_BP).toBe(12_000);
    expect(roastedQtyBase(120_000, DEFAULT_YIELD_BP)).toBe(100_000);
    expect(roastedQtyBase(60_000, DEFAULT_YIELD_BP)).toBe(50_000);
  });

  it("supports an editable yield", () => {
    expect(roastedQtyBase(120_000, 11_000)).toBe(109_091);
    expect(roastedQtyBase(125_000, 12_500)).toBe(100_000);
  });

  it("charge is ₹ per kg of roasted output", () => {
    // ₹20/kg × 100 kg = ₹2,000 = 200,000 paise
    expect(roastChargePaise(2_000, 100_000)).toBe(200_000);
    // ₹12.50/kg × 50 kg = ₹625 = 62,500 paise
    expect(roastChargePaise(1_250, 50_000)).toBe(62_500);
  });

  it("cost per kg uses the roasted weight", () => {
    expect(costPerKgPaise(3_200_000, 100_000)).toBe(32_000);
  });

  it("suggested price applies the margin", () => {
    expect(suggestedPricePaise(32_000, 2_000)).toBe(38_400);
    expect(suggestedPricePaise(32_000, 0)).toBe(32_000);
  });

  it("plans the full batch", () => {
    const plan = planRoast({
      rawQtyBase: 120_000,
      yieldBp: DEFAULT_YIELD_BP,
      chargePerKgPaise: 2_000,
      rawCostPaise: 3_000_000,
      marginBp: 2_000,
    });
    expect(plan).toEqual({
      roastedQtyBase: 100_000,
      chargePaise: 200_000,
      totalCostPaise: 3_200_000,
      costPerKgPaise: 32_000,
      suggestedPricePaise: 38_400,
    });
  });

  it("rejects bad inputs", () => {
    expect(() => roastedQtyBase(0, 12_000)).toThrow();
    expect(() => roastedQtyBase(120_000, 9_000)).toThrow();
    expect(() => roastedQtyBase(120_000, 40_000)).toThrow();
    expect(() => roastChargePaise(-1, 100_000)).toThrow();
    expect(() => suggestedPricePaise(32_000, 20_000)).toThrow();
  });
});
