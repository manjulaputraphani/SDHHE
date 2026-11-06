# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-06 by OpenCode
Tool: OpenCode

## Current state
Phase 12 (Team Chat + receipt approval) in progress — T-12.0, T-12.1 and T-12.2 done and committed.
**STOPPED before T-12.3: R2 is not enabled on the Cloudflare account** (owner action needed).
Web LIVE: https://sdhhe-api.blvphani.workers.dev (worker `sdhhe-api`, all four secrets set) · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Migrations applied to Neon: `0001`…`0006_team_chat.sql` (chat tables exist, 0 rows).

## Done
- **T-12.2 shared chat logic** (committed `be66187`) — `src/logic/sha256.ts` (SHA-256 + HMAC + base64url, RFC 4231 vectors), `src/logic/chatToken.ts` (HMAC chat token, 12 h TTL), `src/logic/chat.ts` (receipt state machine, badges, labels), new `chat` permission module (owner all / CA view+create+edit / staff view+create). 356 tests pass, tsc clean.
- **T-12.1 chat tables + DB module** (committed `0dcdc27`) — `chat_messages` + `receipt_requests` in Neon, `src/db/chat.ts`, `src/logic/chat.ts` (limits), `scripts/apply-sql.mjs` (one statement per request; refuses DROP/TRUNCATE without `--force`).
- **T-12.0 plan** (committed `d8b5a17`) — Phase 12 in `docs/BUILD_PLAN.md`, design preview `docs/chat-in-app-preview.html`, 7 decisions in `docs/DECISIONS.md`.
- **Web visual refresh / rotation / purchases edit / roasting** (2026-11-05) — see git log.
- **Web email LIVE** (2026-11-04): RESEND_API_KEY set (old notification path only — Phase 12 mail uses Gmail SMTP).
- **Session security — web edition** (2026-11-05): 1-hour inactivity auto-logout, 24-hour login-without-logout check.

## Next task
**T-12.3 Receipt files in R2** — `[[r2_buckets]]` binding `RECEIPTS` in `web-worker/wrangler.toml`, `web-worker/src/receipts.ts` (upload → key `receipts/<date>/<id>.<ext>`, image/PDF only, 4 MB cap, download streams the object), key building + validation tested. Blocked until R2 is enabled (see Blockers).

## Planned Phase 12 order
T-12.3 R2 receipts → T-12.4 Durable Object room → T-12.5 worker chat API → T-12.6 web `/team-chat` screen → T-12.7 Gmail SMTP + ntfy (needs SMTP_USER / SMTP_PASS / NTFY_TOPIC) → T-12.8 desktop `/team-chat` + Settings Worker URL + Playwright.

## Commands
- Tests: `npx vitest run --reporter=dot` (356) · `npx tsc --noEmit` · web: `cd web && npm run typecheck`
- Worker typecheck: `cd web-worker && npx tsc --noEmit`
- Desktop: `npm run tauri dev` · Web build: `cd web && npm run build`
- Worker dev: `cd web-worker && npx wrangler dev` (uses `.dev.vars`: DATABASE_URL, SESSION_SECRET)
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy`
- Apply a migration: `node scripts/apply-sql.mjs drizzle/0006_team_chat.sql`

## Blockers
- **R2 not enabled**: `npx wrangler r2 bucket list` → "Please enable R2 through the Cloudflare Dashboard" (code 10042). Wrangler itself IS logged in (OAuth, blvphani@gmail.com, account `0a3450b9c7a5e5ca53ce168a6fe33b41`) — only the R2 switch is missing. Owner must enable R2 in the dashboard, then `npx wrangler r2 bucket create sdhhe-receipts`.
- `prompts/TEAM_CHAT_ALL.md` and `docs/chat-in-app-preview.html` were missing from the repo — both now exist (TEAM_CHAT_ALL.md written 2026-11-06 as the Phase 12 master prompt + spec; the preview file created in T-12.0).
- `sdhhe-api.DATABASE_URL` is not readable/verifiable, but login probes confirm the worker sees the same DB as the local `.env`.
- Owner login: account id=1, phone `7569208757`, active.
