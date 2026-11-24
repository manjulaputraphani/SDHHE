/**
 * Green Coffee Pricing Calculator — PURE, no DB, no React.
 *
 * Shared by the web app and the mobile app so both quote exactly the same
 * prices. Money here is quoted in RUPEES (not ledger paise) because the
 * calculator is a sales-quoting tool: percentages, interest and the ₹5
 * rounding step make the answer inherently fractional. Ledger money is still
 * stored as integer paise elsewhere.
 *
 * Formulas
 *   weightLoss      = purchase × loss% / 100
 *   creditCost      = purchase × interest% / 100 / 365 × creditDays
 *   landed          = purchase + transport + handling + weightLoss + creditCost
 *   selling(tier)   = CEIL(landed × (1 + margin%/100) / 5) × 5
 *   profit/kg       = selling − landed
 *   monthly profit  = profit/kg × kg/month
 *   roasterRevenue  = powderPrice × yield% / 100
 *   roasterMaxPrice = roasterRevenue − processing − roasterRevenue × profit%/100
 */

export type PricingTierKey = "bulk" | "regular" | "small";

export type PricingInputs = {
  /** ₹ per kg paid to the coffee supplier. */
  purchasePrice: number;
  /** ₹ per kg freight. */
  transport: number;
  /** ₹ per kg bags, handling, storage. */
  handling: number;
  /** Moisture + sorting loss, 0–100 %. */
  weightLossPct: number;
  /** Credit days given to the buyer. */
  creditDays: number;
  /** Yearly interest on our money, 0–100 %. */
  interestPct: number;
  bulkMarginPct: number;
  bulkKgPerMonth: number;
  regularMarginPct: number;
  regularKgPerMonth: number;
  smallMarginPct: number;
  smallKgPerMonth: number;
  /** The roaster's own powder selling price, ₹ per kg. */
  powderPrice: number;
  /** Powder output from 1 kg green beans, 0–100 %. */
  yieldPct: number;
  /** Roasting + grinding + packing, ₹ per kg. */
  processingCost: number;
  /** The roaster's profit on their powder revenue, 0–100 %. */
  roasterProfitPct: number;
};

export const DEFAULT_PRICING_INPUTS: PricingInputs = {
  purchasePrice: 320,
  transport: 7,
  handling: 4,
  weightLossPct: 1,
  creditDays: 30,
  interestPct: 12,
  bulkMarginPct: 6,
  bulkKgPerMonth: 500,
  regularMarginPct: 8,
  regularKgPerMonth: 300,
  smallMarginPct: 11,
  smallKgPerMonth: 100,
  powderPrice: 640,
  yieldPct: 82,
  processingCost: 40,
  roasterProfitPct: 20,
};

export type PricingTier = {
  key: PricingTierKey;
  label: string;
  marginPct: number;
  kgPerMonth: number;
  /** Whole rupees, rounded UP to the next ₹5. */
  sellingPrice: number;
  /** Rupees, 2 decimals. */
  profitPerKg: number;
  /** Whole rupees. */
  monthlyProfit: number;
};

export type PricingStatusLevel = "ok" | "error";

export type PricingResult = {
  weightLoss: number;
  creditCost: number;
  /** Rupees, 2 decimals (display to 1 decimal). */
  landedCost: number;
  tiers: PricingTier[];
  regularPrice: number;
  totalMonthlyProfit: number;
  roasterRevenue: number;
  roasterMaxPrice: number;
  status: {
    level: PricingStatusLevel;
    message: string;
    tiersAboveMax: PricingTierKey[];
  };
  /** Regular-price composition for the stacked bar (rupees, 2 decimals). */
  breakdown: {
    purchase: number;
    transportHandling: number;
    lossCredit: number;
    profit: number;
    total: number;
  };
};

export type PricingErrors = Partial<Record<keyof PricingInputs, string>>;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** ₹5 rounding: 357.6 → 360, 360 → 360 (never 365 from float noise). */
const roundUpToFive = (value: number): number => Math.ceil(value / 5 - 1e-9) * 5;

/** "₹23,379" / "₹337.4" — Indian digit grouping, no Intl dependency. */
export function formatPricingMoney(rupees: number, decimals = 0): string {
  if (!Number.isFinite(rupees)) return "—";
  const negative = rupees < 0;
  const fixed = Math.abs(rupees).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;
  return `${negative ? "-" : ""}₹${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** The percentage fields that must stay inside 0–100. */
const PERCENT_FIELDS: Array<keyof PricingInputs> = [
  "weightLossPct",
  "interestPct",
  "bulkMarginPct",
  "regularMarginPct",
  "smallMarginPct",
  "yieldPct",
  "roasterProfitPct",
];

/** Inline field errors — empty object means the form is valid. */
export function validatePricingInputs(inputs: PricingInputs): PricingErrors {
  const errors: PricingErrors = {};
  for (const key of Object.keys(inputs) as Array<keyof PricingInputs>) {
    const value = inputs[key];
    if (!Number.isFinite(value)) {
      errors[key] = "Enter a number";
      continue;
    }
    if (value < 0) {
      errors[key] = "Cannot be negative";
      continue;
    }
    if (PERCENT_FIELDS.includes(key) && value > 100) {
      errors[key] = "Must be between 0 and 100%";
    }
  }
  return errors;
}

/** Coerce a plain JSON object (API body) into typed numeric inputs. */
export function pricingInputsFromRecord(raw: Record<string, unknown>): PricingInputs {
  const result = {} as PricingInputs;
  for (const key of Object.keys(DEFAULT_PRICING_INPUTS) as Array<keyof PricingInputs>) {
    result[key] = typeof raw[key] === "number" ? (raw[key] as number) : Number(raw[key] ?? NaN);
  }
  return result;
}

/**
 * The one calculation everything uses (web, mobile, server).
 * Throws when the inputs are invalid — call validatePricingInputs first to
 * show field-level errors.
 */
export function calculatePricing(inputs: PricingInputs): PricingResult {
  const errors = validatePricingInputs(inputs);
  const firstError = Object.values(errors)[0];
  if (firstError) throw new Error(firstError);

  const weightLoss = (inputs.purchasePrice * inputs.weightLossPct) / 100;
  const creditCost =
    ((inputs.purchasePrice * inputs.interestPct) / 100 / 365) * inputs.creditDays;
  const landed = inputs.purchasePrice + inputs.transport + inputs.handling + weightLoss + creditCost;
  const landedCost = roundTo(landed, 2);

  const tier = (
    key: PricingTierKey,
    label: string,
    marginPct: number,
    kgPerMonth: number,
  ): PricingTier => {
    const sellingPrice = roundUpToFive(landed * (1 + marginPct / 100));
    const profit = sellingPrice - landed;
    return {
      key,
      label,
      marginPct,
      kgPerMonth,
      sellingPrice,
      profitPerKg: roundTo(profit, 2),
      monthlyProfit: Math.round(profit * kgPerMonth),
    };
  };

  const tiers = [
    tier("bulk", "Bulk buyer", inputs.bulkMarginPct, inputs.bulkKgPerMonth),
    tier("regular", "Regular buyer", inputs.regularMarginPct, inputs.regularKgPerMonth),
    tier("small", "Small buyer", inputs.smallMarginPct, inputs.smallKgPerMonth),
  ];
  const regular = tiers[1];

  const roasterRevenue = (inputs.powderPrice * inputs.yieldPct) / 100;
  const roasterMaxPrice = roundTo(
    roasterRevenue - inputs.processingCost - (roasterRevenue * inputs.roasterProfitPct) / 100,
    2,
  );

  const tiersAboveMax = tiers
    .filter((entry) => entry.sellingPrice > roasterMaxPrice)
    .map((entry) => entry.key);

  let status: PricingResult["status"];
  if (roasterMaxPrice <= landed) {
    status = {
      level: "error",
      message: "Cannot sell profitably at these numbers",
      tiersAboveMax,
    };
  } else if (tiersAboveMax.length > 0) {
    const names = tiers
      .filter((entry) => tiersAboveMax.includes(entry.key))
      .map((entry) => entry.label.toLowerCase())
      .join(" and ");
    status = {
      level: "error",
      message: `${names.charAt(0).toUpperCase()}${names.slice(1)} priced above the roaster max of ${formatPricingMoney(roasterMaxPrice)} — lower the margin.`,
      tiersAboveMax,
    };
  } else {
    status = {
      level: "ok",
      message: `All prices are below roaster max of ${formatPricingMoney(roasterMaxPrice)}`,
      tiersAboveMax: [],
    };
  }

  const regularProfit = regular.sellingPrice - landed;
  return {
    weightLoss: roundTo(weightLoss, 2),
    creditCost: roundTo(creditCost, 2),
    landedCost,
    tiers,
    regularPrice: regular.sellingPrice,
    totalMonthlyProfit: Math.round(
      tiers.reduce((sum, entry) => sum + (entry.sellingPrice - landed) * entry.kgPerMonth, 0),
    ),
    roasterRevenue: roundTo(roasterRevenue, 2),
    roasterMaxPrice,
    status,
    breakdown: {
      purchase: roundTo(inputs.purchasePrice, 2),
      transportHandling: roundTo(inputs.transport + inputs.handling, 2),
      lossCredit: roundTo(weightLoss + creditCost, 2),
      profit: roundTo(regularProfit, 2),
      total: regular.sellingPrice,
    },
  };
}
