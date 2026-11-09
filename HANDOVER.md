# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-10 by OpenCode
Tool: OpenCode

## Current state
- **Web LIVE `19177dd4`** (push notifications + delivery receipts + notification sound).
- **Mobile app** (`mobile/` directory): Phase 1 foundation built — Expo project, login,
  bottom tabs (Home · New Bill · Chats · Stock · More), theme system, API client,
  chat room screen with WebSocket protocol. **0 typecheck errors**.

## Next task
Mobile Phase 2: install `expo-notifications`, wire native push (FCM + APNs), test on device.
Then Phase 5: `eas build` → Play Store + App Store.

## What was fixed (web push notifications)
1. **VAPID key mismatch** — generated a NEW key pair, updated both secrets. Fixes BadJwtToken.
2. **Subscription reuse** — `pushSetup.ts` now always creates a FRESH subscription (was reusing
   the old one, which was bound to the old VAPID key → VapidPkHashMismatch).
3. **Clear old subscriptions** — deleted all 8 stale DB rows bound to old keys.
4. **Service worker delivery confirmation** — `sw.js` calls `/api/chat/delivered` on push receipt,
   so the sender sees ✓✓ even when the app is closed.
5. **Immediate delivery tick** (web + 1:1) — when push service accepts the message, server
   immediately marks it delivered + broadcasts "delivered" to the room. Sender sees ✓✓ instantly.
6. **Auto-refresh** — `refreshUnread` interval reduced from 30s to **5 seconds**.
7. **APK download + PushToggle on mobile** — added to MoreSheet (were desktop-only).
8. **iOS Home Screen** — required for iOS Web Push; user must Add to Home Screen.

## Owner steps that are still open
1. Apple Developer Account ($99/year) for iOS App Store.
2. Google Play Console ($25) for Android Play Store.

## Commands
- Tests: `npx vitest run --reporter=dot` (510) · `npm run test:e2e:web` (94)
- Web deploy: `nvm use 22 && cd web && npm run build && cd ../web-worker && npx wrangler deploy`
- Mobile dev: `cd mobile && npx expo start` · typecheck: `npx tsc --noEmit` · lint: `npx expo lint`
- Push diagnostics: `wrangler tail` → `/tmp/wrangler-tail.log`
