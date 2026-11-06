/**
 * The desktop app's Team Chat client (Phase 12).
 *
 * The Tauri app talks to the Cloudflare Worker for the chat: the worker holds
 * the live room (Durable Object), the receipt files (R2) and the approvals.
 * The worker address lives in Settings; the bearer token is fetched when the
 * member signs in and kept in the Keychain.
 */
import type { ChatMessage, ReceiptRequest } from "../db/chat";

export type ChatReceiptFile = {
  r2Key: string;
  filename: string;
  mime: string;
  sizeBytes: number;
};

export type ChatFrame =
  | { type: "hello"; user: { id: number; name: string; role: string }; presence: unknown[] }
  | { type: "message"; message: ChatMessage }
  | { type: "receipt"; receipt: ReceiptRequest; message: ChatMessage }
  | { type: "presence"; users: unknown[] }
  | { type: "error"; message: string };

/** A clean worker address: no trailing slash, https:// when there is no scheme. */
export function normaliseWorkerUrl(url: string): string {
  const clean = (url ?? "").trim().replace(/\/+$/, "");
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  return `https://${clean}`;
}

/** The address of the live room. */
export function chatSocketUrl(workerUrl: string, token: string): string {
  const base = normaliseWorkerUrl(workerUrl);
  const scheme = base.startsWith("https://") ? "wss" : "ws";
  const host = base.replace(/^https?:\/\//i, "");
  return `${scheme}://${host}/api/chat/ws?token=${encodeURIComponent(token)}`;
}

/** The address that shows a stored receipt (the key travels in one segment). */
export function chatReceiptUrl(workerUrl: string, r2Key: string): string {
  const base = normaliseWorkerUrl(workerUrl);
  let text = "";
  for (const byte of new TextEncoder().encode(r2Key)) text += String.fromCharCode(byte);
  const encoded = btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base}/api/chat/receipts/${encoded}`;
}

/** Read the key back out of a receipt address (used by the tests). */
export function receiptKeyFromUrl(url: string): string {
  const encoded = url.split("/").pop() ?? "";
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function request<T>(
  workerUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const base = normaliseWorkerUrl(workerUrl);
  if (!base) throw new Error("Set the chat Worker address in Settings first");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Chat request failed (${res.status})`);
  return data;
}

/** Sign in to the chat with the member's phone + password. */
export async function chatLogin(
  workerUrl: string,
  phone: string,
  password: string,
): Promise<{ token: string; expiresAt: number }> {
  const base = normaliseWorkerUrl(workerUrl);
  if (!base) throw new Error("Set the chat Worker address in Settings first");
  const res = await fetch(`${base}/api/chat/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    expiresAt?: number;
    error?: string;
  };
  if (!res.ok || !data.token) throw new Error(data.error ?? `Chat sign-in failed (${res.status})`);
  return { token: data.token, expiresAt: data.expiresAt ?? 0 };
}

/** A conversation of the chat (Phase 13). */
export type ChatConversation = {
  id: number;
  room: string;
  kind: "group" | "direct";
  other: { id: number; name: string; role: string } | null;
  unread: number;
  lastMessageAt: string | null;
};

/** A member of the shop (who may be chatted with). */
export type ChatMember = { id: number; name: string; role: string };

/** The room history, oldest first. */
export async function chatMessages(
  workerUrl: string,
  token: string,
  room: string = "main",
): Promise<ChatMessage[]> {
  const data = await request<{ messages: ChatMessage[] }>(
    workerUrl,
    token,
    `/api/chat/messages?room=${encodeURIComponent(room)}`,
  );
  return data.messages;
}

/** Every conversation of the member (the shop room + the private chats). */
export async function chatConversations(
  workerUrl: string,
  token: string,
): Promise<ChatConversation[]> {
  const data = await request<{ conversations: ChatConversation[] }>(
    workerUrl,
    token,
    "/api/chat/conversations",
  );
  return data.conversations;
}

/** Who may be chatted with. */
export async function chatMembers(workerUrl: string, token: string): Promise<ChatMember[]> {
  const data = await request<{ members: ChatMember[] }>(workerUrl, token, "/api/chat/members");
  return data.members;
}

/** Find or create the private chat with a member. */
export async function startChatConversation(
  workerUrl: string,
  token: string,
  userId: number,
): Promise<ChatConversation> {
  const data = await request<{ conversation: ChatConversation }>(
    workerUrl,
    token,
    "/api/chat/conversations",
    { method: "POST", body: JSON.stringify({ userId }) },
  );
  return data.conversation;
}

/** Mark a conversation as read. */
export async function markChatRead(
  workerUrl: string,
  token: string,
  room: string,
  messageId?: number,
): Promise<number> {
  const data = await request<{ ok: boolean; unread: number }>(
    workerUrl,
    token,
    "/api/chat/read",
    { method: "POST", body: JSON.stringify({ room, messageId }) },
  );
  return data.unread;
}

/** Send a message (or a receipt) into the room. */
export async function chatSend(
  workerUrl: string,
  token: string,
  body: {
    kind: "text" | "receipt";
    body: string;
    room?: string;
    receipt?: ChatReceiptFile & { title: string; amountPaise: number; note?: string };
  },
): Promise<{ message: ChatMessage; receipt?: ReceiptRequest }> {
  return request(workerUrl, token, "/api/chat/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The receipts (and how many are waiting). */
export async function chatReceipts(
  workerUrl: string,
  token: string,
  room?: string,
): Promise<{ receipts: ReceiptRequest[]; pending: number }> {
  return request(
    workerUrl,
    token,
    `/api/chat/receipts${room ? `?room=${encodeURIComponent(room)}` : ""}`,
  );
}

/** Approve or reject a receipt. */
export async function chatDecide(
  workerUrl: string,
  token: string,
  id: number,
  decision: "approve" | "reject",
  note?: string,
): Promise<{ receipt: ReceiptRequest; message: ChatMessage }> {
  return request(workerUrl, token, `/api/chat/receipts/${id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
}

/** Upload the receipt file (multipart — the file goes to R2). */
export async function chatUpload(
  workerUrl: string,
  token: string,
  file: File,
): Promise<ChatReceiptFile> {
  const base = normaliseWorkerUrl(workerUrl);
  if (!base) throw new Error("Set the chat Worker address in Settings first");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${base}/api/chat/receipts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as { file?: ChatReceiptFile; error?: string };
  if (!res.ok || !data.file) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.file;
}

/** Open the live room of a conversation. */
export function openChatSocket(
  workerUrl: string,
  token: string,
  onFrame: (frame: ChatFrame) => void,
  onClose: () => void,
  room: string = "main",
): WebSocket {
  const socket = new WebSocket(
    `${chatSocketUrl(workerUrl, token)}&room=${encodeURIComponent(room)}`,
  );
  socket.onmessage = (event) => {
    try {
      onFrame(JSON.parse(String(event.data)) as ChatFrame);
    } catch {
      // A frame we do not understand is simply ignored.
    }
  };
  socket.onclose = () => onClose();
  return socket;
}

/** The text of a conversation, for the export button. */
export function conversationText(
  room: string,
  title: string,
  messages: { author: string; body: string; createdAt: string }[],
): string {
  const lines = [`Team Chat — ${title}`, `Room: ${room}`, ""];
  for (const message of messages) {
    lines.push(`[${message.createdAt}] ${message.author}: ${message.body}`);
  }
  return lines.join("\n");
}
