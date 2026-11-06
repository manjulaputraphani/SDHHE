# SESSION_ALL — one full working session in this repo

Paste this at the start of a session that should carry on from wherever the last
one stopped, do the next task properly, and leave the repo ready for the next
agent (or for you) to pick up.

---
Run a full session in this repo.

1. START (in this order, do not skip):
   - Read AGENTS.md and HANDOVER.md. HANDOVER is the state — do not re-read the whole repo.
   - Run `git log --oneline -5` and `git status --short` (no full diffs).
   - Open docs/BUILD_PLAN.md, find the task named in HANDOVER "Next task", read ONLY that task
     and the files it lists. Need more? Read that one file, not whole folders.
   - Say in 2 lines: which task, what you will change. Then do it.
   - If the last session died without a handover, follow prompts/RECOVER.md instead.

2. WORK (one task at a time — task IDs like T-3.2):
   - Write/update the tests FIRST for logic (fifo, stats, money, parsing), then the code, then run.
   - Money = integer paise. Quantity = integer base units. NEVER floats.
   - Small diffs: edit existing files, do not rewrite whole files unless asked.
   - Never hard-code secrets (Neon URL, PIN, API keys). Use the placeholder `DATABASE_URL`.
   - Never read or print: node_modules, src-tauri/target, dist, package-lock.json, *.db, .env.
   - Do not add a library without writing the reason in docs/DECISIONS.md.
   - If a command fails the same way twice: STOP, write the error into HANDOVER "Blockers" and ask.

3. VERIFY (all of these, every task):
   - `npx vitest run --reporter=dot` (quiet — it saves tokens)
   - `npx tsc --noEmit` (app) — plus `cd web && npm run typecheck` and `cd web-worker && npx tsc --noEmit`
     when those changed
   - The acceptance criteria of the task in docs/BUILD_PLAN.md are met

4. FINISH the task:
   - Tick its box in docs/BUILD_PLAN.md and add a one-line note with what was actually built
   - Rewrite HANDOVER.md from its template (under 60 lines): current state, done, next task,
     commands, blockers. History lives in git — do not paste it back in.
   - Commit: `T-x.y: <short summary>`

5. STOP CONDITIONS (ask me, do not guess):
   - a deploy or any destructive database change
   - a secret or account setting only I can do (R2, wrangler login, `wrangler secret put`)
   - the same error twice
   - context ~70% used → update HANDOVER.md, commit "wip: <task id> handover", stop

6. END: reply with what changed, the test result and the next exact step. No essays.
---

## Repo rules that are easy to forget

- Stack: Tauri 2 + React + TypeScript + Vite + Tailwind | Neon Postgres (Drizzle ORM) |
  Vitest + React Testing Library | the web edition is `web/` + the `web-worker/` Cloudflare Worker.
- `npx drizzle-kit push` cannot run from an agent (it wants a TTY) — the same DDL is applied by
  hand: `node scripts/apply-sql.mjs drizzle/00XX_name.sql` (one statement per request, and the
  script refuses DROP/TRUNCATE/DELETE unless `--force` is passed).
- The Neon project is shared with another app: only the lowercase tables in `src/db/schema.ts`
  are ours. Never touch the CamelCase tables or `sdhhe_fy2025`.
- DB tests need `DATABASE_URL_TEST` (a different database than `DATABASE_URL`); without it they
  skip instead of failing. The Playwright suite in `e2e/` needs the same variable.
- Every write logs to `activity_log` (actor + event + summary) inside the same transaction.
- Colour: the app has one palette (coffee brown / caramel gold / sage on warm cream). Use the
  CSS variables in `src/App.css` / `web/src/styles.css` — never a new hex in a component.
- Money and quantity are integers everywhere; `formatRupees` / `formatQuantity` do the display.

## Where things are

| | |
|---|---|
| Spec & data model | `docs/BLUEPRINT.md` |
| Tasks & acceptance criteria | `docs/BUILD_PLAN.md` |
| Test cases | `docs/TESTING.md` |
| Setup / installs | `docs/SETUP.md` |
| Decisions log | `docs/DECISIONS.md` |
| Token-saving rules | `docs/TOKEN_SAVING.md` |
| Workstream prompts | `prompts/TEAM_CHAT_ALL.md`, `prompts/RECOVER.md`, `prompts/END_SESSION.md` |

## Commands

```
npx vitest run --reporter=dot       # tests (quiet)
npx vitest run src/logic/fifo.test.ts --reporter=dot
npx tsc --noEmit                    # types (app)
cd web && npm run typecheck         # types (web)
cd web-worker && npx tsc --noEmit   # types (worker)
npm run tauri dev                   # desktop app
cd web && npm run build             # web build
cd web-worker && npx wrangler dev   # worker locally
cd web-worker && ./node_modules/.bin/wrangler deploy   # deploy (ask first)
```
