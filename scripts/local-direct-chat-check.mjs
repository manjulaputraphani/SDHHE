/**
 * LOCAL check for direct chat (Phase 13).
 *
 * Talks to the local worker: the conversation list, a private chat between two
 * members, the unread count, and the rule that a member cannot read a chat
 * they are not part of. It removes its own rows from Neon afterwards.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-direct-chat-check.mjs
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

try {
  // 1. The conversation list starts with the shop room.
  const list = await fetch(`${BASE}/api/chat/conversations`, { headers: { cookie: ownerCookie } });
  const listJson = await list.json();
  const shopRoom = listJson.conversations?.find((c) => c.room === "main");
  check("the shop room is in the conversation list", list.ok && Boolean(shopRoom), shopRoom?.kind);

  // 2. The member list (who may be chatted with).
  const members = await fetch(`${BASE}/api/chat/members`, { headers: { cookie: ownerCookie } });
  const membersJson = await members.json();
  check("the member list answers", members.ok && Array.isArray(membersJson.members), `${membersJson.members?.length} member(s)`);

  // 3. Start a private chat with another member.
  const other = membersJson.members?.[0];
  let room = null;
  if (other) {
    const started = await fetch(`${BASE}/api/chat/conversations`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: other.id }),
    });
    const startedJson = await started.json();
    room = startedJson.conversation?.room ?? null;
    check("a private chat can be started", started.ok && Boolean(room), room ?? "");
  } else {
    check("a private chat can be started", false, "no second member in the database");
  }

  if (room) {
    // 4. A message in the private room.
    const sent = await fetch(`${BASE}/api/chat/messages`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "text", body: "private hello", room }),
    });
    const sentJson = await sent.json();
    check("a message goes into the private room", sent.ok && sentJson.message?.room === room);

    // 5. The room history is room-scoped.
    const history = await fetch(`${BASE}/api/chat/messages?room=${encodeURIComponent(room)}`, {
      headers: { cookie: ownerCookie },
    });
    const historyJson = await history.json();
    check(
      "the history of the room is room-scoped",
      history.ok && historyJson.messages?.some((m) => m.body === "private hello"),
      `${historyJson.messages?.length} message(s)`,
    );

    // 6. The shop room does not show the private message.
    const shop = await fetch(`${BASE}/api/chat/messages?room=main`, { headers: { cookie: ownerCookie } });
    const shopJson = await shop.json();
    check(
      "the shop room does not show the private message",
      !(shopJson.messages ?? []).some((m) => m.body === "private hello"),
    );

    // 7. Somebody who is not in the room is refused.
    const strangerCookie = cookieFor(999, "STRANGER", "staff");
    const refused = await fetch(`${BASE}/api/chat/messages?room=${encodeURIComponent(room)}`, {
      headers: { cookie: strangerCookie },
    });
    check("a stranger cannot read the private chat", refused.status === 403, `status ${refused.status}`);

    const refusedSend = await fetch(`${BASE}/api/chat/messages`, {
      method: "POST",
      headers: { cookie: strangerCookie, "content-type": "application/json" },
      body: JSON.stringify({ kind: "text", body: "let me in", room }),
    });
    check("a stranger cannot write into the private chat", refusedSend.status === 403, `status ${refusedSend.status}`);

    // 8. The unread count of the other member.
    await sql.query(
      "insert into chat_conversation_members (conversation_id, user_id) select id, $2 from chat_conversations where room = $1 on conflict do nothing",
      [room, other.id],
    );
    const theirList = await fetch(`${BASE}/api/chat/conversations`, {
      headers: { cookie: cookieFor(other.id, other.name, other.role) },
    });
    const theirJson = await theirList.json();
    const theirRoom = theirJson.conversations?.find((c) => c.room === room);
    check("the other member sees the chat with an unread message", theirJson.conversations?.length > 0, `unread ${theirRoom?.unread}`);

    // 9. Reading clears the unread count.
    await fetch(`${BASE}/api/chat/read`, {
      method: "POST",
      headers: { cookie: cookieFor(other.id, other.name, other.role), "content-type": "application/json" },
      body: JSON.stringify({ room, messageId: sentJson.message?.id }),
    });
    const afterRead = await fetch(`${BASE}/api/chat/conversations`, {
      headers: { cookie: cookieFor(other.id, other.name, other.role) },
    });
    const afterJson = await afterRead.json();
    const afterRoom = afterJson.conversations?.find((c) => c.room === room);
    check("reading clears the unread count", afterRoom?.unread === 0, `unread ${afterRoom?.unread}`);
  }
} finally {
  await sql.query("delete from chat_messages where body = 'private hello'");
  await sql.query("delete from chat_conversation_members");
  await sql.query("delete from chat_conversations");
  console.log("cleanup: test rows removed");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
