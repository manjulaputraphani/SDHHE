# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-06 by OpenCode
Tool: OpenCode

## Current state
Phase 12 (Team Chat + receipt approval) in progress — T-12.0 … T-12.4 done and committed.
**Open: the live R2 bucket still has to be created** (Cloudflare control-plane API was 503 all morning).
Web LIVE: https://sdhhe-api.blvphani.workers.dev (worker `sdhhe-api`, all four secrets set) · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Migrations applied to Neon: `0001`…`0006_team_chat.sql` (chat tables exist, 0 rows).

## Done
- **T-12.4 Durable Object room** (committed) — `web-worker/src/chat/do.ts` (`ChatRoom`, WebSocket Hibernation API, presence, ping/pong, no DB writes), `web-worker/src/chat/protocol.ts` (+9 tests), `scripts/local-chat-check.mjs`; the Worker got `/api/chat/ws` (upgrade → DO) and `/api/chat/token` (session → chat token). Verified locally: `hello` + `presence` frames, a bad token is turned away. `@cloudflare/workers-types` (dev) added; the Worker now uses the root's drizzle/neon/zod (one copy).
- **T-12.3 R2 receipts** (committed `70d0815`) — `web-worker/src/receipts.ts` (+16 tests), `[[r2_buckets]] RECEIPTS` binding, `POST /api/chat/receipts` (multipart) and `GET /api/chat/receipts/<base64url key>`; local check `scripts/local-receipt-check.mjs` → "upload + download OK (bytes match)". **Live bucket still missing** (see Blockers).
- **T-12.2 shared chat logic** (committed `be66187`) — `src/logic/sha256.ts`, `src/logic/chatToken.ts`, receipt state machine, `chat` permission module.
- **T-12.1 chat tables + DB module** (committed `0dcdc27`) — `chat_messages` + `receipt_requests` in Neon, `src/db/chat.ts`, `scripts/apply-sql.mjs`.
- **T-12.0 plan** (committed `d8b5a17`) — Phase 12 in `docs/BUILD_PLAN.md`, preview `docs/chat-in-app-preview.html`, decisions in `docs/DECISIONS.md`.
- **Prompts** (committed `20db07e`) — `prompts/TEAM_CHAT_ALL.md` (Phase 12 spec + master prompt) and `prompts/SESSION_ALL.md`.

## Next task
**T-12.5 Worker chat + approval API** — `GET/POST /api/chat/messages`, `POST /api/chat/auth` (phone + password → token), `GET /api/chat/receipts`, `POST /api/chat/receipts/:id/decision`, the `chat` permissions on the routes, and `broadcastToChat` after every write.

## Planned Phase 12 order
T-12.5 worker chat API → T-12.6 web `/team-chat` screen → T-12.7 Gmail SMTP + ntfy (needs SMTP_USER / SMTP_PASS / NTFY_TOPIC) → T-12.8 desktop `/team-chat` + Settings Worker URL + Playwright.

## Commands
- Tests: `npx vitest run --reporter=dot` (356) · `npx tsc --noEmit` · web: `cd web && npm run typecheck`
- Worker typecheck: `cd web-worker && npx tsc --noEmit`
- Desktop: `npm run tauri dev` · Web build: `cd web && npm run build`
- Worker dev: `cd web-worker && npx wrangler dev` (uses `.dev.vars`: DATABASE_URL, SESSION_SECRET)
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy`
- Apply a migration: `node scripts/apply-sql.mjs drizzle/0006_team_chat.sql`

## Blockers
- **Live R2 bucket missing**: `npx wrangler r2 bucket list` still answers "Please enable R2 through the Cloudflare Dashboard" (code 10042) and every other control-plane call returned 503 "no healthy upstream" on 2026-11-06 (the data plane was fine — the worker answered /api/health). Retry `npx wrangler r2 bucket create sdhhe-receipts` before the deploy; if it still refuses, the owner has to switch R2 on in the dashboard.
- `prompts/TEAM_CHAT_ALL.md` and `docs/chat-in-app-preview.html` were missing from the repo — both now exist (TEAM_CHAT_ALL.md written 2026-11-06 as the Phase 12 master prompt + spec; the preview file created in T-12.0).
- `sdhhe-api.DATABASE_URL` is not readable/verifiable, but login probes confirm the worker sees the same DB as the local `.env`.
- Owner login: account id=1, phone `7569208757`, active.
