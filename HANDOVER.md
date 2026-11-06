# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**LIVE version `e6966118-24d8-4590-8782-9caa4fee31ec` (2026-11-07) — Phase 15 AI polish +
message editing + always-Dashboard + 12h AM/PM times.** DB migrations applied BEFORE the deploy and
verified: `chat_conversations.ai_polish` (0016) + `chat_messages.ai_polished` (0017).
Live app: https://sdhhe-api.blvphani.workers.dev (behind Cloudflare Access — curl 302s to
sdhhe.cloudflareaccess.com; verify inside the app). Desktop = Tauri app in `src/` (untouched).

## What is in this deploy
- **AI polish (T-15.1–15.4)**: owner switches it per group (header menu → "AI polish messages");
  everyone sees the "✨ AI polish on" chip. In those rooms Send/Enter opens a preview card
  ("✨ Suggested") — [Send suggested] [Send original] [Edit], Esc cancels; failure = "AI not
  available — send original?"; sent messages carry `ai_polished` → bubble shows ✨. Worker:
  POST /api/chat/polish (Ollama Cloud, key stays in the Worker; skip <15 chars/emoji-only; 8 s
  timeout → {polished:null}; 30/user/h; numbers guard falls back to the original).
- **Message editing finished** (was half-committed — no route, no UI): PATCH /api/chat/messages/:id
  (author-only), `update` frame live-swaps the text; tap your own text bubble to edit; "edited"
  mark (edited_at > created_at). PATCH bodies now parsed in the worker.
- **Always Dashboard**: a cold open lands on the Dashboard even from /team-chat (the URL settles
  to /); push-notification links to /team-chat now open the app on the Dashboard.
- **12-hour times**: formatChatTime → "09:42 AM" / "03:05 PM" (browser-local) in bubbles + list.
- Tests: 486 unit (2 int-suites skip without DATABASE_URL_TEST), 45/45 e2e-web, tsc clean
  root/web/worker. e2e mocks cover the new routes (groups/polish, chat/polish, PATCH message).

## Owner steps that are still open
1. Try it signed in: Team Chat → ⋮ menu → "AI polish messages — on", then type a draft in the
   shop room; tap one of your own bubbles to edit it.
2. Desktop chat → Worker blocked by Cloudflare Access until a service token exists.
3. Desktop 1-hour auto-logout (owner has not answered). 4. Roasting screen missing in desktop.

## Next task ideas (BUILD_PLAN)
- T-14.4 leftovers: initials avatar for groups, floating chat panel group list.
- T-14.5 live two-user e2e (needs the deployed worker; receipts-from-groups approval flow).
- Optional: grant staff the Dashboard permission (Roles screen) so the default screen is the
  dashboard for them too (roles without it still fall to their first allowed screen).

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (486) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (45, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
  (apply any new drizzle/00NN_*.sql to the DB FIRST — the worker selects the new columns)
