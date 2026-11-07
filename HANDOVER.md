# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**LIVE version `cbb81787-30dc-4b7d-9730-045d7b24768c` (2026-11-07) — Phase 16 chat polish +
the sidebar full-height fix, both deployed.** Migrations 0018/0019 were applied earlier; this
deploy was a pure web bundle + worker rebuild (no DB change). 494 unit + 70/70 e2e green before
shipping, tsc clean (root/web/worker), tree clean.
Live app: https://sdhhe-api.blvphani.workers.dev (behind Cloudflare Access — curl 302s to
sdhhe.cloudflareaccess.com; verify signed in). Desktop = Tauri app in `src/` (untouched).

## What Phase 16 delivered
- **T-16.1** line breaks kept exactly (bubble `white-space: pre-wrap`; composer grows to 8 lines).
- **T-16.2** message actions: no-op plain click; hover (desktop) / long-press (phone) action row
  (↩ 😊 📋 ✏️ 🗑 📌 ⓘ); edit in the composer within 15 minutes (audit in chat_message_edits);
  soft delete with tombstone; receipts delete only while pending. Migration 0018.
- **T-16.3** approvals panel only while pending: gold 🧾 badge button (approvers), auto-open on a
  new receipt, remembered open/closed, staff see nothing.
- **T-16.4** replies (quoted preview + scroll-to-original flash), reactions (chips + picker, one
  per member per message), ticks inside the bubble, @mentions (member list + personal push),
  search highlight + jump, pinned messages (owner, max 3, bar + 📌), "New messages" divider.
  Migration 0019 (chat_messages.reply_to_id, chat_reactions, chat_pinned_messages).
- **T-16.5** bubbles 10/14px padding, 14px font, 1.5 line height, ≤70%; same-sender grouping
  (2px) / 12px between senders; accent-ink avatar+names; 360px + dark theme in the e2e suite.
- **T-16.6** `e2e-web/chat-polish.spec.ts` (8 tests) + the extended responsive checks.

## New worker routes (all membership-checked; pin = owner-only)
- PATCH/DELETE /api/chat/messages/:id (edit within 15 min; soft delete)
- POST/DELETE /api/chat/reactions/:messageId · GET/POST /api/chat/pins, DELETE /api/chat/pins/:id
- messages GET carries reactions; messages POST carries replyToId + mentions (personal push)
- Frames: "update", "reaction", "pins" (+ "settings"/"members" from earlier phases)

## Owner steps that are still open
1. ~~Deploy~~ DONE 2026-11-07 — migrations 0018/0019 applied + verified, web bundle rebuilt,
   worker deployed (`ad00db7f`). Try signed in: hover a bubble for the actions, ↩ reply, 😊 react,
   📌 pin (owner), search 🔍 with ↑↓, @mention someone, and the 🧾 approvals badge.
2. Desktop chat → Worker blocked by Cloudflare Access until a service token exists.
3. Desktop 1-hour auto-logout (owner has not answered). 4. Roasting screen missing in desktop.

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (494) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (68, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
