# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by Claude Code
Tool: Claude Code

## Current state
**LIVE version `1081f422-69d7-42a6-9898-154d686ce569` (2026-11-07) = commit `e736463`: T-16.1 line breaks
(bubble `pre-wrap`, web + desktop) on top of mobile & PWA polish, AI polish, message editing.** Deployed
from a clean worktree — the uncommitted T-16.2 work in `web/src/components/TeamChat.tsx` is NOT live. The web edition is now an
installable PWA with default-on message notifications. Live app:
https://sdhhe-api.blvphani.workers.dev (behind Cloudflare Access — curl 302s to
sdhhe.cloudflareaccess.com; verify inside the app, ideally on the phone).

## What is in this deploy (mobile & PWA, 2026-11-07)
- **PWA**: manifest + generated icons (192/512/maskable + apple-touch-icon + favicon.svg) + Apple
  meta. Android: Chrome offers "Install app"; iPhone: Share → Add to Home Screen. The service
  worker is now actually registered (it existed but was never registered — push could not work).
- **Notifications ON BY DEFAULT**: after sign-in the app asks once and subscribes (re-syncs on
  every login; a denial is never nagged again; 🔔 in Team Chat = the manual switch). Group
  messages push to the group's members ("X wrote in <group>"); direct chats never push.
- **Notification tap → the chat** (`/team-chat?notify=1`); a plain /team-chat address still opens
  the Dashboard (always-Dashboard rule).
- **Blank login on phones fixed**: the Google-Fonts CSS no longer blocks the first paint + an
  inline boot splash (brand + pulse) shows while the bundle loads.
- **WhatsApp-style keyboard**: on touch phones the return key = new line, send button sends
  (desktop keeps Enter-to-send); compact mobile chat header.
- e2e race fixed (welcome banner): the login-flag test helper now sets the flag once per tab.

## Test status
486 unit (2 int-suites skip without DATABASE_URL_TEST) · 46/46 e2e-web · tsc clean
root/web/worker. No DB migration in this deploy (0016/0017 were applied last time).

## Owner steps that are still open
1. On the iPhone: open the site → Share → **Add to Home Screen** → allow notifications when
   asked — that is the only way iOS allows push (in-Safari push does not exist on iOS).
2. Desktop chat → Worker blocked by Cloudflare Access until a service token exists.
3. Desktop 1-hour auto-logout (owner has not answered). 4. Roasting screen missing in desktop.

## Next task ideas (BUILD_PLAN)
- T-14.4 leftovers: initials avatar for groups, floating chat panel group list.
- T-14.5 live two-user e2e (needs the deployed worker).
- Optional: grant staff the Dashboard permission (Roles screen) so the default screen is the
  dashboard for them too.

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (486) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (46, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
  (apply any new drizzle/00NN_*.sql to the DB FIRST — the worker selects the new columns)
