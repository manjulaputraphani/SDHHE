# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-09 by OpenCode
Tool: OpenCode

## Current state
**LIVE `ae4ffebd` (AI key moved to Cloudflare Worker — desktop app calls `/api/ai/chat` instead of ollama.com directly; no local key storage).**

## Next task
None queued — the owner picks the next task.

## Owner steps that are still open
1. Cloudflare Access service token for the desktop app (for desktop chat).
2. Desktop 1-hour auto-logout (owner has not answered). 3. Roasting screen missing in desktop.
4. Keep ~/sdhhe-android-twa safe (the APK signing keystore, password sdhhe2026).

## Blockers
- Mail secrets (SMTP_USER / SMTP_PASS) still not on the worker.

## This session (deployed): read receipts + unread badges
- **Root cause**: `POST /api/chat/read` wrote `chat_message_states.read_at` (ticks) but never
  bumped `chat_conversation_members.last_read_message_id`, which `listConversations`/`unreadCount`
  compute the badge from — group and 1:1 badges never cleared server-side.
- **Backend**: `chatStates.markRead` now also updates `last_read_message_id`/`last_read_at`, so
  `unreadCount` drops for groups and 1:1.
- **Frontend**: open → mark all read (optimistic + rollback); new message while open+visible+focused
  → debounced 500 ms mark of *visible* messages only (IntersectionObserver); visibilitychange/focus
  → mark visible messages read; "read" frames from other tabs clear the badge.
- **Ticks**: `otherMemberIds` excludes self, so ✓✓ blue (=read by ALL others) works in groups.
- **Message info panel**: avatar+name Read by / Delivered to + Pending list; read tick `#34B7F1`.
  Bubble `min-w-[80px]` + time/ticks `nowrap` bottom-right.
- **unread.ts**: `markRoomRead` returns rollback; new `markRoomReadByOther`.
- No route/schema change (tables existed). 498 unit tests + typechecks green.
- Hotfix: `markRead` high-water computation used `sql<number>\`max(m.id)\`` which crashed on empty rooms; replaced with `orderBy(desc(id)).limit(1)` pattern.

## This session (deployed): AI key moved to Cloudflare Worker
- **Desktop app** (`src/pages/Chat.tsx`, `src/pages/Settings.tsx`): now calls `POST /api/ai/chat` on the worker instead of calling `ollama.com` directly with a locally-stored key. No local `OLLAMA_API_KEY` storage — the key lives only in Cloudflare Worker secrets.
- **Worker** (`web-worker/src/index.ts`): `/api/ai/chat` is now unauthenticated (the worker's `OLLAMA_API_KEY` secret is the gatekeeper). Old authenticated handler removed.
- **`src/lib/aiApi.ts`**: new `callAiApi()` helper using Tauri's HTTP plugin (bypasses webview CORS).
- **Desktop app gets worker URL from DB** via `getChatWorkerUrl(db)` — owner must set it in Settings first.
- `Settings.test.tsx` updated for new behavior. 498 unit tests + typechecks green.

## This + last session (UI work)
- **Chat**: edge-to-edge mobile, WhatsApp composer, `100dvh`+safe areas, bubble max-w 80/65% +
  always-visible time/ticks, `.chat-bg` pattern, mobile header short mark.
- **Contrast theme**: `contrast` ThemeMode + `[data-theme=contrast]` palette.
- **Mobile login**: bottom-sheet hero+form; +91 prefix; password show/hide; spinner; inline errors;
  light→dark→contrast cycle. Desktop unchanged.
- **Unread + FAB**: `unread.ts` store + `ChatFab.tsx`; total pill, hamburger dot, per-contact badge,
  FAB (pulse, keyboard-hide, setAppBadge, "(N)…" tab title). No "Forgot password?" (no reset flow).

## Commands
- Tests: `npx vitest run --reporter=dot` (494) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (70, mocked worker)
- Deploy (ask first): `cd web && npm run build && cd ../web-worker && npx wrangler deploy`
