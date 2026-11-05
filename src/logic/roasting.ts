/**
 * Roasting maths — PURE, no DB.
 *
 * Raw seeds lose weight when roasted. The shop's standard is 1.200 kg raw
 * for 1.000 kg roasted; the yield is editable per batch.
 *
 * yieldBp is basis points: 12000 = 1.200, 11000 = 1.100.
 * Charge is ₹ per kg of ROASTED output.
 */

export const DEFAULT_YIELD_BP = 12_000;
export const MIN_YIELD_BP = 10_000;
export const MAX_YIELD_BP = 30_000;

function assertInteger(value: number, name: string, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be a whole number ≥ ${min}`);
  }
}

/** Raw base qty → roasted base qty. 120,000 g @ 1.200 → 100,000 g. */
export function roastedQtyBase(rawQtyBase: number, yieldBp: number): number {
  assertInteger(rawQtyBase, "Raw quantity", 1);
  assertInteger(yieldBp, "Yield", MIN_YIELD_BP);
  if (yieldBp > MAX_YIELD_BP) throw new Error("Yield is too high");
  const out = Math.round((rawQtyBase * 10_000) / yieldBp);
  if (out < 1) throw new Error("Roasted quantity is too small");
  return out;
}

/** Roasting charge in paise: ₹/kg roasted × roasted kg. */
export function roastChargePaise(chargePerKgPaise: number, roastedBase: number): number {
  assertInteger(chargePerKgPaise, "Roasting charge", 0);
  assertInteger(roastedBase, "Roasted quantity", 1);
  return Math.round((chargePerKgPaise * roastedBase) / 1000);
}

/** Cost per kg (paise) from total cost and roasted base grams. */
export function costPerKgPaise(totalCostPaise: number, roastedBase: number): number {
  assertInteger(totalCostPaise, "Total cost", 0);
  assertInteger(roastedBase, "Roasted quantity", 1);
  return Math.round((totalCostPaise * 1000) / roastedBase);
}

/** Suggested selling price per kg from cost/kg and margin basis points. */
export function suggestedPricePaise(costPerKg: number, marginBp: number): number {
  assertInteger(costPerKg, "Cost per kg", 0);
  assertInteger(marginBp, "Margin", 0);
  if (marginBp > 10_000) throw new Error("Margin cannot exceed 100%");
  return Math.round((costPerKg * (10_000 + marginBp)) / 10_000);
}

export type RoastPlan = {
  roastedQtyBase: number;
  chargePaise: number;
  totalCostPaise: number;
  costPerKgPaise: number;
  suggestedPricePaise: number;
};

/** Full costing plan for one roasting batch. */
export function planRoast(input: {
  rawQtyBase: number;
  yieldBp: number;
  chargePerKgPaise: number;
  rawCostPaise: number;
  marginBp?: number;
}): RoastPlan {
  assertInteger(input.rawCostPaise, "Raw cost", 0);
  const roastedBase = roastedQtyBase(input.rawQtyBase, input.yieldBp);
  const charge = roastChargePaise(input.chargePerKgPaise, roastedBase);
  const total = input.rawCostPaise + charge;
  const perKg = costPerKgPaise(total, roastedBase);
  const suggested = suggestedPricePaise(perKg, input.marginBp ?? 0);
  return {
    roastedQtyBase: roastedBase,
    chargePaise: charge,
    totalCostPaise: total,
    costPerKgPaise: perKg,
    suggestedPricePaise: suggested,
  };
}
