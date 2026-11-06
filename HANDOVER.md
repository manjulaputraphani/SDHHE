# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-06 by OpenCode
Tool: OpenCode

## Current state
**Phase 12 (Team Chat) and Phase 13 (Direct chat) are code-complete AND deployed.**
Live worker version `8323fdfb-7e47-4003-a9e7-10d0e720077a` (2026-11-06 11:14) — web bundle `index-C5y3EWZo.js`.
Live: https://sdhhe-api.blvphani.workers.dev/team-chat (shop room + private chats).
**The live build has NO R2 binding** (R2 is not enabled on the account) → attaching a receipt file answers
503 "Receipt storage is not configured"; everything else works.
**Remember**: `cd web && npm run build` before every deploy — the Worker uploads `web/dist`.
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Neon migrations applied: `0001`…`0007_direct_chat.sql` (chat tables exist, 0 rows).

## Done
- **Phase 13 — direct chat** (committed, deployed): T-13.1 conversations + unread (`chat_conversations`,
  `chat_conversation_members`), T-13.2 room-scoped API (conversations/members/read/messages, membership → 403),
  T-13.3 one Durable Object per room, T-13.4 web conversation list + New chat + Export, T-13.5 desktop the same,
  T-13.6 privacy (private chats stay private; the activity log never holds the text) + export,
  T-13.7 tests + deploy. **433 unit tests, tsc clean (app/web/worker), Playwright 7/7.**
- **Phase 12 — Team Chat** (committed, deployed): T-12.0…T-12.8 (tables, shared logic, R2 receipts,
  the Durable Object room, the worker API, the web screen, Gmail SMTP + ntfy, the desktop screen + Playwright).
- The **sign-on rule**: the web signs out after an hour of inactivity and the chat follows it (the web chat
  token lives 1 h, refreshed every 30 min; an expired token is refused at the door; an open socket is closed
  when its token runs out). The desktop token lives 12 h (the desktop session has no timeout).

## Owner steps that are still open
1. **Enable R2** (dashboard) — `npx wrangler r2 bucket list` still says "Please enable R2 through the Cloudflare
   Dashboard" (code 10042). Then `cd web-worker && npx wrangler r2 bucket create sdhhe-receipts` and
   `npx wrangler deploy` again (the binding is already in `web-worker/wrangler.toml`).
2. **Set the mail secrets**: `cd web-worker && npx wrangler secret put SMTP_USER` · `SMTP_PASS` (a Gmail **App
   Password**) · `NTFY_TOPIC`. (The mail is skipped quietly until they are set.)
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
