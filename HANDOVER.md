# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-06 by OpenCode
Tool: OpenCode

## Current state
**Phase 12 (Team Chat) and Phase 13 (Direct chat) are code-complete AND deployed.**
Live worker version `22af8463-5234-46c9-8d00-0faacbbe2de3` (2026-11-06 12:46) — web bundle `index-0zs2fwLa.js`.
Live: https://sdhhe-api.blvphani.workers.dev/team-chat (shop room + private chats).
**The live build has NO R2 binding** (R2 is not enabled on the account) → attaching a receipt file answers
503 "Receipt storage is not configured"; everything else works.
**Remember**: `cd web && npm run build` before every deploy — the Worker uploads `web/dist`.
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Neon migrations applied: `0001`…`0007_direct_chat.sql` (chat tables exist, 0 rows).

## Done
- **Phase 15 — the in-app notification system** (committed, deployed `22af8463`): the 7 components (welcome
  banner, onboarding checklist, announcement bar, toasts, "what's new" window, product tour, login alert) +
  the sessions (30-minute idle logout, one device at a time, "sign out everybody", the login history, the
  5-minute warning toast) + the public read counts in the chat. Migration `0009_notifications.sql` applied.
  `src/db/notifications.ts` + the API in the worker + `web/src/components/notifications/*` +
  `web/src/components/AnnouncementsAdmin.tsx`. Local checks: session **10/10**, notifications **18/18**;
  Playwright (web) **17/17**; 445 unit tests. The product tour is **written from scratch — no new dependency**
  (Driver.js/Shepherd.js need your OK).
- **The sessions are fixed** (committed, deployed `8fa63ad3`): the chat screen's 30-minute token refresh was
  **sliding the one-hour idle window**, so the members sitting on the chat screen were never signed out — a
  background call now carries `X-Chat-Refresh: 1` and the Worker does not re-issue the cookie for it. The
  desktop app had **no timeout at all** → it now signs itself out after an hour of inactivity. New: the
  **session epoch** (`session_epoch` in the settings) — the owner can **sign everybody out** at once
  (`POST /api/auth/logout-all`, the web Settings has a "Sign out everybody now" button). **The epoch was
  bumped to 3 on 2026-11-06 → every member who was signed in is signed out now.** Local session check 10/10.
- **Group rename (owner only)** (committed, deployed `cb638c5a`): the admin renames the shop room inline in the
  room header (`POST /api/chat/rename`, role `owner`; staff get 403). The name is pushed into the room as a
  "rename" frame, so every member sees it at once; a private chat keeps the name of the person. Local check
  `scripts/local-rename-check.mjs` 4/4, Playwright 11/11, 445 unit tests.
- **Phase 14 — modern chat + delivered/read ticks** (committed, deployed `7c4965bb`): grouped bubbles with
  avatars and tails, ✓ / ✓✓ / ✓✓✓ ticks (gold = read) on my own messages, a typing indicator in the room
  header, a jump-to-bottom button with the missed count, a friendly empty state — the drawing rules are shared
  (`src/logic/chatView.ts`) so the web and the desktop look the same. The state lives in
  `chat_message_states` (migration `0008_message_states.sql`); `POST /api/chat/delivered` and `/api/chat/read`
  write the marks and push a frame into the room. Local tick check 7/7, Playwright 9/9.
- **Phase 13 — direct chat** (committed, deployed): T-13.1 conversations + unread (`chat_conversations`,
  `chat_conversation_members`), T-13.2 room-scoped API (conversations/members/read/messages, membership → 403),
  T-13.3 one Durable Object per room, T-13.4 web conversation list + New chat + Export, T-13.5 desktop the same,
  T-13.6 privacy (private chats stay private; the activity log never holds the text) + export,
  T-13.7 tests + deploy. **433 unit tests, tsc clean (app/web/worker), Playwright 7/7.**
- **Phase 12 — Team Chat** (committed, deployed): T-12.0…T-12.8 (tables, shared logic, R2 receipts,
  the Durable Object room, the worker API, the web screen, Gmail SMTP + ntfy, the desktop screen + Playwright).
- **CI** (green, run `42210397381`): the two flaky Settings tests are fixed (timeout 30 s + `waitFor` after the
  click) and the workflow now typechecks the web app and the worker too.
- The **sign-on rule**: the web signs out after an hour of inactivity and the chat follows it (the web chat
  token lives 1 h, refreshed every 30 min; an expired token is refused at the door; an open socket is closed
  when its token runs out). The desktop token lives 12 h (the desktop session has no timeout).

## Fixed after the first direct-chat deploy
`unreadCount()` used the aliases `c` / `cm` inside a hand-written SQL fragment, but Drizzle's query builder
generates the FROM clause **without** them → Postgres refused it → `POST /api/chat/read` answered 500 (the
unread badge still looked right, it comes from another query). Fixed with the qualified columns + a comment;
the local check now asserts the **status** of the read calls. Deployed as `63e9d95f`.

## GitHub Actions
The `test` workflow (npm ci → typecheck → unit tests) is **green** on `main` (run `42210397381`, commit
`7414b04`). Two flaky Settings tests were the cause of every failed run: "validates the new PIN format and
match" hit Vitest's 5 s default (the Settings screen re-renders everything on every keystroke → 2.3–3.1 s
locally, more on a loaded runner) and "owner sees members and can add one" asserted right after the click,
before the async handler had run. Fixed: the assertions now wait (`waitFor`), and the timeout is 30 s
(`testTimeout` in `vite.config.ts` + the describe block in `src/pages/Settings.test.tsx`). The workflow now also
typechecks the **web app** and the **Cloudflare Worker** (they were never checked in CI).
To read the runs: `python3 scripts/gh-runs.py [jobs <run id>]` · the job log: `scripts/gh-job-log.sh <job id>`.

## Owner steps that are still open
1. **Enable R2** (dashboard) — `npx wrangler r2 bucket list` still says "Please enable R2 through the Cloudflare
   Dashboard" (code 10042). Then `cd web-worker && npx wrangler r2 bucket create sdhhe-receipts` and
   `npx wrangler deploy` again (the binding is already in `web-worker/wrangler.toml`).
2. **Set the mail secrets**: `cd web-worker && npx wrangler secret put SMTP_USER` · `SMTP_PASS` (a Gmail **App
   Password** — only the owner can create it, and it must be typed into the terminal, never into the chat).
   ✅ `NTFY_TOPIC` is already set (the push topic `sdhhe-team-683c7d880f68`).
3. **Desktop**: Settings → Team Chat → paste `https://sdhhe-api.blvphani.workers.dev`, sign out, sign in again.
4. **Role check**: Team → Roles & permissions → the new **Team Chat** module (staff view+create, CA
   view+create+edit, owner all).
5. Optional: the deployed `SESSION_SECRET` is NOT the one in `web-worker/.dev.vars`, so the local check scripts
   cannot sign in to the live worker — copy the deployed value into `.dev.vars` if that is wanted.

## Next tasks
1. **Desktop 1-hour auto-logout** — the desktop app still only locks via *Lock now* (the web signs out on its
   own). The owner has not answered yet.
2. The Roasting screen is still missing in the desktop app (only the web has it).
3. Audit the 16 stale unticked boxes in `docs/BUILD_PLAN.md` (most are done) + `T-6.3` Excel/PDF export.

## Commands
- Tests: `npx vitest run --reporter=dot` (433) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (Playwright, mocked worker)
- Local worker: `cd web-worker && npx wrangler dev` · web: `cd web && npm run build && cd .. && cd web && npm run dev`
- Local checks: `scripts/local-chat-api-check.mjs` · `local-direct-chat-check.mjs` · `local-web-chat-check.mjs` ·
  `local-receipt-check.mjs` · `local-session-check.mjs` · `local-chat-check.mjs`
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy` (ask the owner first)

## Blockers
- R2 is not enabled on the Cloudflare account (the control plane also answered 503 "no healthy upstream" for a
  while on 2026-11-06).
- The three mail secrets are **not** on the worker (`wrangler secret list` shows only DATABASE_URL,
  OLLAMA_API_KEY, RESEND_API_KEY, SESSION_SECRET).
- `prompts/TEAM_CHAT_ALL.md` and `docs/chat-in-app-preview.html` were missing from the repo; both were written.
- Owner login: account id=1, phone `7569208757`, active.
