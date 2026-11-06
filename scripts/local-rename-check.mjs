/**
 * LOCAL check for renaming a group (Phase 14).
 *
 * The owner (admin) may rename the shop room; a staff member may not.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-rename-check.mjs
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
const staffCookie = cookieFor(2, "RAJU", "staff");
const title = `Morning team ${new Date().toISOString().slice(11, 19)}`;

try {
  // 1. A staff member may not rename the group.
  const refused = await fetch(`${BASE}/api/chat/rename`, {
    method: "POST",
    headers: { cookie: staffCookie, "content-type": "application/json" },
    body: JSON.stringify({ room: "main", title }),
  });
  check("a staff member cannot rename the group", refused.status === 403, `status ${refused.status}`);

  // 2. The owner can.
  const renamed = await fetch(`${BASE}/api/chat/rename`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ room: "main", title }),
  });
  const renamedJson = await renamed.json();
  check("the owner can rename the group", renamed.ok && renamedJson.title === title, JSON.stringify(renamedJson));

  // 3. The new name shows in the conversation list.
  const list = await fetch(`${BASE}/api/chat/conversations`, { headers: { cookie: ownerCookie } });
  const listJson = await list.json();
  const room = listJson.conversations?.find((c) => c.room === "main");
  check("the new name is in the conversation list", room?.title === title, room?.title ?? "");

  // 4. An empty name is refused.
  const empty = await fetch(`${BASE}/api/chat/rename`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ room: "main", title: "   " }),
  });
  check("an empty name is refused", empty.status === 400, `status ${empty.status}`);
} finally {
  await sql.query("update chat_conversations set title = null where room = 'main'");
  await sql.query("delete from activity_log where event = 'chat.rename'");
  console.log("cleanup: the old name is back");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
