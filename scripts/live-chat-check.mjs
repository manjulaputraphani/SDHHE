/**
 * LIVE check of the Team Chat (Phase 12).
 *
 * Talks to the deployed worker with a session minted from the local
 * .dev.vars (the same SESSION_SECRET the worker uses). It never prints a
 * token and it removes its own rows from Neon afterwards.
 *
 *   node scripts/live-chat-check.mjs
 */
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { chromium } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });
dotenv.config();

const BASE = process.env.LIVE_BASE ?? "https://sdhhe-api.blvphani.workers.dev";
const secret = process.env.SESSION_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secret || !databaseUrl) {
  console.error("SESSION_SECRET / DATABASE_URL missing");
  process.exit(1);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const session = {
  uid: 1,
  name: "B PHANI KUMAR",
  role: "owner",
  exp: Date.now() + 60 * 60_000,
  until: null,
  lastActivity: Date.now(),
};
const payload = b64url(Buffer.from(JSON.stringify(session)));
const signature = b64url(createHmac("sha256", secret).update(payload).digest());
const cookie = `sdhhe_session=${payload}.${signature}`;

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

const sql = neon(databaseUrl);
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([
  { name: "sdhhe_session", value: `${payload}.${signature}`, domain: "sdhhe-api.blvphani.workers.dev", path: "/" },
]);
const page = await context.newPage();

try {
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  const meJson = await me.json();
  check("the session works on the live worker", me.ok && meJson.user?.id === 1, meJson.user?.name);

  const token = await fetch(`${BASE}/api/chat/token`, { headers: { cookie } });
  const tokenJson = await token.json();
  check("the chat token is issued", token.ok && typeof tokenJson.token === "string");

  const history = await fetch(`${BASE}/api/chat/messages`, { headers: { cookie } });
  const historyJson = await history.json();
  check("the room history answers", history.ok && Array.isArray(historyJson.messages));

  const receipts = await fetch(`${BASE}/api/chat/receipts`, { headers: { cookie } });
  const receiptsJson = await receipts.json();
  check("the receipts answer", receipts.ok && Array.isArray(receiptsJson.receipts));

  // The live socket.
  const socketOk = await page.evaluate(async (chatToken) => {
    return await new Promise((resolve) => {
      const socket = new WebSocket(
        `wss://sdhhe-api.blvphani.workers.dev/api/chat/ws?token=${encodeURIComponent(chatToken)}`,
      );
      const timer = setTimeout(() => resolve(false), 15000);
      socket.onmessage = () => {
        clearTimeout(timer);
        socket.close();
        resolve(true);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  }, tokenJson.token);
  check("the live socket opens", socketOk);

  // The screen itself.
  await page.goto(`${BASE}/team-chat`, { waitUntil: "domcontentloaded" });
  const heading = await page.getByRole("heading", { name: "Team Chat" }).isVisible().catch(() => false);
  check("the /team-chat screen opens in the browser", heading);

  // Send a message for real.
  const text = `Live check ${new Date().toISOString().slice(11, 19)}`;
  const sent = await fetch(`${BASE}/api/chat/messages`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", body: text }),
  });
  const sentJson = await sent.json();
  check("a message is stored on the live worker", sent.ok && sentJson.message?.id > 0);

  const after = await fetch(`${BASE}/api/chat/messages`, { headers: { cookie } });
  const afterJson = await after.json();
  check(
    "the message is in the live history",
    afterJson.messages?.some((m) => m.body === text),
  );

  // The receipt upload needs R2 — it is not enabled on the account yet.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "live-check.png");
  const uploaded = await fetch(`${BASE}/api/chat/receipts`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  const uploadJson = await uploaded.json().catch(() => ({}));
  check(
    "the receipt upload answers (503 until R2 is enabled)",
    uploaded.status === 503 || uploaded.status === 200,
    `${uploaded.status} ${uploadJson.error ?? ""}`,
  );
} finally {
  await browser.close();
  await sql.query("delete from chat_messages where body like 'Live check %'");
  console.log("cleanup: test rows removed");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
