# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**Phase 16 "Chat polish" in progress: T-16.1 ✓, T-16.2 ✓, T-16.3 ✓ (committed, NOT deployed).
T-16.4, T-16.5, T-16.6 remain — see Next task.** Working tree is clean; 489 unit + 53/53 e2e
green, tsc clean (root/web/worker). LIVE worker is still `f3459367` (mobile+PWA) — the Phase-16
work needs migrations 0018 before it can deploy.

## Done this phase
- **T-16.1 line breaks**: `.chat-bubble { white-space: pre-wrap }` (data pipeline was already
  clean), composer grows to ~8 lines. Unit + int + e2e.
- **T-16.2 message actions**: plain click does nothing; action row (📋 ✏️ 🗑 ⓘ) on hover
  (desktop) / long-press (phone); edit in the COMPOSER ("Editing message ✕" bar, Enter saves,
  Esc cancels), 15-minute window (`withinEditWindow` in src/logic/chat), audit rows in
  `chat_message_edits`; soft delete (`deleted_at`, body stays) with tombstone "🚫 This message
  was deleted"; DELETE /api/chat/messages/:id; PATCH now enforces the window; live via `update`
  frame. Migration **0018** (additive, NOT yet applied to the DB).
- **T-16.3 approvals panel**: hidden entirely with 0 pending (grid drops the third column);
  "🧾 Approvals" header button + gold badge (approvers only, count>0); auto-open on a new
  receipt; open/closed remembered (localStorage); staff see nothing.

## Next task — T-16.4 (chat features; the big one)
- **Reply/quote**: `chat_messages.reply_to_id` (migration 0019) + quoted preview in the bubble,
  click scrolls to the original; worker passes replyToId through parseMessageInput/insertMessage.
- **Reactions**: new table `chat_reactions (message_id, user_id, emoji, pk message+user)` (0019);
  POST/DELETE /api/chat/reactions/:messageId; frame "reaction"; chips 👍 ❤️ 😂 🙏 ✅ 🔥 with
  counts, click own to remove.
- **Ticks INSIDE the bubble** bottom-right with the time (✓ ✓✓ ✓✓ accent = read); Info modal
  already exists (T-16.2) — extend with times.
- **@mentions**: composer detects "@", shows the member list (roster); on send the mentioned
  user gets a push even if the room is muted (worker: mention ids in the payload, push override).
- **Search**: highlight matches in bubbles + jump between results (roomQuery exists; add mark).
- **Pinned messages**: table `chat_pinned_messages (room, message_id, pinned_by)` max 3 (0019);
  📌 action (owner) + pinned bar above the list; worker route + frame.
- **"New messages" divider** when scrolled up; emoji picker + copy already exist.
- Then **T-16.5** (bubbles ≤70%, 10/14px padding, 14px/1.5, 2px grouping, 12px between senders,
  avatar initials + accent-ink names, composer icon row, 360px + themes) and **T-16.6**
  (`e2e-web/chat-polish.spec.ts` with the spec's scenario list).

## Owner steps that are still open
1. Deploy when the phase is done: apply drizzle/0018 (+0019…) to the DB FIRST, then
   `cd web && npm run build && cd ../web-worker && npx wrangler deploy` (ask first).
2. Desktop chat → Worker blocked by Cloudflare Access until a service token exists.
3. Desktop 1-hour auto-logout (owner has not answered). 4. Roasting screen missing in desktop.

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## Commands
- Tests: `npx vitest run --reporter=dot` (489) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (53, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
