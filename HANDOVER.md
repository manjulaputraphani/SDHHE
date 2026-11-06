# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-07 by OpenCode
Tool: OpenCode

## Current state
**Phase 12 (Team Chat) and Phase 13 (Direct chat) are code-complete AND deployed.**
Live worker version `eb23815a-12ad-4da9-8e53-1bb39e3df6e1` (2026-11-06 13:0x) — web bundle `index--dT6aHq4.js`.
Live: https://sdhhe-api.blvphani.workers.dev/team-chat (shop room + private chats).
**R2 is LIVE**: the bucket `sdhhe-receipts` exists and the binding `env.RECEIPTS` is deployed — the receipt
upload/download works. The Worker also sends the security headers (HSTS, CSP, no framing) on every response.
**Remember**: `cd web && npm run build` before every deploy — the Worker uploads `web/dist`.
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Neon migrations applied: `0001`…`0007_direct_chat.sql` (chat tables exist, 0 rows).
**Planning complete for Phase 14 — Chat groups**: Added T-14.0 to BUILD_PLAN.md and DECISIONS.md. Ready to implement T-14.1 Database.

## Done
 - **Welcome-banner fix (2026-11-07, deployed `3b97646f`)**: the banner showed on EVERY page load
   (`NotificationsHost` rendered it whenever not dismissed) and `/api/auth/me` re-fired a "Logged in" toast on
   every session restore. Fixed per spec: the login success handler is the ONLY trigger — it sets a one-time
   `sessionStorage` flag (`src/logic/welcomeBanner.ts`, consumed once on mount, so refresh/tab-change/new-tab
   never show it); the card is now a small toast top-right, auto-hides after 6 s, ✕ closes it, and "Don't show
   again" persists `app_users.show_welcome_banner=false` (migration `0012_welcome_banner_setting.sql`, applied;
   `POST /api/notifications/welcome-banner`; Settings → In-app notifications toggle). Other one-time popups were
   audited and are already condition-gated (what's-new = unseen release marked in DB, onboarding = not completed,
   announcement = active + not dismissed). 466 unit tests (3 new for the flag), Playwright 21/21.
- **Chat Phase 1** (committed, deployed `eb23815a`): the rename is stored in ONE place
  (`chat_conversations.title`, the list read from the server) and posts a system message
  "X renamed the group to …"; presence (a 30 s heartbeat over the socket + `POST /api/chat/heartbeat`,
  offline after 60 s, a green/grey dot, "Online / Last seen today at 16:20", "N members · M online"
  with a member list); read receipts (avatars of the readers, max 3 + "+N", a popup with the read and
  "delivered, not read" names, the two ticks ✓/✓✓, "Seen 16:08" in a private chat). Migration
  `0011_chat_presence.sql` (applied). **Phase 2–4 not started (the owner tests Phase 1 first).**
- **Phase 15 — the in-app notification system** (committed, deployed `22af8463`): the 7 components (welcome
  banner, onboarding checklist, announcement bar, toasts, "what's new" window, product tour, login alert) +
  the sessions (30-minute idle logout, one device at a time, "sign out everybody", the login history, the
  5-minute warning toast) + the public read counts in the chat. Migration `0009_notifications.sql` applied.
  `src/db/notifications.ts` + the API in the worker + `web/src/components/notifications/*` +
  `web/src/components/AnnouncementsAdmin.tsx`. Local checks: session **10/10**, notifications **18/18**;
  Playwright (web) **17/17**; 445 unit tests. The product tour is **written from scratch — no new dependency**
  (Driver.js/Shepherd.js need your OK).
- **The sessions are fixed** (committed, deployed `8fa63ad3`): the chat screen's 30-minute token refresh was
  **sliding the one-hour idle window**, so the members sitting on the chat screen were never signed out — a
  background call now carries `X-Chat-Refresh: 1` and the Worker does not re-issue the cookie for it. The
  desktop app had **no timeout at all** → it now signs itself out after an hour of inactivity. New: the
  **session epoch** (`session_epoch` in the settings) — the owner can **sign everybody out** at once
  (`POST /api/auth/logout-all`, the web Settings has a "Sign out everybody now" button). **The epoch was
  bumped to 3 on 2026-11-06 → every member who was signed in is signed out now.** Local session check 10/10.
- **Group rename (owner only)** (committed, deployed `cb638c5a`): the admin renames the shop room inline in the
  room header (`POST /api/chat/rename`, role `owner`; staff get 403). The name is pushed into the room as a
  "rename" frame, so every member sees it at once; a private chat keeps the name of the person. Local check
  `scripts/local-rename-check.mjs` 4/4, Playwright 11/11, 445 unit tests.
- **Phase 14 — modern chat + delivered/read ticks** (committed, deployed `7c4965bb`): grouped bubbles with
  avatars and tails, ✓ / ✓✓ / ✓✓✓ ticks (gold = read) on my own messages, a typing indicator in the room
  header, a jump-to-bottom button with the missed count, a friendly empty state — the drawing rules are shared
  (`src/logic/chatView.ts`) so the web and the desktop look the same. The state lives in
  `chat_message_states` (migration `0008_message_states.sql`); `POST /api/chat/delivered` and `/api/chat/read`
  write the marks and push a frame into the room. Local tick check 7/7, Playwright 9/9.
- **Phase 13 — direct chat** (committed, deployed): T-13.1 conversations + unread (`chat_conversations`,
  `chat_conversation_members`), T-13.2 room-scoped API (conversations/members/read/messages, membership → 403),
  T-13.3 one Durable Object per room, T-13.4 web conversation list + New chat + Export, T-13.5 desktop the same,
  T-13.6 privacy (private chats stay private; the activity log never holds the text) + export,
  T-13.7 tests + deploy. **433 unit tests, tsc clean (app/web/worker), Playwright 7/7.**
- **Phase 12 — Team Chat** (committed, deployed): T-12.0…T-12.8 (tables, shared logic, R2 receipts,
  the Durable Object room, the worker API, the web screen, Gmail SMTP + ntfy, the desktop screen + Playwright).
- **Composer fix (this session)**: web Team Chat message composer — replaced the `rounded-full` pill with a
  fixed `rounded-[20px]` rounded rectangle, added `overflow-y: auto` + `max-height: 150px` so the textarea
  auto-grows to ~6 lines then scrolls internally, normal `px-3.5 py-2.5` padding, `flex w-full items-end`
  row ([attach][emoji][textarea][send]) with icons/send aligned to the bottom and never overlapping text.
  Message list keeps `min-h-0 flex-1` so it shrinks as the composer grows. Enter sends, Shift+Enter new line,
  send disabled on empty/whitespace. typecheck + build clean.

## Next tasks
0. **Access service token for the desktop app** (owner creates it in Zero Trust → Access → Service Auth).
1. **Desktop 1-hour auto-logout** — the desktop app still only locks via *Lock now* (the web signs out on its
   own). The owner has not answered yet.
2. The Roasting screen is still missing in the desktop app (only the web has it).
3. Audit the 16 stale unticked boxes in `docs/BUILD_PLAN.md` (most are done) + `T-6.3` Excel/PDF export.
4. **T-14.1 Database (chat groups)**: Create chat_rooms and chat_room_members tables, add room_id to chat_messages, migrate existing messages to "All team" room.

## Commands
- Tests: `npx vitest run --reporter=dot` (433) · `npx tsc --noEmit` · `cd web && npm run typecheck` ·
  `cd web-worker && npx tsc --noEmit` · `npm run test:e2e:web` (Playwright, mocked worker)
- Local worker: `cd web-worker && npx wrangler dev` · web: `cd web && npm run build && cd .. && cd web && npm run dev`
- Local checks: `scripts/local-chat-api-check.mjs` · `local-direct-chat-check.mjs` · `local-web-chat-check.mjs` ·
  `local-receipt-check.mjs` · `local-session-check.mjs` · `local-chat-check.mjs`
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy` (ask the owner first)

## Blockers
- Desktop chat → Worker is blocked by Cloudflare Access until a service token is added (see Owner steps 2).
- The three mail secrets are **not** on the worker (`wrangler secret list` shows only DATABASE_URL,
  OLLAMA_API_KEY, RESEND_API_KEY, SESSION_SECRET).
- `prompts/TEAM_CHAT_ALL.md` and `docs/chat-in-app-preview.html` were missing from the repo; both were written.
- Owner login: account id=1, phone `7569208757`, active.