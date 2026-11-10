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
        lastMessage?: { id?: number; userId?: number | null; author?: string; body?: string; kind?: string; createdAt?: string } | null;
      }[];
    }>("/api/chat/conversations"),

  chatMembers: () =>
    request<{ members: { id: number; name: string; role: string; lastSeenAt?: string | null }[] }>("/api/chat/members"),

  sendChatMessage: (body: { kind: "text" | "receipt"; body: string; room?: string; replyToId?: number; mentions?: number[] }) =>
    request<{ message: { id: number; room: string; userId: number; author: string; kind: string; body: string; createdAt: string } }>("/api/chat/messages", {
      method: "POST",
      body,
    }),

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

  stats: () => request<Record<string, unknown>>("/api/stats"),

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
  deliveredBy?: number[];
  readBy?: number[];
  reactions?: { emoji: string; userId: number; name: string }[];
};
