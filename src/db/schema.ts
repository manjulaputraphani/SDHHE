import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Data model — docs/BLUEPRINT.md §4. Money is integer paise, quantity integer base units.

export const items = pgTable("items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  unit: text("unit").notNull(),
  category: text("category"),
  /** GST HSN code shown on invoices (optional). */
  hsnCode: text("hsn_code"),
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
    /** 'purchase' for supplier buys; 'roasting' for internal roasted-seed production. */
    source: text("source").notNull().default("purchase"),
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
      sql`${t.type} in ('PURCHASE','STOCK_CHECK','USAGE','WASTAGE','ADJUSTMENT','SALE','ROASTING')`,
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
    /** The setup checklist is done (or skipped). */
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
    /** The newest release this member has seen. */
    lastSeenRelease: integer("last_seen_release"),
    /** When this member signed in the last time. */
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Show the "Welcome back" card after a login (per member, every device). */
    showWelcomeBanner: boolean("show_welcome_banner").notNull().default(true),
    /** The last sign of life (the chat heartbeat) — "last seen today at 16:20". */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
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
    /** The id of the signed session (the one-device rule). */
    sessionId: text("session_id"),
    device: text("device"),
    browser: text("browser"),
    os: text("os"),
    ip: text("ip"),
    /** Signed out because the member signed in on another device. */
    forcedOut: boolean("forced_out").notNull().default(false),
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

/**
 * Roasting batch: raw seeds are consumed (with a yield loss) and roasted seeds
 * are added to stock, carrying the raw cost + roasting charge.
 */
export const roastings = pgTable("roastings", {
  id: serial("id").primaryKey(),
  rawItemId: integer("raw_item_id")
    .notNull()
    .references(() => items.id),
  roastedItemId: integer("roasted_item_id")
    .notNull()
    .references(() => items.id),
  /** Internal purchase row that created the roasted batch. */
  roastedPurchaseId: integer("roasted_purchase_id").references(() => purchases.id),
  roastDate: date("roast_date").notNull(),
  rawQtyBase: integer("raw_qty_base").notNull(),
  roastedQtyBase: integer("roasted_qty_base").notNull(),
  /** 12000 = 1.200 kg raw per 1 kg roasted. */
  yieldBp: integer("yield_bp").notNull(),
  chargePerKgPaise: integer("charge_per_kg_paise").notNull().default(0),
  chargePaise: integer("charge_paise").notNull().default(0),
  rawCostPaise: integer("raw_cost_paise").notNull().default(0),
  totalCostPaise: integer("total_cost_paise").notNull().default(0),
  marginBp: integer("margin_bp").notNull().default(0),
  suggestedPricePaise: integer("suggested_price_paise").notNull().default(0),
  note: text("note"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Team Chat (Phase 12) — one row per message in the shop room.
 *
 * The live room itself is a Cloudflare Durable Object; these rows are the
 * durable history that every client loads when it opens the room.
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    /** Room name — one shared room for the shop ("main"). */
    room: text("room").notNull().default("main"),
    userId: integer("user_id").references(() => appUsers.id),
    author: text("author").notNull(),
    role: text("role").notNull().default("staff"),
    /** 'text' (a message) | 'receipt' (a receipt for approval) | 'system' (the app) */
    kind: text("kind").notNull().default("text"),
    body: text("body").notNull().default(""),
    /** Set when the message shows a receipt (see receiptRequests.id). */
    receiptId: integer("receipt_id"),
    /** Set when the author edited the text (Phase 17 — message editing). */
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
    /** The sender accepted the AI polish suggestion (Phase 15). */
    aiPolished: boolean("ai_polished").notNull().default(false),
    /** Set when the message was soft-deleted (T-16.2) — the body stays. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** The message this one quotes (T-16.4 — replies). */
    replyToId: integer("reply_to_id").references((): AnyPgColumn => chatMessages.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("chat_messages_kind_valid", sql`${t.kind} in ('text','receipt','system')`)],
);

/**
 * A receipt waiting for (or carrying) an approval decision.
 *
 * The file itself lives in Cloudflare R2 — only the key is stored here.
 */
export const receiptRequests = pgTable(
  "receipt_requests",
  {
    id: serial("id").primaryKey(),
    submittedBy: integer("submitted_by").references(() => appUsers.id),
    submitterName: text("submitter_name").notNull(),
    title: text("title").notNull(),
    /** Money in paise — never a float. */
    amountPaise: integer("amount_paise").notNull(),
    note: text("note"),
    /** R2 object key, e.g. "receipts/2026-11-06/12.jpg". */
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** 'pending' | 'approved' | 'rejected' */
    status: text("status").notNull().default("pending"),
    decidedBy: integer("decided_by").references(() => appUsers.id),
    deciderName: text("decider_name"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The chat message that shows this receipt. */
    messageId: integer("message_id").references(() => chatMessages.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "receipt_requests_status_valid",
      sql`${t.status} in ('pending','approved','rejected')`,
    ),
    check("receipt_requests_amount_positive", sql`${t.amountPaise} > 0`),
  ],
);

/**
 * A chat conversation (Phase 13).
 *
 * The shop room is a `group` conversation ("main"); every other one is a
 * private chat between two members (`dm-<smallId>-<bigId>`).
 */
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: serial("id").primaryKey(),
    room: text("room").notNull().unique(),
    kind: text("kind").notNull().default("direct"),
    /** Shown above the conversation (the shop room has a name). */
    title: text("title"),
    /** AI polish (Phase 15): the owner turned it on for this group. */
    aiPolish: boolean("ai_polish").notNull().default(false),
    /** Set when an owner-made group is retired (never hard-deleted). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("chat_conversations_kind_valid", sql`${t.kind} in ('group','direct')`)],
);

/** Who is in a conversation — and how far they have read it. */
export const chatConversationMembers = pgTable(
  "chat_conversation_members",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    /** The last message this member has seen (the unread ones are newer). */
    lastReadMessageId: integer("last_read_message_id").notNull().default(0),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);

/**
 * Delivery and read marks of a chat message (Phase 14).
 *
 * One row per (message, member): when their device got it and when they have
 * seen it. The ticks in the chat are built from these rows.
 */
export const chatMessageStates = pgTable(
  "chat_message_states",
  {
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/**
 * The audit trail of a message edit (T-16.2): every previous version of the
 * text stays here — a message in the DB is never overwritten without a record.
 */
export const chatMessageEdits = pgTable(
  "chat_message_edits",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    oldBody: text("old_body").notNull(),
    editedBy: integer("edited_by").references(() => appUsers.id),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_message_edits_message_idx").on(t.messageId)],
);

/**
 * One reaction per member per message (T-16.4): 👍 ❤️ 😂 🙏 ✅ 🔥.
 * Clicking a different emoji replaces the row; the same emoji removes it.
 */
export const chatReactions = pgTable(
  "chat_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_reactions_message_user").on(t.messageId, t.userId),
    index("chat_reactions_message_idx").on(t.messageId),
  ],
);

/**
 * The messages an owner pins in a room (T-16.4) — at most three.
 */
export const chatPinnedMessages = pgTable(
  "chat_pinned_messages",
  {
    id: serial("id").primaryKey(),
    room: text("room").notNull(),
    messageId: integer("message_id")
      .notNull()
      .unique()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    pinnedBy: integer("pinned_by").references(() => appUsers.id),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_pinned_room_idx").on(t.room)],
);

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

/**
 * The in-app notification system (Phase 15).
 *
 * Announcements (the bar on every page), the releases ("what's new"), the
 * tours and the login history.
 */
export const announcements = pgTable(
  "announcements",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    kind: text("kind").notNull().default("info"),
    linkLabel: text("link_label"),
    linkUrl: text("link_url"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: integer("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("announcements_kind_valid", sql`${t.kind} in ('info','success','warning','critical')`),
  ],
);

/** A member closed an announcement (it does not come back on any device). */
export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    announcementId: integer("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);

/** A published release — it shows up as "what's new" once per member. */
export const releases = pgTable("releases", {
  id: serial("id").primaryKey(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  /** The list of what changed (a JSON array of strings). */
  items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
  imageUrl: text("image_url"),
  releaseDate: timestamp("release_date", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The member has seen this release. */
export const userReleasesSeen = pgTable(
  "user_releases_seen",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    releaseId: integer("release_id")
      .notNull()
      .references(() => releases.id, { onDelete: "cascade" }),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.releaseId] })],
);

/** The member has finished this tour. */
export const userTours = pgTable(
  "user_tours",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    tourId: text("tour_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tourId] })],
);

/** Every sign-in of every member (the "recent logins" list). */
export const loginHistory = pgTable(
  "login_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    device: text("device"),
    browser: text("browser"),
    os: text("os"),
    ip: text("ip"),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_history_user_idx").on(t.userId, t.createdAt)],
);

/** The Web Push subscriptions (Phase 16) — the phone notifications of the team. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

/** Expo push tokens (Phase 18) — the native SDHHE Mobile Android app. */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);
