/**
 * Cash / bank ledger + working capital queries.
 *
 * Money is integer paise. Every cash movement (sale receipt, purchase
 * payment, expense, withdrawal, deposit, opening balance) is a row in
 * `cash_ledger`. The running balance is computed on the fly from the
 * opening balance + all ledger entries up to a date.
 *
 * Credit aging groups unpaid sale bills by days overdue.
 */
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import {
  cashLedger,
  customers,
  items,
  batches,
  openingBalance,
  saleBills,
} from "./schema";

export type Queryable = Db | TxDb;

export type CashLedgerRow = {
  id: number;
  type: string;
  amountPaise: number;
  refType: string | null;
  refId: number | null;
  entryDate: string;
  note: string | null;
  actor: string | null;
};

export type OpeningBalanceRow = {
  id: number;
  amountPaise: number;
  asOfDate: string;
  note: string | null;
};

/** Cash balance as of `date` (inclusive): opening + all ledger entries up to and including that date. */
export async function cashBalanceAsOf(db: Db, date: string): Promise<number> {
  const [opening] = await db
    .select({ amountPaise: openingBalance.amountPaise })
    .from(openingBalance)
    .orderBy(desc(openingBalance.asOfDate))
    .limit(1);

  const base = opening?.amountPaise ?? 0;

  const [ledger] = await db
    .select({
      total: sql<number>`coalesce(sum(${cashLedger.amountPaise}), 0)`.mapWith(Number),
    })
    .from(cashLedger)
    .where(lt(cashLedger.entryDate, date));

  return base + (ledger?.total ?? 0);
}

/** Cash balance as of today. */
export async function cashBalanceToday(db: Db): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  return cashBalanceAsOf(db, today);
}

/** Record a cash ledger entry (positive = money in, negative = money out). */
export async function recordCashEntry(
  db: Queryable,
  input: {
    type: string;
    amountPaise: number;
    refType?: string | null;
    refId?: number | null;
    entryDate: string;
    note?: string | null;
    actor?: string | null;
  },
): Promise<void> {
  await db
    .insert(cashLedger)
    .values({
      type: input.type,
      amountPaise: input.amountPaise,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      entryDate: input.entryDate,
      note: input.note ?? null,
      actor: input.actor ?? null,
    });
}

/** Credit outstanding per customer, aged by days overdue. */
export type CreditAgingRow = {
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  billNo: string;
  billDate: string;
  totalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  daysOverdue: number;
  ageBucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
};

export type CreditAgingSummary = {
  totalOutstandingPaise: number;
  byBucket: Record<string, number>;
  rows: CreditAgingRow[];
};

/** All unpaid credit bills, aged as of `asOfDate` (defaults to today). */
export async function creditAging(
  db: Db,
  asOfDate?: string,
): Promise<CreditAgingSummary> {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);

  const bills = await db
    .select({
      id: saleBills.id,
      billNo: saleBills.billNo,
      customerId: saleBills.customerId,
      customerName: customers.name,
      customerPhone: customers.phone,
      saleDate: saleBills.saleDate,
      totalPaise: saleBills.totalPaise,
      paidPaise: saleBills.paidPaise,
    })
    .from(saleBills)
    .leftJoin(customers, eq(customers.id, saleBills.customerId))
    .where(
      and(
        eq(saleBills.cancelled, false),
        sql`${saleBills.totalPaise} > ${saleBills.paidPaise}`,
      ),
    )
    .orderBy(asc(saleBills.saleDate));

  const rows: CreditAgingRow[] = [];
  const byBucket: Record<string, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  let totalOutstanding = 0;

  for (const b of bills) {
    const outstanding = Number(b.totalPaise) - Number(b.paidPaise);
    const saleDate = b.saleDate;
    const days = daysBetween(saleDate, today);
    const daysOverdue = Math.max(0, days - 30); // 30 days credit period
    let bucket: CreditAgingRow["ageBucket"];
    if (daysOverdue <= 0) bucket = "current";
    else if (daysOverdue <= 30) bucket = "1-30";
    else if (daysOverdue <= 60) bucket = "31-60";
    else if (daysOverdue <= 90) bucket = "61-90";
    else bucket = "90+";

    rows.push({
      customerId: Number(b.customerId),
      customerName: b.customerName ?? "Walk-in",
      customerPhone: b.customerPhone ?? null,
      billNo: b.billNo,
      billDate: saleDate,
      totalPaise: Number(b.totalPaise),
      paidPaise: Number(b.paidPaise),
      outstandingPaise: outstanding,
      daysOverdue,
      ageBucket: bucket,
    });

    byBucket[bucket] += outstanding;
    totalOutstanding += outstanding;
  }

  return {
    totalOutstandingPaise: totalOutstanding,
    byBucket,
    rows,
  };
}

/** Working capital snapshot: investment, stock, cash, credit outstanding, rotation. */
export type WorkingCapital = {
  asOfDate: string;
  investmentPaise: number;
  stockValuePaise: number;
  cashInBankPaise: number;
  creditOutstandingPaise: number;
  amountInRotationPaise: number; // stock + cash + credit outstanding
  rotationTurnover: number; // net sales / average capital (from analytics)
  daysToRotate: number | null;
};

/** Working capital as of a date. Uses opening balance for investment if set. */
export async function workingCapital(db: Db, asOfDate?: string): Promise<WorkingCapital> {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);

  const [opening] = await db
    .select({ amountPaise: openingBalance.amountPaise })
    .from(openingBalance)
    .orderBy(desc(openingBalance.asOfDate))
    .limit(1);
  const investmentPaise = opening?.amountPaise ?? 0;

  const [stockRow] = await db
    .select({
      total: sql<number>`coalesce(round(sum(
        ${batches.qtyRemaining} * ${batches.unitPricePaise}::numeric /
        case when ${items.unit} = '60 kg bag' then 60000 when ${items.unit} in ('kg', 'l') then 1000 else 1 end
      )), 0)`.mapWith(Number),
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId));

  const stockValuePaise = stockRow?.total ?? 0;
  const cashInBankPaise = await cashBalanceAsOf(db, today);
  const aging = await creditAging(db, today);
  const creditOutstandingPaise = aging.totalOutstandingPaise;
  const amountInRotationPaise = stockValuePaise + cashInBankPaise + creditOutstandingPaise;

  return {
    asOfDate: today,
    investmentPaise,
    stockValuePaise,
    cashInBankPaise,
    creditOutstandingPaise,
    amountInRotationPaise,
    rotationTurnover: 0, // filled by caller from analytics if needed
    daysToRotate: null,
  };
}

/** Daily rotation trend: net sales per day over the last N days. */
export type RotationDay = { date: string; netSalesPaise: number };

export async function rotationTrend(
  db: Db,
  days: number,
): Promise<RotationDay[]> {
  const today = new Date();
  const result: RotationDay[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const next = new Date(d);
    next.setUTCDate(d.getUTCDate() + 1);

    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(${saleBills.subtotalPaise}), 0)`.mapWith(Number),
      })
      .from(saleBills)
      .where(
        and(
          eq(saleBills.cancelled, false),
          gte(saleBills.saleDate, date),
          lt(saleBills.saleDate, next.toISOString().slice(0, 10)),
        ),
      );
    result.push({ date, netSalesPaise: row?.total ?? 0 });
  }
  return result;
}

/** Latest opening balance (investment) set by the shop owner. */
export type OpeningBalance = {
  amountPaise: number;
  asOfDate: string;
  note: string | null;
};

export async function getOpeningBalance(db: Db): Promise<OpeningBalance | null> {
  const [row] = await db
    .select({
      amountPaise: openingBalance.amountPaise,
      asOfDate: openingBalance.asOfDate,
      note: openingBalance.note,
    })
    .from(openingBalance)
    .orderBy(desc(openingBalance.asOfDate))
    .limit(1);
  return row ?? null;
}

export async function saveOpeningBalance(
  db: Db,
  input: { amountPaise: number; asOfDate: string; note?: string | null },
): Promise<void> {
  await db.insert(openingBalance).values({
    amountPaise: input.amountPaise,
    asOfDate: input.asOfDate,
    note: input.note ?? null,
  });
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}
