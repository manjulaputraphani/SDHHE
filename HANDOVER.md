# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**T-14.1/14.2/14.3 — chat groups: DB helpers, worker routes, DO kick, owner UI — committed.**
The owner can make groups ("New group"), and add / remove members or archive from the group header
⋮ menu. A removed member's socket is closed at once (close 1008 → toast, back to the room list).
NOT LIVE YET: the worker + DB must be updated first (see Owner steps). Web LIVE:
https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/` (untouched).
Note: the message-editing work (PATCH route, updateMessage, 0013) was committed by its owner
mid-session as `322fd51`; I only added the missing `editedAt` column to `src/db/schema.ts`.

## Done (T-14 chat groups)
- DB (`src/db/chatRooms.ts`): groups reuse the Phase 13 tables (`chat_conversations` kind `group` +
  `chat_conversation_members`) — no new tables; only `archived_at` was added (drizzle/0014).
  New: createGroupConversation, listConversationMembers, add/removeConversationMember,
  archiveConversation. isMember / listConversations / unreadCount / rename all filter archived rooms,
  so a retired group is unreadable everywhere (never hard-deleted).
- Rules: `isGroupRoom()` (src/logic/chatPrivacy.ts) — room shape `group-…`; chatRoomMember in the
  worker accepts group rooms; logFirstDirectMessage skips them.
- Worker (web-worker/src/index.ts): POST /api/chat/groups (create + system message),
  GET/POST/DELETE /api/chat/groups/members, POST /api/chat/groups/archive. Owner-only (role check,
  like rename — T-14.2 deviation, see DECISIONS). Receipt decisions: membership only enforced for
  direct chats, so owner/CA can approve a group receipt without being a member.
- DO (web-worker/src/chat/do.ts): new POST /kick closes one member (or all) with code 1008.
  Protocol: new `members` frame (reload lists). Body parsing now includes DELETE.
- Web UI (TeamChat.tsx): owner "New group" button + dialog (name + tick members); ⋮ menu gains
  Add members / Remove member / Archive (group rooms only, never the shop room); members popup
  shows the group roster; socket close 1008 → toast + back to the list. api.ts: 5 new calls.
- Tests: chatPrivacy/chatView/protocol unit tests, 6 group int tests (skip without
  DATABASE_URL_TEST; resetAll now also truncates the chat conversation tables), 5 new e2e in
  team-chat.spec.ts. 470 unit green, 39/39 e2e-web green, tsc clean (root/web/worker).

## Owner steps that are still open
1. Apply drizzle/0013 + 0014 to the Neon DB (dev branch first — 0014 adds `archived_at`; the new
   worker code SELECTs it, so deploy only AFTER the column exists). Then deploy:
   `cd web && npm run build && cd ../web-worker && npx wrangler deploy`.
2. Desktop chat → Worker blocked by Cloudflare Access until a service token exists.
3. Desktop 1-hour auto-logout (owner has not answered). 4. Roasting screen missing in desktop.

## Next task (BUILD_PLAN Phase 14)
- **T-14.4 UI polish**: initials avatar for groups in the list, floating chat panel starts on the
  group list, light+dark check. **T-14.5**: live two-user e2e (Ravi loses access live; receipt from
  a group approved from Expenses) — needs the deployed worker.

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (470) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (39, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && ./node_modules/.bin/wrangler deploy`
