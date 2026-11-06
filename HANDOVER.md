# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**T-14.1/14.2/14.3 — chat groups: DEPLOYED and LIVE** (version `51de2837-6bc1-4e38-9b9a-e4f9132914da`,
2026-11-07). DB migration applied BEFORE the deploy: `chat_messages.edited_at` (0013, was already in)
+ `chat_messages.edited_at` not null and default (0014, applied now). The deploy also re-added the R2 binding
(`sdhhe-receipts`) that the 2026-11-06 deploy had to skip.
Message editing feature is now live.
Live app: https://sdhhe-api.blvphani.workers.dev (behind Cloudflare Access — curl gets a 302 to
sdhhe.cloudflareaccess.com; verify the group UI by signing in). Desktop = Tauri app in `src/`
(untouched). Message editing feature deployed as part of this commit.

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
1. ~~Apply migrations + deploy~~ DONE 2026-11-07 (see Current state). In the app: Team Chat →
   "New group" to try the feature; check that receipts from groups can be approved in Expenses.
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
