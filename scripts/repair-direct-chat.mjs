/**
 * ONE-TIME repair for 1:1 chat data (the "Message info" fix).
 *
 * a) Every 1:1 conversation (room `dm-<a>-<b>`) must have EXACTLY two rows in
 *    `chat_conversation_members`: the two people of the room name. Missing
 *    members are added (when the user exists), extra members are removed.
 * b) A receipt where `user_id` = the message's `sender_id` can never exist —
 *    the sender is not a recipient of their own message. Those rows are
 *    deleted (the migration of the fix).
 *
 * Run (reads DATABASE_URL from the env or web-worker/.dev.vars):
 *
 *   node scripts/repair-direct-chat.mjs            # repairs
 *   node scripts/repair-direct-chat.mjs --dry-run  # shows what it WOULD do
 */
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });
dotenv.config();

const dryRun = process.argv.includes("--dry-run");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}
const sql = neon(databaseUrl);

const fixed = { extra: 0, missing: 0, receipts: 0 };
const problems = [];

// ---- (b) receipts of a sender for their own message ----
const senderReceipts = await sql`
  select s.message_id, s.user_id
  from chat_message_states s
  join chat_messages m on m.id = s.message_id
  where s.user_id = m.user_id
`;
if (senderReceipts.length > 0 && !dryRun) {
  await sql`
    delete from chat_message_states s
    using chat_messages m
    where s.message_id = m.id and s.user_id = m.user_id
  `;
}
fixed.receipts = senderReceipts.length;
console.log(
  `${dryRun ? "would delete" : "deleted"} ${senderReceipts.length} sender receipt(s) (user_id = sender_id)`,
);

// ---- (a) every 1:1 conversation has exactly its two members ----
const conversations = await sql`
  select c.id, c.room,
         coalesce(json_agg(cm.user_id) filter (where cm.user_id is not null), '[]')::text as members
  from chat_conversations c
  left join chat_conversation_members cm on cm.conversation_id = c.id
  where c.kind = 'direct' and c.archived_at is null
  group by c.id, c.room
  order by c.id
`;

for (const conversation of conversations) {
  const match = /^dm-(\d+)-(\d+)$/.exec(conversation.room);
  if (!match) {
    problems.push(`${conversation.room}: room name is not dm-<a>-<b> — left untouched`);
    continue;
  }
  const wanted = [...new Set([Number(match[1]), Number(match[2])])].sort((a, b) => a - b);
  if (wanted.length !== 2 || wanted[0] === wanted[1]) {
    problems.push(`${conversation.room}: the room name has no two different people — left untouched`);
    continue;
  }
  const current = JSON.parse(conversation.members).map(Number);

  // Extra members (the bug: a 1:1 listing the whole team) — removed.
  const extras = current.filter((id) => !wanted.includes(id));
  for (const id of extras) {
    console.log(`${conversation.room}: removes extra member #${id}`);
    if (!dryRun) {
      await sql`
        delete from chat_conversation_members
        where conversation_id = ${conversation.id} and user_id = ${id}
      `;
    }
    fixed.extra += 1;
  }

  // Missing members — added when the user exists.
  for (const id of wanted.filter((entry) => !current.includes(entry))) {
    const known = await sql`select 1 from app_users where id = ${id}`;
    if (known.length === 0) {
      problems.push(`${conversation.room}: user #${id} does not exist — cannot add them`);
      continue;
    }
    console.log(`${conversation.room}: adds missing member #${id}`);
    if (!dryRun) {
      await sql`
        insert into chat_conversation_members (conversation_id, user_id)
        values (${conversation.id}, ${id})
        on conflict (conversation_id, user_id) do nothing
      `;
    }
    fixed.missing += 1;
  }
}

console.log(
  `${dryRun ? "would repair" : "repaired"}: ${fixed.extra} extra member row(s), ` +
    `${fixed.missing} missing member row(s), ${fixed.receipts} sender receipt(s)`,
);
for (const problem of problems) console.log(`NOTE  ${problem}`);
