/**
 * SREE DURGA HARIHARA ENTERPRISES — web API (Cloudflare Worker)
 * W1: health. W2: phone + password auth with HttpOnly signed sessions.
 * Secrets (wrangler secret / .dev.vars): DATABASE_URL, SESSION_SECRET.
 */
import { neon } from "@neondatabase/serverless";
import { argon2id } from "@noble/hashes/argon2.js";
import { normalizePhone, validatePassword } from "../../src/logic/auth";
import { getDb, withTransaction } from "../../src/db/client";
import { sql } from "drizzle-orm";
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
import { cancelSaleBill, createCustomer, createSaleBill, deleteSaleBill, recordBillPayment } from "../../src/db/billing";
import { deleteCustomer, listCustomers, updateCustomer } from "../../src/db/customers";
import { addPurchase, deletePurchase, updatePurchase } from "../../src/db/purchases";
import { saveStockEntry } from "../../src/db/stock";
import { createExpense, deleteExpense, updateExpense } from "../../src/db/expenses";
import { setAuditActor, type AuditActor } from "../../src/db/activity";
import { endSession, SESSION_MAX_SECONDS, startSession, userUsageMetrics, getSessionsWithoutLogoutLast24Hours } from "../../src/db/sessions";
import { getCostingMethod, setCostingMethod } from "../../src/db/costing";
import { finYearOptions, finYearReport, dealProfits, batchLedger } from "../../src/db/reports";
import { getRoleMatrix, loadPermissionsForRole, saveRolePermissions } from "../../src/db/permissions";
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
  ASSETS?: { fetch: typeof fetch };
}

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

type Session = { uid: number; name: string; role: Role; exp: number; until?: string | null; lastActivity: number };

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

  return null;
}

const attempts = new Map<string, { count: number; resetAt: number }>();

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
  const token = await createToken(session, env.SESSION_SECRET as string);
  // Track the session so the activity log knows who was in and for how long.
  await startSession(getDb(env.DATABASE_URL as string), session.uid, "web", session.name);
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

export default {
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

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const session = await readSession(request, env.SESSION_SECRET);
      if (!session) return json({ error: "Not signed in" }, { status: 401 });
      const today = new Date().toISOString().slice(0, 10);
      if (session.until && session.until < today) {
        return json({ error: "Access expired — ask the owner" }, { status: 401 });
      }
      const permissions = await loadPermissionsForRole(getDb(env.DATABASE_URL as string), session.role);
      return json({ user: { id: session.uid, name: session.name, role: session.role, permissions } });
    }

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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

    // ---- W3 read API (session required) ----
    const session = await readSession(request, env.SESSION_SECRET);
    if (!session) return json({ error: "Not signed in" }, { status: 401 });

    // 1-hour inactivity auto-logout (sliding window, refreshed on every API call).
    const IDLE_MS = 60 * 60 * 1000;
    if (Date.now() - session.lastActivity > IDLE_MS) {
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return json({ error: "Session expired due to inactivity — please sign in again" }, { status: 401, headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}` } });
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (session.until && session.until < todayIso) {
      return json({ error: "Access expired — ask the owner" }, { status: 401 });
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
    const refreshedSession: Session = { ...session, lastActivity: Date.now() };
    const refreshToken = await createToken(refreshedSession, env.SESSION_SECRET as string);
    pendingSetCookie = sessionCookie(refreshToken, url);
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

      if (url.pathname === "/api/purchases" && request.method === "GET") {
        const rows = await sqlQuery(env, `select p.id, p.qty_base, p.unit_price_paise, p.total_paise, p.paid_paise, p.purchase_date,
            p.expenses_paise, p.payment_mode, p.note, i.name, i.unit, s.name as supplier_name
          from purchases p
          join items i on i.id = p.item_id
          left join suppliers s on s.id = p.supplier_id
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

      // ---- W3b writes (session actor threaded per request) ----
      const body = ["POST", "PUT"].includes(request.method)
        ? await request.json().catch(() => ({}))
        : {};

      if (url.pathname === "/api/ai/chat" && request.method === "POST") {
        if (!env.OLLAMA_API_KEY) {
          return json({ error: "AI is not configured (missing OLLAMA_API_KEY secret)" }, { status: 503 });
        }
        const message = String(body.message ?? "").trim();
        if (!message) return json({ error: "Message is required" }, { status: 400 });
        const history = (Array.isArray(body.history) ? body.history : []) as ChatTurn[];
        const config = { mode: "cloud" as const, apiKey: env.OLLAMA_API_KEY, model: "glm-5.3-flash:cloud" };
        const result = await askAssistant(db, config, history, message, (c, m, t) =>
          chat(c, m, t, globalThis.fetch),
        );
        await asActor(actor, () =>
          logActivity(db, { event: "ai.chat", summary: `AI asked: ${message.slice(0, 60)}`, entity: "ai" }),
        );
        return json(result);
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

      if (url.pathname === "/api/customers" && request.method === "POST") {
        return json({ customer: await asActor(actor, () => createCustomer(db, body)) });
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
        const id = Number(url.pathname.split("/").pop());
        if (!Number.isInteger(id) || id <= 0) return json({ error: "Invalid expense id" }, { status: 400 });
        return json({ expense: await asActor(actor, () => updateExpense(db, id, body)) });
      }

      if (url.pathname.startsWith("/api/expenses/") && request.method === "DELETE") {
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
        await asActor(actor, () => saveShopDetails(db, body));
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
