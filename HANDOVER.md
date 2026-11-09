# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `648781ba`** (deployed 2026-11-09: 1:1 Message info fix + repair script run — 6 sender
receipts deleted, 1:1 member rows were already correct). Previous: `2cb408cf` (AI key on Worker).

## Next task
None queued — the owner picks the next task. Next: the two-browser manual test of the 1:1
Message info (me + Chaluvaraj) against the LIVE site (hard-refresh both browsers).

## Owner steps that are still open
1. Cloudflare Access service token for the desktop app (for desktop chat).
2. Desktop 1-hour auto-logout (owner has not answered). 3. Roasting screen missing in desktop.
4. Keep ~/sdhhe-android-twa safe (the APK signing keystore, password sdhhe2026).

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## This session: 1:1 Message info fix (Seen by / Delivered to)
- **Bugs**: 1:1 panel listed the whole team as Pending; "Delivered to #1" (sender's own receipt +
  `/api/chat/members` excludes self so the name lookup failed); receipts stale/missing for 1:1.
- **New API** `GET /api/chat/messages/:id/info`: `recipients` = conversation_members of THAT room
  minus the sender + `receipts` with joined user data (id, name, initials, avatar) + deliveredAt/readAt.
  UI fallback is "Unknown member" — never "#id".
- **No sender receipts**: `POST /api/chat/delivered` and `/read` skip the sender (markDelivered SQL
  guard too); `GET /api/chat/messages` filters sender rows out of deliveredBy/readBy; the client no
  longer confirms its own echo message.
- **1:1 panel**: bubble preview + two rows only — Read (blue ✓✓) / Delivered (grey ✓✓) with
  "Today, 04:20 PM" or "—". Groups keep Read by / Delivered to / Pending chips (info API data now).
- **Ticks 1:1**: the other person comes from the room name (`membersOf`) — broken member rows can no
  longer mis-match ticks; live via socket "read"/"delivered" (the open panel refetches on those frames).
- **Delivered sync**: an unread 1:1 whose newest message is the other person's is confirmed delivered
  when the app syncs conversations (unread.ts `confirmDirectDelivered`) → "comes online = grey ✓✓,
  opens the chat = blue ✓✓".
- **REPAIR (DONE 2026-11-09)**: `node scripts/repair-direct-chat.mjs` ran on the live DB — deleted
  6 sender receipts (user_id = sender_id); 0 member rows needed fixing.
- Tests: 505 unit + all typechecks green; 72 e2e web green (2 Message info tests); new DB int
  test in `src/db/chatStates.int.test.ts` (`npm run test:db`, needs DATABASE_URL_TEST).
- DEPLOYED `648781ba` (2026-11-09): `nvm use 22 && cd web && npm run build && cd ../web-worker &&
  npx wrangler deploy`.

## This session (deployed): read receipts + unread badges
- **Root cause**: `POST /api/chat/read` wrote `chat_message_states.read_at` but never bumped
  `chat_conversation_members.last_read_message_id` — badges never cleared. `chatStates.markRead` now
  does both; front end marks visible messages read (IntersectionObserver) and clears badges live.

## Commands
- Tests: `npx vitest run --reporter=dot` (505) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (72, mocked worker)
- Deploy (ask first): `nvm use 22` (wrangler 4.158 requires Node ≥22) then
  `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
