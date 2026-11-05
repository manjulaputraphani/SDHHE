import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client";
import { logActivity } from "./activity";
import { cashLedger, expenseBills, expenses, items, purchases, saleBills } from "./schema";
import { getCostPool, saveCostPool } from "./costing";
import { PAYMENT_MODES } from "./purchases";
import { formatRupees, type Unit } from "../logic/units";
import { recordCashEntry } from "./cashLedger";

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Transport",
  "Salary",
  "Packaging",
  "Maintenance",
  "Other",
] as const;

export const EXPENSE_TYPES = ["purchase", "sale", "general"] as const;
export type ExpenseType = (typeof EXPENSE_TYPES)[number];

/** Bill photo / paid invoice stored with the expense (max 4 MB). */
export const expenseBillSchema = z.object({
  filename: z.string().trim().min(1, "Bill file is missing a name").max(200),
  mime: z.string().trim().min(1).max(100),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(4 * 1024 * 1024, "Bill file must be 4 MB or smaller"),
  dataBase64: z.string().min(1, "Bill file is empty"),
});

export const expenseInputSchema = z.object({
  category: z.string().trim().min(1, "Category is required").max(60, "Category is too long"),
  /** purchase (added into stock cost) | sale (charged to a deal) | general (rent, salary…). */
  expenseType: z.enum(EXPENSE_TYPES).default("general"),
  amountPaise: z
    .number({ message: "Amount is required" })
    .int("Amount must be whole paise")
    .positive("Amount must be more than 0"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date"),
  paymentMode: z.enum(PAYMENT_MODES).optional(),
  paidTo: z.string().trim().max(120, "Paid to is too long").optional(),
  note: z.string().trim().max(200, "Note is too long").optional(),
  /** Deal this expense belongs to (sale expenses). */
  relatedSaleId: z.number().int().positive().nullish(),
  /** Purchase this expense belongs to (transport, loading, commission). */
  relatedPurchaseId: z.number().int().positive().nullish(),
  bill: expenseBillSchema.optional(),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export type ExpenseRow = {
  id: number;
  category: string;
  expenseType: ExpenseType;
  amountPaise: number;
  date: string;
  paymentMode: string | null;
  paidTo: string | null;
  note: string | null;
  relatedSaleId: number | null;
  relatedPurchaseId: number | null;
  billId: number | null;
  billFilename: string | null;
};

export function parseExpenseInput(input: unknown): ExpenseInput {
  const result = expenseInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid expense");
  }
  return result.data;
}

/** "2026-10" → ["2026-10-01", "2026-11-01") */
export function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { start: `${month}-01`, end: next.toISOString().slice(0, 10) };
}

export async function listExpenses(
  db: Db,
  filter: { month?: string; category?: string } = {},
): Promise<ExpenseRow[]> {
  const conditions = [];
  if (filter.month) {
    const { start, end } = monthRange(filter.month);
    conditions.push(gte(expenses.expenseDate, start), lt(expenses.expenseDate, end));
  }
  if (filter.category) {
    conditions.push(eq(expenses.category, filter.category));
  }

  const rows = await db
    .select({
      id: expenses.id,
      category: expenses.category,
      expenseType: expenses.expenseType,
      amountPaise: expenses.amountPaise,
      date: expenses.expenseDate,
      paymentMode: expenses.paymentMode,
      paidTo: expenses.paidTo,
      note: expenses.note,
      relatedSaleId: expenses.relatedSaleId,
      relatedPurchaseId: expenses.relatedPurchaseId,
      billId: expenseBills.id,
      billFilename: expenseBills.filename,
    })
    .from(expenses)
    .leftJoin(expenseBills, eq(expenseBills.expenseId, expenses.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(expenses.expenseDate), desc(expenses.id));
  return rows.map((row) => ({ ...row, expenseType: row.expenseType as ExpenseType }));
}

function summaryOf(data: ExpenseInput, verb: string): string {
  const who = data.paidTo ? ` to ${data.paidTo}` : "";
  return `Expense ${verb}: ${data.category} ${formatRupees(data.amountPaise)}${who}`;
}

async function replaceBill(db: Db, expenseId: number, bill: ExpenseInput["bill"]): Promise<void> {
  if (!bill) return;
  await db.delete(expenseBills).where(eq(expenseBills.expenseId, expenseId));
  await db.insert(expenseBills).values({ expenseId, ...bill });
}

/**
 * Where the money goes:
 *  - purchase expense linked to a purchase → added into the stock cost (pool)
 *  - sale expense linked to a deal → charged to that deal
 */
async function applyExpenseEffect(
  db: Db,
  effect: {
    expenseType: ExpenseType;
    amountPaise: number;
    relatedSaleId: number | null;
    relatedPurchaseId: number | null;
  },
): Promise<void> {
  if (effect.expenseType === "purchase" && effect.relatedPurchaseId) {
    const [purchase] = await db
      .select({ id: purchases.id, itemId: purchases.itemId, expensesPaise: purchases.expensesPaise })
      .from(purchases)
      .where(eq(purchases.id, effect.relatedPurchaseId));
    if (!purchase) return;
    await db
      .update(purchases)
      .set({ expensesPaise: purchase.expensesPaise + effect.amountPaise })
      .where(eq(purchases.id, purchase.id));
    const [item] = await db
      .select({ unit: items.unit })
      .from(items)
      .where(eq(items.id, purchase.itemId));
    if (!item) return;
    const pool = await getCostPool(db, purchase.itemId);
    await saveCostPool(
      db,
      purchase.itemId,
      { qtyBase: pool.qtyBase, valuePaise: pool.valuePaise + effect.amountPaise },
      item.unit as Unit,
    );
    return;
  }

  if (effect.expenseType === "sale" && effect.relatedSaleId) {
    const [bill] = await db
      .select({ id: saleBills.id, saleExpensesPaise: saleBills.saleExpensesPaise })
      .from(saleBills)
      .where(eq(saleBills.id, effect.relatedSaleId));
    if (!bill) return;
    await db
      .update(saleBills)
      .set({ saleExpensesPaise: bill.saleExpensesPaise + effect.amountPaise })
      .where(eq(saleBills.id, bill.id));
  }
}

export async function createExpense(db: Db, input: unknown): Promise<ExpenseRow> {
  const data = parseExpenseInput(input);
  const [created] = await db
    .insert(expenses)
    .values({
      category: data.category,
      expenseType: data.expenseType,
      amountPaise: data.amountPaise,
      expenseDate: data.date,
      paymentMode: data.paymentMode ?? null,
      paidTo: data.paidTo?.trim() || null,
      note: data.note?.trim() || null,
      relatedSaleId: data.relatedSaleId ?? null,
      relatedPurchaseId: data.relatedPurchaseId ?? null,
    })
    .returning();

  await applyExpenseEffect(db, {
    expenseType: data.expenseType,
    amountPaise: data.amountPaise,
    relatedSaleId: data.relatedSaleId ?? null,
    relatedPurchaseId: data.relatedPurchaseId ?? null,
  });
  await replaceBill(db, created.id, data.bill);

  // Cash ledger: money out for this expense.
  await recordCashEntry(db, {
    type: "expense",
    amountPaise: -data.amountPaise,
    refType: "expense",
    refId: created.id,
    entryDate: data.date,
    note: `${data.category}: ${data.note?.trim() ?? ""}`.trim() || data.category,
  });

  await logActivity(db, {
    event: "expense.create",
    summary: summaryOf(data, "added"),
    entity: "expense",
    entityId: created.id,
  });

  return {
    id: created.id,
    category: created.category,
    expenseType: created.expenseType as ExpenseType,
    amountPaise: created.amountPaise,
    date: created.expenseDate,
    paymentMode: created.paymentMode,
    paidTo: created.paidTo,
    note: created.note,
    relatedSaleId: created.relatedSaleId,
    relatedPurchaseId: created.relatedPurchaseId,
    billId: null,
    billFilename: data.bill?.filename ?? null,
  };
}

export async function updateExpense(db: Db, id: number, input: unknown): Promise<ExpenseRow> {
  const data = parseExpenseInput(input);
  const [before] = await db
    .select({
      amountPaise: expenses.amountPaise,
      expenseType: expenses.expenseType,
      relatedSaleId: expenses.relatedSaleId,
      relatedPurchaseId: expenses.relatedPurchaseId,
    })
    .from(expenses)
    .where(eq(expenses.id, id));
  const [updated] = await db
    .update(expenses)
    .set({
      category: data.category,
      expenseType: data.expenseType,
      amountPaise: data.amountPaise,
      expenseDate: data.date,
      paymentMode: data.paymentMode ?? null,
      paidTo: data.paidTo?.trim() || null,
      note: data.note?.trim() || null,
      relatedSaleId: data.relatedSaleId ?? null,
      relatedPurchaseId: data.relatedPurchaseId ?? null,
    })
    .where(eq(expenses.id, id))
    .returning();
  if (!updated) throw new Error("Expense not found");

  // Undo the old effect, then apply the new one (keeps the stock cost in step).
  if (before) {
    await applyExpenseEffect(db, {
      expenseType: before.expenseType as ExpenseType,
      amountPaise: -before.amountPaise,
      relatedSaleId: before.relatedSaleId,
      relatedPurchaseId: before.relatedPurchaseId,
    });
  }
  await applyExpenseEffect(db, {
    expenseType: data.expenseType,
    amountPaise: data.amountPaise,
    relatedSaleId: data.relatedSaleId ?? null,
    relatedPurchaseId: data.relatedPurchaseId ?? null,
  });
  await replaceBill(db, id, data.bill);
  await logActivity(db, {
    event: "expense.update",
    summary: summaryOf(data, "edited"),
    entity: "expense",
    entityId: id,
  });

  return {
    id: updated.id,
    category: updated.category,
    expenseType: updated.expenseType as ExpenseType,
    amountPaise: updated.amountPaise,
    date: updated.expenseDate,
    paymentMode: updated.paymentMode,
    paidTo: updated.paidTo,
    note: updated.note,
    relatedSaleId: updated.relatedSaleId,
    relatedPurchaseId: updated.relatedPurchaseId,
    billId: null,
    billFilename: data.bill?.filename ?? null,
  };
}

export async function deleteExpense(db: Db, id: number): Promise<void> {
  const [before] = await db
    .select({
      amountPaise: expenses.amountPaise,
      expenseType: expenses.expenseType,
      relatedSaleId: expenses.relatedSaleId,
      relatedPurchaseId: expenses.relatedPurchaseId,
    })
    .from(expenses)
    .where(eq(expenses.id, id));
  if (before) {
    await applyExpenseEffect(db, {
      expenseType: before.expenseType as ExpenseType,
      amountPaise: -before.amountPaise,
      relatedSaleId: before.relatedSaleId,
      relatedPurchaseId: before.relatedPurchaseId,
    });
  }
  await db
    .delete(cashLedger)
    .where(and(eq(cashLedger.refType, "expense"), eq(cashLedger.refId, id)));
  await db.delete(expenseBills).where(eq(expenseBills.expenseId, id));
  await db.delete(expenses).where(eq(expenses.id, id));
  await logActivity(db, {
    event: "expense.delete",
    summary: `Expense deleted: #${id}`,
    entity: "expense",
    entityId: id,
  });
}

/** Categories already used, for the dropdown, oldest first. */
export async function listExpenseCategories(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: expenses.category })
    .from(expenses)
    .orderBy(asc(expenses.category));
  return rows.map((r) => r.category);
}

export type ExpenseBill = { filename: string; mime: string; dataBase64: string };

/** The latest bill attached to an expense (for viewing/downloading). */
export async function getExpenseBill(db: Db, expenseId: number): Promise<ExpenseBill | null> {
  const [row] = await db
    .select({
      filename: expenseBills.filename,
      mime: expenseBills.mime,
      dataBase64: expenseBills.dataBase64,
    })
    .from(expenseBills)
    .where(eq(expenseBills.expenseId, expenseId))
    .orderBy(desc(expenseBills.id))
    .limit(1);
  return row ?? null;
}
