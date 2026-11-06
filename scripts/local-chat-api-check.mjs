/**
 * LOCAL check for the Team Chat API (Phase 12).
 *
 * Talks to the local worker (wrangler dev): history, sending a message, a
 * receipt with its file, approving it, and the permission rules.
 * Everything it writes is removed again at the end.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-chat-api-check.mjs
 */
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { chromium } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });
dotenv.config();

const BASE = "http://127.0.0.1:8787";
const secret = process.env.SESSION_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secret || !databaseUrl) {
  console.error("SESSION_SECRET / DATABASE_URL missing");
  process.exit(1);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function chatToken(uid, name, role) {
  const body = b64url(
    Buffer.from(JSON.stringify({ uid, name, role, exp: Math.floor(Date.now() / 1000) + 3600 })),
  );
  return `${body}.${b64url(createHmac("sha256", secret).update(body).digest())}`;
}

const owner = { "Authorization": `Bearer ${chatToken(1, "B PHANI KUMAR", "owner")}` };
// The same member id (it has to exist in app_users) but with the staff role.
const staff = { "Authorization": `Bearer ${chatToken(1, "RAJU", "staff")}` };

const sql = neon(databaseUrl);
const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

try {
  // 0. open the room socket and keep it open while we write
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const socketReady = page.evaluate(async (token) => {
    return await new Promise((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:8787/api/chat/ws?token=${token}`);
      window.__frames = [];
      socket.onmessage = (event) => window.__frames.push(String(event.data));
      socket.onopen = () => resolve(true);
      socket.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 10000);
    });
  }, chatToken(1, "B PHANI KUMAR", "owner"));
  check("the room socket opens", await socketReady);

  // 1. history
  const history = await fetch(`${BASE}/api/chat/messages`, { headers: owner });
  const historyJson = await history.json();
  check("GET /api/chat/messages answers", history.ok && Array.isArray(historyJson.messages));

  // 2. send a message
  const sent = await fetch(`${BASE}/api/chat/messages`, {
    method: "POST",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", body: "Hello from the local check" }),
  });
  const sentJson = await sent.json();
  check("POST /api/chat/messages stores a message", sent.ok && sentJson.message?.id > 0);

  // 3. an empty message is refused
  const empty = await fetch(`${BASE}/api/chat/messages`, {
    method: "POST",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", body: "   " }),
  });
  check("an empty message is refused", empty.status === 400, `status ${empty.status}`);

  // 4. upload a receipt file
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "check.png");
  const uploaded = await fetch(`${BASE}/api/chat/receipts`, { method: "POST", headers: owner, body: form });
  const uploadedJson = await uploaded.json();
  check("POST /api/chat/receipts stores the file", uploaded.ok && uploadedJson.file?.r2Key);

  // 5. post the receipt in the room
  const posted = await fetch(`${BASE}/api/chat/messages`, {
    method: "POST",
    headers: { ...staff, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "receipt",
      body: "Transport bill",
      receipt: {
        title: "Transport bill",
        amountPaise: 45000,
        note: "today",
        r2Key: uploadedJson.file.r2Key,
        filename: uploadedJson.file.filename,
        mime: uploadedJson.file.mime,
        sizeBytes: uploadedJson.file.sizeBytes,
      },
    }),
  });
  const postedJson = await posted.json();
  const receiptId = postedJson.receipt?.id;
  check("a member can submit a receipt", posted.ok && receiptId > 0);

  // 6. the receipt is pending
  const pending = await fetch(`${BASE}/api/chat/receipts?status=pending`, { headers: owner });
  const pendingJson = await pending.json();
  check(
    "the receipt waits for a decision",
    pending.ok && pendingJson.receipts.some((r) => r.id === receiptId && r.status === "pending"),
    `${pendingJson.pending} pending`,
  );

  // 7. staff may not approve
  const staffDecision = await fetch(`${BASE}/api/chat/receipts/${receiptId}/decision`, {
    method: "POST",
    headers: { ...staff, "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  check("staff cannot approve a receipt", staffDecision.status === 403, `status ${staffDecision.status}`);

  // 8. the owner approves
  const decision = await fetch(`${BASE}/api/chat/receipts/${receiptId}/decision`, {
    method: "POST",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", note: "checked" }),
  });
  const decisionJson = await decision.json();
  check(
    "the owner can approve",
    decision.ok && decisionJson.receipt?.status === "approved" && decisionJson.receipt?.deciderName === "B PHANI KUMAR",
  );

  // 9. a receipt is decided only once
  const again = await fetch(`${BASE}/api/chat/receipts/${receiptId}/decision`, {
    method: "POST",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({ decision: "reject" }),
  });
  check("a receipt cannot be decided twice", again.status === 400, `status ${again.status}`);

  // 10. the room history has the message and the decision
  const after = await fetch(`${BASE}/api/chat/messages?limit=50`, { headers: owner });
  const afterJson = await after.json();
  const kinds = afterJson.messages.map((m) => m.kind);
  check(
    "the history holds the message, the receipt and the decision",
    kinds.includes("text") && kinds.includes("receipt") && kinds.includes("system"),
    kinds.join(","),
  );

  // 11. without a token nothing works
  const anonymous = await fetch(`${BASE}/api/chat/messages`);
  check("an anonymous request is refused", anonymous.status === 401, `status ${anonymous.status}`);

  // 12. the room received the message live over the socket
  const frames = await page.evaluate(() => window.__frames ?? []);
  const live = frames.map((f) => JSON.parse(f)).filter((f) => f.type === "message");
  check(
    "the message arrived live over the socket",
    live.some((f) => f.message?.body === "Hello from the local check"),
    `${frames.length} frame(s)`,
  );
  await browser.close();
} finally {
  // Clean up: the check writes into the same Neon database the app uses.
  // The receipts point at their message, so they go first.
  await sql.query(
    "delete from receipt_requests where title = 'Transport bill' and amount_paise = 45000",
  );
  await sql.query(
    "delete from chat_messages where body like 'Hello from the local check%' or body like 'Transport bill' or body like '%approved receipt%' or body like '%rejected receipt%'",
  );
  console.log("cleanup: test rows removed");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
