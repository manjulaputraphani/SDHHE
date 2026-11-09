/**
 * SREE DURGA HARIHARA ENTERPRISES — web API (Cloudflare Worker)
 * W1: health. W2: phone + password auth with HttpOnly signed sessions.
 * Secrets (wrangler secret / .dev.vars): DATABASE_URL, SESSION_SECRET.
 */
import { neon } from "@neondatabase/serverless";
import { argon2id } from "@noble/hashes/argon2.js";
import { normalizePhone, validatePassword } from "../../src/logic/auth";
import { getDb, withTransaction, type Db } from "../../src/db/client";
import { eq, sql } from "drizzle-orm";
import { listItems } from "../../src/db/items";
import { getSaleBill, listSaleBills } from "../../src/db/billing";
import { askAssistant, type ChatTurn } from "../../src/ai/chat";
import { chat } from "../../src/ai/ollama";
import { listExpenses } from "../../src/db/expenses";
import { listActivity } from "../../src/db/activity";
import { getShopDetails, saveShopDetails } from "../../src/db/settings";
import { buildBillHtml } from "../../src/lib/printBill";
import { logActivity } from "../../src/db/activity";
import { createItem, deleteItem, updateItem } from "../../src/db/items";
import { createCustomerOnly } from "../../src/db/customers";
import { cancelSaleBill, createCustomer, createSaleBill, deleteSaleBill, recordBillPayment } from "../../src/db/billing";
import { deleteCustomer, listCustomers, updateCustomer } from "../../src/db/customers";
import { addPurchase, deletePurchase, updatePurchase } from "../../src/db/purchases";
import { createRoasting, listRoastings } from "../../src/db/roasting";
import { rotationSummary } from "../../src/db/rotation";
import { saveStockEntry } from "../../src/db/stock";
import { createExpense, deleteExpense, updateExpense } from "../../src/db/expenses";
import { setAuditActor, type AuditActor } from "../../src/db/activity";
import { endSession, SESSION_MAX_SECONDS, startSession, userUsageMetrics, getSessionsWithoutLogoutLast24Hours } from "../../src/db/sessions";
import { getCostingMethod, setCostingMethod } from "../../src/db/costing";
import { finYearOptions, finYearReport, dealProfits, batchLedger } from "../../src/db/reports";
import { getRoleMatrix, loadPermissionsForRole, saveRolePermissions } from "../../src/db/permissions";
import {
  decodeReceiptKey,
  readReceipt,
  uploadReceipt,
  type R2BucketLike,
} from "./receipts";
import { chatRoomStub } from "./chat/do";
import type { ChatFrame } from "./chat/protocol";
import { chatTokenExpiry, signChatToken, verifyChatToken, CHAT_SESSION_TOKEN_TTL_SECONDS } from "../../src/logic/chatToken";
import {
  createReceipt,
  decideReceipt,
  deleteMessage,
  insertMessage,
  linkReceiptMessage,
  listMessages,
  listPinnedMessages,
  listReactionsForMessages,
  listReceipts,
  messageContext,
  messageRoom,
  parseMessageInput,
  pendingReceiptCount,
  pinMessage,
  receiptRoom,
  setReaction,
  unpinMessage,
  type ReceiptRequest,
updateMessage,
} from "../../src/db/chat";
import {
  addConversationMember,
  archiveConversation,
  conversationRecipients,
  conversationTitle,
  createGroupConversation,
  ensureDirectConversation,
  ensureGroupConversation,
  isMember,
  listChatMembers,
  listConversationMembers,
  listConversations,
  markRead,
  polishEnabled,
  removeConversationMember,
  renameConversation,
  setAiPolish,
  SHARED_ROOM,
  unreadCount,
} from "../../src/db/chatRooms";
import {
  markDelivered,
  markRead as markMessageRead,
  receiptsForMessage,
  statesForMessages,
} from "../../src/db/chatStates";
import { initials } from "../../src/logic/chatView";
import {
  buildDecisionMail,
  buildPushText,
  buildReceiptMail,
  chatMailConfig,
  type MailSender,
} from "./chatMail";
import { pushNtfy, sendMail } from "./mailer";
import { describeDevice } from "./device";
import { sendWebPush } from "./webpush";
import {
  forgetPushSubscription,
  pushSubscriptionsForRoom,
  pushSubscriptionsForUsers,
  savePushSubscription,
} from "../../src/db/pushSubscriptions";
import {
  completeOnboarding,
  completeTour,
  createAnnouncement,
  createRelease,
  dismissAnnouncement,
  forceOtherSessionsOut,
  getShowWelcomeBanner,
  lastLoginAt,
  listActiveAnnouncements,
  listAllAnnouncements,
  listLoginHistory,
  latestUnseenRelease,
  markReleaseSeen,
  onboardingSteps,
  recordLogin,
  sessionForcedOut,
  setLastLoginAt,
  setShowWelcomeBanner,
  updateAnnouncement,
  completedTours,
} from "../../src/db/notifications";
import { chatAuditLine, isGroupRoom, isSharedRoom, membersOf } from "../../src/logic/chatPrivacy";
import { keptAllNumbers, POLISH_SYSTEM_PROMPT, polishSkipReason } from "../../src/logic/aiPolish";
import { appUsers, chatMessages } from "../../src/db/schema";
import { socketTransport } from "./smtpSocket";

/** The Durable Object that holds the Team Chat room (Phase 12). */
export { ChatRoom } from "./chat/do";
import {
  DEFAULT_ROLE_PERMISSIONS,
  MODULES,
  isModule,
  isRole,
  allowed,
  type ModuleKey,
  type PermissionAction,
  type Role,
  type RolePermissions,
} from "../../src/logic/permissions";

export interface Env {
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  MAIL_FROM?: string;
  /** Team Chat mail (Phase 12) — Gmail SMTP. */
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  /** Team Chat push (Phase 12) — the ntfy topic. */
  NTFY_TOPIC?: string;
  /** Web Push (Phase 16) — the VAPID keys of the app. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** Receipt files (Phase 12) — R2 bucket `sdhhe-receipts`. */
  RECEIPTS?: R2BucketLike;
  /** The Team Chat room (Phase 12) — Durable Object. */
  CHAT_ROOM?: DurableObjectNamespace;
  ASSETS?: { fetch: typeof fetch };
}

/** How long a session may sit idle before it is signed out (minutes). */
const IDLE_MINUTES = 30;

const COOKIE = "sdhhe_session";
const SESSION_HOURS = SESSION_MAX_SECONDS / 3600;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60_000;

/** The financial year that contains today (India: 1 April – 31 March). */
function currentFinYear(): string {
  const now = new Date();
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

type Session = {
  uid: number;
  name: string;
  role: Role;
  exp: number;
  until?: string | null;
  lastActivity: number;
  /** Bumped by "sign out everyone" — an older epoch is refused. */
  epoch?: number;
  /** The id of this sign-in (the one-device rule). */
  sid?: string;
};

function normalizeRole(value: unknown): Role {
  return value === "owner" ? "owner" : value === "ca" ? "ca" : "staff";
}

/** Which module + permission does this API request need? `null` = authenticated only. */
function routePermission(
  pathname: string,
  method: string,
): { module: ModuleKey; action: PermissionAction } | null {
  const read = method === "GET";
  if (pathname === "/api/items") return { module: "items", action: read ? "view" : "create" };
  if (/^\/api\/items\/\d+$/.test(pathname)) return { module: "items", action: method === "DELETE" ? "delete" : "edit" };
  if (/^\/api\/items\/\d+\/batches(\/ledger)?$/.test(pathname)) return { module: "items", action: "view" };

  if (pathname === "/api/bills") {
    return read ? { module: "bills", action: "view" } : { module: "billing", action: "create" };
  }
   if (/^\/api\/bills\/\d+$/.test(pathname)) {
     if (method === "DELETE") return { module: "bills", action: "delete" };
     return { module: "bills", action: "view" };
   }
  if (/^\/api\/bills\/\d+\/cancel$/.test(pathname)) return { module: "bills", action: "edit" };
  if (/^\/api\/bills\/\d+\/payment$/.test(pathname)) return { module: "bills", action: "edit" };
  if (/^\/api\/bills\/\d+\/email$/.test(pathname)) return { module: "bills", action: "export" };

  if (pathname === "/api/expenses") return { module: "expenses", action: read ? "view" : "create" };
  if (/^\/api\/expenses\/\d+$/.test(pathname)) return { module: "expenses", action: method === "DELETE" ? "delete" : "edit" };

  if (pathname === "/api/purchases") return { module: "purchases", action: read ? "view" : "create" };
  if (/^\/api\/purchases\/\d+$/.test(pathname)) {
    return { module: "purchases", action: method === "DELETE" ? "delete" : "edit" };
  }

  if (pathname === "/api/suppliers") return { module: "suppliers", action: read ? "view" : "create" };
  if (pathname === "/api/supplier-dues") return { module: "suppliers", action: "view" };
  if (pathname === "/api/supplier-payments") return { module: "suppliers", action: read ? "view" : "create" };

  if (pathname === "/api/stock") return { module: "stock", action: read ? "view" : "create" };
  if (pathname === "/api/roastings") return { module: "stock", action: read ? "view" : "create" };
  if (pathname === "/api/rotation") return { module: "dashboard", action: "view" };

  if (pathname === "/api/customers/save") return { module: "customers", action: "create" };
  if (pathname === "/api/customers") return { module: "customers", action: read ? "view" : "create" };
  if (/^\/api\/customers\/\d+$/.test(pathname)) return { module: "customers", action: method === "DELETE" ? "delete" : "edit" };

  if (pathname === "/api/investments") return { module: "investments", action: read ? "view" : "create" };
  if (/^\/api\/investments\/\d+$/.test(pathname)) return { module: "investments", action: "delete" };

  if (pathname.startsWith("/api/reports/")) return { module: "reports", action: "view" };
  if (pathname === "/api/activity") return { module: "activity", action: "view" };
  if (pathname === "/api/usage") return { module: "team", action: "view" };
  if (pathname === "/api/users") return { module: "team", action: read ? "view" : "create" };
  if (pathname.startsWith("/api/users/")) return { module: "team", action: "edit" };
  if (pathname === "/api/roles") return { module: "team", action: read ? "view" : "edit" };

  if (pathname === "/api/sessions/open") return { module: "team", action: "view" };

  if (pathname === "/api/settings/costing") return { module: "settings", action: read ? "view" : "edit" };
  if (pathname.startsWith("/api/settings/notifications")) return { module: "settings", action: read ? "view" : "edit" };
  if (pathname === "/api/shop") return read ? null : { module: "settings", action: "edit" };
  if (pathname === "/api/stats" || pathname.startsWith("/api/stats/")) return { module: "dashboard", action: "view" };

  // ---- Team Chat (Phase 12) ----
  if (pathname === "/api/chat/auth") return null; // the caller proves who they are
  if (pathname === "/api/chat/messages") return { module: "chat", action: read ? "view" : "create" };
  // Message info (the 1:1 fix): who got / read one message — read-only.
  if (/^\/api\/chat\/messages\/\d+\/info$/.test(pathname)) return { module: "chat", action: "view" };
  if (/^\/api\/chat\/messages\/\d+$/.test(pathname) && method === "PATCH") {
    return { module: "chat", action: "edit" };
  }
  // Deleting one's own message is a "create"-level action — the route checks
  // ownership itself (the owner may delete any, T-16.2).
  if (/^\/api\/chat\/messages\/\d+$/.test(pathname) && method === "DELETE") {
    return { module: "chat", action: "create" };
  }
  if (pathname === "/api/chat/receipts") return { module: "chat", action: read ? "view" : "create" };
  if (/^\/api\/chat\/receipts\/[A-Za-z0-9_-]+$/.test(pathname)) return { module: "chat", action: "view" };
  if (/^\/api\/chat\/receipts\/\d+\/decision$/.test(pathname)) return { module: "chat", action: "edit" };
  // Web Push (Phase 16): any member may subscribe their own device.
  if (pathname === "/api/push/subscribe") return { module: "chat", action: "view" };
  if (pathname === "/api/chat/heartbeat") return { module: "chat", action: "view" };
  if (pathname === "/api/push/key") return null;

  // The notification system (Phase 15).
  if (pathname.startsWith("/api/notifications/announcements")) {
    return { module: "team", action: read ? "view" : "edit" };
  }
  if (pathname.startsWith("/api/notifications/")) return { module: "team", action: "view" };

  // Direct chat (Phase 13): conversations, the member list, read markers.
  if (pathname === "/api/chat/conversations") return { module: "chat", action: read ? "view" : "create" };
  if (pathname === "/api/chat/members") return { module: "chat", action: "view" };
  if (pathname === "/api/chat/read") return { module: "chat", action: "create" };

  // Chat groups (Phase 14): the owner makes groups and picks the members
  // (the routes below check the owner role themselves, like the rename).
  if (pathname === "/api/chat/groups") return { module: "chat", action: read ? "view" : "create" };
  if (pathname === "/api/chat/groups/members") {
    return { module: "chat", action: read ? "view" : method === "DELETE" ? "delete" : "create" };
  }
  if (pathname === "/api/chat/groups/archive") return { module: "chat", action: "delete" };
  // AI polish (Phase 15): a member asks for a suggestion, the owner sets the switch.
  if (pathname === "/api/chat/groups/polish") return { module: "chat", action: "create" };
  if (pathname === "/api/chat/polish") return { module: "chat", action: "create" };
  // Reactions and pins (T-16.4): any member reacts; only the owner pins.
  if (/^\/api\/chat\/reactions\/\d+$/.test(pathname)) return { module: "chat", action: "create" };
  if (pathname === "/api/chat/pins") return { module: "chat", action: read ? "view" : "create" };
  if (/^\/api\/chat\/pins\/\d+$/.test(pathname) && method === "DELETE") {
    return { module: "chat", action: "create" };
  }

  return null;
}

const attempts = new Map<string, { count: number; resetAt: number }>();

// AI polish (Phase 15): 30 suggestions per member per hour, per isolate.
const polishHits = new Map<number, { count: number; resetAt: number }>();

function polishAllowed(userId: number): boolean {
  const now = Date.now();
  const entry = polishHits.get(userId);
  if (!entry || entry.resetAt <= now) {
    polishHits.set(userId, { count: 1, resetAt: now + 60 * 60_000 });
    return true;
  }
  if (entry.count >= 30) return false;
  entry.count += 1;
  return true;
}

// Writes in one isolate are serialized so the audit actor cannot leak between requests.
let writeQueue: Promise<unknown> = Promise.resolve();

function asActor<T>(actor: AuditActor, fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    setAuditActor(actor);
    try {
      return await fn();
    } finally {
      setAuditActor(null);
    }
  });
  writeQueue = run.catch(() => {});
  return run;
}

let pendingSetCookie: string | null = null;

/**
 * The security headers of the app (Phase 15, "zero trust" hardening).
 *
 * The browser may only talk to us over HTTPS, never frame us, never sniff a
 * content type, and only load our own scripts, styles and images.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-XSS-Protection": "0",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

function withSecurityHeaders(response: Response): Response {
  // A WebSocket upgrade carries the socket — it must pass through untouched.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const res = Response.json(data, init);
  if (pendingSetCookie) {
    res.headers.set("Set-Cookie", pendingSetCookie);
    pendingSetCookie = null;
  }
  return res;
}

function b64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const pad = value.length % 4 ? "=".repeat(4 - (value.length % 4)) : "";
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

async function createToken(session: Session, secret: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = b64url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

async function readSession(request: Request, secret: string): Promise<Session | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const part = cookie.split(/;\s*/).find((entry) => entry.startsWith(`${COOKIE}=`));
  if (!part) return null;
  const [payload, signature] = part.slice(COOKIE.length + 1).split(".");
  if (!payload || !signature) return null;
  if (signature !== b64url(await hmac(secret, payload))) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function b64decode(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function b64encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/=+$/, "");
}

/** Verify a PHC argon2id hash ($argon2id$v=19$m=…,t=…,p=…$salt$digest). */
function verifyArgon2(password: string, hash: string): boolean {
  const parts = hash.split("$");
  if (parts.length !== 6 || parts[1] !== "argon2id") return false;
  const params = new Map(
    parts[3].split(",").map((kv) => kv.split("=") as [string, string]),
  );
  const m = Number(params.get("m"));
  const t = Number(params.get("t"));
  const p = Number(params.get("p"));
  if (!Number.isFinite(m) || !Number.isFinite(t) || !Number.isFinite(p)) return false;
  const salt = b64decode(parts[4]);
  const expected = b64encode(b64decode(parts[5]));
  const digest = argon2id(new TextEncoder().encode(password), salt, {
    m,
    t,
    p,
    dkLen: b64decode(parts[5]).length,
  });
  const actual = b64encode(digest);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function hashPasswordPhc(password: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = argon2id(new TextEncoder().encode(password), salt, {
    m: 19456,
    t: 2,
    p: 1,
    dkLen: 32,
  });
  return `$argon2id$v=19$m=19456,t=2,p=1$${b64encode(salt)}$${b64encode(digest)}`;
}

function sessionCookie(token: string, url: URL): string {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${secure}`;
}

/** Send a mail through Gmail (the transport is the Workers socket). */
const gmailSender: MailSender = (config, content) =>
  sendMail(config, content, socketTransport);

/**
 * Tell the shop that a receipt is waiting — or that it was decided.
 *
 * Best effort: the mail and the push may fail, the action never does.
 */
async function notifyReceipt(
  env: Env,
  receipt: ReceiptRequest,
  actorName: string,
): Promise<void> {
  try {
    const config = chatMailConfig(env);
    const push = buildPushText(receipt, actorName);
    await pushNtfy(env.NTFY_TOPIC, push.title, push.message);

    if (!config) return;
    const recipients = await chatMailRecipients(env);
    if (recipients.length === 0) return;
    const mail =
      receipt.status === "pending"
        ? buildReceiptMail(receipt, actorName)
        : buildDecisionMail(receipt, actorName);
    const result = await gmailSender(config, { to: recipients, ...mail });
    if (!result.ok) console.error("chat: mail not sent —", result.error);
  } catch (err) {
    console.error("chat: notification failed:", err);
  }
}

/** Who gets the mail: the notification addresses of the shop. */
async function chatMailRecipients(env: Env): Promise<string[]> {
  const rows = await sqlQuery(env, "select value from settings where key = 'notify_emails'");
  const shop = await getShopDetails(getDb(env.DATABASE_URL as string));
  const raw = rows.length ? String(rows[0].value) : (shop.email ?? "");
  return raw
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry));
}

/**
 * Is this member allowed in that room?
 *
 * Everybody is in the shop room (the row is added on the spot); a private
 * chat only has its two members.
 */
async function chatRoomMember(db: Db, room: string, userId: number): Promise<boolean> {
  if (room === SHARED_ROOM) {
    // Everybody is in the shop room — the row is added on the spot. A member
    // that does not exist gets no row and therefore no access.
    const added = await ensureGroupConversation(db, userId);
    return added !== null;
  }
  // A private chat must look like a private chat, a group like a group —
  // anything else is refused before the database is even asked.
  if (!membersOf(room) && !isGroupRoom(room)) return false;
  return isMember(db, room, userId);
}

/** The name of a member (for the system messages of a group). */
async function memberName(db: Db, userId: number): Promise<string> {
  const [row] = await db
    .select({ name: appUsers.name })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return row?.name ?? "a member";
}

/**
 * Note a private chat in the activity log — WITHOUT what was written in it.
 *
 * The owner can see that a direct chat happened (who with, when); the text
 * of a private chat never reaches the log.
 */
async function logFirstDirectMessage(
  db: Db,
  room: string,
  session: Session,
  message: { id: number },
): Promise<void> {
  // The shop room and an owner-made group are not private chats.
  if (isSharedRoom(room) || isGroupRoom(room)) return;
  const [row] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(chatMessages)
    .where(sql`${chatMessages.room} = ${room}`);
  if ((row?.total ?? 0) !== 1) return; // only the first message of the chat
  await logActivity(db, {
    event: "chat.direct",
    summary: chatAuditLine({
      room,
      author: session.name,
      authorId: session.uid,
      messageCount: 1,
      at: new Date().toISOString(),
    }),
    entity: "chat",
    entityId: message.id,
  });
}

/** The Web Push settings (null when the keys are not set). */
function webPushConfig(env: Env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.log("push: VAPID keys not configured — notifications disabled");
    return null;
  }
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || "mailto:owner@sdhhe-api.blvphani.workers.dev",
  };
}

/**
 * Push a message to the phones of the team (Cloudflare Web Push).
 *
 * Best effort: a dead subscription is removed, nothing is ever thrown.
 */
async function pushToTheTeam(
  env: Env,
  exceptUserId: number,
  message: { title: string; body: string; url?: string },
): Promise<void> {
  const db = getDb(env.DATABASE_URL as string);
  console.log("push: pushToTheTeam, exceptUserId", exceptUserId);
  await pushToSubscriptions(env, db, await pushSubscriptionsForRoom(db, exceptUserId), message);
}

/** Push a message to the phones of the members of a group (the sender is left out). */
async function pushToUsers(
  env: Env,
  userIds: number[],
  exceptUserId: number,
  message: { title: string; body: string; url?: string },
): Promise<void> {
  const db = getDb(env.DATABASE_URL as string);
  console.log("push: pushToUsers, userIds", JSON.stringify(userIds), "exceptUserId", exceptUserId);
  await pushToSubscriptions(env, db, await pushSubscriptionsForUsers(db, userIds, exceptUserId), message);
}

/** The shared fan-out: every device gets the push, dead subscriptions go. */
async function pushToSubscriptions(
  env: Env,
  db: Db,
  subscriptions: Awaited<ReturnType<typeof pushSubscriptionsForRoom>>,
  message: { title: string; body: string; url?: string },
): Promise<void> {
  const config = webPushConfig(env);
  if (!config) return;
  console.log("push: fan-out to", subscriptions.length, "subscription(s)");
  try {
    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const result = await sendWebPush(config, subscription, message);
        if (result.gone) {
          await forgetPushSubscription(db, subscription.endpoint);
          console.log("push: removed dead subscription", subscription.endpoint);
        } else if (!result.delivered) {
          console.log("push: delivery failed for", subscription.endpoint);
        } else {
          console.log("push: delivered to", subscription.endpoint);
        }
      }),
    );
  } catch (err) {
    console.error("push fan-out failed:", err);
  }
}

/** Push a frame into a chat room — the Durable Object broadcasts it. */
async function broadcastToChat(env: Env, frame: ChatFrame, room: string = SHARED_ROOM): Promise<void> {
  const stub = chatRoomStub(env, room);
  if (!stub) return;
  try {
    await stub.fetch("https://chat.internal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(frame),
    });
  } catch (err) {
    console.error("chat: broadcast failed:", err);
  }
}

/**
 * Close the socket of one member (or of everybody) in a room.
 *
 * The Worker removed the member from a group — or archived it — so the
 * Durable Object closes the sockets at once (close code 1008).
 */
async function kickFromChat(
  env: Env,
  room: string,
  options: { userId?: number; reason?: string } = {},
): Promise<void> {
  const stub = chatRoomStub(env, room);
  if (!stub) return;
  try {
    await stub.fetch("https://chat.internal/kick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options),
    });
  } catch (err) {
    console.error("chat: kick failed:", err);
  }
}

/**
 * The signed-in member of a Team Chat request.
 *
 * The web app sends its session cookie; the desktop app sends a short-lived
 * chat token (bearer) because it has no cookie.
 */
/** The session epoch — "sign out everyone" bumps it and every session dies. */
async function sessionEpoch(env: Env): Promise<number> {
  const rows = await sqlQuery(env, "select value from settings where key = 'session_epoch'");
  const value = Number(rows[0]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/** Is this session from an older epoch (i.e. "sign out everybody")? */
async function epochRefused(env: Env, session: Session): Promise<boolean> {
  const epoch = await sessionEpoch(env);
  return (session.epoch ?? 0) !== epoch;
}

/** Bump the epoch — every signed-in member is signed out at once. */
async function bumpSessionEpoch(env: Env): Promise<number> {
  const current = await sessionEpoch(env);
  const next = current + 1;
  await sqlQuery(
    env,
    "insert into settings (key, value) values ('session_epoch', $1) on conflict (key) do update set value = excluded.value",
    [String(next)],
  );
  return next;
}

async function chatActor(request: Request, env: Env): Promise<Session | null> {
  const secret = env.SESSION_SECRET as string;
  const session = await readSession(request, secret);
  if (session) return session;
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const payload = verifyChatToken(token, secret);
  if (!payload) return null;
  return {
    uid: payload.uid,
    name: payload.name,
    role: payload.role,
    exp: payload.exp * 1000,
    until: null,
    lastActivity: Date.now(),
  };
}

/** The session behind a chat bearer token (no cookie involved). */
async function chatTokenSession(request: Request, env: Env): Promise<Session | null> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const payload = verifyChatToken(token, env.SESSION_SECRET as string);
  if (!payload) return null;
  return {
    uid: payload.uid,
    name: payload.name,
    role: payload.role,
    exp: payload.exp * 1000,
    until: null,
    lastActivity: Date.now(),
  };
}

/**
 * The member behind a chat token in the address (?token=…).
 *
 * A WebSocket cannot carry an Authorization header, so the socket carries the
 * token in the address — the desktop app has no cookie at all.
 */
function chatQueryTokenSession(url: URL, env: Env): Session | null {
  const token = url.searchParams.get("token") ?? "";
  if (!token) return null;
  const payload = verifyChatToken(token, env.SESSION_SECRET as string);
  if (!payload) return null;
  return {
    uid: payload.uid,
    name: payload.name,
    role: payload.role,
    exp: payload.exp * 1000,
    until: null,
    lastActivity: Date.now(),
  };
}

function retryAfterMs(phone: string): number {
  const entry = attempts.get(phone);
  if (!entry) return 0;
  if (Date.now() > entry.resetAt) {
    attempts.delete(phone);
    return 0;
  }
  return entry.count >= MAX_ATTEMPTS ? entry.resetAt - Date.now() : 0;
}

function recordFailure(phone: string): void {
  const now = Date.now();
  const entry = attempts.get(phone);
  if (!entry || now > entry.resetAt) {
    attempts.set(phone, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { phone?: string; password?: string } | null;
  if (!body?.phone || !body?.password) {
    return json({ error: "Phone and password are required" }, { status: 400 });
  }
  const phone = normalizePhone(body.phone);
  if (!phone.valid) return json({ error: phone.reason }, { status: 400 });

  const wait = retryAfterMs(phone.phone);
  if (wait > 0) {
    return json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s` }, { status: 429 });
  }

  const sql = neon(env.DATABASE_URL as string);
  const rows = (await sql`
    select id, name, phone, password_hash, role, active, pending, access_until
    from app_users where phone = ${phone.phone} limit 1
  `) as { id: number; name: string; password_hash: string; role: string; active: boolean; pending: boolean; access_until: string | null }[];

  const user = rows[0];
  if (!user) {
    recordFailure(phone.phone);
    return json({ error: "No account found for this number" }, { status: 404 });
  }
  if (user.pending) {
    return json({ error: "Account awaiting owner approval" }, { status: 403 });
  }
  if (!user.active) {
    return json({ error: "This account is disabled — ask the owner" }, { status: 403 });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (user.access_until && user.access_until < today) {
    await sql`update app_users set active = false where id = ${user.id}`;
    return json({ error: "Access expired — ask the owner" }, { status: 403 });
  }

  let valid = false;
  try {
    valid = verifyArgon2(body.password, user.password_hash);
  } catch (err) {
    console.error("argon2 verify failed:", err);
  }
  if (!valid) {
    recordFailure(phone.phone);
    return json({ error: "Wrong password" }, { status: 401 });
  }

  attempts.delete(phone.phone);
  const session: Session = {
    uid: Number(user.id),
    name: String(user.name),
    role: user.role === "owner" ? "owner" : user.role === "ca" ? "ca" : "staff",
    exp: Date.now() + SESSION_HOURS * 3600_000,
    until: user.access_until ?? null,
    lastActivity: Date.now(),
  };
  const epoch = await sessionEpoch(env);
  // One device at a time: the other sessions of this member are signed out.
  const sid = crypto.randomUUID();
  const device = describeDevice(request.headers.get("User-Agent"));
  const ip = request.headers.get("CF-Connecting-IP") ?? null;
  const db = getDb(env.DATABASE_URL as string);
  await forceOtherSessionsOut(db, session.uid, sid);
  await recordLogin(db, {
    userId: session.uid,
    device: device.device,
    browser: device.browser,
    os: device.os,
    ip,
    sessionId: sid,
  });
  await setLastLoginAt(db, session.uid);
  const token = await createToken({ ...session, epoch, sid }, env.SESSION_SECRET as string);
  // Track the session so the activity log knows who was in and for how long.
  await startSession(db, session.uid, "web", session.name);
  const permissions = await loadPermissionsForRole(getDb(env.DATABASE_URL as string), session.role);
  return json(
    { user: { id: session.uid, name: session.name, role: session.role, permissions } },
    { headers: { "Set-Cookie": sessionCookie(token, url) } },
  );
}

type NotifyConfig = { emails: string[]; signup: boolean; member: boolean; bill: boolean };

async function readNotify(env: Env): Promise<NotifyConfig> {
  const sql = neon(env.DATABASE_URL as string) as unknown as {
    query: (text: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
  };
  const rows = await sql.query("select key, value from settings where key in ('notify_emails','notify_signup','notify_member','notify_bill')");
  const map = new Map(rows.map((r) => [String(r.key), String(r.value)]));
  const shop = await getShopDetails(getDb(env.DATABASE_URL as string));
  const raw = map.get("notify_emails") ?? shop.email;
  return {
    emails: raw.split(/[,;]/).map((e) => e.trim()).filter(Boolean),
    signup: map.get("notify_signup") !== "off",
    member: map.get("notify_member") !== "off",
    bill: map.get("notify_bill") !== "off",
  };
}

async function aesKey(env: Env): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.SESSION_SECRET as string));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptText(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(env);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)),
  );
  return `${b64encode(iv)}.${b64encode(cipher)}`;
}

async function decryptText(env: Env, payload: string): Promise<string | null> {
  const [ivPart, cipherPart] = payload.split(".");
  if (!ivPart || !cipherPart) return null;
  try {
    const key = await aesKey(env);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(ivPart) as unknown as BufferSource },
      key,
      b64decode(cipherPart) as unknown as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Resend key: Worker secret first, otherwise the AES-GCM encrypted settings value. */
async function getResendKey(env: Env): Promise<string | null> {
  if (env.RESEND_API_KEY) return env.RESEND_API_KEY;
  const rows = await sqlQuery(env, "select value from settings where key = 'resend_api_key_enc'");
  if (!rows.length) return null;
  return decryptText(env, String(rows[0].value));
}

async function sendOwnerMail(
  env: Env,
  recipients: string[],
  subject: string,
  html: string,
): Promise<boolean> {
  const key = await getResendKey(env);
  if (!key || recipients.length === 0) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "SREE DURGA HARIHARA ENTERPRISES <onboarding@resend.dev>",
      to: recipients,
      subject,
      html,
    }),
  });
  return res.ok;
}

/** Best-effort owner alert; never breaks the action that triggered it. */
async function notifyOwners(
  env: Env,
  event: "signup" | "member" | "bill",
  subject: string,
  html: string,
): Promise<void> {
  try {
    const cfg = await readNotify(env);
    if (!cfg[event]) return;
    await sendOwnerMail(env, cfg.emails, subject, html);
  } catch (err) {
    console.error("notify failed:", err);
  }
}

async function sqlQuery(env: Env, text: string, params: unknown[] = []) {
  const sql = neon(env.DATABASE_URL as string) as unknown as {
    query: (queryText: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;
  };
  return sql.query(text, params);
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/") && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "sdhhe-api",
        databaseConfigured: Boolean(env.DATABASE_URL),
        sessionConfigured: Boolean(env.SESSION_SECRET),
        at: new Date().toISOString(),
      });
    }

    if (!env.DATABASE_URL || !env.SESSION_SECRET) {
      return json({ error: "Server not configured" }, { status: 500 });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return login(request, env, url);
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const session = await readSession(request, env.SESSION_SECRET);
      if (session) {
        // Close the open session and store how long the person was active.
        await endSession(getDb(env.DATABASE_URL as string), session.uid, "web");
      }
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return json({ ok: true }, { headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` } });
    }

    if (url.pathname === "/api/auth/logout-all" && request.method === "POST") {
      const session = await readSession(request, env.SESSION_SECRET);
      if (!session) return json({ error: "Not signed in" }, { status: 401 });
      if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
      const next = await bumpSessionEpoch(env);
      // The open sessions of the usage log are closed as well.
      await sqlQuery(env, "update user_sessions set ended_at = now(), duration_seconds = 0 where ended_at is null");
      return json({ ok: true, epoch: next });
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const session = await readSession(request, env.SESSION_SECRET);
      if (!session) return json({ error: "Not signed in" }, { status: 401 });
      if (await epochRefused(env, session)) {
        const secure = url.protocol === "https:" ? "; Secure" : "";
        return json(
          { error: "Signed out — please sign in again" },
          {
            status: 401,
            headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` },
          },
        );
      }
      const today = new Date().toISOString().slice(0, 10);
      if (session.until && session.until < today) {
        return json({ error: "Access expired — ask the owner" }, { status: 401 });
      }
      const permissions = await loadPermissionsForRole(getDb(env.DATABASE_URL as string), session.role);
      return json({ user: { id: session.uid, name: session.name, role: session.role, permissions } });
    }

    // ---- AI chat (unauthenticated — the worker holds the OLLAMA_API_KEY secret) ----
    if (url.pathname === "/api/ai/chat" && request.method === "POST") {
      if (!env.OLLAMA_API_KEY) {
        return json({ error: "AI is not configured (missing OLLAMA_API_KEY secret)" }, { status: 503 });
      }
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const message = String(body.message ?? "").trim();
      if (!message) return json({ error: "Message is required" }, { status: 400 });
      const history = (Array.isArray(body.history) ? body.history : []) as ChatTurn[];
      const db = getDb(env.DATABASE_URL as string);
      const config = { mode: "cloud" as const, apiKey: env.OLLAMA_API_KEY, model: "glm-5.3-flash:cloud" };
      const result = await askAssistant(db, config, history, message, (c, m, t) =>
        chat(c, m, t, globalThis.fetch),
      );
      return json(result);
    }

    // ---- Team Chat login (Phase 12) ----
    // The desktop app has no worker cookie, so it signs in here with the same
    // phone + password and gets a short-lived chat token.
    if (url.pathname === "/api/chat/auth" && request.method === "POST") {
      const raw = (await request.json().catch(() => ({}))) as { phone?: string; password?: string };
      const phone = normalizePhone(String(raw.phone ?? ""));
      const password = String(raw.password ?? "");
      if (!phone.valid) return json({ error: phone.reason }, { status: 400 });
      if (!password) return json({ error: "Password is required" }, { status: 400 });

      const wait = retryAfterMs(phone.phone);
      if (wait > 0) {
        return json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s` }, { status: 429 });
      }

      const sql = neon(env.DATABASE_URL as string);
      const rows = (await sql`
        select id, name, password_hash, role, active, pending
        from app_users where phone = ${phone.phone} limit 1
      `) as {
        id: number;
        name: string;
        password_hash: string;
        role: string;
        active: boolean;
        pending: boolean;
      }[];

      const user = rows[0];
      if (!user) {
        recordFailure(phone.phone);
        return json({ error: "No account found for this number" }, { status: 404 });
      }
      if (user.pending) {
        return json({ error: "Account awaiting owner approval" }, { status: 403 });
      }
      if (!user.active) {
        return json({ error: "This account is disabled — ask the owner" }, { status: 403 });
      }

      let valid = false;
      try {
        valid = verifyArgon2(password, user.password_hash);
      } catch (err) {
        console.error("argon2 verify failed:", err);
      }
      if (!valid) {
        recordFailure(phone.phone);
        return json({ error: "Wrong password" }, { status: 401 });
      }
      attempts.delete(phone.phone);

      const role = normalizeRole(user.role);
      const exp = chatTokenExpiry();
      const token = signChatToken(
        { uid: Number(user.id), name: String(user.name), role, exp },
        env.SESSION_SECRET as string,
      );
      return json({
        token,
        expiresAt: exp * 1000,
        user: { id: Number(user.id), name: String(user.name), role },
      });
    }

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const name = String(body.name ?? "").trim();
      const phone = normalizePhone(String(body.phone ?? ""));
      const password = String(body.password ?? "");
      if (!name) return json({ error: "Name is required" }, { status: 400 });
      if (!phone.valid) return json({ error: phone.reason }, { status: 400 });
      const pw = validatePassword(password);
      if (!pw.valid) return json({ error: pw.reason }, { status: 400 });
      const existing = await sqlQuery(env, "select id from app_users where phone = $1", [phone.phone]);
      if (existing.length) return json({ error: "That phone number already has an account" }, { status: 400 });
      await sqlQuery(
        env,
        "insert into app_users (name, phone, password_hash, role, active, pending) values ($1,$2,$3,'staff',false,true)",
        [name, phone.phone, hashPasswordPhc(password)],
      );
      await notifyOwners(
        env,
        "signup",
        `New account request — ${name}`,
        `<p><b>${name}</b> (${phone.phone}) requested an account.</p><p>Approve it in the app: Team → Approve.</p>`,
      );
      return json({ ok: true, pending: true }, { status: 201 });
    }

    // ---- Team Chat socket (Phase 12/13) ----
    // The Durable Object does the authentication itself (it checks the chat
    // token and the `chat:view` permission), so the upgrade is handed over
    // before the cookie-only session check below. The room decides which
    // Durable Object holds the socket — one object per conversation.
    if (url.pathname === "/api/chat/ws" && request.method === "GET") {
      if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
        return json({ error: "Expected a WebSocket connection" }, { status: 426 });
      }
      const room = url.searchParams.get("room") ?? SHARED_ROOM;
      const stub = chatRoomStub(env, room);
      if (!stub) return json({ error: "Chat is not configured" }, { status: 503 });
      // Only a member of the conversation may open its socket.
      const member = (await chatActor(request, env)) ?? chatQueryTokenSession(url, env);
      if (!member) return json({ error: "Not signed in" }, { status: 401 });
      const db = getDb(env.DATABASE_URL as string);
      if (!(await chatRoomMember(db, room, member.uid))) {
        return json({ error: "Not allowed: chat view" }, { status: 403 });
      }
      return stub.fetch(request);
    }

    // ---- W3 read API (session required) ----
    // A chat bearer token is accepted on the Team Chat routes and on
    // /api/ai/chat — it is not a general session.
    const cookieSession = await readSession(request, env.SESSION_SECRET);
    const session =
      cookieSession ??
      (url.pathname.startsWith("/api/chat/") || url.pathname === "/api/ai/chat"
        ? await chatTokenSession(request, env)
        : null);
    if (!session) return json({ error: "Not signed in" }, { status: 401 });

    // Inactivity auto-logout (sliding window, refreshed on every API call).
    // 30 minutes — the owner asked for half an hour.
    const IDLE_MS = IDLE_MINUTES * 60 * 1000;
    if (Date.now() - session.lastActivity > IDLE_MS) {
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return json({ error: "Session expired due to inactivity — please sign in again" }, { status: 401, headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` } });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (session.until && session.until < todayIso) {
      return json({ error: "Access expired — ask the owner" }, { status: 401 });
    }

    // "Sign out everyone": a session from an older epoch is refused.
    const epoch = await sessionEpoch(env);
    if ((session.epoch ?? 0) !== epoch) {
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return json(
        { error: "Signed out — please sign in again" },
        {
          status: 401,
          headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` },
        },
      );
    }

    const db = getDb(env.DATABASE_URL as string);
    const permissions = await loadPermissionsForRole(db, session.role);
    const needed = routePermission(url.pathname, request.method);
    if (needed && !allowed(permissions, needed.module, needed.action)) {
      return json(
        { error: `Not allowed: ${needed.module} ${needed.action}` },
        { status: 403 },
      );
    }

    // Refresh the session cookie on every authenticated response (sliding 1-hour window).
    // A background call (the chat token refresh) must NOT slide it — otherwise the
    // hour-long idle logout would never happen while the chat screen is open.
    const isBackground = Boolean(request.headers.get("x-chat-refresh"));
    if (cookieSession && !isBackground) {
      const refreshedSession: Session = { ...cookieSession, lastActivity: Date.now() };
      const refreshToken = await createToken(refreshedSession, env.SESSION_SECRET as string);
      pendingSetCookie = sessionCookie(refreshToken, url);
    }
    const actor: AuditActor = { userId: session.uid, name: session.name, role: session.role };

    try {
      if (url.pathname === "/api/_txn-test" && request.method === "GET") {
        const rows = await withTransaction(env.DATABASE_URL as string, (tx) =>
          tx.execute(sql`select 1 as ok`),
        );
        return json({ ok: true, rows });
      }
      if (url.pathname === "/api/items" && request.method === "GET") {
        return json({ items: await listItems(db) });
      }

      if (url.pathname === "/api/bills" && request.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
        return json({ bills: await listSaleBills(db, limit) });
      }

      if (url.pathname.startsWith("/api/bills/") && request.method === "GET") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid bill id" }, { status: 400 });
        const bill = await getSaleBill(db, id);
        if (!bill) return json({ error: "Bill not found" }, { status: 404 });
        return json({ bill });
      }

       if (url.pathname.startsWith("/api/bills/") && request.method === "DELETE") {
         if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
         const id = Number(url.pathname.split("/").pop());
         if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid bill id" }, { status: 400 });
         await asActor(actor, () => deleteSaleBill(db, id));
         return json({ ok: true });
       }

      if (url.pathname === "/api/expenses" && request.method === "GET") {
        const month = url.searchParams.get("month") ?? undefined;
        const category = url.searchParams.get("category") ?? undefined;
        return json({ expenses: await listExpenses(db, { month, category }) });
      }

      if (url.pathname === "/api/activity" && request.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit")) || 25, 200);
        const offset = Math.min(Math.max(Number(url.searchParams.get("offset")) || 0, 0), 10_000);
        return json({ activity: await listActivity(db, limit, offset) });
      }

      if (url.pathname === "/api/shop" && request.method === "GET") {
        return json({ shop: await getShopDetails(db) });
      }

      if (url.pathname === "/api/stats/daily" && request.method === "GET") {
        // Rolling window: "today" in Asia/Kolkata (the shop's sale/expense dates are
        // IST calendar dates) minus (days − 1) through today — NOT the current month
        // and not `current_date`, which follows the UTC database clock and shifts the
        // window around midnight IST.
        const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 14, 7), 31);
        const rows = await sqlQuery(env, `select d::date::text as date,
          coalesce((select sum(total_paise) from sale_bills b where not b.cancelled and b.sale_date = d::date),0)::bigint as sales,
          coalesce((select sum(amount_paise) from expenses e where e.expense_date = d::date),0)::bigint as expenses
          from generate_series((now() at time zone 'Asia/Kolkata')::date - ($1::int - 1), (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d`, [days]);
        return json({ daily: rows });
      }

      if (url.pathname === "/api/stats/expense-categories" && request.method === "GET") {
        const rows = await sqlQuery(env, `select category, sum(amount_paise)::bigint as total from expenses
          where expense_date >= date_trunc('month', current_date) group by category order by total desc`);
        return json({ categories: rows });
      }

      if (url.pathname === "/api/reports/fin-years" && request.method === "GET") {
        return json({ finYears: await finYearOptions(db) });
      }

      if (url.pathname === "/api/reports/fin-year" && request.method === "GET") {
        const finYear = url.searchParams.get("fy") ?? currentFinYear();
        try {
          return json({ report: await finYearReport(db, finYear) });
        } catch {
          return json({ error: "Invalid financial year" }, { status: 400 });
        }
      }

      if (url.pathname === "/api/reports/deals" && request.method === "GET") {
        const finYear = url.searchParams.get("fy") ?? currentFinYear();
        try {
          return json({ deals: await dealProfits(db, finYear) });
        } catch {
          return json({ error: "Invalid financial year" }, { status: 400 });
        }
      }

      if (url.pathname === "/api/usage" && request.method === "GET") {
        return json({ usage: await userUsageMetrics(db) });
      }

      if (url.pathname === "/api/roles" && request.method === "GET") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        return json({ roles: await getRoleMatrix(db) });
      }

      if (url.pathname === "/api/sessions/open" && request.method === "GET") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const rows = await getSessionsWithoutLogoutLast24Hours(db);
        return json({ sessions: rows });
      }

      if (url.pathname === "/api/settings/costing" && request.method === "GET") {
        return json({ method: await getCostingMethod(db) });
      }

      if (url.pathname === "/api/settings/costing" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { method?: string };
        const method = body.method === "FIFO" ? "FIFO" : "WAC";
        await setCostingMethod(db, method);
        await logActivity(db, {
          event: "settings.costing",
          summary: `Costing method set to ${method}`,
          entity: "settings",
        });
        return json({ ok: true, method });
      }

      if (url.pathname === "/api/investments") {
        if (request.method === "GET") {
          const rows = await sqlQuery(env, `select id, investor_name, amount_paise, invested_on::text as invested_on, note from investments order by invested_on desc, id desc`);
          const [tot] = await sqlQuery(env, `select coalesce(sum(amount_paise),0)::bigint as total from investments`);
          return json({ investments: rows, totalPaise: Number(tot.total) });
        }
      }

      if (url.pathname === "/api/rotation" && request.method === "GET") {
        return json({ rotation: await rotationSummary(db) });
      }

      if (url.pathname === "/api/stats" && request.method === "GET") {
        const [row] = await sqlQuery(env, `select
          (select coalesce(sum(total_paise),0) from sale_bills where cancelled = false and sale_date = current_date) as today_sales,
          (select coalesce(sum(total_paise),0) from sale_bills where cancelled = false and sale_date >= date_trunc('month', current_date)) as month_sales,
          (select coalesce(sum(si.profit_paise),0) from sale_items si join sale_bills sb on sb.id = si.sale_id where sb.cancelled = false and sb.sale_date >= date_trunc('month', current_date)) as month_profit,
          (select coalesce(sum(amount_paise),0) from expenses where expense_date >= date_trunc('month', current_date)) as month_expenses,
          (select coalesce(sum(total_paise - paid_paise),0) from sale_bills where cancelled = false and paid_paise < total_paise) as credit_paise,
          (select count(*)::int from sale_bills where cancelled = false and paid_paise < total_paise) as credit_bills,
          (select count(*)::int from items i where coalesce((select sum(b.qty_remaining) from batches b where b.item_id = i.id),0) <= i.min_stock_base) as low_stock`);
        return json({ stats: row });
      }

      if (url.pathname === "/api/roastings" && request.method === "GET") {
        return json({ roastings: await listRoastings(db) });
      }

      if (url.pathname === "/api/purchases" && request.method === "GET") {
        const rows = await sqlQuery(env, `select p.id, p.qty_base, p.unit_price_paise, p.total_paise, p.paid_paise, p.purchase_date,
            p.expenses_paise, p.payment_mode, p.note, i.name, i.unit, s.name as supplier_name
          from purchases p
          join items i on i.id = p.item_id
          left join suppliers s on s.id = p.supplier_id
          where p.source = 'purchase'
          order by p.id desc limit 30`);
        return json({ purchases: rows });
      }

      // ---- Supplier dues (reads) ----
      if (url.pathname === "/api/suppliers" && request.method === "GET") {
        const rows = await sqlQuery(env, `select id, name, phone from suppliers order by name`);
        return json({ suppliers: rows });
      }

      if (url.pathname === "/api/supplier-dues" && request.method === "GET") {
        const rows = await sqlQuery(env, `select
          s.id, s.name, s.phone,
          coalesce(sum(p.total_paise), 0)::bigint as total_purchased_paise,
          coalesce(sum(p.paid_paise), 0)::bigint as total_paid_paise,
          (coalesce(sum(p.total_paise), 0) - coalesce(sum(p.paid_paise), 0))::bigint as outstanding_paise
        from suppliers s
        left join purchases p on p.supplier_id = s.id
        group by s.id, s.name, s.phone
        order by s.name`);
        return json({ dues: rows });
      }

      if (url.pathname === "/api/supplier-payments" && request.method === "GET") {
        const rows = await sqlQuery(env, `select
          sp.id, sp.purchase_id, p.purchase_date, i.name as item_name,
          sp.amount_paise, sp.payment_date, sp.payment_mode, sp.note
        from supplier_payments sp
        join purchases p on p.id = sp.purchase_id
        join items i on i.id = p.item_id
        order by sp.payment_date desc, sp.id desc`);
        return json({ payments: rows });
      }

      const batchMatch = url.pathname.match(/^\/api\/items\/(\d+)\/batches$/);
      if (batchMatch && request.method === "GET") {
        const id = Number(batchMatch[1]);
        const rows = await sqlQuery(env, `select id, qty_remaining, unit_price_paise, purchase_date from batches where item_id = $1 and qty_remaining > 0 order by purchase_date, id`, [id]);
        return json({ batches: rows });
      }

      // Lot-wise ledger: per purchase batch, sold qty / sold value / profit / pending.
      const ledgerMatch = url.pathname.match(/^\/api\/items\/(\d+)\/batches\/ledger$/);
      if (ledgerMatch && request.method === "GET") {
        const id = Number(ledgerMatch[1]);
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid item id" }, { status: 400 });
        return json({ ledger: await batchLedger(db, id) });
      }

      // ---- Team Chat (Phase 12): receipt files ----
      // The web app exchanges its session for a chat token (the socket needs
      // one); the desktop app gets its token with phone + password.
      if (url.pathname === "/api/chat/token" && request.method === "GET") {
        const actor = await chatActor(request, env);
        if (!actor) return json({ error: "Not signed in" }, { status: 401 });
        if (!allowed(permissions, "chat", "view")) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const exp = chatTokenExpiry(Date.now(), CHAT_SESSION_TOKEN_TTL_SECONDS);
        const token = signChatToken(
          { uid: actor.uid, name: actor.name, role: actor.role, exp },
          env.SESSION_SECRET as string,
        );
        return json({
          token,
          expiresAt: exp * 1000,
          user: { id: actor.uid, name: actor.name, role: actor.role },
        });
      }

      // These two live ABOVE the generic `body` reader below: a multipart upload
      // must not be read as JSON first.
      if (url.pathname === "/api/chat/receipts" && request.method === "POST") {
        const bucket = env.RECEIPTS;
        if (!bucket) {
          return json({ error: "Receipt storage is not configured" }, { status: 503 });
        }
        const form = await request.formData().catch(() => null);
        const entry = form?.get("file");
        if (!entry || typeof entry === "string") {
          return json({ error: "Attach the receipt file" }, { status: 400 });
        }
        const file = entry as File;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const stored = await uploadReceipt(bucket, {
            name: file.name,
            type: file.type,
            bytes,
          });
          return json({ file: stored });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
        }
      }

      const receiptFileMatch = url.pathname.match(/^\/api\/chat\/receipts\/([A-Za-z0-9_-]+)$/);
      if (receiptFileMatch && request.method === "GET") {
        const bucket = env.RECEIPTS;
        if (!bucket) {
          return json({ error: "Receipt storage is not configured" }, { status: 503 });
        }
        let key: string;
        try {
          key = decodeReceiptKey(receiptFileMatch[1]!);
        } catch {
          return json({ error: "Invalid receipt key" }, { status: 400 });
        }
        const object = await readReceipt(bucket, key);
        if (!object) return json({ error: "Receipt not found" }, { status: 404 });
        return new Response(object.body, {
          headers: {
            "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
            "content-length": String(object.size),
            "cache-control": "private, max-age=300",
          },
        });
      }

      // ---- Team Chat (Phase 13): conversations ----
      if (url.pathname === "/api/chat/conversations" && request.method === "GET") {
        return json({ conversations: await listConversations(db, session.uid) });
      }

      if (url.pathname === "/api/chat/members" && request.method === "GET") {
        const rows = await sqlQuery(
          env,
          `select id, name, role, last_seen_at::text as "lastSeenAt" from app_users
           where active = true and id <> $1 order by name`,
          [session.uid],
        );
        return json({ members: rows });
      }

      // ---- Team Chat (Phase 12): messages and approvals ----
      if (url.pathname === "/api/chat/messages" && request.method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
        const room = url.searchParams.get("room") ?? SHARED_ROOM;
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const messages = await listMessages(db, { room, limit });
        // The ticks: who has received the message and who has read it.
        const marks = await statesForMessages(db, messages.map((message) => message.id));
        // The reactions (T-16.4) — chips under the bubble.
        const reactions = await listReactionsForMessages(
          db,
          messages.map((message) => message.id),
        );
        const withMarks = messages.map((message) => {
          const states = marks.get(message.id) ?? [];
          // The sender is NEVER a recipient of their own message — their rows
          // (dirty data from before the fix) never reach the client.
          const senderId = message.userId == null ? null : Number(message.userId);
          const notMine = (state: { userId: number }) =>
            senderId == null || Number(state.userId) !== senderId;
          return {
            ...message,
            deliveredBy: states
              .filter((state) => state.delivered && notMine(state))
              .map((state) => Number(state.userId)),
            readBy: states.filter((state) => state.read && notMine(state)).map((state) => Number(state.userId)),
            reactions: reactions.get(message.id) ?? [],
          };
        });
        return json({ messages: withMarks });
      }

      // ---- Message info (the 1:1 fix): the recipients and their receipts ----
      const messageInfoMatch = url.pathname.match(/^\/api\/chat\/messages\/(\d+)\/info$/);
      if (messageInfoMatch && request.method === "GET") {
        const id = Number(messageInfoMatch[1]);
        const target = await messageContext(db, id);
        if (!target || !(await chatRoomMember(db, target.room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        // The recipients are the members of THIS conversation, minus the
        // sender — never the team or the all-users list.
        const [recipients, receipts] = await Promise.all([
          conversationRecipients(db, target.room, target.userId),
          receiptsForMessage(db, id, target.userId),
        ]);
        const userOf = (userId: number, name: string | null) => ({
          id: userId,
          name,
          initials: name ? initials(name) : null,
          avatar: null as string | null,
        });
        return json({
          recipients: recipients.map((entry) => userOf(entry.id, entry.name)),
          receipts: receipts.map((entry) => ({
            userId: entry.userId,
            user: userOf(entry.userId, entry.name),
            deliveredAt: entry.deliveredAt,
            readAt: entry.readAt,
          })),
        });
      }

      if (url.pathname === "/api/chat/receipts" && request.method === "GET") {
        const rawStatus = url.searchParams.get("status");
        const status =
          rawStatus === "pending" || rawStatus === "approved" || rawStatus === "rejected"
            ? rawStatus
            : undefined;
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
        const room = url.searchParams.get("room") ?? undefined;
        if (room && !(await isMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        return json({
          receipts: await listReceipts(db, { status, limit, room }),
          pending: await pendingReceiptCount(db),
        });
      }

      // ---- W3b writes (session actor threaded per request) ----
      const body = (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)
        ? await request.json().catch(() => ({}))
        : {}) as Record<string, unknown>;

      if (url.pathname === "/api/chat/rename" && request.method === "POST") {
        // Renaming a group is an owner job (the admin).
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const room = String(body.room ?? "");
        const title = String(body.title ?? "");
        if (!room) return json({ error: "Which conversation?" }, { status: 400 });
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const renamed = await renameConversation(db, room, title);
        if (!renamed) return json({ error: "Give the group a name" }, { status: 400 });
        // Everybody in the room sees the new name at once…
        await broadcastToChat(env, { type: "rename", room, title: renamed }, room);
        // …and the rename is written into the conversation itself.
        const system = await asActor(actor, () =>
          insertMessage(db, {
            room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "system",
            body: `${session.name} renamed the group to "${renamed}"`,
          }),
        );
        await broadcastToChat(env, { type: "message", message: system }, room);
        await logActivity(db, {
          event: "chat.rename",
          summary: `Chat renamed to ${renamed}`,
          entity: "chat",
        });
        return json({ ok: true, room, title: renamed, message: system });
      }

      // ---- Chat groups (Phase 14): the owner makes groups and picks the members ----
      if (url.pathname === "/api/chat/groups" && request.method === "POST") {
        // Making a group is an owner job (the admin), like the rename.
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const title = String(body.title ?? "");
        const memberIds = (Array.isArray(body.memberIds) ? body.memberIds : [])
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0);
        // The owner is always part of the group they make.
        const group = await asActor(actor, () =>
          createGroupConversation(db, {
            room: `group-${crypto.randomUUID()}`,
            title,
            memberIds: [session.uid, ...memberIds],
          }),
        );
        if (!group) {
          return json({ error: "Give the group a name and pick its members" }, { status: 400 });
        }
        const system = await asActor(actor, () =>
          insertMessage(db, {
            room: group.room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "system",
            body: `${session.name} created the group "${group.title ?? group.room}"`,
          }),
        );
        await broadcastToChat(env, { type: "message", message: system }, group.room);
        await broadcastToChat(env, { type: "members", room: group.room }, group.room);
        await logActivity(db, {
          event: "chat.group.create",
          summary: `Chat group "${group.title ?? group.room}" created`,
          entity: "chat",
        });
        return json({ conversation: group, message: system }, { status: 201 });
      }

      if (url.pathname === "/api/chat/groups/members" && request.method === "GET") {
        const room = url.searchParams.get("room") ?? SHARED_ROOM;
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        // The shop room shows the whole team; a group shows its own members.
        const list =
          room === SHARED_ROOM
            ? (await listChatMembers(db)).map((member) => ({ ...member, lastSeenAt: null }))
            : await listConversationMembers(db, room);
        return json({ members: list });
      }

      if (url.pathname === "/api/chat/groups/members" && request.method === "POST") {
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const room = String(body.room ?? "");
        const userId = Number(body.userId);
        if (!isGroupRoom(room) || !Number.isInteger(userId) || userId <= 0) {
          return json({ error: "Which group and which member?" }, { status: 400 });
        }
        if (!(await isMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const added = await asActor(actor, () => addConversationMember(db, room, userId));
        if (!added) {
          return json({ error: "That member could not be added" }, { status: 404 });
        }
        const target = await memberName(db, userId);
        const system = await asActor(actor, () =>
          insertMessage(db, {
            room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "system",
            body: `${session.name} added ${target}`,
          }),
        );
        await broadcastToChat(env, { type: "message", message: system }, room);
        await broadcastToChat(env, { type: "members", room }, room);
        await logActivity(db, {
          event: "chat.group.member",
          summary: `Chat: a member was added to the group ${room}`,
          entity: "chat",
        });
        return json({ ok: true, message: system });
      }

      if (url.pathname === "/api/chat/groups/members" && request.method === "DELETE") {
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const room = String(body.room ?? "");
        const userId = Number(body.userId);
        if (!isGroupRoom(room) || !Number.isInteger(userId) || userId <= 0) {
          return json({ error: "Which group and which member?" }, { status: 400 });
        }
        if (!(await isMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const target = await db
          .select({ name: appUsers.name, role: appUsers.role })
          .from(appUsers)
          .where(eq(appUsers.id, userId))
          .limit(1);
        if (target[0]?.role === "owner" || userId === session.uid) {
          return json(
            { error: "The owner of the shop cannot be removed from a group" },
            { status: 400 },
          );
        }
        const removed = await asActor(actor, () => removeConversationMember(db, room, userId));
        if (!removed) {
          return json({ error: "That member is not in this group" }, { status: 404 });
        }
        const system = await asActor(actor, () =>
          insertMessage(db, {
            room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "system",
            body: `${session.name} removed ${target[0]?.name ?? "a member"}`,
          }),
        );
        await broadcastToChat(env, { type: "message", message: system }, room);
        // The removed member loses access at once: their socket is closed.
        await kickFromChat(env, room, { userId, reason: "removed" });
        await broadcastToChat(env, { type: "members", room }, room);
        await logActivity(db, {
          event: "chat.group.member",
          summary: `Chat: a member was removed from the group ${room}`,
          entity: "chat",
        });
        return json({ ok: true, message: system });
      }

      if (url.pathname === "/api/chat/groups/archive" && request.method === "POST") {
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const room = String(body.room ?? "");
        if (!isGroupRoom(room)) {
          return json({ error: "The shop room cannot be archived" }, { status: 400 });
        }
        const archived = await asActor(actor, () => archiveConversation(db, room));
        if (!archived) {
          return json({ error: "That group could not be archived" }, { status: 404 });
        }
        const system = await asActor(actor, () =>
          insertMessage(db, {
            room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "system",
            body: `${session.name} archived the group`,
          }),
        );
        await broadcastToChat(env, { type: "message", message: system }, room);
        // Everybody leaves the retired room at once.
        await kickFromChat(env, room, { reason: "archived" });
        await logActivity(db, {
          event: "chat.group.archive",
          summary: `Chat group ${room} archived`,
          entity: "chat",
        });
        return json({ ok: true, message: system });
      }

      // ---- AI polish (Phase 15, T-15.1): the owner sets the switch per group ----
      if (url.pathname === "/api/chat/groups/polish" && request.method === "POST") {
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const room = String(body.room ?? "");
        const enabled = Boolean(body.enabled);
        if (!room) return json({ error: "Which group?" }, { status: 400 });
        const saved = await asActor(actor, () => setAiPolish(db, room, enabled));
        if (!saved) {
          return json({ error: "That room cannot use AI polish" }, { status: 404 });
        }
        // Everybody in the room picks the change up at once.
        await broadcastToChat(env, { type: "settings", room }, room);
        await logActivity(db, {
          event: "chat.polish",
          summary: `AI polish turned ${enabled ? "on" : "off"} for chat room ${room}`,
          entity: "chat",
        });
        return json({ ok: true, room, aiPolish: enabled });
      }

      // ---- AI polish (Phase 15, T-15.2): suggest a professional version ----
      if (url.pathname === "/api/chat/polish" && request.method === "POST") {
        const room = String(body.room ?? "");
        const text = String(body.text ?? "");
        if (!room || !text.trim()) {
          return json({ error: "Which room and what text?" }, { status: 400 });
        }
        // A member may only ask for a suggestion in a room they are in.
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        if (!(await polishEnabled(db, room))) {
          return json({ error: "AI polish is off in this room" }, { status: 403 });
        }
        // Tiny and emoji-only texts go out as they are — no AI call.
        const skip = polishSkipReason(text);
        if (skip) return json({ polished: text, skipped: skip });
        if (!polishAllowed(session.uid)) {
          return json({ error: "Too many polish requests — try again in a while" }, { status: 429 });
        }
        if (!env.OLLAMA_API_KEY) {
          return json({ polished: null });
        }
        // One non-streaming round-trip; the caller waits at most 8 s (the
        // plan's timeout). The losing request is discarded, never stored.
        const config = { mode: "cloud" as const, apiKey: env.OLLAMA_API_KEY, model: "glm-5.3-flash:cloud" };
        const reply = await Promise.race([
          chat(
            config,
            [
              { role: "system", content: POLISH_SYSTEM_PROMPT },
              { role: "user", content: text },
            ],
            undefined,
            globalThis.fetch,
          ),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (!reply || !reply.content.trim()) {
          return json({ polished: null });
        }
        const polished = reply.content.trim();
        // Amounts are the heart of a trade message — a rewrite that drops a
        // number never goes out; the original stands.
        const kept = keptAllNumbers(text, polished);
        return json({ polished: kept ? polished : text, keptOriginal: !kept });
      }

      // ---- Reactions (T-16.4): 👍 ❤️ 😂 🙏 ✅ 🔥 — one per member per message ----
      const reactionMatch = url.pathname.match(/^\/api\/chat\/reactions\/(\d+)$/);
      if (reactionMatch && request.method === "POST") {
        const id = Number(reactionMatch[1]);
        const room = await messageRoom(db, id);
        if (!room || !(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const emoji = String(body.emoji ?? "").trim();
        if (!emoji || emoji.length > 8) {
          return json({ error: "Pick a reaction" }, { status: 400 });
        }
        const reactions = await setReaction(db, id, session.uid, emoji);
        await broadcastToChat(env, { type: "reaction", messageId: id, reactions }, room);
        return json({ reactions });
      }
      if (reactionMatch && request.method === "DELETE") {
        const id = Number(reactionMatch[1]);
        const room = await messageRoom(db, id);
        if (!room || !(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const reactions = await setReaction(db, id, session.uid, null);
        await broadcastToChat(env, { type: "reaction", messageId: id, reactions }, room);
        return json({ reactions });
      }

      // ---- Pinned messages (T-16.4): the owner pins, at most three per room ----
      if (url.pathname === "/api/chat/pins" && request.method === "GET") {
        const room = String(url.searchParams.get("room") ?? SHARED_ROOM);
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        return json({ pins: await listPinnedMessages(db, room) });
      }
      if (url.pathname === "/api/chat/pins" && request.method === "POST") {
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const room = String(body.room ?? "");
        const messageId = Number(body.messageId);
        if (!room || !Number.isInteger(messageId) || messageId <= 0) {
          return json({ error: "Which message?" }, { status: 400 });
        }
        let pins: Awaited<ReturnType<typeof pinMessage>>;
        try {
          pins = await asActor(actor, () => pinMessage(db, room, messageId, session.uid));
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
        }
        await broadcastToChat(env, { type: "pins", room }, room);
        return json({ pins });
      }
      const unpinMatch = url.pathname.match(/^\/api\/chat\/pins\/(\d+)$/);
      if (unpinMatch && request.method === "DELETE") {
        if (session.role !== "owner") {
          return json({ error: "Owner only" }, { status: 403 });
        }
        const id = Number(unpinMatch[1]);
        const room = await messageRoom(db, id);
        if (room) {
          await asActor(actor, () => unpinMessage(db, id));
          await broadcastToChat(env, { type: "pins", room }, room);
        }
        return json({ ok: true });
      }

      // ---- The notification system (Phase 15) ----
      if (url.pathname === "/api/notifications" && request.method === "GET") {
        const steps = await onboardingSteps(db, session.uid);
        const previousLogin = await lastLoginAt(db, session.uid);
        const [member] = await sqlQuery(
          env,
          "select id, name, role, onboarding_completed from app_users where id = $1",
          [session.uid],
        );
        return json({
          user: {
            id: session.uid,
            name: session.name,
            role: session.role,
            lastLoginAt: previousLogin,
            showWelcomeBanner: await getShowWelcomeBanner(db, session.uid),
          },
          announcements: await listActiveAnnouncements(db, session.uid),
          release: await latestUnseenRelease(db, session.uid),
          onboarding: {
            steps,
            done: steps.filter((step) => step.done).length,
            total: steps.length,
            completed: Boolean(member?.onboarding_completed),
          },
          tours: await completedTours(db, session.uid),
          loginHistory: await listLoginHistory(db, session.uid, session.sid ?? null, 10),
          session: { expiresAt: new Date(session.exp).toISOString() },
        });
      }

      if (url.pathname.startsWith("/api/notifications/announcements/") && request.method === "POST") {
        const dismiss = url.pathname.match(/^\/api\/notifications\/announcements\/(\d+)\/dismiss$/);
        if (dismiss) {
          await dismissAnnouncement(db, Number(dismiss[1]), session.uid);
          return json({ ok: true });
        }
        const deactivate = url.pathname.match(
          /^\/api\/notifications\/announcements\/(\d+)\/deactivate$/,
        );
        if (deactivate) {
          if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
          const ok = await updateAnnouncement(db, Number(deactivate[1]), { isActive: false });
          return json({ ok });
        }
      }

      if (url.pathname === "/api/notifications/announcements" && request.method === "GET") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        return json({ announcements: await listAllAnnouncements(db) });
      }

      if (url.pathname === "/api/notifications/announcements" && request.method === "POST") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const kind = ["info", "success", "warning", "critical"].includes(String(body.kind))
          ? (body.kind as "info" | "success" | "warning" | "critical")
          : "info";
        const created = await createAnnouncement(db, {
          title: String(body.title ?? "").trim(),
          message: String(body.message ?? "").trim(),
          kind,
          linkLabel: body.linkLabel ? String(body.linkLabel) : null,
          linkUrl: body.linkUrl ? String(body.linkUrl) : null,
          startDate: body.startDate ? String(body.startDate) : null,
          endDate: body.endDate ? String(body.endDate) : null,
          createdBy: session.uid,
        });
        if (!created.title || !created.message) {
          return json({ error: "A title and a message are needed" }, { status: 400 });
        }
        return json({ announcement: created });
      }

      if (url.pathname.match(/^\/api\/notifications\/announcements\/\d+$/) && request.method === "PUT") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const id = Number(url.pathname.split("/").pop());
        const ok = await updateAnnouncement(db, id, {
          ...(body.title !== undefined ? { title: String(body.title) } : {}),
          ...(body.message !== undefined ? { message: String(body.message) } : {}),
          ...(body.kind !== undefined ? { kind: String(body.kind) as "info" } : {}),
          ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        });
        return json({ ok });
      }

      if (url.pathname === "/api/notifications/onboarding/complete" && request.method === "POST") {
        await completeOnboarding(db, session.uid);
        return json({ ok: true });
      }

      // The member's own switch for the "Welcome back" card (Phase 15 fix).
      if (url.pathname === "/api/notifications/welcome-banner" && request.method === "POST") {
        await setShowWelcomeBanner(db, session.uid, Boolean(body.show));
        return json({ ok: true, showWelcomeBanner: Boolean(body.show) });
      }

      if (url.pathname.match(/^\/api\/notifications\/releases\/\d+\/seen$/) && request.method === "POST") {
        const id = Number(url.pathname.split("/")[4]);
        await markReleaseSeen(db, session.uid, id);
        return json({ ok: true });
      }

      if (url.pathname.match(/^\/api\/notifications\/tours\/[a-z0-9-]+$/i) && request.method === "POST") {
        const tourId = url.pathname.split("/").pop()!;
        await completeTour(db, session.uid, tourId);
        return json({ ok: true });
      }

      if (url.pathname === "/api/notifications/releases" && request.method === "POST") {
        // Publishing a release tells the whole team: everybody is signed out
        // so they see the "what's new" window the next time they sign in.
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const items = Array.isArray(body.items)
          ? (body.items as unknown[]).map((item) => String(item)).filter(Boolean)
          : [];
        const release = await createRelease(db, {
          version: String(body.version ?? "").trim() || "1.0",
          title: String(body.title ?? "").trim() || "What's new",
          items,
          imageUrl: body.imageUrl ? String(body.imageUrl) : null,
        });
        const epoch = await bumpSessionEpoch(env);
        await sqlQuery(env, "update user_sessions set ended_at = now(), duration_seconds = 0 where ended_at is null");
        return json({ release, epoch });
      }

      if (url.pathname === "/api/notifications/login-history" && request.method === "GET") {
        return json({
          logins: await listLoginHistory(db, session.uid, session.sid ?? null, 10),
        });
      }

      // ---- Presence (Phase 1) ----
      if (url.pathname === "/api/chat/heartbeat" && request.method === "POST") {
        const room = String(body.room ?? SHARED_ROOM);
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        await sqlQuery(env, "update app_users set last_seen_at = now() where id = $1", [session.uid]);
        return json({ ok: true, at: new Date().toISOString() });
      }

      // ---- Web Push (Phase 16) ----
      if (url.pathname === "/api/push/key" && request.method === "GET") {
        return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
      }

      if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
        const endpoint = String(body.endpoint ?? "");
        const p256dh = String(body.p256dh ?? "");
        const auth = String(body.auth ?? "");
        if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) {
          return json({ error: "A complete subscription is needed" }, { status: 400 });
        }
        await savePushSubscription(db, { userId: session.uid, endpoint, p256dh, auth });
        return json({ ok: true });
      }

      if (url.pathname === "/api/push/subscribe" && request.method === "DELETE") {
        const endpoint = String(body.endpoint ?? "");
        if (endpoint) await forgetPushSubscription(db, endpoint);
        return json({ ok: true });
      }

      // ---- Team Chat (Phase 13): conversations (writes) ----
      if (url.pathname === "/api/chat/conversations" && request.method === "POST") {
        const otherId = Number(body.userId);
        if (!Number.isInteger(otherId) || otherId <= 0) {
          return json({ error: "Choose a person to chat with" }, { status: 400 });
        }
        if (otherId === session.uid) {
          return json({ error: "You cannot start a chat with yourself" }, { status: 400 });
        }
        const conversation = await ensureDirectConversation(db, session.uid, otherId);
        if (!conversation) {
          return json({ error: "That member is not available" }, { status: 404 });
        }
        return json({ conversation });
      }

      if (url.pathname === "/api/chat/read" && request.method === "POST") {
        const room = String(body.room ?? "");
        if (!room) return json({ error: "Which conversation?" }, { status: 400 });
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        const messageId = Number(body.messageId ?? 0);
        // The receiver's user_id (session.uid) is saved; the sender NEVER gets
        // a receipt for their own message (markMessageRead skips those rows).
        const readIds = await markMessageRead(
          db,
          room,
          session.uid,
          Number.isInteger(messageId) ? messageId : undefined,
        );
        // Tell the others straight away, so their tick turns blue at once.
        if (readIds.length > 0) {
          await broadcastToChat(
            env,
            {
              type: "read",
              messageIds: readIds,
              userId: session.uid,
              name: session.name,
            },
            room,
          );
        }
        return json({ ok: true, unread: await unreadCount(db, session.uid), read: readIds });
      }

      if (url.pathname === "/api/chat/delivered" && request.method === "POST") {
        const messageId = Number(body.messageId ?? 0);
        if (!Number.isInteger(messageId) || messageId <= 0) {
          return json({ error: "Which message?" }, { status: 400 });
        }
        const target = await messageContext(db, messageId);
        if (!target || !(await chatRoomMember(db, target.room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        // NEVER a receipt for the sender: my own message cannot be "delivered
        // to me". No row, no broadcast — the tick stays on the real receiver.
        if (target.userId != null && Number(target.userId) === session.uid) {
          return json({ ok: true, own: true });
        }
        const marked = await markDelivered(db, messageId, session.uid);
        if (marked) {
          await broadcastToChat(
            env,
            { type: "delivered", messageIds: [messageId], userId: session.uid, name: session.name },
            target.room,
          );
        }
        return json({ ok: true });
      }

      // ---- Team Chat (Phase 12): send a message, decide a receipt ----
      if (url.pathname === "/api/chat/messages" && request.method === "POST") {
        const room = String(body.room ?? SHARED_ROOM);
        if (!(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        let input: ReturnType<typeof parseMessageInput>;
        try {
          input = parseMessageInput(body);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
        }

        if (input.kind === "text") {
          const message = await asActor(actor, () =>
            insertMessage(db, {
              room,
              userId: session.uid,
              author: session.name,
              role: session.role,
              kind: "text",
              body: input.body,
              aiPolished: input.aiPolished,
              replyToId: input.replyToId,
            }),
          );
          await logFirstDirectMessage(db, room, session, message);
          await broadcastToChat(env, { type: "message", message }, room);
          await markRead(db, room, session.uid, message.id);
          // The shop room pushes the phones of the whole team; a group pushes
          // only its members (Cloudflare Web Push first, ntfy as the
          // fallback). A private chat does not push — the push channel is
          // shared and the text of a 1-to-1 chat is private.
          if (room === SHARED_ROOM) {
            await pushToTheTeam(env, session.uid, {
              title: `${session.name} wrote in the shop room`,
              body: input.body.slice(0, 120),
              url: "/team-chat?notify=1",
            });
            await pushNtfy(
              env.NTFY_TOPIC,
              `${session.name} wrote in the shop room`,
              input.body.slice(0, 120),
            );
          } else if (isGroupRoom(room)) {
            const memberIds = (await listConversationMembers(db, room)).map((member) => member.id);
            const title = (await conversationTitle(db, room)) ?? "the group";
            await pushToUsers(env, memberIds, session.uid, {
              title: `${session.name} wrote in ${title}`,
              body: input.body.slice(0, 120),
              url: "/team-chat?notify=1",
            });
          } else {
            // Direct chat (1:1): push to the other member only — text-free alert
            // so the private message text never reaches the push service.
            console.log("push: entering 1:1 push path for room", room, "sender", session.uid);
            const dm = membersOf(room);
            if (dm) {
              const otherId = dm.userId === session.uid ? dm.otherId : dm.userId;
              console.log("push: 1:1 dm members", JSON.stringify(dm), "otherId", otherId);
              if (otherId) {
                await pushToUsers(env, [otherId], session.uid, {
                  title: "New message",
                  body: session.name,
                  url: "/team-chat?notify=1",
                  messageId: message.id,
                });
                await pushNtfy(
                  env.NTFY_TOPIC,
                  `New message from ${session.name}`,
                  "Open the chat to read it",
                );
                // IMMEDIATE delivery: the push service accepted the message,
                // so the receiver's phone has it — mark it delivered and tell
                // the sender at once (WhatsApp behaviour: ✓✓ when the push
                // service confirms, not when the receiver opens the app).
                const pushed = await markDelivered(db, message.id, otherId);
                if (pushed) {
                  await broadcastToChat(env, {
                    type: "delivered",
                    messageIds: [message.id],
                    userId: otherId,
                    name: "push service",
                  }, room);
                }
              }
            }
          }
          // @mentions (T-16.4): the named members get a personal push even if
          // the room itself would not push them.
          const mentions = Array.isArray(body.mentions)
            ? (body.mentions as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== session.uid)
            : [];
          if (mentions.length > 0) {
            await pushToUsers(env, mentions, session.uid, {
              title: `${session.name} mentioned you`,
              body: input.body.slice(0, 120),
              url: "/team-chat?notify=1",
            });
          }
          return json({ message });
        }

        // A receipt: the file is already in R2, now it needs a decision.
        const receipt = await asActor(actor, () =>
          createReceipt(db, {
            submittedBy: session.uid,
            submitterName: session.name,
            receipt: input.receipt!,
          }),
        );
        const message = await asActor(actor, () =>
          insertMessage(db, {
            room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "receipt",
            body: input.body || input.receipt!.title,
            receiptId: receipt.id,
          }),
        );
        await asActor(actor, () => linkReceiptMessage(db, receipt.id, message.id));
        await broadcastToChat(env, { type: "receipt", receipt, message }, room);
        await markRead(db, room, session.uid, message.id);
        await notifyReceipt(env, receipt, session.name);
        return json({ message, receipt });
      }

      // ---- Message editing (Phase 17): the author fixes their own text ----
      const editMatch = url.pathname.match(/^\/api\/chat\/messages\/(\d+)$/);
      if (editMatch && request.method === "PATCH") {
        const id = Number(editMatch[1]);
        const room = await messageRoom(db, id);
        if (!room || !(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        let edited: Awaited<ReturnType<typeof updateMessage>>;
        try {
          edited = await asActor(actor, () =>
            updateMessage(db, id, { userId: session.uid, body: String(body.body ?? "") }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = /not found/i.test(message)
            ? 404
            : /not authorized/i.test(message)
              ? 403
              : 400;
          return json({ error: message }, { status });
        }
        // Everybody in the room sees the fixed text at once.
        await broadcastToChat(env, { type: "update", message: edited }, room);
        return json({ message: edited });
      }

      // ---- Message deleting (T-16.2): soft-delete, the body stays in the DB ----
      const deleteMatch = url.pathname.match(/^\/api\/chat\/messages\/(\d+)$/);
      if (deleteMatch && request.method === "DELETE") {
        const id = Number(deleteMatch[1]);
        const room = await messageRoom(db, id);
        if (!room || !(await chatRoomMember(db, room, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        let gone: Awaited<ReturnType<typeof deleteMessage>>;
        try {
          gone = await asActor(actor, () =>
            deleteMessage(db, id, { userId: session.uid, role: session.role }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = /not found|already deleted/i.test(message)
            ? 404
            : /not authorized|cannot be deleted/i.test(message)
              ? 403
              : 400;
          return json({ error: message }, { status });
        }
        // The tombstone replaces the bubble everywhere at once.
        await broadcastToChat(env, { type: "update", message: gone }, room);
        await logActivity(db, {
          event: "chat.message.delete",
          summary: `Chat message #${id} deleted`,
          entity: "chat",
          entityId: id,
        });
        return json({ message: gone });
      }

      const decisionMatch = url.pathname.match(/^\/api\/chat\/receipts\/(\d+)\/decision$/);
      if (decisionMatch && request.method === "POST") {
        const id = Number(decisionMatch[1]);
        // A receipt in a private chat can only be decided by the two people
        // who are in that conversation. In the shop room or a group the
        // approver (owner / CA) may decide it without being a member (T-14.2).
        const receiptRoomName = await receiptRoom(db, id);
        if (receiptRoomName && membersOf(receiptRoomName) && !(await isMember(db, receiptRoomName, session.uid))) {
          return json({ error: "Not allowed: chat view" }, { status: 403 });
        }
        let receipt: Awaited<ReturnType<typeof decideReceipt>>;
        try {
          receipt = await asActor(actor, () =>
            decideReceipt(db, id, body as { decision: string; note?: string }, {
              userId: session.uid,
              name: session.name,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = /not found/i.test(message) ? 404 : 400;
          return json({ error: message }, { status });
        }
        const room = receiptRoomName ?? SHARED_ROOM;
        const system = await asActor(actor, () =>
          insertMessage(db, {
            room,
            userId: session.uid,
            author: session.name,
            role: session.role,
            kind: "system",
            body: `${session.name} ${receipt.status === "approved" ? "approved" : "rejected"} receipt #${receipt.id} — ${receipt.title}`,
          }),
        );
        await broadcastToChat(env, { type: "receipt", receipt, message: system }, room);
        await notifyReceipt(env, receipt, session.name);
        return json({ receipt, message: system });
      }

      if (url.pathname === "/api/roles" && (request.method === "POST" || request.method === "PUT")) {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const role = normalizeRole((body as { role?: unknown }).role);
        if (role === "owner") {
          return json({ error: "Owner permissions cannot be changed" }, { status: 400 });
        }
        const input = (body as { permissions?: RolePermissions }).permissions;
        if (!input || typeof input !== "object") {
          return json({ error: "Permissions are required" }, { status: 400 });
        }
        const saved = await asActor(actor, () => saveRolePermissions(db, role, input));
        return json({ role, permissions: saved });
      }

      if (url.pathname === "/api/items" && request.method === "POST") {
        return json({ item: await asActor(actor, () => createItem(db, body)) });
      }

      if (url.pathname.startsWith("/api/items/") && request.method === "PUT") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid item id" }, { status: 400 });
        return json({ item: await asActor(actor, () => updateItem(db, id, body)) });
      }

      if (url.pathname.startsWith("/api/items/") && request.method === "DELETE") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid item id" }, { status: 400 });
        await asActor(actor, () => deleteItem(db, id));
        return json({ ok: true });
      }

      if (url.pathname === "/api/customers" && request.method === "GET") {
        const search = url.searchParams.get("search") ?? undefined;
        return json({ customers: await listCustomers(db, search) });
      }

      if (url.pathname === "/api/customers/save" && request.method === "POST") {
        return json({ customer: await asActor(actor, () => createCustomer(db, body)) });
      }

      if (url.pathname === "/api/customers" && request.method === "POST") {
        return json({ customer: await asActor(actor, () => createCustomerOnly(db, body)) });
      }

      if (url.pathname.match(/^\/api\/customers\/\d+$/) && request.method === "PUT") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid customer id" }, { status: 400 });
        return json({ customer: await asActor(actor, () => updateCustomer(db, id, body)) });
      }

      if (url.pathname.match(/^\/api\/customers\/\d+$/) && request.method === "DELETE") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid customer id" }, { status: 400 });
        await asActor(actor, () => deleteCustomer(db, id));
        return json({ ok: true });
      }

      if (url.pathname === "/api/expenses" && request.method === "POST") {
        return json({ expense: await asActor(actor, () => createExpense(db, body)) });
      }

      if (url.pathname.startsWith("/api/expenses/") && request.method === "PUT") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid expense id" }, { status: 400 });
        return json({ expense: await asActor(actor, () => updateExpense(db, id, body)) });
      }

      if (url.pathname.startsWith("/api/expenses/") && request.method === "DELETE") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid expense id" }, { status: 400 });
        await asActor(actor, () => deleteExpense(db, id));
        return json({ ok: true });
      }

      // ---- Supplier dues (writes) ----
      if (url.pathname === "/api/suppliers" && request.method === "POST") {
        const name = String(body.name ?? "").trim();
        const phone = String(body.phone ?? "").trim() || null;
        if (!name) return json({ error: "Supplier name is required" }, { status: 400 });
        const [row] = await sqlQuery(env, `insert into suppliers (name, phone) values ($1, $2) returning id, name, phone`, [name, phone]);
        await asActor(actor, () => logActivity(db, { event: "supplier.create", summary: `Supplier ${name} added`, entity: "supplier", entityId: Number(row.id) }));
        return json({ supplier: row });
      }

      if (url.pathname === "/api/supplier-payments" && request.method === "POST") {
        const purchaseId = Number(body.purchaseId);
        const amountPaise = Number(body.amountPaise);
        const paymentDate = String(body.paymentDate ?? "");
        const paymentMode = String(body.paymentMode ?? "").trim() || null;
        const note = String(body.note ?? "").trim() || null;
        if (!Number.isInteger(purchaseId) || purchaseId <= 0) return json({ error: "Invalid purchase" }, { status: 400 });
        if (!Number.isInteger(amountPaise) || amountPaise <= 0) return json({ error: "Amount must be more than 0" }, { status: 400 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return json({ error: "Choose a valid date" }, { status: 400 });

        const [purchase] = await sqlQuery(env, `select id, total_paise, paid_paise from purchases where id = $1`, [purchaseId]);
        if (!purchase) return json({ error: "Purchase not found" }, { status: 404 });
        const totalPaise = Number(purchase.total_paise);
        const paidPaise = Number(purchase.paid_paise);
        if (paidPaise + amountPaise > totalPaise) {
          return json({ error: `Payment exceeds purchase total (₹${(totalPaise / 100).toFixed(2)})` }, { status: 400 });
        }

        await asActor(actor, async () => {
          await sqlQuery(env, `insert into supplier_payments (purchase_id, amount_paise, payment_date, payment_mode, note, actor) values ($1, $2, $3, $4, $5, $6)`, [purchaseId, amountPaise, paymentDate, paymentMode, note, actor.name]);
          await sqlQuery(env, `update purchases set paid_paise = paid_paise + $1 where id = $2`, [amountPaise, purchaseId]);
          await sqlQuery(env, `insert into cash_ledger (type, amount_paise, ref_type, ref_id, entry_date, note, actor) values ('purchase', $1, 'purchase', $2, $3, $4, $5)`, [-amountPaise, purchaseId, paymentDate, `Payment to supplier for purchase #${purchaseId}`, actor.name]);
          await logActivity(db, { event: "supplier.payment", summary: `Paid ₹${(amountPaise / 100).toFixed(2)} against purchase #${purchaseId}`, entity: "purchase", entityId: purchaseId });
        });

        return json({ ok: true });
      }

      if (url.pathname === "/api/investments" && request.method === "POST") {
        const investorName = String(body.investorName ?? "").trim();
        const amountPaise = Number(body.amountPaise ?? 0);
        const date = String(body.date ?? "");
        if (!investorName) return json({ error: "Investor name is required" }, { status: 400 });
        if (!Number.isInteger(amountPaise) || amountPaise <= 0) return json({ error: "Amount must be more than 0" }, { status: 400 });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Choose a valid date" }, { status: 400 });
        const [row] = await sqlQuery(env, `insert into investments (investor_name, amount_paise, invested_on, note) values ($1,$2,$3,$4) returning id`, [investorName, amountPaise, date, String(body.note ?? "") || null]);
        await asActor(actor, () => logActivity(db, { event: "investment.create", summary: `Investment ${investorName}: ₹${(amountPaise / 100).toFixed(2)}`, entity: "investment", entityId: Number(row.id) }));
        return json({ ok: true, id: row.id });
      }

      if (url.pathname.startsWith("/api/investments/") && request.method === "DELETE") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid id" }, { status: 400 });
        await sqlQuery(env, `delete from investments where id = $1`, [id]);
        await asActor(actor, () => logActivity(db, { event: "investment.delete", summary: `Investment #${id} removed`, entity: "investment", entityId: id }));
        return json({ ok: true });
      }

      if (url.pathname === "/api/shop" && request.method === "PUT") {
        await asActor(actor, () =>
          saveShopDetails(db, body as Parameters<typeof saveShopDetails>[1]),
        );
        return json({ ok: true });
      }

      // ---- N1 notification settings ----
      if (url.pathname.startsWith("/api/settings/notifications")) {
        const shop = await getShopDetails(db);
        if (url.pathname === "/api/settings/notifications" && request.method === "GET") {
          const rows = await sqlQuery(env, "select key, value from settings where key in ('notify_emails','notify_signup','notify_member','notify_bill')");
          const map = new Map(rows.map((r) => [String(r.key), String(r.value)]));
          const raw = map.get("notify_emails") ?? shop.email;
          return json({
            emails: raw.split(/[,;]/).map((e) => e.trim()).filter(Boolean),
            signup: map.get("notify_signup") !== "off",
            member: map.get("notify_member") !== "off",
            bill: map.get("notify_bill") !== "off",
            emailConfigured: Boolean(await getResendKey(env)),
            defaultEmail: shop.email,
          });
        }
        if (url.pathname === "/api/settings/notifications/test" && request.method === "POST") {
          const cfg = await readNotify(env);
          if (cfg.emails.length === 0) return json({ error: "Add at least one notification email" }, { status: 400 });
          const storedKey = await getResendKey(env);
          if (!storedKey) return json({ error: "Email is not configured (add a Resend API key)" }, { status: 503 });
          const ok = await sendOwnerMail(env, cfg.emails, "Stock Tracker test notification", "<p>Owner notifications are working.</p>");
          return ok ? json({ ok: true, to: cfg.emails }) : json({ error: "Email provider refused the message" }, { status: 502 });
        }
        if (url.pathname === "/api/settings/notifications" && request.method === "PUT") {
          const emails = String(body.emails ?? "").trim();
          const pairs: [string, string][] = [
            ["notify_emails", emails],
            ["notify_signup", body.signup === false ? "off" : "on"],
            ["notify_member", body.member === false ? "off" : "on"],
            ["notify_bill", body.bill === false ? "off" : "on"],
          ];
          for (const [key, value] of pairs) {
            await sqlQuery(env, "insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value", [key, value]);
          }
          if (typeof body.resendApiKey === "string" && body.resendApiKey.trim()) {
            const enc = await encryptText(env, body.resendApiKey.trim());
            await sqlQuery(env, "insert into settings (key, value) values ('resend_api_key_enc', $1) on conflict (key) do update set value = excluded.value", [enc]);
          }
          if (body.clearResendKey === true) {
            await sqlQuery(env, "delete from settings where key = 'resend_api_key_enc'");
          }
          await asActor(actor, () => logActivity(db, { event: "settings.notify", summary: "Notification settings updated", entity: "settings" }));
          return json({ ok: true });
        }
      }

      // ---- Web team management (team permissions) ----
      if (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/")) {

          if (url.pathname === "/api/users" && request.method === "GET") {
            // Access-until is enforced lazily: expired accounts become inactive.
            await sqlQuery(
              env,
              "update app_users set active = false where access_until is not null and access_until < current_date and active = true",
            );
            const rows = await sqlQuery(
              env,
              `select id, name, phone, role, active, pending, access_until::text as "accessUntil" from app_users order by id`,
            );
            return json({ users: rows });
          }


          if (url.pathname === "/api/users" && request.method === "POST") {
            const name = String(body.name ?? "").trim();
            const phone = normalizePhone(String(body.phone ?? ""));
            const password = String(body.password ?? "");
            const role = normalizeRole(body.role);
            const rawUntil = String(body.accessUntil ?? "").trim();
            const accessUntil = /^\d{4}-\d{2}-\d{2}$/.test(rawUntil) ? rawUntil : null;
            if (!name) return json({ error: "Name is required" }, { status: 400 });
            if (!phone.valid) return json({ error: phone.reason }, { status: 400 });
            const pw = validatePassword(password);
            if (!pw.valid) return json({ error: pw.reason }, { status: 400 });
            const existing = await sqlQuery(env, `select id from app_users where phone = $1`, [phone.phone]);
            if (existing.length) return json({ error: "That phone number already has an account" }, { status: 400 });
            const created = await sqlQuery(
              env,
              `insert into app_users (name, phone, password_hash, role, access_until) values ($1,$2,$3,$4,$5) returning id, name, phone, role, active, access_until::text as "accessUntil"`,
              [name, phone.phone, hashPasswordPhc(password), role, accessUntil],
            );
            await asActor(actor, () => logActivity(db, { event: "user.create", summary: `Member added: ${name} (${role})${accessUntil ? ` until ${accessUntil}` : ""}`, entity: "user", entityId: Number(created[0].id) }));
            await notifyOwners(env, "member", `Member added — ${name}`, `<p><b>${name}</b> (${phone.phone}) was added as ${role} by ${session.name}.</p>`);
            return json({ user: created[0] });
          }

          const match = url.pathname.match(/^\/api\/users\/(\d+)\/(password|active|approve|reject|role)$/);
          if (match && request.method === "POST") {
            const id = Number(match[1]);
            if (match[2] === "approve") {
              const role = normalizeRole(body.role);
              await sqlQuery(env, "update app_users set pending = false, active = true, role = $1 where id = $2", [role, id]);
              await asActor(actor, () => logActivity(db, { event: "user.approve", summary: `Member #${id} approved as ${role}`, entity: "user", entityId: id }));
              await notifyOwners(env, "member", `Member approved — #${id}`, `<p>Member #${id} was approved as <b>${role}</b> by ${session.name}.</p>`);
              return json({ ok: true, role });
            }
            if (match[2] === "role") {
              const role = normalizeRole(body.role);
              const [target] = await sqlQuery(env, "select role, active from app_users where id = $1", [id]);
              if (!target) return json({ error: "Member not found" }, { status: 404 });
              if (target.role === "owner" && role !== "owner" && target.active) {
                const [others] = await sqlQuery(
                  env,
                  "select count(*)::int as c from app_users where role = 'owner' and active = true and id <> $1",
                  [id],
                );
                if (Number(others?.c ?? 0) === 0) {
                  return json({ error: "At least one active Owner is required" }, { status: 400 });
                }
              }
              await sqlQuery(env, "update app_users set role = $1 where id = $2", [role, id]);
              await asActor(actor, () => logActivity(db, { event: "user.role", summary: `Member #${id} role set to ${role}`, entity: "user", entityId: id }));
              await notifyOwners(env, "member", `Member role changed — #${id}`, `<p>Member #${id} is now <b>${role}</b> (by ${session.name}).</p>`);
              return json({ ok: true, role });
            }
            if (match[2] === "reject") {
              await sqlQuery(env, "delete from app_users where id = $1 and pending = true", [id]);
              await asActor(actor, () => logActivity(db, { event: "user.reject", summary: `Member request #${id} rejected`, entity: "user", entityId: id }));
              return json({ ok: true });
            }
            if (match[2] === "password") {
              const pw = validatePassword(String(body.password ?? ""));
              if (!pw.valid) return json({ error: pw.reason }, { status: 400 });
              await sqlQuery(env, `update app_users set password_hash = $1 where id = $2`, [hashPasswordPhc(String(body.password)), id]);
              await asActor(actor, () => logActivity(db, { event: "user.password", summary: `Password reset for member #${id}`, entity: "user", entityId: id }));
            } else {
              const nextActive = Boolean(body.active);
              if (!nextActive) {
                const [target] = await sqlQuery(env, "select role, active from app_users where id = $1", [id]);
                if (!target) return json({ error: "Member not found" }, { status: 404 });
                if (target.role === "owner" && target.active) {
                  const [others] = await sqlQuery(
                    env,
                    "select count(*)::int as c from app_users where role = 'owner' and active = true and id <> $1",
                    [id],
                  );
                  if (Number(others?.c ?? 0) === 0) {
                    return json({ error: "At least one active Owner is required" }, { status: 400 });
                  }
                }
              }
              await sqlQuery(env, `update app_users set active = $1 where id = $2`, [nextActive, id]);
              await asActor(actor, () => logActivity(db, { event: nextActive ? "user.enable" : "user.disable", summary: `Member #${id} ${nextActive ? "enabled" : "disabled"}`, entity: "user", entityId: id }));
            }
            return json({ ok: true });
          }
      }

      // ---- W5 email a bill (Resend API) ----
      if (url.pathname.match(/^\/api\/bills\/\d+\/email$/) && request.method === "POST") {
        const id = Number(url.pathname.split("/")[3]);
        const bill = await getSaleBill(db, id);
        if (!bill) return json({ error: "Bill not found" }, { status: 404 });
        if (!bill.customerEmail) {
          return json({ error: "This customer has no email — add it in GST Billing" }, { status: 400 });
        }
        if (!(await getResendKey(env))) {
          return json({ error: "Email is not configured (add a Resend API key in Settings)" }, { status: 503 });
        }
        const shop = await getShopDetails(db);
        const from = env.MAIL_FROM || "SREE DURGA HARIHARA ENTERPRISES <onboarding@resend.dev>";
        const subject = `Invoice ${bill.billNo} — ${shop.name}`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${(await getResendKey(env)) as string}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [bill.customerEmail],
            subject,
            html: buildBillHtml(bill, shop),
          }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return json({ error: `Email failed: ${detail.slice(0, 200)}` }, { status: 502 });
        }
        await asActor(actor, () =>
          logActivity(db, {
            event: "bill.email",
            summary: `Bill ${bill.billNo} emailed to ${bill.customerEmail}`,
            entity: "sale",
            entityId: id,
          }),
        );
        return json({ ok: true, to: bill.customerEmail });
      }

      // ---- W3c transactional writes (Neon WebSocket pool, verified on Workers) ----
      if (url.pathname === "/api/purchases" && request.method === "POST") {
        return json({ purchase: await asActor(actor, () => addPurchase(db, body)) });
      }

      if (url.pathname.match(/^\/api\/purchases\/\d+$/) && request.method === "PUT") {
        if (session.role !== "owner") return json({ error: "Owner only" }, { status: 403 });
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid purchase id" }, { status: 400 });
        await asActor(actor, () => updatePurchase(env.DATABASE_URL as string, id, body));
        return json({ ok: true });
      }

      if (url.pathname.startsWith("/api/purchases/") && request.method === "DELETE") {
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid purchase id" }, { status: 400 });
        await asActor(actor, () => deletePurchase(env.DATABASE_URL as string, id));
        return json({ ok: true });
      }

      if (url.pathname === "/api/bills" && request.method === "POST") {
        const created = await asActor(actor, () => createSaleBill(env.DATABASE_URL as string, body));
        if (session.role === "staff") {
          const lines = Array.isArray((body as { lines?: unknown[] }).lines)
            ? (body as { lines: unknown[] }).lines.length
            : 0;
          await notifyOwners(
            env,
            "bill",
            `Bill ${created.billNo} — ${session.name}`,
            `<p><b>${session.name}</b> (staff) created bill <b>${created.billNo}</b> for ₹${(
              created.totalPaise / 100
            ).toFixed(2)} (${lines} line(s)).</p>`,
          );
        }
        return json({ bill: created });
      }

      if (url.pathname.match(/^\/api\/bills\/\d+\/cancel$/) && request.method === "POST") {
        const id = Number(url.pathname.split("/")[3]);
        return json({ result: await asActor(actor, () => cancelSaleBill(env.DATABASE_URL as string, id)) });
      }

      if (url.pathname.match(/^\/api\/bills\/\d+\/payment$/) && request.method === "POST") {
        const id = Number(url.pathname.split("/")[3]);
        // The body was already read for this request — read it from there.
        const amount = Number((body as { amountPaise?: number }).amountPaise ?? 0);
        return json({ payment: await asActor(actor, () => recordBillPayment(db, id, amount)) });
      }

      if (url.pathname === "/api/stock" && request.method === "POST") {
        return json({ stock: await asActor(actor, () => saveStockEntry(env.DATABASE_URL as string, body)) });
      }

      if (url.pathname === "/api/roastings" && request.method === "POST") {
        return json({
          roasting: await asActor(actor, () => createRoasting(env.DATABASE_URL as string, body)),
        });
      }

      // Recent stock entries (date, item, type, qty, note, user). The user is
      // recovered from the activity log: each entry logs `stock.*` with the
      // item as entity, in the same transaction and the same order.
      if (url.pathname === "/api/stock" && request.method === "GET") {
        const rows = await sqlQuery(
          env,
          `with sm as (
             select m.id, m.item_id, m.type, m.qty_change, m.entered_qty_left, m.note,
                    m.movement_date::text as date, m.actor, m.created_at, i.name as item, i.unit,
                    row_number() over (partition by m.item_id, m.type order by m.id) as rn
             from stock_movements m
             join items i on i.id = m.item_id
             where m.type in ('STOCK_CHECK','USAGE','WASTAGE')
           ),
           al as (
             select a.id, a.entity_id, a.event, a.actor,
                    row_number() over (partition by a.entity_id, a.event order by a.id) as rn
             from activity_log a
             where a.entity = 'item' and a.event like 'stock.%'
           )
           select sm.id, sm.date, sm.item, sm.unit, sm.type,
                  case when sm.type = 'STOCK_CHECK'
                       then coalesce(sm.entered_qty_left, 0)
                       else abs(sm.qty_change) end as "qtyBase",
                  sm.note,
                  coalesce(sm.actor, al.actor) as "user",
                  sm.created_at::text as "createdAt"
           from sm
           left join al on al.entity_id = sm.item_id
             and al.event = 'stock.' || lower(sm.type)
             and al.rn = sm.rn
           order by sm.id desc
           limit 30`,
        );
        return json({ entries: rows });
      }
    } catch (err) {
      console.error("api error:", err);
      return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }

    return json({ error: "Not found" }, { status: 404 });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await handler.fetch(request, env));
  },
};
