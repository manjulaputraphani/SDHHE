# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `648781ba`** (1:1 Message info fix + repair: 6 sender receipts deleted). This session's
mobile layout + loading mark are built and tested but NOT yet deployed.

## Next task
None queued — the owner picks the next task. Next: deploy + a real-device pass (iPhone Safari,
Android Chrome) of the mobile layout checklist (keyboard, safe areas, back gestures).

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
