# TEAM_CHAT_ALL — Team Chat + receipt approval (Phase 12)

Paste this at the start of a session that builds the Team Chat feature end to end.
It is the master prompt for Phase 12 — the task list, the architecture and the
API contract live in this file, so an agent never has to guess.

---
Build the Team Chat + receipt-approval feature end to end.

1. Read AGENTS.md and HANDOVER.md, then this file. Open docs/BUILD_PLAN.md and read ONLY the
   Phase 12 task named in HANDOVER "Next task" (and only the files that task lists).
2. Work through Phase 12 in order: T-12.0 → T-12.8, one task at a time. For every task:
   write the tests FIRST, then the code, then run `npx vitest run --reporter=dot` and
   `npx tsc --noEmit` (plus `cd web-worker && npx tsc --noEmit` when the worker changed).
   When the task passes: tick its box in docs/BUILD_PLAN.md, update HANDOVER.md (under 60 lines)
   and commit with that task's message ("T-x.y: <short summary>").
   Never start the next task while one is failing.
3. Hard rules — do not break these:
   - The route is /team-chat (desktop `#/team-chat` through the existing HashRouter,
     web `/team-chat` through history.pushState).
   - Live chat = a Cloudflare Durable Object. Neon stays the source of truth; the Worker writes,
     the DO broadcasts over WebSocket. NO client may poll Neon.
   - Receipt files = Cloudflare R2 (bucket `sdhhe-receipts`). Never store them in Postgres.
   - Email = worker-mailer with Gmail (SMTP over `cloudflare:sockets`, smtp.gmail.com:465) plus an
     ntfy push. NO Resend for this feature (the old Resend path stays as it is).
   - NO secret in code. Secrets only via `wrangler secret put` (SMTP_USER, SMTP_PASS, NTFY_TOPIC).
   - Money = integer paise. Quantity = integer base units. Never floats.
   - Use ONLY the existing colour tokens from src/App.css and match docs/chat-in-app-preview.html.
4. Stop and tell me exactly what to do when you need:
   (a) me to enable R2 or run `npx wrangler login` — needed before T-12.3,
   (b) me to set SMTP_USER, SMTP_PASS, NTFY_TOPIC with `npx wrangler secret put` — needed before T-12.7,
   (c) a deploy or any destructive database change,
   (d) help after the same error happens twice.
   After I reply "done", continue from where you stopped.
5. If context reaches ~70%: update HANDOVER.md, commit "wip: T-12.x handover" and stop.
6. At the end: run all tests, tsc for the app AND the web-worker, the Playwright test, then give me a
   short summary of what works and the manual steps left (deploy, Worker URL in desktop Settings,
   role permissions check).
---

## Where Phase 12 stands

| Task | State | What it delivers |
|---|---|---|
| T-12.0 | done | Phase 12 in `docs/BUILD_PLAN.md`, preview `docs/chat-in-app-preview.html`, decisions in `docs/DECISIONS.md` |
| T-12.1 | done | `chat_messages` + `receipt_requests` in Neon, `src/db/chat.ts`, `scripts/apply-sql.mjs` |
| T-12.2 | done | `src/logic/sha256.ts`, `src/logic/chatToken.ts`, receipt state machine, `chat` permission module |
| T-12.3 | next | R2 receipts: binding + upload/download + validation |
| T-12.4 | todo | Durable Object room: WebSocket, broadcast, presence |
| T-12.5 | todo | Worker chat + approval API, `chat` permissions on the routes |
| T-12.6 | todo | Web screen `/team-chat` |
| T-12.7 | todo | Gmail SMTP + ntfy (needs the three secrets) |
| T-12.8 | todo | Desktop screen `/team-chat`, Worker URL in Settings, Playwright spec |

## Architecture

```
Neon (source of truth)          Cloudflare
  chat_messages      ◄── write ──  Worker (sdhhe-api)  ──►  Durable Object "ChatRoom"
  receipt_requests                    │  writes             (WebSocket fan-out, one room)
  (R2 key only)                       ▼                              │
  R2 bucket                    R2  sdhhe-receipts                 ▼
  sdhhe-receipts               (receipt images/PDF)         every member's browser
```

- The Worker owns every write (messages, receipts, decisions) and logs to `activity_log`.
- The Durable Object never touches the database — it only holds the sockets and broadcasts.
- The browser loads the history once over REST and then receives everything live over the socket.
- Receipt files stay in R2; Postgres only stores the key, the file name, the mime type and the size.

## Data model

`chat_messages` — id, room (`main`), user_id, author, role, kind (`text` | `receipt` | `system`),
body, receipt_id, created_at.

`receipt_requests` — id, submitted_by, submitter_name, title, amount_paise (integer paise), note,
r2_key, filename, mime, size_bytes, status (`pending` | `approved` | `rejected`), decided_by,
decider_name, decision_note, decided_at, message_id, created_at.

## API contract (Worker)

| Route | Who | Notes |
|---|---|---|
| `POST /api/chat/auth` | any | `{phone, password}` → `{token, expiresAt, user}` — the desktop app's bearer token (12 h, HMAC-SHA256 with `SESSION_SECRET`) |
| `GET /api/chat/messages?limit=100` | `chat:view` | `{messages}` oldest first, newest `limit` rows |
| `POST /api/chat/messages` | `chat:create` | `{kind:"text",body}` or `{kind:"receipt",body,receipt}` → `{message, receipt?}`; also broadcasts over the socket |
| `POST /api/chat/receipts` | `chat:create` | multipart upload → `{file:{r2Key, filename, mime, sizeBytes}}` (image/PDF, 4 MB cap) |
| `GET /api/chat/receipts?status=pending` | `chat:view` | `{receipts}` newest first |
| `POST /api/chat/receipts/:id/decision` | `chat:edit` | `{decision:"approve"|"reject", note}` → `{receipt, message}`; a receipt can only be decided once |
| `GET /api/chat/receipts/<r2Key>` | `chat:view` | streams the file out of R2 |
| `WS /api/chat/ws?token=…` | `chat:view` | live frames: `hello`, `message`, `receipt`, `presence`, `error` |

Auth = the web session cookie **or** `Authorization: Bearer <chat token>` (desktop).

## Permissions

The `chat` module (view / create / edit) was added to `src/logic/permissions.ts`:
owner = all, CA = view+create+edit, staff = view+create. The `role_permissions` table needs no
migration — a missing row falls back to the defaults.

## Files that belong to Phase 12

```
src/logic/chat.ts            shared limits, receipt state machine, badges, labels
src/logic/chatToken.ts       HMAC chat token (sign + verify)
src/logic/sha256.ts          SHA-256 + HMAC + base64url (no crypto.subtle dependency)
src/db/chat.ts               messages + receipts persistence (zod parsing)
src/db/schema.ts             chatMessages, receiptRequests
drizzle/0006_team_chat.sql   the migration (additive)
web-worker/src/chat/do.ts    the Durable Object (T-12.4)
web-worker/src/chat/protocol.ts  socket frames (T-12.4)
web-worker/src/receipts.ts   R2 upload/download (T-12.3)
web-worker/src/mailer.ts     Gmail SMTP + ntfy (T-12.7)
src/pages/TeamChat.tsx       desktop screen (T-12.8)
src/lib/chatClient.ts        desktop REST + WebSocket client (T-12.8)
web/src/components/TeamChat.tsx  web screen (T-12.6)
e2e/team-chat.spec.ts        Playwright (T-12.8)
```

## Commands

```
npx vitest run --reporter=dot            # all tests
npx tsc --noEmit                          # app
cd web && npm run typecheck               # web app
cd web-worker && npx tsc --noEmit         # worker
cd web-worker && npx wrangler dev         # local worker (R2 + DO are emulated locally)
node scripts/apply-sql.mjs drizzle/0006_team_chat.sql   # apply a migration (additive only)
```
