/**
 * Supplier management and dues (payable) tracking.
 *
 * Money is integer paise. Each purchase can have partial payments recorded
 * against it via `supplier_payments`. The `purchases.paid_paise` column keeps
 * the running total paid, and `supplier_payments` is the audit trail.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import {
  purchases,
  suppliers,
  supplierPayments,
  items,
} from "./schema";
import { logActivity } from "./activity";
import { recordCashEntry } from "./cashLedger";
import { formatRupees } from "../logic/units";

export type Queryable = Db | TxDb;

export type SupplierRow = {
  id: number;
  name: string;
  phone: string | null;
};

export type SupplierWithDues = SupplierRow & {
  totalPurchasedPaise: number;
  totalPaidPaise: number;
  outstandingPaise: number;
};

export type SupplierPaymentRow = {
  id: number;
  purchaseId: number;
  purchaseDate: string;
  itemName: string;
  amountPaise: number;
  paymentDate: string;
  paymentMode: string | null;
  note: string | null;
};

/** Create a new supplier. */
export async function createSupplier(
  db: Queryable,
  input: { name: string; phone?: string | null },
): Promise<SupplierRow> {
  await db
    .insert(suppliers)
    .values({ name: input.name, phone: input.phone ?? null });
  const [row] = await db
    .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone })
    .from(suppliers)
    .orderBy(desc(suppliers.id))
    .limit(1);
  return row;
}

/** List all suppliers, optionally with dues. */
export async function listSuppliers(db: Queryable): Promise<SupplierRow[]> {
  return db
    .select({ id: suppliers.id, name: suppliers.name, phone: suppliers.phone })
    .from(suppliers)
    .orderBy(asc(suppliers.name));
}

/** Outstanding dues per supplier (total purchased − total paid). */
export async function getSupplierDues(db: Queryable): Promise<SupplierWithDues[]> {
  const rows = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone,
      totalPurchasedPaise: sql<number>`coalesce(sum(${purchases.totalPaise}), 0)`.mapWith(Number),
      totalPaidPaise: sql<number>`coalesce(sum(${purchases.paidPaise}), 0)`.mapWith(Number),
    })
    .from(suppliers)
    .leftJoin(purchases, eq(purchases.supplierId, suppliers.id))
    .groupBy(suppliers.id)
    .orderBy(asc(suppliers.name));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    totalPurchasedPaise: row.totalPurchasedPaise,
    totalPaidPaise: row.totalPaidPaise,
    outstandingPaise: row.totalPurchasedPaise - row.totalPaidPaise,
  }));
}

/** Record a payment to a supplier against a specific purchase.
 * Updates purchases.paid_paise, inserts supplier_payments, and records a cash ledger entry.
 */
export async function recordSupplierPayment(
  db: Queryable,
  input: {
    purchaseId: number;
    amountPaise: number;
    paymentDate: string;
    paymentMode?: string | null;
    note?: string | null;
    actor?: string | null;
  },
): Promise<void> {
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new Error("Payment amount must be a positive whole number");
  }

  const [purchase] = await db
    .select({ id: purchases.id, totalPaise: purchases.totalPaise, paidPaise: purchases.paidPaise })
    .from(purchases)
    .where(eq(purchases.id, input.purchaseId));
  if (!purchase) throw new Error("Purchase not found");

  const newPaid = purchase.paidPaise + input.amountPaise;
  if (newPaid > purchase.totalPaise) {
    throw new Error(`Payment exceeds purchase total (${formatRupees(purchase.totalPaise)})`);
  }

  await db
    .insert(supplierPayments)
    .values({
      purchaseId: input.purchaseId,
      amountPaise: input.amountPaise,
      paymentDate: input.paymentDate,
      paymentMode: input.paymentMode ?? null,
      note: input.note ?? null,
      actor: input.actor ?? null,
    });

  await db
    .update(purchases)
    .set({ paidPaise: newPaid })
    .where(eq(purchases.id, input.purchaseId));

  // Cash ledger: money out to supplier.
  await recordCashEntry(db, {
    type: "purchase",
    amountPaise: -input.amountPaise,
    refType: "purchase",
    refId: input.purchaseId,
    entryDate: input.paymentDate,
    note: input.note ?? `Payment to supplier for purchase #${input.purchaseId}`,
    actor: input.actor ?? null,
  });

  await logActivity(db, {
    event: "supplier.payment",
    summary: `Paid ${formatRupees(input.amountPaise)} against purchase #${input.purchaseId}`,
    entity: "purchase",
    entityId: input.purchaseId,
  });
}

/** List supplier payments, optionally filtered by purchase. */
export async function listSupplierPayments(
  db: Queryable,
  purchaseId?: number,
): Promise<SupplierPaymentRow[]> {
  const rows = await db
    .select({
      id: supplierPayments.id,
      purchaseId: supplierPayments.purchaseId,
      purchaseDate: purchases.purchaseDate,
      itemName: items.name,
      amountPaise: supplierPayments.amountPaise,
      paymentDate: supplierPayments.paymentDate,
      paymentMode: supplierPayments.paymentMode,
      note: supplierPayments.note,
    })
    .from(supplierPayments)
    .innerJoin(purchases, eq(purchases.id, supplierPayments.purchaseId))
    .innerJoin(items, eq(items.id, purchases.itemId))
    .where(purchaseId ? eq(supplierPayments.purchaseId, purchaseId) : undefined)
    .orderBy(desc(supplierPayments.paymentDate), desc(supplierPayments.id));

  return rows;
}

/** Total outstanding payable across all suppliers. */
export async function getTotalSupplierDues(db: Queryable): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`
        coalesce(sum(${purchases.totalPaise} - ${purchases.paidPaise}), 0)
      `.mapWith(Number),
    })
    .from(purchases);
  return row?.total ?? 0;
}
