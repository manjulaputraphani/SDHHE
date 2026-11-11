/**
 * API client for the SDHHE native mobile app.
 *
 * Connects to the SAME Cloudflare Worker backend as the web app — zero
 * backend changes. The Worker uses cookie auth (`sdhhe_session` cookie)
 * created at login; the mobile client stores that token in SecureStore and
 * sends it as the cookie header on every request.
 */
import * as SecureStore from "expo-secure-store";


const WORKER_URL = "https://sdhhe-api.blvphani.workers.dev";

const TOKEN_KEY = "sdhhe_auth_token";
const ACCESS_ID_KEY = "sdhhe_cf_access_id";
const ACCESS_SECRET_KEY = "sdhhe_cf_access_secret";

export async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setAuthToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearAuthToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---- Cloudflare Access service token (stored in SecureStore) ----
// The owner creates these at: Zero Trust → Access → Service Tokens → Create.
// The app saves them ONCE in a setup screen and sends them with EVERY request.

export async function getAccessId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_ID_KEY);
}

export async function getAccessSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_SECRET_KEY);
}

export async function setAccessCredentials(clientId: string, clientSecret: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_ID_KEY, clientId);
  await SecureStore.setItemAsync(ACCESS_SECRET_KEY, clientSecret);
}

export async function accessCredentialsSet(): Promise<boolean> {
  const id = await SecureStore.getItemAsync(ACCESS_ID_KEY);
  const secret = await SecureStore.getItemAsync(ACCESS_SECRET_KEY);
  return Boolean(id && secret);
}

export type PermissionSet = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
};

export type ApiUser = {
  id: number;
  name: string;
  role: "owner" | "ca" | "staff";
  permissions: Record<string, PermissionSet>;
};

/** GET /api/stats — snake_case straight from the SQL row. */
export type Stats = {
  today_sales: number;
  month_sales: number;
  month_profit: number;
  month_expenses: number;
  credit_paise: number;
  credit_bills: number;
  low_stock: number;
};

/** GET /api/rotation — working capital & rotation block. */
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

/** GET /api/activity — the feed rows. */
export type ActivityRow = {
  id: number;
  at: string;
  actor: string;
  event: string;
  summary: string;
};

/** One item of the financial-year closing stock (web ClosingStockRow). */
export type ClosingStockRow = {
  itemId: number;
  name: string;
  unit: string;
  qtyBase: number;
  avgCostPaise: number;
  valuePaise: number;
};

/** GET /api/reports/fin-year — the year summary (web FinYearReport). */
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

/** GET /api/reports/deals — per-deal profit (web DealProfit). */
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

/** Supplier master row (web Supplier). */
export type Supplier = { id: number; name: string; phone: string | null };

/** GET /api/supplier-dues — raw SQL, snake_case (web SupplierWithDues). */
export type SupplierWithDues = Supplier & {
  total_purchased_paise: number;
  total_paid_paise: number;
  outstanding_paise: number;
};

/** GET /api/supplier-payments (web SupplierPaymentRow). */
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

/** GET /api/users — a team member (web Member). */
export type Member = {
  id: number;
  name: string;
  phone: string;
  role: "owner" | "ca" | "staff";
  active: boolean;
  pending: boolean;
  accessUntil: string | null;
};

/** GET /api/usage — who logged in and how long (web UsageRow). */
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

export type AiTurn = { role: "user" | "assistant"; content: string };

type RequestOptions = { method?: "POST" | "PUT" | "PATCH" | "DELETE"; body?: Record<string, unknown> };

/**
 * base64url without btoa/TextEncoder — Hermes provides neither.
 * The input is UTF-8 encoded first (same as the web's TextEncoder path).
 */
function base64UrlEncode(input: string): string {
  const latin1 = encodeURIComponent(input).replace(
    /%([0-9A-F]{2})/g,
    (_, hex: string) => String.fromCharCode(parseInt(hex, 16)),
  );
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < latin1.length; i += 3) {
    const b0 = latin1.charCodeAt(i);
    const has1 = i + 1 < latin1.length;
    const has2 = i + 2 < latin1.length;
    const b1 = has1 ? latin1.charCodeAt(i + 1) : 0;
    const b2 = has2 ? latin1.charCodeAt(i + 2) : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 3) << 4) | (b1 >> 4)];
    if (!has1) break;
    out += alphabet[((b1 & 15) << 2) | (b2 >> 6)];
    if (!has2) break;
    out += alphabet[b2 & 63];
  }
  return out;
}

/** The Cloudflare Access service token headers (empty if not configured). */
async function accessHeaders(): Promise<Record<string, string>> {
  const id = await SecureStore.getItemAsync(ACCESS_ID_KEY);
  const secret = await SecureStore.getItemAsync(ACCESS_SECRET_KEY);
  if (!id || !secret) return {};
  return {
    "CF-Access-Client-Id": id,
    "CF-Access-Client-Secret": secret,
  };
}

/** Send the stored session token as the cookie (same as the Worker expects). */
async function authHeaders(contentType = "application/json"): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not signed in");
  return {
    ...(await accessHeaders()),
    // Empty contentType → omitted (multipart FormData sets its own boundary).
    ...(contentType ? { "content-type": contentType } : {}),
    accept: "application/json",
    cookie: `sdhhe_session=${token}`,
  };
}

/** Headers for UNAUTHENTICATED requests (login itself). */
async function accessOnly(): Promise<Record<string, string>> {
  return { ...(await accessHeaders()), "content-type": "application/json", accept: "application/json" };
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    await clearAuthToken();
    throw new Error("Session expired — sign in again");
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---- Auth ----

export const api = {
  me: () => request<{ user: ApiUser }>("/api/auth/me"),

  /** Login — the Worker returns `{ user }` and the token in the Set-Cookie header. */
  login: async (phone: string, password: string): Promise<ApiUser> => {
    const res = await fetch(`${WORKER_URL}/api/auth/login`, {
      method: "POST",
      headers: await accessOnly(),
      body: JSON.stringify({ phone, password }),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const head = text.slice(0, 120).replace(/\n/g, " ");
      throw new Error(`Unexpected response (${res.status}): "${head}…" — not JSON`);
    }
    if (!res.ok) {
      throw new Error((parsed.error as string) ?? `Login failed (${res.status})`);
    }
    // The token is set in the Set-Cookie header: sdhhe_session=<payload>.<signature>
    const cookie = res.headers.get("set-cookie") ?? "";
    const match = /sdhhe_session=([^;]+)/.exec(cookie);
    const token = match?.[1];
    if (!token) throw new Error("Login succeeded but no session token returned");
    await setAuthToken(token);
    return parsed.user as unknown as ApiUser;
  },

  logout: async () => {
    try { await clearAuthToken(); } catch { /* already gone */ }
    try {
      await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    } catch { /* server may not be reachable */ }
  },

  // ---- Conversations (direct + group chat) ----

  chatConversations: () =>
    request<{
      conversations: {
        id: number;
        room: string;
        kind: "group" | "direct";
        title: string | null;
        other: { id: number; name: string; role: string } | null;
        unread: number;
        lastMessageAt: string | null;
        aiPolish?: boolean;
        lastMessage?: { id?: number; userId?: number | null; author?: string; body?: string; kind?: string; createdAt?: string } | null;
      }[];
    }>("/api/chat/conversations"),

  /** Start (or reopen) a 1:1 conversation with a member — POST /api/chat/conversations. */
  startConversation: (userId: number) =>
    request<{ conversation: { room: string; kind?: string; title?: string | null } }>(
      "/api/chat/conversations",
      { method: "POST", body: { userId } },
    ),

  chatMembers: () =>
    request<{ members: { id: number; name: string; role: string; lastSeenAt?: string | null }[] }>("/api/chat/members"),

  sendChatMessage: (body: {
    kind: "text" | "receipt";
    body: string;
    room?: string;
    replyToId?: number;
    mentions?: number[];
    aiPolished?: boolean;
    receipt?: ChatReceiptInput;
  }) =>
    request<{ message: ChatMessage; receipt?: ChatReceipt }>("/api/chat/messages", {
      method: "POST",
      body,
    }),

  /** Multipart upload — the JSON helper cannot set FormData's boundary. */
  uploadChatReceipt: async (file: { uri: string; name: string; type: string }) => {
    const headers = await authHeaders("");
    const form = new FormData();
    form.append("file", file as unknown as Blob);
    const res = await fetch(`${WORKER_URL}/api/chat/receipts`, { method: "POST", headers, body: form });
    if (res.status === 401) {
      await clearAuthToken();
      throw new Error("Session expired — sign in again");
    }
    const data = (await res.json().catch(() => ({}))) as { file?: ChatReceiptFile; error?: string };
    if (!res.ok || !data.file) throw new Error(data.error ?? `Upload failed (${res.status})`);
    return data.file;
  },

  chatReceipts: (room?: string) =>
    request<{ receipts: ChatReceipt[]; pending: number }>(
      `/api/chat/receipts${room ? `?room=${encodeURIComponent(room)}` : ""}`,
    ),

  /** Absolute URL of a stored receipt file (web uses a relative path). */
  chatReceiptUrl: (r2Key: string): string => `${WORKER_URL}/api/chat/receipts/${base64UrlEncode(r2Key)}`,

  /** Leave (or replace) my reaction on a message — one per member. */
  reactChatMessage: (messageId: number, emoji: string) =>
    request<{ reactions: ChatMessage["reactions"] }>(`/api/chat/reactions/${messageId}`, {
      method: "POST",
      body: { emoji },
    }),

  unreactChatMessage: (messageId: number) =>
    request<{ reactions: ChatMessage["reactions"] }>(`/api/chat/reactions/${messageId}`, {
      method: "DELETE",
    }),

  chatPins: (room: string) =>
    request<{ pins: ChatPin[] }>(`/api/chat/pins?room=${encodeURIComponent(room)}`),

  /** Owner only, max 3 per room. */
  pinChatMessage: (room: string, messageId: number) =>
    request<{ pins: ChatPin[] }>("/api/chat/pins", { method: "POST", body: { room, messageId } }),

  unpinChatMessage: (messageId: number) =>
    request<{ ok: boolean }>(`/api/chat/pins/${messageId}`, { method: "DELETE" }),

  /** Edit my own message within 15 minutes. */
  editChatMessage: (id: number, body: string) =>
    request<{ message: ChatMessage }>(`/api/chat/messages/${id}`, {
      method: "PATCH",
      body: { body },
    }),

  deleteChatMessage: (id: number) =>
    request<{ message: ChatMessage }>(`/api/chat/messages/${id}`, { method: "DELETE" }),

  polishChatMessage: (room: string, text: string) =>
    request<{
      polished: string | null;
      keptOriginal?: boolean;
      skipped?: "short" | "emoji";
    }>("/api/chat/polish", { method: "POST", body: { room, text } }),

  chatMessages: (room?: string) =>
    request<{ messages: ChatMessage[] }>(`/api/chat/messages${room ? `?room=${encodeURIComponent(room)}` : ""}`),

  markChatRead: (room: string, messageId?: number) =>
    request<{ ok: boolean; unread: number; read?: number[] }>("/api/chat/read", {
      method: "POST",
      body: { room, messageId },
    }),

  markChatDelivered: (messageId: number) =>
    request<{ ok: boolean }>("/api/chat/delivered", { method: "POST", body: { messageId } }),

  chatHeartbeat: (room: string) =>
    request<{ ok: boolean; at: string }>("/api/chat/heartbeat", { method: "POST", body: { room } }),

  chatToken: () =>
    request<{ token: string; expiresAt: number; user: ApiUser }>("/api/chat/token"),

  pushKey: () => request<{ publicKey: string | null }>("/api/push/key"),

  pushSubscribe: (body?: { endpoint: string; p256dh: string; auth: string }) =>
    request<{ ok: boolean }>("/api/push/subscribe", { method: "POST", body }),

  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>("/api/push/subscribe", { method: "DELETE", body: { endpoint } }),

  stats: () => request<{ stats: Stats }>("/api/stats"),
  statsDaily: (days = 14) =>
    request<{ daily: Array<{ date: string; sales: string; expenses: string }> }>(`/api/stats/daily?days=${days}`),
  expenseCategories: () =>
    request<{ categories: Array<{ category: string; total: string }> }>("/api/stats/expense-categories"),
  rotation: () => request<{ rotation: RotationSummary }>("/api/rotation"),
  activity: (limit = 25, offset = 0) =>
    request<{ activity: ActivityRow[] }>(`/api/activity?limit=${limit}&offset=${offset}`),
  aiChat: (message: string, history: AiTurn[]) =>
    request<{ answer: string }>("/api/ai/chat", { method: "POST", body: { message, history } }),

  users: () => request<{ users: Member[] }>("/api/users"),

  // ---- Team (owner member management) ----
  addUser: (name: string, phone: string, password: string, role: "owner" | "ca" | "staff" = "staff", accessUntil?: string) =>
    request<{ user: Member }>("/api/users", { method: "POST", body: { name, phone, password, role, accessUntil } }),
  setUserRole: (id: number, role: "owner" | "ca" | "staff") =>
    request<{ ok: boolean }>(`/api/users/${id}/role`, { method: "POST", body: { role } }),
  approveUser: (id: number, role: "owner" | "ca" | "staff") =>
    request<{ ok: boolean }>(`/api/users/${id}/approve`, { method: "POST", body: { role } }),
  rejectUser: (id: number) =>
    request<{ ok: boolean }>(`/api/users/${id}/reject`, { method: "POST" }),
  resetUserPassword: (id: number, password: string) =>
    request<{ ok: boolean }>(`/api/users/${id}/password`, { method: "POST", body: { password } }),
  setUserActive: (id: number, active: boolean) =>
    request<{ ok: boolean }>(`/api/users/${id}/active`, { method: "POST", body: { active } }),
  usage: () => request<{ usage: UsageRow[] }>("/api/usage"),

  // ---- Reports (financial year) ----
  finYears: () => request<{ finYears: string[] }>("/api/reports/fin-years"),
  finYearReport: (finYear: string) =>
    request<{ report: FinYearReport }>(`/api/reports/fin-year?fy=${encodeURIComponent(finYear)}`),
  dealProfits: (finYear: string) =>
    request<{ deals: DealProfit[] }>(`/api/reports/deals?fy=${encodeURIComponent(finYear)}`),

  // ---- Suppliers ----
  suppliers: () => request<{ suppliers: Supplier[] }>("/api/suppliers"),
  createSupplier: (body: { name: string; phone?: string }) =>
    request<{ supplier: Supplier }>("/api/suppliers", { method: "POST", body }),
  supplierDues: () => request<{ dues: SupplierWithDues[] }>("/api/supplier-dues"),
  recordSupplierPayment: (body: { purchaseId: number; amountPaise: number; paymentDate: string; paymentMode?: string; note?: string }) =>
    request<{ ok: boolean }>("/api/supplier-payments", { method: "POST", body }),
  supplierPayments: () => request<{ payments: SupplierPaymentRow[] }>("/api/supplier-payments"),

  chatGroupMembers: (room: string) =>
    request<{ members: { id: number; name: string; role: string; lastSeenAt?: string | null }[] }>(
      `/api/chat/groups/members?room=${encodeURIComponent(room)}`,
    ),

  chatMessageInfo: (messageId: number) =>
    request<{
      recipients: { id: number; name: string | null; initials: string | null; avatar: string | null }[];
      receipts: { userId: number; user: { id: number; name: string | null; initials: string | null; avatar: string | null } | null; deliveredAt: string | null; readAt: string | null }[];
    }>(`/api/chat/messages/${messageId}/info`),

  // ---- Items ----

  items: () => request<{ items: ItemRow[] }>("/api/items"),

  /** POST /api/items (src/db/items.ts itemInputSchema). */
  createItem: (body: {
    name: string;
    unit: string;
    category?: string;
    hsnCode?: string;
    minStockBase: number;
    imageUrl?: string;
  }) => request<{ item: ItemRow }>("/api/items", { method: "POST", body }),

  updateItem: (id: number, body: {
    name: string;
    unit: string;
    category?: string;
    hsnCode?: string;
    minStockBase: number;
    imageUrl?: string;
  }) => request<{ item: ItemRow }>(`/api/items/${id}`, { method: "PUT", body }),

  deleteItem: (id: number) =>
    request<{ ok: boolean }>(`/api/items/${id}`, { method: "DELETE" }),

  /** Lot-wise ledger — one row per purchase batch (web api.batchLedger). */
  batchLedger: (itemId: number) =>
    request<{ ledger: BatchLedger }>(`/api/items/${itemId}/batches/ledger`),

  /** The customer master (search matches name/phone/gstin). */
  customers: (search?: string) =>
    request<{ customers: Customer[] }>(
      `/api/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    ),

  /** Create-or-update a customer by name — returns the master id for the bill. */
  saveCustomer: (body: { name: string; phone?: string; address?: string; gstin?: string; email?: string }) =>
    request<{ customer: { id: number; name: string; phone: string | null } }>("/api/customers/save", {
      method: "POST",
      body,
    }),
  // ---- Purchases ----
  purchases: () => request<{ purchases: PurchaseRow[] }>("/api/purchases"),

  /** POST /api/purchases — qty is in DISPLAY units (server converts). */
  addPurchase: (body: {
    itemId: number;
    qty: number;
    unitPricePaise: number;
    expensesPaise?: number;
    date: string;
    supplierName?: string;
    paymentMode?: "Cash" | "Card" | "UPI" | "Credit";
  }) => request<{ purchase: unknown }>("/api/purchases", { method: "POST", body }),

  updatePurchase: (id: number, body: {
    qty: number;
    unitPricePaise: number;
    expensesPaise?: number;
    date: string;
    supplierName?: string;
    paymentMode?: "Cash" | "Card" | "UPI" | "Credit";
    note?: string;
  }) => request<{ purchase: unknown }>(`/api/purchases/${id}`, { method: "PUT", body }),

  // ---- Expenses ----

  expenses: () => request<{ expenses: ExpenseRow[] }>("/api/expenses"),

  /** POST /api/expenses (src/db/expenses.ts expenseInputSchema). */
  addExpense: (body: {
    category: string;
    expenseType: "general" | "purchase" | "sale";
    amountPaise: number;
    date: string;
    paymentMode?: "Cash" | "Card" | "UPI" | "Credit";
    paidTo?: string;
    note?: string;
  }) => request<{ expense: ExpenseRow }>("/api/expenses", { method: "POST", body }),

  updateExpense: (id: number, body: {
    category: string;
    expenseType: "general" | "purchase" | "sale";
    amountPaise: number;
    date: string;
    paymentMode?: "Cash" | "Card" | "UPI" | "Credit";
    paidTo?: string;
    note?: string;
  }) => request<{ expense: ExpenseRow }>(`/api/expenses/${id}`, { method: "PUT", body }),

  deleteExpense: (id: number) =>
    request<{ ok: boolean }>(`/api/expenses/${id}`, { method: "DELETE" }),

  // ---- Stock Check ----

  /** GET /api/stock — the last 30 STOCK_CHECK / USAGE / WASTAGE entries. */
  stockEntries: () => request<{ entries: StockEntryRow[] }>("/api/stock"),

  /**
   * POST /api/stock (src/db/stock.ts stockEntrySchema): USAGE/WASTAGE send
   * `qty` (base units taken); STOCK_CHECK sends `enteredLeft` (counted base).
   */
  saveStock: (body: {
    itemId: number;
    type: "STOCK_CHECK" | "USAGE" | "WASTAGE";
    qty?: number | null;
    enteredLeft?: number | null;
    date: string;
    note?: string;
  }) => request<{ stock: unknown }>("/api/stock", { method: "POST", body }),

  /** Open purchase batches of an item, oldest first (raw SQL, snake_case). */
  itemBatches: (itemId: number) =>
    request<{
      batches: Array<{ id: number; qty_remaining: number; unit_price_paise: number; purchase_date: string }>;
    }>(`/api/items/${itemId}/batches`),

  // ---- Bills ----

  bills: () => request<{ bills: BillRow[] }>("/api/bills"),
  /**
   * POST /api/bills — the REAL contract (src/db/billing.ts saleBillSchema):
   * qtyBase = integer base units (g/ml/pcs), unitPricePaise = paise per BASE
   * unit, customerId from saveCustomer, gstRateBp in basis points (500 = 5%).
   */
  createBill: (body: {
    customerId?: number | null;
    date: string;
    paymentMode: "Cash" | "Card" | "UPI" | "Credit";
    lines: Array<{ itemId: number; qtyBase: number; unitPricePaise: number; hsnCode?: string }>;
    discountPaise?: number;
    gstPaise?: number;
    gstRateBp?: number;
    saleExpensesPaise?: number;
    paidPaise?: number;
    note?: string | null;
  }) =>
    request<{ bill: { saleId: number; billNo: string; subtotalPaise: number; totalPaise: number; profitPaise: number } }>(
      "/api/bills",
      { method: "POST", body },
    ),
  cancelBill: (id: number) =>
    request<{ result: { ok: boolean } }>(`/api/bills/${id}/cancel`, { method: "POST" }),
  recordBillPayment: (id: number, amountPaise: number) =>
    request<{ payment: { id: number; amountPaise: number; paidAt: string } }>(
      `/api/bills/${id}/payment`,
      { method: "POST", body: { amountPaise } },
    ),
};

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
  /** When the message was last edited (if edited). */
  editedAt?: string;
  /** The sender accepted the AI polish suggestion. */
  aiPolished?: boolean;
  /** Soft-deleted — the bubble shows a tombstone. */
  deleted?: boolean;
  /** The message this one quotes (replies). */
  replyToId?: number;
  reactions?: { emoji: string; userId: number; name: string }[];
  deliveredBy?: number[];
  readBy?: number[];
};

/** One pinned message of a room. */
export type ChatPin = {
  id: number;
  messageId: number;
  author: string;
  body: string;
  pinnedAt: string;
};

/** The uploaded file returned by POST /api/chat/receipts. */
export type ChatReceiptFile = {
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
};

/** The `receipt` field of a kind:"receipt" send. */
export type ChatReceiptInput = ChatReceiptFile & {
  title: string;
  amountPaise: number;
  note?: string;
};

/** GET /api/chat/receipts — the full receipt row. */
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

export type ItemRow = {
  id: number;
  name: string;
  /** "kg" | "60 kg bag" (src/db/items.ts ITEM_UNITS). */
  unit: string;
  category: string | null;
  hsnCode: string | null;
  /** Low-stock floor, in integer base units (g / 60kg). */
  minStockBase: number;
  imageUrl: string | null;
  /** Weighted-average cost per BASE unit, for the margin suggestion. */
  avgCostPaise: number;
  /** Stock left across all open batches, in integer base units. */
  stockLeftBase: number;
};

/** One sale that took stock from a lot (web BatchLedgerSale). */
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

/** One purchase lot of an item (web BatchLedgerRow). */
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

/** GET /api/customers — the customer master row. */
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

export type PurchaseRow = {
  id: number;
  /** Item name (GET /api/purchases raw SQL aliases it as `name`). */
  name: string;
  unit: string;
  qty_base: number;
  unit_price_paise: number;
  total_paise: number;
  paid_paise: number;
  purchase_date: string;
  expenses_paise: number;
  payment_mode: string | null;
  note: string | null;
  supplier_name: string | null;
};

export type ExpenseRow = {
  id: number;
  category: string;
  /** purchase (into stock cost) | sale (charged to a deal) | general. */
  expenseType: "general" | "purchase" | "sale";
  amountPaise: number;
  /** YYYY-MM-DD */
  date: string;
  paymentMode: string | null;
  paidTo: string | null;
  note: string | null;
  relatedSaleId: number | null;
  relatedPurchaseId: number | null;
  billId: number | null;
  billFilename: string | null;
};

/** One row of GET /api/stock — a STOCK_CHECK / USAGE / WASTAGE entry. */
export type StockEntryRow = {
  id: number;
  /** Movement date (YYYY-MM-DD). */
  date: string;
  item: string;
  unit: string;
  type: "STOCK_CHECK" | "USAGE" | "WASTAGE";
  qtyBase: number;
  note: string | null;
  user: string | null;
  createdAt: string | null;
};

export type BillRow = {
  id: number;
  billNo: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  subtotalPaise: number;
  discountPaise: number;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  status: "pending" | "paid" | "cancelled";
  createdAt: string;
};
