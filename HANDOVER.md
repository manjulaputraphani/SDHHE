# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `d01e573f`. Mobile-login polish (cream sheet, −28px hero overlap, no border, autofill fix,
forgot link, spacing, field/button styles) is committed, NOT deployed yet.**

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

## This + last session (UI work)
- **Chat**: edge-to-edge mobile, WhatsApp composer (emoji·pill·circular send,
  mic⇄send), `100dvh`+safe areas, bubble max-w 80/65% + always-visible time/ticks (blue read),
  `.chat-bg` pattern, mobile header short mark, theme toggle into drawer.
- **Contrast theme**: `contrast` ThemeMode + `[data-theme=contrast]` palette (solid, 2px borders).
- **Mobile login** (<768px only): bottom-sheet hero+form; +91 prefix (10-digit, 6–9, normalizePhone);
  password show/hide; spinner; inline errors + shake; light→dark→contrast cycle. Desktop unchanged.
- **Unread + FAB**: `unread.ts` store + `ChatFab.tsx`. Total pill on "Team Chat" (nav+drawer),
  8px hamburger dot, per-contact green badge/time + bold preview, FAB (pulse, keyboard-hide,
  setAppBadge, "(N)…" tab title). Refresh on login/focus/30s; clears on open.
- **No "Forgot password?"** — no self-service reset flow exists. Unread already existed (no backend
  change). FAB label "Open the chat…" (not "Open Team Chat…") to avoid a nav-button e2e substring clash.
- No backend / chat-logic / data-structure changes. 494 unit + 70 e2e green.

## Commands
- Tests: `npx vitest run --reporter=dot` (494) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (70, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
