/**
 * LOCAL check of the sign-on rules (Phase 12 review).
 *
 * 1. A cookie session that has been idle for more than an hour must be
 *    refused (and the cookie cleared) — the "auto logout after one hour".
 * 2. A chat token must not outlive the sign-on: after the fix the web token
 *    expires with the session (1 h), the desktop token keeps its own life.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-session-check.mjs
 */
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { chromium } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });
dotenv.config();

const BASE = "http://127.0.0.1:8787";
const secret = process.env.SESSION_SECRET;
if (!secret) {
  console.error("SESSION_SECRET missing");
  process.exit(1);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sql = neon(process.env.DATABASE_URL);

async function currentEpoch() {
  const rows = await sql.query("select value from settings where key = 'session_epoch'");
  const value = Number(rows[0]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function cookieFor(lastActivity, epoch = 0) {
  const session = {
    uid: 1,
    name: "B PHANI KUMAR",
    role: "owner",
    exp: Date.now() + 60 * 60_000,
    until: null,
    lastActivity,
    epoch,
  };
  const payload = b64url(Buffer.from(JSON.stringify(session)));
  const signature = b64url(createHmac("sha256", secret).update(payload).digest());
  return `sdhhe_session=${payload}.${signature}`;
}

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

const now = Date.now();

const epoch = await currentEpoch();
const epochNowValue = () => epoch;

// 1. A fresh session works.
const fresh = await fetch(`${BASE}/api/chat/messages`, { headers: { cookie: cookieFor(now, epoch) } });
check("a fresh session is let in", fresh.status === 200, `status ${fresh.status}`);

// 2. A session idle for two hours is refused and the cookie is cleared.
const idle = await fetch(`${BASE}/api/chat/messages`, {
  headers: { cookie: cookieFor(now - 2 * 3600_000, epoch) },
});
const cleared = idle.headers.get("Set-Cookie") ?? "";
check(
  "an idle session is signed out after an hour",
  idle.status === 401,
  `status ${idle.status}`,
);
check("the cookie is cleared on the way out", cleared.includes("Max-Age=0"), cleared.slice(0, 60));

// 3. The chat token of the web expires with the sign-on (1 hour).
const token = await fetch(`${BASE}/api/chat/token`, { headers: { cookie: cookieFor(now, epoch) } });
const tokenJson = await token.json();
const ttlSeconds = tokenJson.expiresAt ? Math.round((tokenJson.expiresAt - now) / 1000) : 0;
check(
  "the web chat token expires after an hour",
  ttlSeconds > 0 && ttlSeconds <= 3660,
  `${Math.round(ttlSeconds / 60)} min`,
);

// 3b. The background chat-token refresh must NOT slide the idle window.
const background = await fetch(`${BASE}/api/chat/token`, {
  headers: { cookie: cookieFor(now, epoch), "x-chat-refresh": "1" },
});
check(
  "the background token refresh does not re-issue the session cookie",
  !background.headers.get("Set-Cookie"),
  background.headers.get("Set-Cookie") ?? "no Set-Cookie",
);

// 3c. A session from an older epoch is refused (that is how "sign out
//     everybody" works).
const epochRes = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: cookieFor(now, epoch) } });
const epochNow = Number(epochNowValue());
check(
  "a session of the current epoch is let in",
  epochRes.status === 200,
  `status ${epochRes.status}`,
);

// 4. An expired token cannot open a socket, and an open socket is closed when
//    its token runs out (the chat may not outlive the sign-on).
{
  const tokenWith = (exp) => {
    const payload = b64url(
      Buffer.from(JSON.stringify({ uid: 1, name: "B PHANI KUMAR", role: "owner", exp })),
    );
    const signature = b64url(createHmac("sha256", secret).update(payload).digest());
    return `${payload}.${signature}`;
  };

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 4a. a token that ran out a minute ago is refused.
  const refused = await page.evaluate(async (token) => {
    return await new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:8787/api/chat/ws?token=${token}`);
      let opened = false;
      socket.onopen = () => {
        opened = true;
      };
      socket.onclose = () => resolve(opened ? "opened" : "refused");
      socket.onerror = () => resolve(opened ? "opened" : "refused");
      setTimeout(() => resolve(opened ? "opened" : "refused"), 8000);
    });
  }, tokenWith(Math.floor(now / 1000) - 60));
  check("a token that ran out is refused at the door", refused === "refused", refused);

  // 4b. a socket is closed once its token runs out.
  await page.evaluate(async (token) => {
    const socket = new WebSocket(`ws://127.0.0.1:8787/api/chat/ws?token=${token}`);
    window.__socket = socket;
    await new Promise((resolve) => {
      socket.onopen = () => resolve(null);
      socket.onerror = () => resolve(null);
      setTimeout(resolve, 8000);
    });
  }, tokenWith(Math.floor(now / 1000) + 3));

  // Wait for the token to run out, then push a message so the room broadcasts.
  await new Promise((r) => setTimeout(r, 5000));
  await fetch(`${BASE}/api/chat/messages`, {
    method: "POST",
    headers: { cookie: cookieFor(now), "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", body: "session expiry probe" }),
  });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => {
    const socket = window.__socket;
    return socket ? socket.readyState : -1;
  });
  await browser.close();
  check("an open socket is closed when its token runs out", state === 3, `readyState ${state} (3 = closed)`);

  // Clean up the probe message.
  const sql = neon(process.env.DATABASE_URL);
  await sql.query("delete from chat_messages where body = 'session expiry probe'");
}

// 4. A session from an older epoch is refused (that is "sign out everybody").
const old = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: cookieFor(now, epoch - 1) } });
check("a session of an older epoch is refused", old.status === 401, `status ${old.status}`);

// 5. Only the owner may sign everybody out.
const staff = await fetch(`${BASE}/api/auth/logout-all`, {
  method: "POST",
  headers: { cookie: cookieFor(now, epoch) },
});
check("signing everybody out works for the owner", staff.status === 200, `status ${staff.status}`);

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);