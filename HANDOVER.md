# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `cc685e1d`** (deployed 2026-11-09: WhatsApp-style notification sound for incoming chat messages
while the app is open + push diagnostics). Previous: `cf71e475` (1:1 push notifications enabled).
Owner's real-device push + sound test is due.

## Next task
None queued — the owner picks the next task. Push notification testing on real devices.

## Owner steps that are still open
1. Cloudflare Access service token (desktop chat). 2. Desktop 1-hour auto-logout (no answer).
3. Roasting screen missing in desktop. 4. Keep ~/sdhhe-android-twa safe (keystore, pw sdhhe2026).

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## This session: mobile layout (max-width 767px ONLY) + round loading mark
- **New** `web/src/lib/mobile.ts` (useIsMobile/useKeyboardOpen/formatTabBadge, immersive chrome
  store, useBackGuard back-stack with isSilentPop) · `BottomNav` (5 tabs, caramel pill, badge from
  the shared unread store) · `MoreSheet` (screens grouped, ThemeToggle, user, Sign out) ·
  `ChatHeader` (56px, Phone/Video/More menu) · `GroupInfo` (group + 1:1 contact, same AI-polish /
  push settings as desktop).
- **TeamChat**: mobile chat list (collapsing "Chats" title, search, MessageSquarePlus sheet),
  full-screen chat (page title block + app header + bottom bar hidden = immersive), composer ONE
  pill + 44px round send/mic, 1:1 Message info rows, caramel sender name. Desktop JSX untouched
  (every new block is `isMobile`-gated or in `@media (max-width: 767px)`).
- **App**: BottomNav render, `mobile-nav-pad`, immersive hides the mobile header, hamburger +
  logout icons REMOVED from the mobile header (Sign out lives in More), popstate handler skips
  silent layer pops (`isSilentPop`).
- **Loading mark** (`src/components/LoadingMark.tsx` + `.loading-mark` CSS): espresso tile
  #3E2A1F, caramel disc, cream cup, animated steam — on every screen load (web + desktop).
- Deviations (flagged to owner): Settings added to More/ADMIN (every screen reachable); "Clear
  chat" clears the visible thread only (no backend changes — history returns on reload); Voice/
  Video = "not available yet" toasts; contact phone from /api/users (hidden w/o team view);
  approvals entry on mobile = 🧾 button in the chat list header.
- Tests: 509 unit + all typechecks; **94 e2e web** green — 72 desktop (pixel-identical proof) +
  22 mobile (`e2e-web/mobile-chat.spec.ts`: 320/360/375/390/412/430 × light/dark/contrast + More
  sheet, back nav, Message info, Group info). Real-device Safari/Chrome pass is still due.

## Commands
- Tests: `npx vitest run --reporter=dot` (509) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (94, mocked worker)
- Deploy (ask first): `nvm use 22` (wrangler 4.158 requires Node ≥22) then
  `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
- Push diagnostics: `wrangler tail` runs in background → `/tmp/wrangler-tail.log`

## Push notification root cause + test steps
- **Root cause (fixed)**: `sendWebPush` treated every non-404/410 response as "delivered" — VAPID/auth
  failures were silently swallowed. Now returns `{delivered, gone}` and logs status + body.
- **1:1 push now enabled** (was disabled by design — private text). A 1:1 message now sends a
  text-free web push ("New message" + sender name) to the other member's subscription, plus an
  ntfy fallback. The message text never reaches the push service.
- **Test**: hard-refresh both phones → bell toggle "🔔 Notifications on" → send a 1:1 message
  with the app closed/backgrounded → notification should arrive. Check
  `/tmp/wrangler-tail.log` for 401/403/500 if it doesn't.

## This session: notification sound (WhatsApp-style) — deployed `cc685e1d`
- **`web/src/lib/notificationSound.ts`** (new): synthesizes a two-tone chime (880 Hz → 1320 Hz)
  via the Web Audio API — no external file, works offline.
- **`web/public/sw.js`**: on a push event, posts `play-notification-sound` to every open
  window client so the tab plays the sound even if the OS notification is suppressed.
- **`web/src/App.tsx`**: listens for the service worker message and plays the sound.
- **`web/src/components/TeamChat.tsx`**: plays the sound on incoming socket "message" frames
  (not your own message).
- Note: iOS Safari blocks audio until the first user gesture; Android Chrome plays once the
  user has tapped anything. The OS notification sound (closed app) is separate and automatic.
