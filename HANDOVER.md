# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `cc685e1d`** (deployed 2026-11-09: WhatsApp-style notification sound for incoming chat
messages while the app is open + 1:1 push notifications). Owner's real-device push + sound test
is due.

## Next task
None queued — the owner picks the next task. Push notification + sound testing on real devices.

## Owner steps that are still open
1. Cloudflare Access service token (desktop chat). 2. Desktop 1-hour auto-logout (no answer).
3. Roasting screen missing in desktop. 4. Keep ~/sdhhe-android-twa safe (keystore, pw sdhhe2026).

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## This session: push notifications + notification sound — deployed `cc685e1d`
- **`sendWebPush`** now returns `{delivered, gone}` — VAPID/auth failures (400/401/403/500) are
  logged instead of silently swallowed as "delivered".
- **1:1 push now enabled** (was off by design — private text). A 1:1 message sends a text-free
  web push ("New message" + sender name) + ntfy fallback. Message text never reaches the push
  service.
- **Notification sound**: `web/src/lib/notificationSound.ts` synthesizes a two-tone chime
  (880→1320 Hz) via Web Audio API. Played on incoming socket messages (TeamChat.tsx) and on
  push events relayed from `web/public/sw.js` to open tabs (App.tsx). iOS Safari blocks audio
  until first user gesture; Android Chrome plays after any tap.
- Tests: 509 unit + all typechecks; **94 e2e web** green (72 desktop + 22 mobile). Mobile
  real-device Safari/Chrome pass still due.

## Commands
- Tests: `npx vitest run --reporter=dot` (509) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (94, mocked worker)
- Deploy: `nvm use 22` then `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
- Push diagnostics: `wrangler tail` → `/tmp/wrangler-tail.log`

## Test steps (push + sound)
1. Hard-refresh both phones → bell toggle "🔔 Notifications on" → grant permission if needed.
2. Send a 1:1 message with the app closed/backgrounded → notification should arrive.
3. App open → notification sound should play on incoming message.
4. No notification? Check `/tmp/wrangler-tail.log` for 401/403/500 errors.
