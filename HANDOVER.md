# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `388e3ee9` (chat UI redesign shipped).**
The database is Neon Postgres (Drizzle) and stays that way — no database migration is planned
or in progress.

## Next task
None queued — the owner picks the next task.

## Owner steps that are still open
1. Cloudflare Access service token for the desktop app (for desktop chat).
2. Desktop 1-hour auto-logout (owner has not answered). 3. Roasting screen missing in desktop.
4. Keep ~/sdhhe-android-twa safe (the APK signing keystore, password sdhhe2026).

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

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## What this session changed (chat UI — now live)
- Fixed horizontal overflow: mobile chat edge-to-edge (main padding negated, `min-w-0` on
  grid/flex, `word-break`/`overflow-wrap` on bubbles, `overflow-x:hidden` on the list).
- WhatsApp composer: [emoji] [pill: textarea+attach+camera] [circular 48px send]; mic ⇄ send
  icon swap; 16px on phones (no iOS auto-zoom).
- `100dvh` height + `100svh`/`-webkit-fill-available` fallbacks + safe areas +
  `overscroll-behavior: contain`; `.chat-bg` coffee dot-lattice backdrop.
- Bubbles: max-w 80%/65%, timestamp + ticks always visible. Mobile header: short "SDHHE"
  mark (icon-only <360px), theme toggle moved into the drawer; Call icon (desktop only).
- Viewport meta `interactive-widget=resizes-content`; `prefers-reduced-motion` respected.
- No backend / chat-logic / data changes. 494 unit + 70 e2e green before commit.

## Commands
- Tests: `npx vitest run --reporter=dot` (494) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (70, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
