/**
 * LOCAL check for the delivered / read ticks (Phase 14).
 *
 * Sends a message, marks it as delivered, then as read, and looks at what the
 * sender sees. It removes its own rows from Neon afterwards.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-tick-check.mjs
 */
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
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

function cookieFor(uid, name, role) {
  const session = {
    uid,
    name,
    role,
    exp: Date.now() + 60 * 60_000,
    until: null,
    lastActivity: Date.now(),
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

const sql = neon(databaseUrl);
const ownerCookie = cookieFor(1, "B PHANI KUMAR", "owner");
// The other member of the shop (the first one that is not the owner).
const members = await sql.query(
  "select id, name, role from app_users where id <> 1 and active = true order by id limit 1",
);
const other = members[0];
if (!other) {
  console.error("no second member in the database — cannot check the ticks");
  process.exit(1);
}
const otherCookie = cookieFor(other.id, other.name, other.role);
const text = `tick check ${new Date().toISOString().slice(11, 19)}`;

try {
  // 1. The owner sends a message.
  const sent = await fetch(`${BASE}/api/chat/messages`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", body: text, room: "main" }),
  });
  const sentJson = await sent.json();
  const messageId = sentJson.message?.id;
  check("the message is sent", sent.ok && messageId > 0, `id ${messageId}`);

  // 2. It is only "sent" so far.
  let history = await (await fetch(`${BASE}/api/chat/messages?room=main`, { headers: { cookie: ownerCookie } })).json();
  let mine = history.messages?.find((m) => m.id === messageId);
  check("a fresh message has no marks yet", (mine?.deliveredBy ?? []).length === 0 && (mine?.readBy ?? []).length === 0);

  // 3. The other member's device gets it → delivered.
  const delivered = await fetch(`${BASE}/api/chat/delivered`, {
    method: "POST",
    headers: { cookie: otherCookie, "content-type": "application/json" },
    body: JSON.stringify({ messageId }),
  });
  check("the delivered call answers 200", delivered.status === 200, `status ${delivered.status}`);

  history = await (await fetch(`${BASE}/api/chat/messages?room=main`, { headers: { cookie: ownerCookie } })).json();
  mine = history.messages?.find((m) => m.id === messageId);
  check("the sender sees it as delivered", mine?.deliveredBy?.includes(other.id) === true, JSON.stringify(mine?.deliveredBy));

  // 4. The other member reads it → read.
  const read = await fetch(`${BASE}/api/chat/read`, {
    method: "POST",
    headers: { cookie: otherCookie, "content-type": "application/json" },
    body: JSON.stringify({ room: "main", messageId }),
  });
  check("the read call answers 200", read.status === 200, `status ${read.status}`);

  history = await (await fetch(`${BASE}/api/chat/messages?room=main`, { headers: { cookie: ownerCookie } })).json();
  mine = history.messages?.find((m) => m.id === messageId);
  check("the sender sees it as read", mine?.readBy?.includes(other.id) === true, JSON.stringify(mine?.readBy));

  // 5. The stranger cannot mark somebody else's message.
  const stranger = await fetch(`${BASE}/api/chat/delivered`, {
    method: "POST",
    headers: { cookie: cookieFor(9999, "STRANGER", "staff"), "content-type": "application/json" },
    body: JSON.stringify({ messageId }),
  });
  check("a stranger cannot mark a message", stranger.status === 403, `status ${stranger.status}`);
} finally {
  await sql.query("delete from chat_message_states where message_id in (select id from chat_messages where body = $1)", [text]);
  await sql.query("delete from chat_messages where body = $1", [text]);
  console.log("cleanup: test rows removed");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
