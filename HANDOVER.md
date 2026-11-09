# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `9aa83610`** (deployed 2026-11-09: delivery receipts work from ANY screen + push notifications +
notification sound). Owner's real-device test is due.

## Next task
None queued — the owner picks the next task. Push notification + delivery receipt testing on real devices.

## Owner steps that are still open
1. Cloudflare Access service token (desktop chat). 2. Desktop 1-hour auto-logout (no answer).
3. Roasting screen missing in desktop. 4. Keep ~/sdhhe-android-twa safe (keystore, pw sdhhe2026).

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## This session: delivery receipts from any screen — deployed `9aa83610`
- **`confirmDirectDelivered`** (web/src/unread.ts) is now async and fetches ALL messages for each
  unread 1:1 conversation — marks every message from the other person as delivered, even when the
  member is on the dashboard or another screen, not just in the chat room. Runs every 30s via
  `refreshUnread`, on focus, visibility change, and sign-in.
- **`web/src/components/TeamChat.tsx`**: awaits `confirmDirectDelivered` in `loadConversations`.
- **Tests**: 510 unit + all typechecks; **94 e2e web** green (72 desktop + 22 mobile). Mobile
  real-device Safari/Chrome pass still due.

## Commands
- Tests: `npx vitest run --reporter=dot` (510) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (94, mocked worker)
- Deploy: `nvm use 22` then `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
- Push diagnostics: `wrangler tail` → `/tmp/wrangler-tail.log`

## Test steps (delivery receipts + push + sound)
1. Hard-refresh both phones → bell toggle "🔔 Notifications on" → grant permission if needed.
2. Send a 1:1 message while admin is on ANOTHER screen (not the chat) → double ticks should still
   appear (delivery receipt from conversation sync).
3. Send a 1:1 message with admin's app closed/backgrounded → notification should arrive.
4. App open → notification sound should play on incoming message.
5. No notification? Check `/tmp/wrangler-tail.log` for 401/403/500 errors.
