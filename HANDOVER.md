# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**T-16.0 — the web edition is fully responsive (iPhone Safari) — committed & verified.**
Live worker version `eb23815a-12ad-4da9-8e53-1bb39e3df6e1` unchanged; this touched the **web bundle only**
(`cd web && npm run build` → `cd web-worker && npx wrangler deploy` when the owner wants it live).
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/` (NOT touched here).

## Done
- **T-16.0 Responsive web edition** (committed): exact viewport meta with `viewport-fit=cover` (no
  user-scalable lock); global CSS (border-box, `-webkit-text-size-adjust: 100%`, `overflow-x: hidden`,
  img/svg max-width); **every** input/select/textarea ≥16px on phones (iOS auto-zoom gone — incl. the
  chat searches, rename, margin% field); `100dvh` with `100vh` fallback (`.h-viewport`, `.chat-shell`);
  safe-area insets (header, drawer, composer, toasts, modals, tour); 44px tap targets under
  `(pointer: coarse)` (`.tap-44`, `.btn/.btn-mini`); bottom-sheet modals on phones; dashboard cards
  `repeat(auto-fit, minmax(160px, 1fr))`; padding 16/24/32px (phone/tablet/desktop).
- **Team Chat**: one panel on a phone (list ↔ room with back arrow), on **md (768–1023)** the list +
  room sit side by side and the approvals slide over the grid, three panels on lg; bubbles
  `max-w-[80%] md:max-w-[65%]` + `overflow-wrap: anywhere`; the composer stays above the keyboard
  via `visualViewport` (`useKeyboardOffset`) — no page jump; message time now opens by tap
  (`tabIndex={0}` on bubbles); the chat shell height counts the 3.5rem top bar + safe areas
  (`.chat-shell` in styles.css — change both together if the header height changes).
- **Verification**: new `e2e-web/responsive.spec.ts` (13 tests) walks every page at **375 / 390 / 430**
  px (no horizontal scroll, no auto-zoom) + drawer behaviour + chat at 768/1280 + login at 375.
  Web suite **34/34 green**, 466 unit tests, tsc clean (root / web / worker), web build ok.
- Files: `web/index.html`, `web/src/styles.css`, `web/src/App.tsx`,
  `web/src/components/TeamChat.tsx`, `web/src/components/notifications/{ToastHost,WelcomeBanner,
  AnnouncementBanner,ProductTour,WhatsNewModal,LoginAlertModal}.tsx`, `e2e-web/responsive.spec.ts`,
  `docs/BUILD_PLAN.md`.

## ⚠ Uncommitted work in the tree (NOT mine — leave it for its owner)
The "welcome banner setting" fix is half-finished and uncommitted: `src/db/notifications.ts`,
`src/db/schema.ts`, `web-worker/src/index.ts`, `web/src/api.ts`,
`web/src/components/notifications/{NotificationsHost,WelcomeBanner}.tsx`,
`drizzle/0012_welcome_banner_setting.sql`, `src/logic/welcomeBanner.{ts,test.ts}`.
I only added a `tap-44` class to WelcomeBanner's ✕. The file was being edited WHILE I worked
(3 of my TeamChat edits got reverted once and were re-applied — re-check before committing).

## Owner steps that are still open
1. Access service token for the desktop app (Zero Trust → Service Auth).
2. Desktop 1-hour auto-logout (owner has not answered).
3. The Roasting screen is still missing in the desktop app.
4. Deploy the new web bundle when wanted: `cd web && npm run build && cd ../web-worker && npx wrangler deploy`.

## Blockers
- Desktop chat → Worker blocked by Cloudflare Access until a service token exists.
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (466) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (34, mocked worker)
- Responsive check: `npx playwright test --config playwright.web.config.ts e2e-web/responsive.spec.ts`
- Deploy: `cd web && npm run build && cd ../web-worker && ./node_modules/.bin/wrangler deploy` (ask first)
