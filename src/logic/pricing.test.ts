import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRICING_INPUTS,
  calculatePricing,
  formatPricingMoney,
  validatePricingInputs,
} from "./pricing";

describe("calculatePricing — default green coffee numbers", () => {
  const result = calculatePricing(DEFAULT_PRICING_INPUTS);

  it("lands the coffee at ₹337.36 per kg", () => {
    expect(result.weightLoss).toBe(3.2);
    expect(result.creditCost).toBe(3.16);
    expect(result.landedCost).toBe(337.36);
  });

  it("rounds each buyer price UP to the next ₹5", () => {
    expect(result.tiers.map((tier) => tier.sellingPrice)).toEqual([360, 365, 375]);
  });

  it("headline regular price is the regular tier", () => {
    expect(result.regularPrice).toBe(365);
  });

  it("shows profit per kg for every tier", () => {
    expect(result.tiers.map((tier) => tier.profitPerKg)).toEqual([22.64, 27.64, 37.64]);
  });

  it("multiplies profit by monthly kg", () => {
    expect(result.tiers.map((tier) => tier.monthlyProfit)).toEqual([11_322, 8_293, 3_764]);
    expect(result.totalMonthlyProfit).toBe(23_379);
  });

  it("caps the price at the roaster's ceiling", () => {
    expect(result.roasterRevenue).toBe(524.8);
    expect(result.roasterMaxPrice).toBe(379.84);
    expect(result.status.level).toBe("ok");
    expect(result.status.message).toBe("All prices are below roaster max of ₹380");
  });

  it("splits the regular price into the stacked bar", () => {
    expect(result.breakdown).toEqual({
      purchase: 320,
      transportHandling: 11,
      lossCredit: 6.36,
      profit: 27.64,
      total: 365,
    });
  });
});

describe("calculatePricing — guard rails", () => {
  it("flags a roaster ceiling below the landed cost", () => {
    const result = calculatePricing({
      ...DEFAULT_PRICING_INPUTS,
      powderPrice: 300,
      processingCost: 60,
    });
    expect(result.roasterMaxPrice).toBeLessThan(result.landedCost);
    expect(result.status.level).toBe("error");
    expect(result.status.message).toBe("Cannot sell profitably at these numbers");
  });

  it("names the tier that crosses the roaster ceiling", () => {
    const result = calculatePricing({
      ...DEFAULT_PRICING_INPUTS,
      smallMarginPct: 40,
    });
    expect(result.status.level).toBe("error");
    expect(result.status.tiersAboveMax).toEqual(["small"]);
    expect(result.status.message).toContain("Small buyer");
    expect(result.status.message).toContain("lower the margin");
  });
});

describe("validatePricingInputs", () => {
  it("accepts the defaults", () => {
    expect(validatePricingInputs(DEFAULT_PRICING_INPUTS)).toEqual({});
  });

  it("rejects negative numbers", () => {
    expect(validatePricingInputs({ ...DEFAULT_PRICING_INPUTS, purchasePrice: -1 })).toEqual({
      purchasePrice: "Cannot be negative",
    });
  });

  it("keeps percentages inside 0–100", () => {
    expect(validatePricingInputs({ ...DEFAULT_PRICING_INPUTS, yieldPct: 101 })).toEqual({
      yieldPct: "Must be between 0 and 100%",
    });
  });

  it("rejects empty / non-numeric fields", () => {
    expect(validatePricingInputs({ ...DEFAULT_PRICING_INPUTS, transport: Number.NaN })).toEqual({
      transport: "Enter a number",
    });
  });
});

describe("formatPricingMoney", () => {
  it("uses Indian digit grouping", () => {
    expect(formatPricingMoney(23_379)).toBe("₹23,379");
    expect(formatPricingMoney(12_34_567)).toBe("₹12,34,567");
  });

  it("shows the requested decimals", () => {
    expect(formatPricingMoney(337.36, 1)).toBe("₹337.4");
  });
});
