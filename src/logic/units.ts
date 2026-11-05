/**
 * Money and quantity helpers — PURE, no DB, no floats for stored money.
 *
 * Money  = integer paise.
 * Quantity = integer base units (g, ml, pcs).
 */

export type Unit = "g" | "kg" | "ml" | "l" | "pcs" | "60 kg bag";

/**
 * Base units per one display unit:
 * 1 kg = 1000 g, 1 l = 1000 ml, 1 pc = 1 pc, 1 bag = 60 kg = 60,000 g.
 */
const FACTOR: Record<Unit, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  pcs: 1,
  "60 kg bag": 60_000,
};

/** How many base units make one display unit (used by FIFO costing too). */
export function baseFactor(unit: Unit): number {
  const factor = FACTOR[unit];
  if (!factor) throw new Error(`Unknown unit: ${String(unit)}`);
  return factor;
}

/** Display value → integer base units, e.g. toBase(1.5, "kg") === 1500. */
export function toBase(value: number, unit: Unit): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid quantity: ${value}`);
  if (value < 0) throw new Error("Quantity cannot be negative");
  return Math.round(value * baseFactor(unit));
}

/** Integer base units → display value, e.g. fromBase(1500, "kg") === 1.5. */
export function fromBase(base: number, unit: Unit): number {
  if (!Number.isFinite(base)) throw new Error(`Invalid base quantity: ${base}`);
  return base / baseFactor(unit);
}

/** Integer base units → human text, e.g. formatQuantity(1500, "kg") === "1.50 kg". */
export function formatQuantity(base: number, unit: Unit): string {
  if (!Number.isFinite(base)) throw new Error(`Invalid base quantity: ${base}`);
  if (baseFactor(unit) === 1) return `${Math.round(base)} ${unit}`;
  return `${(base / baseFactor(unit)).toFixed(2)} ${unit}`;
}

/** Integer paise → "₹22.00". Integer maths only, so no float drift. */
export function formatRupees(paise: number): string {
  if (!Number.isFinite(paise)) throw new Error(`Invalid amount: ${paise}`);
  const rounded = Math.round(paise);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}₹${rupees}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Cost of `qtyBase` base units at `unitPricePaise` per `pricePer` unit,
 * rounded to the nearest paise.
 *
 * Quantity is always in base units (g/ml/pcs); `pricePer` is the unit the
 * price is quoted in — "kg" by default, because that is how prices are
 * normally quoted in the shop.
 *
 * costPaise(250, 1200)           → 300   (250 g @ ₹12 per kg)
 * costPaise(3, 500, "pcs")      → 1500  (3 pcs @ ₹5 per piece)
 * costPaise(500, 8000, "l")     → 4000  (500 ml @ ₹80 per litre)
 */
export function costPaise(qtyBase: number, unitPricePaise: number, pricePer: Unit = "kg"): number {
  if (!Number.isFinite(qtyBase)) throw new Error(`Invalid quantity: ${qtyBase}`);
  if (!Number.isFinite(unitPricePaise)) throw new Error(`Invalid price: ${unitPricePaise}`);
  if (qtyBase < 0) throw new Error("Quantity cannot be negative");
  if (unitPricePaise < 0) throw new Error("Unit price cannot be negative");
  return Math.round((qtyBase * unitPricePaise) / baseFactor(pricePer));
}
