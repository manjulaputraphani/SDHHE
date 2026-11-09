/**
 * API client for the SDHHE native mobile app.
 *
 * Connects to the SAME Cloudflare Worker backend as the web app — zero
 * backend changes. Auth uses a token stored in SecureStore (not cookies).
 */
import * as SecureStore from "expo-secure-store";

const WORKER_URL = "https://sdhhe-api.blvphani.workers.dev";

const TOKEN_KEY = "sdhhe_auth_token";

export async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setAuthToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearAuthToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export type ApiUser = {
  id: number;
  name: string;
  role: "owner" | "ca" | "staff";
  permissions: Record<string, { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport: boolean }>;
};

type RequestOptions = { method?: "POST" | "PUT" | "PATCH" | "DELETE"; body?: Record<string, unknown> };

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      "content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      cookie: `sdhhe_session=${token}`,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    await clearAuthToken();
    throw new Error("Session expired — sign in again");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// ---- Auth ----

export const api = {
  me: () =>
    request<{ user: ApiUser; session: { expiresAt: string } }>("/api/auth/me"),

  login: async (phone: string, password: string) => {
    
    const res = await fetch(`${WORKER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error ?? `Login failed (${res.status})`);
    }
    return res.json() as Promise<{ user: ApiUser; token: string; session: { expiresAt: string } }>;
  },

  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  // ---- Conversations (direct chat) ----

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
        lastMessage?: { id: number; userId: number | null; author: string; body: string; kind: string; createdAt: string } | null;
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
    request<{
      messages: {
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
      }[];
    }>(`/api/chat/messages${room ? `?room=${encodeURIComponent(room)}` : ""}`),

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

  // ---- Push ----

  pushKey: () => request<{ publicKey: string | null }>("/api/push/key"),

  pushSubscribe: (body?: { endpoint: string; p256dh: string; auth: string }) =>
    request<{ ok: boolean }>("/api/push/subscribe", { method: "POST", body }),

  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: boolean }>("/api/push/subscribe", { method: "DELETE", body: { endpoint } }),

  // ---- Stats ----

  stats: () => request<Record<string, unknown>>("/api/stats"),

  // ---- Group management ----

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
