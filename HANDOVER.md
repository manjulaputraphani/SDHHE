# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `5e7683d2` (Android install button + APK shipped; D1 binding `DB` registered).**
Phase 17 STARTED: Neon Postgres → Cloudflare D1. T-17.0 plan + T-17.1 database created
(`sdhhe`, APAC, id a111542a-461f-4cda-a756-a5eca215ca48, binding `DB` in wrangler.toml).
better-sqlite3 added for local int tests.
The app still runs on Neon until the cutover (T-17.5) — no data migration shipped yet.

## Next task — T-17.2 port the schema (tests first)
Rewrite `src/db/schema.ts` on drizzle sqlite-core (serial → autoincrement pk; timestamptz →
ISO text; booleans → 0/1; money/qty stay integer). Then T-17.3 ports the raw-SQL modules
(chatRooms listConversations json_build_object → manual assembly, `interval`/`::` casts in
reports/rotation/cash ledger, client.ts getDb → env.DB in the worker), T-17.4 exports Neon →
imports D1 with row/total verification, T-17.5 cutover deploy, T-17.6 desktop becomes an API
client (also unblocks its chat via the Access service token), T-17.7/17.8 verify + cleanup.
Full task list in docs/BUILD_PLAN.md (Phase 17).

## Owner steps that are still open
1. Cloudflare Access service token for the desktop app (needed by T-17.6).
2. Desktop 1-hour auto-logout (owner has not answered). 3. Roasting screen missing in desktop.
4. Keep ~/sdhhe-android-twa safe (the APK signing keystore, password sdhhe2026).

## What Phase 16 delivered
- **T-16.1** line breaks kept exactly (bubble `white-space: pre-wrap`; composer grows to 8 lines).
- **T-16.2** message actions: no-op plain click; hover (desktop) / long-press (phone) action row
  (↩ 😊 📋 ✏️ 🗑 📌 ⓘ); edit in the composer within 15 minutes (audit in chat_message_edits);
  soft delete with tombstone; receipts delete only while pending. Migration 0018.
- **T-16.3** approvals panel only while pending: gold 🧾 badge button (approvers), auto-open on a
  new receipt, remembered open/closed, staff see nothing.
- **T-16.4** replies (quoted preview + scroll-to-original flash), reactions (chips + picker, one
  per member per message), ticks inside the bubble, @mentions (member list + personal push),
  search highlight + jump, pinned messages (owner, max 3, bar + 📌), "New messages" divider.
  Migration 0019 (chat_messages.reply_to_id, chat_reactions, chat_pinned_messages).
- **T-16.5** bubbles 10/14px padding, 14px font, 1.5 line height, ≤70%; same-sender grouping
  (2px) / 12px between senders; accent-ink avatar+names; 360px + dark theme in the e2e suite.
- **T-16.6** `e2e-web/chat-polish.spec.ts` (8 tests) + the extended responsive checks.

## New worker routes (all membership-checked; pin = owner-only)
- PATCH/DELETE /api/chat/messages/:id (edit within 15 min; soft delete)
- POST/DELETE /api/chat/reactions/:messageId · GET/POST /api/chat/pins, DELETE /api/chat/pins/:id
- messages GET carries reactions; messages POST carries replyToId + mentions (personal push)
- Frames: "update", "reaction", "pins" (+ "settings"/"members" from earlier phases)

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (494) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (70, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
