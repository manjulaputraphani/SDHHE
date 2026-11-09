# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**LIVE version `51bbd70a-8496-406e-a0ab-7147009824e7` (2026-11-09) — Android app shipped.**
A TWA APK (`web/public/sdhhe.apk`, 1.1 MB, signed: CN=Phani Kumar, O=SDHHE, C=IN) is hosted by
the worker and downloadable in-app ("📲 Install the Android app" in the sidebar footer, Android
devices only — opens the live web app full-screen with notifications). Built with Google
bubblewrap (JDK 17 + Android SDK installed at ~/.bubblewrap). The TWA project + signing keystore
(android.keystore, password sdhhe2026) live at **~/sdhhe-android-twa** — NOT in git; keep the
keystore safe, future APK updates must be signed with it. 494 unit + 70/70 e2e green before
shipping, tsc clean, tree clean.

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
