import type { Role, RolePermissions } from "../../src/logic/permissions";

export type User = { id: number; name: string; role: Role; permissions: RolePermissions };

// ---- Team Chat (Phase 12) ----
export type ChatMessage = {
  id: number;
  room: string;
  userId: number | null;
  author: string;
  role: string;
  kind: "text" | "receipt" | "system";
  body: string;
  receiptId: number | null;
  createdAt: string;
  /** Who has received it (Phase 14). */
  deliveredBy?: number[];
  /** Who has read it (Phase 14). */
  readBy?: number[];
};

export type ChatReceipt = {
  id: number;
  submittedBy: number | null;
  submitterName: string;
  title: string;
  amountPaise: number;
  note: string | null;
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  status: "pending" | "approved" | "rejected";
  decidedBy: number | null;
  deciderName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  messageId: number | null;
  createdAt: string;
};

/** What the upload endpoint gives back (the file itself lives in R2). */
export type ChatReceiptFile = {
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
};

/** A receipt as it is posted into the room (the file details + the details). */
export type ChatReceiptInput = ChatReceiptFile & {
  title: string;
  amountPaise: number;
  note?: string;
};

export type ChatUser = { id: number; name: string; role: string };

/** A conversation of the chat (Phase 13). */
export type ChatConversation = {
  id: number;
  room: string;
  kind: "group" | "direct";
  /** The name the owner gave the group (Phase 14). */
  title: string | null;
  other: ChatUser | null;
  unread: number;
  lastMessageAt: string | null;
};

/** A member of the shop (who may be chatted with). */
export type ChatMember = { id: number; name: string; role: string; lastSeenAt?: string | null };

// ---- The notification system (Phase 15) ----
export type AnnouncementKind = "info" | "success" | "warning" | "critical";

export type Announcement = {
  id: number;
  title: string;
  message: string;
  kind: AnnouncementKind;
  linkLabel: string | null;
  linkUrl: string | null;
  isActive: boolean;
  createdAt: string;
};

export type Release = {
  id: number;
  version: string;
  title: string;
  items: string[];
  imageUrl: string | null;
  releaseDate: string;
};

export type OnboardingStep = { key: string; label: string; done: boolean };

export type LoginEntry = {
  id: number;
  device: string | null;
  browser: string | null;
  os: string | null;
  ip: string | null;
  createdAt: string;
  current: boolean;
};

export type NotificationBootstrap = {
  user: { id: number; name: string; role: string; lastLoginAt: string | null };
  announcements: Announcement[];
  release: Release | null;
  onboarding: { steps: OnboardingStep[]; done: number; total: number; completed: boolean };
  tours: string[];
  loginHistory: LoginEntry[];
  session: { expiresAt: string };
};

export type Item = {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  hsnCode: string | null;
  minStockBase: number;
  imageUrl: string | null;
  avgCostPaise: number;
  stockLeftBase: number;
};

export type BillRow = {
  id: number;
  billNo: string;
  customerName: string | null;
  saleDate: string;
  totalPaise: number;
  paidPaise: number;
  paymentMode: string;
  cancelled: boolean;
};

export type BillLine = {
  itemName: string;
  unit: string;
  qtyBase: number;
  unitPricePaise: number;
  hsnCode: string | null;
  lineTotalPaise: number;
  costPaise: number;
  profitPaise: number;
};

export type BillDetail = BillRow & {
  customerPhone: string | null;
  customerAddress: string | null;
  customerGstin: string | null;
  customerEmail: string | null;
  subtotalPaise: number;
  discountPaise: number;
  gstPaise: number;
  gstRateBp: number;
  lines: BillLine[];
};

export type ExpenseRow = {
  id: number;
  category: string;
  expenseType: string;
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

export type RotationSummary = {
  asOfDate: string;
  investmentPaise: number;
  stockValuePaise: number;
  cashInBankPaise: number;
  creditOutstandingPaise: number;
  amountInRotationPaise: number;
  netSalesPaise: number;
  cogsPaise: number;
  expensesPaise: number;
  grossProfitPaise: number;
  netProfitPaise: number;
  rotationTimes: number;
  daysToRotate: number | null;
  inventoryTurnover: number;
  trend: Array<{ date: string; netSalesPaise: number }>;
};

export type RoastingRow = {
  id: number;
  roastDate: string;
  rawItemId: number;
  rawItemName: string;
  rawUnit: string;
  roastedItemId: number;
  roastedItemName: string;
  roastedUnit: string;
  rawQtyBase: number;
  roastedQtyBase: number;
  yieldBp: number;
  chargePerKgPaise: number;
  chargePaise: number;
  rawCostPaise: number;
  totalCostPaise: number;
  costPerKgPaise: number;
  marginBp: number;
  suggestedPricePaise: number;
  note: string | null;
};

export type RoastingResult = {
  id: number;
  roastedPurchaseId: number | null;
  rawCostPaise: number;
  chargePaise: number;
  totalCostPaise: number;
  roastedQtyBase: number;
  costPerKgPaise: number;
  suggestedPricePaise: number;
};

export type Supplier = { id: number; name: string; phone: string | null };

export type SupplierWithDues = Supplier & {
  total_purchased_paise: number;
  total_paid_paise: number;
  outstanding_paise: number;
};

export type SupplierPaymentRow = {
  id: number;
  purchase_id: number;
  purchase_date: string;
  item_name: string;
  amount_paise: number;
  payment_date: string;
  payment_mode: string | null;
  note: string | null;
};

export type Member = { id: number; name: string; phone: string; role: Role; active: boolean; pending: boolean; accessUntil: string | null };

export type Customer = {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  email: string | null;
  billCount: number;
  billedPaise: number;
  creditPaise: number;
  lastBillDate: string | null;
};

export type ClosingStockRow = {
  itemId: number;
  name: string;
  unit: string;
  qtyBase: number;
  valuePaise: number;
  avgCostPaise: number;
};

export type FinYearReport = {
  finYear: string;
  startDate: string;
  endDate: string;
  turnoverPaise: number;
  discountsPaise: number;
  gstPaise: number;
  salesCount: number;
  purchaseValuePaise: number;
  purchaseExpensesPaise: number;
  totalPurchasesPaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
  saleExpensesPaise: number;
  generalExpensesPaise: number;
  netProfitPaise: number;
  closingStock: ClosingStockRow[];
  closingStockQtyBase: number;
  closingStockValuePaise: number;
};

export type DealProfit = {
  saleId: number;
  billNo: string;
  date: string;
  customerName: string | null;
  saleValuePaise: number;
  discountPaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
  saleExpensesPaise: number;
  netProfitPaise: number;
  profitPercent: number;
  lines: Array<{
    itemName: string;
    qtyBase: number;
    unit: string;
    ratePaise: number;
    avgCostPaise: number;
    saleValuePaise: number;
    cogsPaise: number;
    profitPaise: number;
    profitPercent: number;
  }>;
};

export type UsageRow = {
  userId: number;
  name: string;
  phone: string;
  role: string;
  sessions: number;
  activeSeconds: number;
  openSessions: number;
  lastLoginAt: string | null;
  lastLogoutAt: string | null;
};

// Lot-wise (per-batch) ledger — see src/db/reports.ts batchLedger().
export type BatchLedgerSale = {
  billNo: string;
  saleDate: string;
  customerName: string | null;
  qtyTaken: number;
  unitPricePaise: number;
  revenuePaise: number;
  cogsPaise: number;
  profitPaise: number;
};

export type BatchLedgerRow = {
  batchId: number;
  purchaseId: number;
  purchaseDate: string;
  supplierName: string | null;
  qtyOriginal: number;
  qtyRemaining: number;
  unitPricePaise: number;
  expensesPaise: number;
  qtySold: number;
  soldValuePaise: number;
  cogsPaise: number;
  profitPaise: number;
  pendingValuePaise: number;
  sales: BatchLedgerSale[];
};

export type BatchLedger = {
  itemId: number;
  itemName: string;
  unit: string;
  batches: BatchLedgerRow[];
};

export type StockEntryRow = {
  id: number;
  date: string;
  item: string;
  unit: string;
  type: string;
  qtyBase: number;
  note: string | null;
  user: string | null;
  createdAt: string | null;
};

export type ActivityRow = {
  id: number;
  at: string;
  actor: string;
  event: string;
  summary: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; reason?: string };
  if (res.status === 401) {
    // Session expired (inactivity, token expiry or a sign-in on another device).
    if (typeof window !== "undefined") {
      const reason = (data as { reason?: string }).reason;
      window.dispatchEvent(new CustomEvent("sdhhe:unauthorized", { detail: { reason } }));
    }
    throw new Error("Session expired — please sign in again");
  }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (phone: string, password: string) =>
    request<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: User }>("/api/auth/me"),
  items: () => request<{ items: Item[] }>("/api/items"),
  createItem: (body: { name: string; unit: string; category?: string; minStockBase: number; imageUrl?: string }) =>
    request<{ item: Item }>("/api/items", { method: "POST", body: JSON.stringify(body) }),
  deleteItem: (id: number) => request<{ ok: boolean }>(`/api/items/${id}`, { method: "DELETE" }),
  updateItem: (id: number, body: { name: string; unit: string; category?: string; minStockBase: number; imageUrl?: string }) =>
    request<{ item: Item }>(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  rotation: () => request<{ rotation: RotationSummary }>("/api/rotation"),
  statsDaily: (days = 14) =>
    request<{ daily: Array<{ date: string; sales: string; expenses: string }> }>(`/api/stats/daily?days=${days}`),
  expenseCategories: () =>
    request<{ categories: Array<{ category: string; total: string }> }>("/api/stats/expense-categories"),
  investments: () =>
    request<{ investments: Array<{ id: number; investor_name: string; amount_paise: number; invested_on: string; note: string | null }>; totalPaise: number }>(
      "/api/investments",
    ),
  addInvestment: (body: { investorName: string; amountPaise: number; date: string; note?: string }) =>
    request<{ ok: boolean; id: number }>("/api/investments", { method: "POST", body: JSON.stringify(body) }),
  deleteInvestment: (id: number) => request<{ ok: boolean }>(`/api/investments/${id}`, { method: "DELETE" }),
  stats: () =>
    request<{
      stats: {
        today_sales: number;
        month_sales: number;
        month_profit: number;
        month_expenses: number;
        credit_paise: number;
        credit_bills: number;
        low_stock: number;
      };
    }>("/api/stats"),
  purchases: () => request<{ purchases: Array<{ id: number; name: string; unit: string; qty_base: number; unit_price_paise: number; total_paise: number; paid_paise: number; purchase_date: string; expenses_paise: number; payment_mode: string | null; note: string | null; supplier_name: string | null }> }>("/api/purchases"),
  addPurchase: (body: { itemId: number; qty: number; unitPricePaise: number; expensesPaise?: number; date: string; supplierName?: string; paymentMode?: string }) =>
    request<{ purchase: { purchaseId: number } }>("/api/purchases", { method: "POST", body: JSON.stringify(body) }),
  updatePurchase: (id: number, body: { qty: number; unitPricePaise: number; expensesPaise?: number; date: string; supplierName?: string; paymentMode?: string; note?: string }) =>
    request<{ ok: boolean }>(`/api/purchases/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  roastings: () => request<{ roastings: RoastingRow[] }>("/api/roastings"),
  createRoasting: (body: Record<string, unknown>) =>
    request<{ roasting: RoastingResult }>("/api/roastings", { method: "POST", body: JSON.stringify(body) }),
  suppliers: () => request<{ suppliers: Supplier[] }>("/api/suppliers"),
  createSupplier: (body: { name: string; phone?: string }) =>
    request<{ supplier: Supplier }>("/api/suppliers", { method: "POST", body: JSON.stringify(body) }),
  supplierDues: () => request<{ dues: SupplierWithDues[] }>("/api/supplier-dues"),
  recordSupplierPayment: (body: { purchaseId: number; amountPaise: number; paymentDate: string; paymentMode?: string; note?: string }) =>
    request<{ ok: boolean }>("/api/supplier-payments", { method: "POST", body: JSON.stringify(body) }),
  supplierPayments: () => request<{ payments: SupplierPaymentRow[] }>("/api/supplier-payments"),
  batches: (itemId: number) => request<{ batches: Array<{ id: number; qty_remaining: number; unit_price_paise: number; purchase_date: string }> }>(`/api/items/${itemId}/batches`),
  batchLedger: (itemId: number) => request<{ ledger: BatchLedger }>(`/api/items/${itemId}/batches/ledger`),
  saveStock: (body: Record<string, unknown>) => request<{ stock: unknown }>("/api/stock", { method: "POST", body: JSON.stringify(body) }),
  stockEntries: () => request<{ entries: StockEntryRow[] }>("/api/stock"),
  expenses: () => request<{ expenses: ExpenseRow[] }>("/api/expenses"),
  addExpense: (body: Record<string, unknown>) => request<{ expense: unknown }>("/api/expenses", { method: "POST", body: JSON.stringify(body) }),
  updateExpense: (id: number, body: Record<string, unknown>) =>
    request<{ expense: unknown }>(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteExpense: (id: number) => request<{ ok: boolean }>(`/api/expenses/${id}`, { method: "DELETE" }),
  createBill: (body: Record<string, unknown>) => request<{ bill: { saleId: number; billNo: string; totalPaise: number } }>("/api/bills", { method: "POST", body: JSON.stringify(body) }),
  bills: () => request<{ bills: BillRow[] }>("/api/bills?limit=100"),
  bill: (id: number) => request<{ bill: BillDetail }>(`/api/bills/${id}`),
  activity: (limit = 25, offset = 0) =>
    request<{ activity: ActivityRow[] }>(`/api/activity?limit=${limit}&offset=${offset}`),
  shop: () => request<{ shop: Record<string, string> }>("/api/shop"),
  signup: (name: string, phone: string, password: string) =>
    request<{ ok: boolean; pending: boolean }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, phone, password }),
    }),
  notifySettings: () =>
    request<{ emails: string[]; signup: boolean; member: boolean; bill: boolean; emailConfigured: boolean; defaultEmail: string }>(
      "/api/settings/notifications",
    ),
  saveNotifySettings: (body: {
    emails: string;
    signup: boolean;
    member: boolean;
    bill: boolean;
    resendApiKey?: string;
    clearResendKey?: boolean;
  }) =>
    request<{ ok: boolean }>("/api/settings/notifications", { method: "PUT", body: JSON.stringify(body) }),
  testNotify: () => request<{ ok: boolean; to?: string[] }>("/api/settings/notifications/test", { method: "POST" }),
  users: () => request<{ users: Member[] }>("/api/users"),
  setUserRole: (id: number, role: Role) =>
    request<{ ok: boolean; role: string }>(`/api/users/${id}/role`, { method: "POST", body: JSON.stringify({ role }) }),
  approveUser: (id: number, role: Role) =>
    request<{ ok: boolean; role: string }>(`/api/users/${id}/approve`, { method: "POST", body: JSON.stringify({ role }) }),
  rejectUser: (id: number) => request<{ ok: boolean }>(`/api/users/${id}/reject`, { method: "POST" }),
  addUser: (name: string, phone: string, password: string, role: Role = "staff", accessUntil?: string) =>
    request<{ user: Member }>("/api/users", { method: "POST", body: JSON.stringify({ name, phone, password, role, accessUntil }) }),
  resetUserPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/api/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  setUserActive: (id: number, active: boolean) =>
    request<{ ok: boolean }>(`/api/users/${id}/active`, { method: "POST", body: JSON.stringify({ active }) }),
  roles: () => request<{ roles: Record<Role, RolePermissions> }>("/api/roles"),
  saveRolePermissions: (role: Role, permissions: RolePermissions) =>
    request<{ role: Role; permissions: RolePermissions }>("/api/roles", { method: "POST", body: JSON.stringify({ role, permissions }) }),
  emailBill: (id: number) => request<{ ok: boolean; to?: string }>(`/api/bills/${id}/email`, { method: "POST" }),
  aiChat: (message: string, history: { role: "user" | "assistant"; content: string }[]) =>
    request<{ answer: string; usedTools: string[] }>("/api/ai/chat", { method: "POST", body: JSON.stringify({ message, history }) }),
  finYears: () => request<{ finYears: string[] }>("/api/reports/fin-years"),
  finYearReport: (finYear: string) => request<{ report: FinYearReport }>(`/api/reports/fin-year?fy=${finYear}`),
  dealProfits: (finYear: string) => request<{ deals: DealProfit[] }>(`/api/reports/deals?fy=${finYear}`),
  usage: () => request<{ usage: UsageRow[] }>("/api/usage"),
   recordPayment: (id: number, amountPaise: number) =>
     request<{ payment: { paidPaise: number; totalPaise: number; creditPaise: number } }>(
       `/api/bills/${id}/payment`,
       { method: "POST", body: JSON.stringify({ amountPaise }) },
     ),
   deleteBill: (id: number) => request<{ ok: boolean }>(`/api/bills/${id}`, { method: "DELETE" }),
  customers: (search?: string) =>
    request<{ customers: Customer[] }>(`/api/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  createCustomer: (body: { name: string; phone?: string; address?: string; gstin?: string; email?: string }) =>
    request<{ customer: { id: number; name: string; phone: string | null } }>("/api/customers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  saveCustomer: (body: { name: string; phone?: string; address?: string; gstin?: string; email?: string }) =>
    request<{ customer: { id: number; name: string; phone: string | null } }>("/api/customers/save", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCustomer: (id: number, body: { name: string; phone?: string; address?: string; gstin?: string; email?: string }) =>
    request<{ customer: Customer }>(`/api/customers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCustomer: (id: number) => request<{ ok: boolean }>(`/api/customers/${id}`, { method: "DELETE" }),
  costingMethod: () => request<{ method: "WAC" | "FIFO" }>("/api/settings/costing"),
  setCostingMethod: (method: "WAC" | "FIFO") =>
    request<{ ok: boolean; method: string }>("/api/settings/costing", { method: "POST", body: JSON.stringify({ method }) }),

  // ---- Team Chat (Phase 12) ----
  // A background call: it must NOT slide the one-hour idle window.
  chatToken: () =>
    request<{ token: string; expiresAt: number; user: User }>("/api/chat/token", {
      headers: { "x-chat-refresh": "1" },
    }),
  logoutEveryone: () =>
    request<{ ok: boolean; epoch: number }>("/api/auth/logout-all", { method: "POST" }),
  chatMessages: (room?: string) =>
    request<{ messages: ChatMessage[] }>(
      `/api/chat/messages${room ? `?room=${encodeURIComponent(room)}` : ""}`,
    ),
  sendChatMessage: (body: { kind: "text" | "receipt"; body: string; room?: string; receipt?: ChatReceiptInput }) =>
    request<{ message: ChatMessage; receipt?: ChatReceipt }>("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  chatReceipts: (status?: "pending" | "approved" | "rejected", room?: string) =>
    request<{ receipts: ChatReceipt[]; pending: number }>(
      `/api/chat/receipts${status || room ? `?${status ? `status=${status}` : ""}${status && room ? "&" : ""}${room ? `room=${encodeURIComponent(room)}` : ""}` : ""}`,
    ),
  decideChatReceipt: (id: number, decision: "approve" | "reject", note?: string) =>
    request<{ receipt: ChatReceipt; message: ChatMessage }>(`/api/chat/receipts/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, note }),
    }),

  // ---- Direct chat (Phase 13) ----
  chatConversations: () => request<{ conversations: ChatConversation[] }>("/api/chat/conversations"),
  chatMembers: () => request<{ members: ChatMember[] }>("/api/chat/members"),
  chatHeartbeat: (room: string) =>
    request<{ ok: boolean; at: string }>("/api/chat/heartbeat", {
      method: "POST",
      body: JSON.stringify({ room }),
    }),
  startChatConversation: (userId: number) =>
    request<{ conversation: ChatConversation }>("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ userId }),
    }),
  markChatRead: (room: string, messageId?: number) =>
    request<{ ok: boolean; unread: number; read?: number[] }>("/api/chat/read", {
      method: "POST",
      body: JSON.stringify({ room, messageId }),
    }),
  // ---- The notification system (Phase 15) ----
  notifications: () => request<NotificationBootstrap>("/api/notifications"),
  dismissAnnouncement: (id: number) =>
    request<{ ok: boolean }>(`/api/notifications/announcements/${id}/dismiss`, { method: "POST" }),
  completeOnboarding: () =>
    request<{ ok: boolean }>("/api/notifications/onboarding/complete", { method: "POST" }),
  markReleaseSeen: (id: number) =>
    request<{ ok: boolean }>(`/api/notifications/releases/${id}/seen`, { method: "POST" }),
  completeTour: (tourId: string) =>
    request<{ ok: boolean }>(`/api/notifications/tours/${tourId}`, { method: "POST" }),
  listAnnouncements: () => request<{ announcements: Announcement[] }>("/api/notifications/announcements"),
  createAnnouncement: (body: {
    title: string;
    message: string;
    kind: AnnouncementKind;
    linkLabel?: string;
    linkUrl?: string;
  }) => request<{ announcement: Announcement }>("/api/notifications/announcements", {
    method: "POST",
    body: JSON.stringify(body),
  }),
  updateAnnouncement: (id: number, body: { title?: string; message?: string; kind?: AnnouncementKind; isActive?: boolean }) =>
    request<{ ok: boolean }>(`/api/notifications/announcements/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deactivateAnnouncement: (id: number) =>
    request<{ ok: boolean }>(`/api/notifications/announcements/${id}/deactivate`, { method: "POST" }),
  publishRelease: (body: { version: string; title: string; items: string[] }) =>
    request<{ release: Release; epoch: number }>("/api/notifications/releases", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  loginHistory: () => request<{ logins: LoginEntry[] }>("/api/notifications/login-history"),

  // ---- Web Push (Phase 16) ----
  pushKey: () => request<{ publicKey: string | null }>("/api/push/key"),
  pushSubscribe: (body: { endpoint: string; p256dh: string; auth: string }) =>
    request<{ ok: boolean }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(body) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>("/api/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }),

  renameChatConversation: (room: string, title: string) =>
    request<{ ok: boolean; room: string; title: string }>("/api/chat/rename", {
      method: "POST",
      body: JSON.stringify({ room, title }),
    }),
  markChatDelivered: (messageId: number) =>
    request<{ ok: boolean }>("/api/chat/delivered", {
      method: "POST",
      body: JSON.stringify({ messageId }),
    }),
};

/** Upload a receipt file (multipart — the JSON helper cannot be used here). */
export async function uploadChatReceipt(file: File): Promise<ChatReceiptFile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/chat/receipts", { method: "POST", credentials: "include", body: form });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sdhhe:unauthorized"));
    }
    throw new Error("Session expired — please sign in again");
  }
  const data = (await res.json().catch(() => ({}))) as { file?: ChatReceiptFile; error?: string };
  if (!res.ok || !data.file) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.file;
}

/** The URL that shows a stored receipt (the key travels base64url in one segment). */
export function chatReceiptUrl(r2Key: string): string {
  let text = "";
  for (const byte of new TextEncoder().encode(r2Key)) text += String.fromCharCode(byte);
  const encoded = btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `/api/chat/receipts/${encoded}`;
}

export const money = (paise: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);

const QTY_FACTORS: Record<string, number> = { kg: 1000, l: 1000, "60 kg bag": 60_000 };

export const qty = (base: number, unit: string): string => {
  const factor = QTY_FACTORS[unit] ?? 1;
  return factor === 1 ? `${Math.round(base)} ${unit}` : `${(base / factor).toFixed(2)} ${unit}`;
};
