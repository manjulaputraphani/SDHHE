# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-06 by OpenCode
Tool: OpenCode

## Current state
Phase 12 (Team Chat + receipt approval) in progress — T-12.0 and T-12.1 done.
Web LIVE: https://sdhhe-api.blvphani.workers.dev (worker `sdhhe-api`, all four secrets set) · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
DB is empty of demo data (22 app tables + the 2 new chat tables, 0 rows).
Migrations applied to Neon: `0001`…`0006_team_chat.sql`.

## Done
- **T-12.0 plan** (committed) — Phase 12 written into `docs/BUILD_PLAN.md`, design preview `docs/chat-in-app-preview.html` (uses only `src/App.css` tokens), 7 Phase-12 decisions in `docs/DECISIONS.md`.
- **T-12.1 chat tables + DB module** — `chat_messages` + `receipt_requests` in Neon (0 rows), `src/db/schema.ts`, `src/db/chat.ts` (zod parsing + persistence), `src/logic/chat.ts` (limits: 2000 chars, 4 MB, image/PDF), `src/db/chat.test.ts` (18), `src/logic/chat.test.ts` (8), `src/db/chat.int.test.ts` (skips without `DATABASE_URL_TEST`), `scripts/apply-sql.mjs` (one statement per request, refuses DROP/TRUNCATE without `--force`). 328 tests pass, tsc clean.
- **Web visual refresh / rotation / purchases edit / roasting** (2026-11-05) — see git log.
- **Web email LIVE** (2026-11-04): RESEND_API_KEY set, test mail delivered (old notification path only — Phase 12 mail uses Gmail SMTP).
- **Session security — web edition** (2026-11-05): 1-hour inactivity auto-logout, 24-hour login-without-logout check, `sdhhe:unauthorized` event.
- **Supplier dues / working capital / roasting / HSN** — all committed, see git log.

## Next task
**T-12.2 Shared chat logic** — `src/logic/chat.ts` grows the approval state machine, the permission helper (`chat:edit`), badges and time formatting; new `src/logic/chatToken.ts` (short-lived HMAC chat token for the desktop app). Tests first.

## Planned Phase 12 order
T-12.2 shared logic → T-12.3 R2 receipts (**owner must create the R2 bucket first**) → T-12.4 Durable Object room → T-12.5 worker chat API → T-12.6 web `/team-chat` screen → T-12.7 Gmail SMTP + ntfy (**owner must set SMTP_USER / SMTP_PASS / NTFY_TOPIC**) → T-12.8 desktop `/team-chat` + Settings Worker URL + Playwright.

## Commands
- Tests: `npx vitest run --reporter=dot` (328) · `npx tsc --noEmit` · web: `cd web && npm run typecheck`
- Worker typecheck: `cd web-worker && npx tsc --noEmit`
- Desktop: `npm run tauri dev` · Web build: `cd web && npm run build`
- Worker dev: `cd web-worker && npx wrangler dev` (uses `.dev.vars`: DATABASE_URL, SESSION_SECRET)
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy`
- Apply a migration: `node scripts/apply-sql.mjs drizzle/0006_team_chat.sql`

## Blockers
- `prompts/TEAM_CHAT_ALL.md` and `docs/chat-in-app-preview.html` did not exist in the repo — the Phase 12 task split is the plan written in `docs/BUILD_PLAN.md` (T-12.0), and the preview file was created there.
- `sdhhe-api.DATABASE_URL` is not readable/verifiable, but login probes confirm the worker sees the same DB as the local `.env`.
- Owner login: account id=1, phone `7569208757`, active.
