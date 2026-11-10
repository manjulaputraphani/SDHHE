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

export type AiTurn = { role: "user" | "assistant"; content: string };

type RequestOptions = { method?: "POST" | "PUT" | "PATCH" | "DELETE"; body?: Record<string, unknown> };

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
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not signed in");
  return {
    ...(await accessHeaders()),
    "content-type": "application/json",
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
  }) =>
    request<{ message: ChatMessage }>("/api/chat/messages", {
      method: "POST",
      body,
    }),

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
  activity: (limit = 4) => request<{ activity: ActivityRow[] }>(`/api/activity?limit=${limit}`),
  addExpense: (body: Record<string, unknown>) =>
    request<{ expense: unknown }>("/api/expenses", { method: "POST", body }),
  aiChat: (message: string, history: AiTurn[]) =>
    request<{ answer: string }>("/api/ai/chat", { method: "POST", body: { message, history } }),

  users: () =>
    request<{ users: { id: number; name: string; phone: string; role: string; active: boolean }[] }>("/api/users"),

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
  createItem: (body: Record<string, unknown>) =>
    request<{ item: ItemRow }>("/api/items", { method: "POST", body }),

  // ---- Purchases ----

  purchases: () => request<{ purchases: PurchaseRow[] }>("/api/purchases"),
  createPurchase: (body: Record<string, unknown>) =>
    request<{ purchase: PurchaseRow }>("/api/purchases", { method: "POST", body }),

  // ---- Expenses ----

  expenses: () => request<{ expenses: ExpenseRow[] }>("/api/expenses"),
  createExpense: (body: Record<string, unknown>) =>
    request<{ expense: ExpenseRow }>("/api/expenses", { method: "POST", body }),

  // ---- Stock Check ----

  stockCheck: () => request<{ rows: StockRow[] }>("/api/stock"),

  // ---- Bills ----

  bills: () => request<{ bills: BillRow[] }>("/api/bills"),
  createBill: (body: {
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    lines: Array<{ itemId: number; qty: number; ratePaise: number }>;
    discountPaise?: number;
    gstPaise?: number;
    paidPaise?: number;
    paymentMode?: "Cash" | "Card" | "UPI" | "Credit";
    date?: string | null;
    note?: string | null;
  }) =>
    request<{ bill: BillRow }>("/api/bills", { method: "POST", body }),
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

export type ItemRow = {
  id: number;
  name: string;
  sku: string | null;
  unit: string;
  batchCostingMethod: string;
  stockRemaining: number;
  wacCostPerUnitPaise: number | null;
  lotLedger: Array<{ batch: string; qtyRemaining: number; costPerUnitPaise: number }>;
  /** From GET /api/items — used for the dashboard low-stock list. */
  minStockBase?: number;
  stockLeftBase?: number;
  category?: string | null;
  imageUrl?: string | null;
};

export type PurchaseRow = {
  id: number;
  itemId: number | null;
  itemName: string;
  qtyRemaining: number;
  unit: string;
  supplierName: string | null;
  poNumber: string | null;
  status: "pending" | "received" | "cancelled";
  amountPaise: number;
  createdAt: string;
};

export type ExpenseRow = {
  id: number;
  title: string;
  amountPaise: number;
  category: string | null;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  createdAt: string;
};

export type StockRow = {
  itemId: number;
  itemName: string;
  unit: string;
  stockLeft: number;
  reservedQty: number;
  availableQty: number;
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
