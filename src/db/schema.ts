import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Data model — docs/BLUEPRINT.md §4. Money is integer paise, quantity integer base units.

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  unit: text("unit").notNull(),
  category: text("category"),
  minStockBase: integer("min_stock_base").notNull().default(0),
  /** Optional picture for the item (R2 public URL or any image URL). */
  imageUrl: text("image_url"),
  /** Weighted-average cost of one display unit (paise per kg / l / pc). */
  avgCostPaise: integer("avg_cost_paise").notNull().default(0),
  /** Value of the stock on hand in paise — the weighted-average cost pool. */
  stockValuePaise: integer("stock_value_paise").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
});

export const purchases = pgTable(
  "purchases",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    supplierId: integer("supplier_id").references(() => suppliers.id),
    qtyBase: integer("qty_base").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    /** Transport / loading / commission added into the stock cost. */
    expensesPaise: integer("expenses_paise").notNull().default(0),
    purchaseDate: date("purchase_date").notNull(),
    paymentMode: text("payment_mode"),
    /** Amount already paid to the supplier for this purchase (paise). */
    paidPaise: integer("paid_paise").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("purchases_qty_base_positive", sql`${t.qtyBase} > 0`),
    check("purchases_unit_price_non_negative", sql`${t.unitPricePaise} >= 0`),
  ],
);

export const batches = pgTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    purchaseId: integer("purchase_id")
      .notNull()
      .unique()
      .references(() => purchases.id),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    qtyOriginal: integer("qty_original").notNull(),
    qtyRemaining: integer("qty_remaining").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    purchaseDate: date("purchase_date").notNull(),
  },
  (t) => [check("batches_qty_remaining_non_negative", sql`${t.qtyRemaining} >= 0`)],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    type: text("type").notNull(),
    qtyChange: integer("qty_change").notNull(),
    costPaise: integer("cost_paise").notNull(),
    enteredQtyLeft: integer("entered_qty_left"),
    movementDate: date("movement_date").notNull(),
    note: text("note"),
    /** Member who entered it (saved at write time, not derived later). */
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "stock_movements_type_valid",
      sql`${t.type} in ('PURCHASE','STOCK_CHECK','USAGE','WASTAGE','ADJUSTMENT','SALE')`,
    ),
  ],
);

export const movementBatchLinks = pgTable(
  "movement_batch_links",
  {
    movementId: integer("movement_id")
      .notNull()
      .references(() => stockMovements.id),
    batchId: integer("batch_id")
      .notNull()
      .references(() => batches.id),
    qtyTaken: integer("qty_taken").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    costPaise: integer("cost_paise").notNull(),
  },
  (t) => [primaryKey({ columns: [t.movementId, t.batchId] })],
);

export const sales = pgTable(
  "sales",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    movementId: integer("movement_id")
      .notNull()
      .references(() => stockMovements.id),
    qtyBase: integer("qty_base").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    soldAt: date("sold_at").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("sales_qty_positive", sql`${t.qtyBase} > 0`)],
);

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  /** purchase | sale | general — decides where the amount is counted. */
  expenseType: text("expense_type").notNull().default("general"),
  amountPaise: integer("amount_paise").notNull(),
  expenseDate: date("expense_date").notNull(),
  paymentMode: text("payment_mode"),
  paidTo: text("paid_to"),
  note: text("note"),
  /** Deal this expense belongs to (sale expenses). */
  relatedSaleId: integer("related_sale_id").references(() => saleBills.id),
  /** Purchase this expense belongs to (transport, loading, commission). */
  relatedPurchaseId: integer("related_purchase_id").references(() => purchases.id),
});

export const expenseBills = pgTable("expense_bills", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id")
    .notNull()
    .references(() => expenses.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  dataBase64: text("data_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Who did what, when — login/lock plus every create/update/delete. */
export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  userId: integer("user_id").references(() => appUsers.id),
  actor: text("actor").notNull().default("local"),
  event: text("event").notNull(),
  summary: text("summary").notNull(),
  entity: text("entity"),
  entityId: integer("entity_id"),
});

/** Members who log in with phone + password (docs/PLAN_LOGIN.md). */
export const appUsers = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    pending: boolean("pending").notNull().default(false),
    /** Optional last day of access — the account is disabled after this date. */
    accessUntil: date("access_until"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("app_users_role_valid", sql`${t.role} in ('owner','ca','staff')`)],
);

/** Per-role module permissions, editable by the owner (Team → Roles & permissions). */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: text("role").notNull(),
    module: text("module").notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    canExport: boolean("can_export").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.role, t.module] }),
    check("role_permissions_role_valid", sql`${t.role} in ('owner','ca','staff')`),
  ],
);

// One row per login. Opened at sign-in, closed at sign-out (duration = usage time).
export const userSessions = pgTable(
  "user_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Active seconds — written when the session is closed. */
    durationSeconds: integer("duration_seconds"),
    source: text("source").notNull().default("web"),
  },
  (t) => [check("user_sessions_source_valid", sql`${t.source} in ('web','desktop')`)],
);

// V2-P10 billing. NOTE: named sale_bills so the interim `sales` table keeps working
// until the New Sale / Sales list screens replace it (see docs/BUILD_PLAN.md).
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  gstin: text("gstin"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const saleBills = pgTable(
  "sale_bills",
  {
    id: serial("id").primaryKey(),
    billNo: text("bill_no").notNull().unique(),
    customerId: integer("customer_id").references(() => customers.id),
    saleDate: date("sale_date").notNull(),
    subtotalPaise: integer("subtotal_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    gstPaise: integer("gst_paise").notNull().default(0),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    paymentMode: text("payment_mode").notNull(),
    paidPaise: integer("paid_paise").notNull(),
    /** Travel / delivery / packing paid for this deal. */
    saleExpensesPaise: integer("sale_expenses_paise").notNull().default(0),
    note: text("note"),
    cancelled: boolean("cancelled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "sale_bills_payment_mode_valid",
      sql`${t.paymentMode} in ('Cash','UPI','Card','Credit')`,
    ),
    check("sale_bills_paid_non_negative", sql`${t.paidPaise} >= 0`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: serial("id").primaryKey(),
    saleId: integer("sale_id")
      .notNull()
      .references(() => saleBills.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id),
    /** SALE movement for this line — needed to reverse stock exactly on cancel. */
    movementId: integer("movement_id").references(() => stockMovements.id),
    qtyBase: integer("qty_base").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    hsnCode: text("hsn_code"),
    lineTotalPaise: integer("line_total_paise").notNull(),
    costPaise: integer("cost_paise").notNull(),
    profitPaise: integer("profit_paise").notNull(),
    /** Average cost per display unit at the time of the sale (snapshot). */
    avgCostPaise: integer("avg_cost_paise").notNull().default(0),
  },
  (t) => [check("sale_items_qty_positive", sql`${t.qtyBase} > 0`)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Capital ledger — added to the live DB by the web worker (2026-10-31); read-only here.
 *  Treated as the capital account for analytics (opening/closing capital per period). */
export const investments = pgTable("investments", {
  id: serial("id").primaryKey(),
  investorName: text("investor_name").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  investedOn: date("invested_on").notNull(),
  note: text("note"),
});

export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  itemId: integer("item_id").references(() => items.id),
  message: text("message").notNull(),
  priority: integer("priority").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  dismissed: boolean("dismissed").notNull().default(false),
});

/** Cash / bank ledger — every money movement in or out of the business. */
export const cashLedger = pgTable("cash_ledger", {
  id: serial("id").primaryKey(),
  /** 'opening' | 'sale' | 'purchase' | 'expense' | 'withdrawal' | 'deposit' | 'adjustment' */
  type: text("type").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  /** Related sale / purchase / expense id (nullable for opening/withdrawal/deposit). */
  refType: text("ref_type"),
  refId: integer("ref_id"),
  entryDate: date("entry_date").notNull(),
  note: text("note"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Opening balance snapshot — set once, reused as the starting cash position. */
export const openingBalance = pgTable("opening_balance", {
  id: serial("id").primaryKey(),
  amountPaise: integer("amount_paise").notNull(),
  asOfDate: date("as_of_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Payments made to suppliers — tracks money out against each purchase. */
export const supplierPayments = pgTable("supplier_payments", {
  id: serial("id").primaryKey(),
  purchaseId: integer("purchase_id")
    .notNull()
    .references(() => purchases.id),
  amountPaise: integer("amount_paise").notNull(),
  paymentDate: date("payment_date").notNull(),
  paymentMode: text("payment_mode"),
  note: text("note"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
