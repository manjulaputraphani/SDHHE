# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-06 by OpenCode
Tool: OpenCode

## Current state
**Phase 12 (Team Chat + receipt approval) is code-complete AND deployed** — T-12.0 … T-12.8 done and committed.
Live worker version `a86fa809-a19f-4d77-8ab5-791d6864a045` (2026-11-06 10:46) — the chat, the live room and the
approvals are live at https://sdhhe-api.blvphani.workers.dev/team-chat (web bundle `index-DlxGjY5K.js`).
**The live build has NO R2 binding** (R2 is not enabled on the account) → attaching a receipt file answers
503 "Receipt storage is not configured"; everything else works.
**Remember**: `cd web && npm run build` before every deploy — the Worker uploads `web/dist`, so a change
in the web app is only live after a rebuild (the 1-hour chat-token fix needed two deploys because of this).
**Sign-on rule**: the web signs out after an hour of inactivity (sliding window) — and the chat now
follows it: the web chat token lives 1 h (refreshed every 30 min), an expired token is refused at the
door and an open socket is closed when its token runs out. The desktop token lives 12 h (the desktop
session has no timeout — it locks on request; see "Next tasks").
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Migrations applied to Neon: `0001`…`0006_team_chat.sql` (chat tables exist, 0 rows).

## Done (Phase 12)
- **Deployed** (2026-11-06) — `wrangler deploy` (DO migration `v1`, `new_sqlite_classes` — the free plan needs
  the SQLite form, not `new_classes`), assets + the chat screen. Two fixes came out of the deploy: the
  Durable Object migration tag and the missing R2 binding (temporarily commented out for this deploy only).
- **T-12.8 desktop + Playwright** (committed `11ad1d7`) — `src/pages/TeamChat.tsx` (route `/team-chat`), `src/lib/chatClient.ts`, Settings → **Team Chat** (worker address in `settings.chat_worker_url`), the chat token is fetched at sign-in and kept in the Keychain (`CHAT_TOKEN`), `e2e-web/team-chat.spec.ts` + `playwright.web.config.ts` (`npm run test:e2e:web`) — 5/5 green, no DB needed.
- **T-12.7 Gmail SMTP + ntfy** (committed `842cf99`) — `web-worker/src/mailer.ts` (SMTP over `cloudflare:sockets`, 15 s timeout), `smtpSocket.ts`, `chatMail.ts`; fires when a receipt is submitted and when it is decided. Verified end to end against `scripts/local-smtp-server.mjs`.
- **T-12.6 web screen** (committed `a5949a0`) — `web/src/components/TeamChat.tsx`, the `/team-chat` path, `scripts/local-web-chat-check.mjs` (10/10).
- **T-12.5 worker API** (committed `1f5d151`) — messages, receipts, decisions, `/api/chat/auth`; `scripts/local-chat-api-check.mjs` (13/13).
- **T-12.4 Durable Object** (committed `60b1289`) — `web-worker/src/chat/do.ts` (WebSocket Hibernation API), `protocol.ts`.
- **T-12.3 R2 receipts** (committed `70d0815`) — `web-worker/src/receipts.ts` + upload/download routes.
- **T-12.2 shared logic** (committed `be66187`) — `src/logic/sha256.ts`, `chatToken.ts`, the `chat` permission module.
- **T-12.1 tables** (committed `0dcdc27`) — `chat_messages`, `receipt_requests` in Neon.
- **T-12.0 plan** (committed `d8b5a17`) — Phase 12 in `docs/BUILD_PLAN.md`, `docs/chat-in-app-preview.html`, decisions.
- **Prompts** (committed `20db07e`) — `prompts/TEAM_CHAT_ALL.md` (spec), `prompts/SESSION_ALL.md`.

## Next tasks
1. **Owner question**: should the **desktop** app also sign out after an hour of inactivity? Today it only
   locks when "Lock now" is pressed (the web signs out on its own). The desktop chat token lives 12 h
   because of that.
2. The Roasting screen is still missing in the desktop app (only the web has it).

## Owner steps that are still open
1. **Enable R2** (dashboard) — `npx wrangler r2 bucket list` still says "Please enable R2 through the Cloudflare Dashboard" (code 10042). Then `cd web-worker && npx wrangler r2 bucket create sdhhe-receipts` and `npx wrangler deploy` again (the R2 binding is already in `web-worker/wrangler.toml`).
2. **Set the mail secrets**: `cd web-worker && npx wrangler secret put SMTP_USER` · `SMTP_PASS` (a Gmail **App Password**) · `NTFY_TOPIC`. (The mail is skipped quietly until they are set.)
3. **Desktop**: Settings → Team Chat → paste `https://sdhhe-api.blvphani.workers.dev`, sign out, sign in again.
4. **Role check**: Team → Roles & permissions → the new **Team Chat** module (staff view+create, CA view+create+edit, owner all).
5. Optional: the deployed `SESSION_SECRET` is NOT the one in `web-worker/.dev.vars`, so the local check scripts cannot sign in to the live worker — put the same value in `.dev.vars` if that is wanted.

## Commands
- Tests: `npx vitest run --reporter=dot` (411) · `npx tsc --noEmit` · `cd web && npm run typecheck` · `cd web-worker && npx tsc --noEmit`
- Playwright (web, mocked): `npm run test:e2e:web` · desktop e2e needs `DATABASE_URL_TEST`
- Local worker: `cd web-worker && npx wrangler dev` · web: `cd web && npm run dev`
- Local checks: `node scripts/local-chat-api-check.mjs` · `local-web-chat-check.mjs` · `local-receipt-check.mjs` · `local-chat-check.mjs`
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy` (ask the owner first)

## Blockers
- R2 is not enabled on the Cloudflare account (the control plane answered 503 "no healthy upstream" for a while on 2026-11-06 and came back later).
- The three mail secrets are **not** on the worker (`wrangler secret list` shows only DATABASE_URL, OLLAMA_API_KEY, RESEND_API_KEY, SESSION_SECRET).
- The real Gmail delivery and the live R2 bucket are therefore untested — everything else was verified locally (worker + Neon + browser).
- `prompts/TEAM_CHAT_ALL.md` and `docs/chat-in-app-preview.html` were missing from the repo; both were written (2026-11-06).
- Owner login: account id=1, phone `7569208757`, active.
