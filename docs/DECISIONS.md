# DECISIONS LOG (append one line per decision: date · decision · reason)
- 2026-10-30 · Tauri 2 + React + TS (not Electron) · small installers, React skills
- 2026-10-30 · Neon Postgres as primary DB · data safe across laptops, free plan
- 2026-10-30 · Money in paise, qty in base units (int) · no float errors
- 2026-10-30 · FIFO default, weighted average optional · matches real usage
- 2026-10-30 · AI computes nothing; app computes stats, AI explains · LLMs bad at arithmetic
- 2026-10-30 · Secrets in OS secure storage only · desktop app has no server
- 2026-10-30 · `keyring` crate for secrets (not a JS plugin / not stronghold) · native macOS Keychain & Windows Credential Manager, no extra vault file or password
- 2026-10-30 · `argon2` crate for PIN hashing, argon2id + random salt · memory-hard, no plaintext PIN on disk
- 2026-10-30 · `@types/node` (devDependency) · `src/db/test-utils.ts` reads `process.env.DATABASE_URL_TEST`; removes the old `@ts-expect-error` in vite.config.ts
- 2026-10-30 · `@playwright/test` (devDependency) + e2e/ specs · runs the real React UI in Chromium with Tauri IPC stubbed; the only automated check of the Setup→Lock→Home flow without a GUI
- 2026-10-30 · `@tauri-apps/plugin-http` + `tauri-plugin-http` · Ollama calls go through Rust, bypassing webview CORS; capability scope limited to http://localhost:11434/* and https://ollama.com/*
- 2026-10-30 · Sales = `sales` table + `SALE` stock movement with FIFO batch links · stock left stays one source of truth (sum of open batches), no duplicate counters
- 2026-10-30 · Sale price stored as paise per display unit (kg/l/pcs), total = round(qty × price / factor) · matches batch costing and avoids float money
- 2026-10-30 · keychain items DATABASE_URL/PIN_HASH re-created allow-all on this dev Mac (`security ... -A`) · ad-hoc dev binaries change code signature on every Rust rebuild, so macOS re-prompted forever; app still uses keyring, revert by deleting the items + redoing Setup
- 2026-10-30 · Audit trail in `activity_log` (actor 'local') · single-user desktop app; rows answer who did what and when, share the data transaction, and travel with the DB backup
- 2026-10-31 · Analytics: Recharts + Dashboard tabs (Overview/Graphs/Funds/Investors) · user-approved plan (docs/PLAN_ANALYTICS.md); basic BAR + PIE always on, other charts selectable and remembered
- 2026-10-31 · "Funds with us" = actual cash position (investments + money received − money paid out) · stock value and receivables shown separately as utilised; avoids counting unpaid revenue as cash
- 2026-10-31 · Execution order: V2-P10 → charts → V2-P11 credit → Funds tab · charts need real sales, funds need credit/payments data
- 2026-10-31 · V2-P10 tables named `sale_bills` / `sale_items` (interim `sales` kept until the new screens replace it), `sale_items.movement_id` added · exact batch restore on cancel needs the SALE movement link
- 2026-10-31 · Migration workflow: `drizzle-kit pull` baseline committed under `drizzle/`; `generate` needs an interactive TTY, so new tables go to the DEV branch via push first (once DATABASE_URL_TEST exists)
- 2026-10-31 · P10 billing tables pushed additively to the current DB (customers/sale_bills/sale_items) · dev branch still missing; additive CREATE only, existing screens unaffected (dev-branch rule remains for future changes)
- 2026-10-31 · GST bill printing via a hidden iframe + system Print dialog (Save as PDF) · no extra PDF dependency yet; shop name/address/phone/GSTIN read from Settings (`shop_*` keys)
- 2026-10-31 · GST math in `src/logic/gst.ts` (basis points, rounded paise, exact CGST/SGST split) · one source for bill totals and the future GST report
- 2026-10-31 · Invoice layout follows the SDHHE sample PDF (docs/PLAN_V2.md phase note): HSN per sale line, buyer GSTIN/address on `customers`, shop email + bank details in settings, DD-MM-YYYY on print · user asked for the same design/details; bill number stays `SD-YYYY-NNNNNN` per the V2 spec (the sample's `SDHHE/25-26/16` style was not adopted until asked)
- 2026-10-31 · GST details: NO portal scraping/automation (no public API, captcha, portal terms) · instead validate the GSTIN (format + official check digit), open the portal for the human captcha lookup, and auto-fill from customers already saved by GSTIN; a paid GSP API can be added later behind the same UI
- 2026-10-31 · Bill email: Rust `lettre` SMTP (Gmail app password in Keychain) + HTML invoice body (same `buildBillHtml`) · no server; sender is the shop's own address; PDF attachment deferred to Phase 12
- 2026-11-04 · Bill PDF (T-10.6): `jspdf` + `html2canvas` client-side — Tauri has no headless print-to-file, so the invoice HTML renders to an image-based A4 PDF (not vector; accepted for v1) · PDFs go to a temp bin via Rust `save_bill_pdf` (name-sanitised), Email bill attaches + auto-deletes on success, WhatsApp bill reveals the file in Finder with a "Delete PDF" action, and the bin purges >24 h files on Bills load · closes the "PDF attachment deferred" note from 2026-10-31
- 2026-10-31 · Web API auth verifies argon2id with `@noble/hashes` (pure JS) · Cloudflare Workers blocks dynamic WASM compilation, so hash-wasm cannot run there; noble is ~190 ms per login and reads the same PHC hashes the desktop writes
- 2026-10-31 · Web UI re-themed as a warm premium café palette (cream `#F7F1E8` / coffee brown `#6F4E37` / caramel gold `#C8963E` / sage green `#7A8B5A`, night-roast dark mode) · user-specified colours and rules: light = morning, dark = night, gold only for small highlights, sage for positive states, no pure white page bg and no pure black anywhere
- 2026-10-31 · Theme = CSS variables on `<html data-theme="light|dark">` mapped into Tailwind v4 with `@theme inline` (`bg-surface`, `text-ink`, `border-line`, …) · flipping one attribute re-themes every component; no per-component state, no re-render
- 2026-10-31 · Three theme modes (light / dark / system) kept in localStorage, resolved by an inline script in `web/index.html` before first paint · no flash of the wrong palette; "system" keeps following `prefers-color-scheme` while the app is open
- 2026-10-31 · Brand colours exposed as CSS variables and read from JS for the donut/bars (`var(--c-chart-1…)`) instead of hard-coded hex · charts re-colour with the theme
- 2026-10-31 · Playfair Display (headings) + Inter (body) from the Google Fonts CDN, no npm font package · zero build step and no new dependency; Georgia/system fallbacks if the CDN is unreachable
- 2026-10-31 · Added `web/tsconfig.json` + `npm run typecheck` (web/) · the web app had no type checking at all; it shares `src/lib|db|logic` with the desktop app
- 2026-10-31 · Theme engine + switch moved to `src/lib/theme.ts` and `src/components/ThemeToggle.tsx` (shared by the Tauri app and the web edition; the web keeps thin re-export files) · one implementation, one storage key (`sdhhe-theme`), one palette for both editions
- 2026-10-31 · Desktop (Tauri) app re-themed with the same coffee palette + light/dark/system · the desktop app is the daily tool, so it must match the web edition; this also delivers the dark-mode half of V2-P15
- 2026-10-31 · Desktop modal scrim is warm `rgb(28 22 18 / .55)` instead of `bg-black/40` · the design rule bans pure black anywhere, and a brown-black scrim reads warmer
- 2026-10-31 · Dark mode neutralises Tailwind shadow utilities (`--tw-shadow: 0 0 #0000`) · "thin borders instead of shadows" in dark mode, so cards keep their 1px border
- 2026-10-31 · Costing = weighted average (WAC) with a value pool per item (`items.stock_value_paise` + `avg_cost_paise`) · the pool keeps the cost exact: COGS = pool value × qty sold ÷ stock on hand, so the required test case (avg ₹102.33/kg, gross ₹153.33, net ₹113.33, 280 kg left) comes out without float drift; FIFO stays available as a setting
- 2026-10-31 · Purchase expenses (transport, loading, commission) are added into the stock cost; sale expenses (delivery, packing) are charged to the deal · the spec's costing model: freight lands in the cost of the goods, delivery lands on the deal
- 2026-10-31 · `expenses` gained `expense_type` (purchase / sale / general) plus optional links to a purchase or a sale · `category` stays the free-text label ("Rent", "Transport"); a purchase-linked expense raises the stock cost, a sale-linked one raises the deal's expenses
- 2026-10-31 · Financial year = India FY (1 Apr → 31 Mar), label "2026-27", derived from the transaction date · no FY column in the DB (it would go stale); reports filter by date range, so old rows stay correct
- 2026-10-31 · FY report figures exclude GST and subtract discounts (turnover = Σ subtotal − discount) · GST is collected for the government, not turnover
- 2026-10-31 · Sale lines store a cost snapshot (`sale_items.avg_cost_paise` + `cost_paise`) · later purchases must not change the profit of past deals
- 2026-10-31 · Login sessions in a `user_sessions` table (started/ended/duration) + `user.login` / `user.logout` in the activity log · the user asked for "who logged in, when they logged out, how long they were in and overall metrics"
- 2026-10-31 · A sign-in lasts 12 hours (web token + cookie), shared as `SESSION_MAX_SECONDS` · the desktop app has no timeout (it locks on request); a new sign-in closes the previous session and any open session is capped at 12 h, so "still active" never sticks around and the usage numbers stay honest
- 2026-10-31 · `items.image_url` (nullable text) added with `ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url text` · additive, no data touched; the web item form takes an image URL (R2 is not configured yet, so uploads are not possible) and the thumbnail falls back to a coloured circle with the first letter
- 2026-10-31 · Sidebar links grouped into SALES / INVENTORY / MONEY / ADMIN with one inline-SVG icon set (Lucide-style, hand-written) · no icon library (the bundle stays small); the ADMIN group is owner-only
- 2026-10-31 · Coffee-bean sidebar texture is an inline SVG data-URI on a `::before` layer at 4–5 % opacity, behind the text · no image file, and the text contrast is unchanged
- 2026-10-31 · The 14-day chart draws its own y-axis (₹0 … max, Indian short form ₹1,200 / ₹1.2L) with 4 gridlines, and bars with a value of 0 are not rendered · a zero stub reads as "there was activity"; the tooltip shows on hover and on tap for the future Android app
- 2026-10-31 · The desktop rail is `sticky top-0 h-screen` and the mobile navigation moved into a side drawer · the rail no longer scrolls away with the page; below 768 px the header shows icons only (menu / theme / sign out) and the grouped nav opens as a left drawer that closes when a link is picked
- 2026-10-31 · Editing or deleting a purchase rebuilds that item's cost pool from the open batches · the weighted-average pool otherwise drifts away from the batches and the reported profit stops matching the stock
- 2026-10-31 · Purchase expenses are prorated over the quantity still on hand when a pool is rebuilt · the transport paid for a purchase that was partly sold leaves with the sold part
- 2026-10-31 · The chart uses pointer events with a short "recent touch" guard · a tap on a phone fires compatibility mouse events straight after, which were closing the tooltip again
- 2026-10-31 · The item-thumbnail letter circles use the soft chip colours (sage/gold tint + dark ink) · the saturated sage and gold backgrounds failed WCAG AA for the letter
- 2026-10-31 · `customers` is a real MASTER: one row per client, matched by phone → GSTIN → name · billing used to insert a new customer row for every bill, so the same client was stored again and again; now the details are updated in place (empty fields never wipe what is known)
- 2026-10-31 · The phone is stored as digits only · "98765 43210" and "+91 9876543210" must find the same client in the master
- 2026-10-31 · New web screen *Customers* (CONTACTS group) with search, bill count and billed total, plus a customer picker on the billing form · the client details are saved into the master with the bill, and a saved client can be picked instead of retyped
- 2026-10-31 · Credit (udhaar) is shown as a tag: a bill that is not fully paid shows "Credit ₹X", the dashboard shows the total credit given, and the customer master shows each client's outstanding credit · the unpaid part of a live bill (total − paid) is the credit; cancelled bills never count
- 2026-10-31 · `recordBillPayment` adds a payment to a bill (never above the bill total) and logs `sale.payment` · without it a credit bill could never be cleared — the tag would be a dead end
- 2026-10-31 · The old app's 31 CamelCase tables (Users, Invoices, StockLedger, …) were dropped from the Neon database; `drizzle.config.ts` now has a `tablesFilter` listing only our tables · nothing in src/, web/ or the worker ever read them (only the old drizzle baseline did), and the guard stops `drizzle-kit push` from recreating them
- 2026-10-31 · The database was cleaned of development data on 2026-10-31: test bills + their lines/movements, test customers/suppliers, the dismissed AI suggestion, the dev audit trail and sessions · the real data was kept (items, purchases, stock, shop settings, users, investments, KALKI ENTERPRISES) and the batch quantities + cost pool were rebuilt from the purchases so the stock matches the books again
- 2026-11-01 · `.nav-texture` sets **no** `position` — it is unlayered CSS and silently overrode the Tailwind `sticky`/`fixed` utilities on the same element (that is why the rail still scrolled away and ended short) · the desktop rail is `sticky top-0` + `h-screen`/`100dvh`, the nav scrolls internally with a thin scrollbar and the theme toggle / user / Sign out stay pinned at the bottom; the mobile drawer keeps its behaviour (its `fixed` works again)
- 2026-11-01 · The dashboard "Recent activity" card shows only the latest 4 rows (the **query** is limited to 4) with a bottom-right "View all activity →" link; the Activity screen pages 20 at a time with "Load more" (`listActivity(limit, offset)` → `/api/activity?limit=&offset=`) · never fetch the whole feed to show a glimpse
- 2026-11-01 · The 14-day chart window is "today − 13 … today" with **today in Asia/Kolkata** (`(now() at time zone 'Asia/Kolkata')::date`) · the Neon clock is UTC, so `current_date` slides the window around midnight IST. The chart was never month-bound — it read empty on 2026-11-01 because the database has no sales/expenses: the 30–31 Oct bills were removed in the 2026-10-31 dev-data cleanup (restore point: `docs/db-backup-2026-10-31.sql`)
- 2026-11-01 · `SD-2026-000002` (30 Oct sale, KALKI ENTERPRISES, ₹7,875) was restored **verbatim** from `docs/db-backup-2026-10-31.sql` (bill + line + stock movement + batch link, batch 2: 1000→500, `sale.restore` audit row, id sequences moved past the restored ids) · the 31 Oct bills labelled TEST and the cancelled one stay deleted until the owner confirms; restore only from the backup, never re-derive old bills through `createBill` (the cost snapshot must not be recomputed)
- 2026-11-06 · Phase 12 Team Chat: live chat = one Cloudflare **Durable Object** room (`ChatRoom`) used as a fan-out hub only · Neon stays the single source of truth for messages and receipts, the Worker writes, the DO broadcasts over WebSocket — no client polls Neon
- 2026-11-06 · Receipt images/PDFs live in **R2** (bucket `sdhhe-receipts`, 4 MB cap, keys `receipts/<date>/<id>.<ext>`) · the paperwork is too big for Postgres and the room must open it from a URL; R2 objects are private, the Worker streams them after a permission check
- 2026-11-06 · Team-chat email goes out through **Gmail SMTP from the Worker** (`cloudflare:sockets` → `smtp.gmail.com:465`, secrets `SMTP_USER` / `SMTP_PASS`) plus an **ntfy** push (`NTFY_TOPIC`) · no Resend for this feature (the old Resend path stays for the old notifications), no secret ever reaches the repo
- 2026-11-06 · The desktop app talks to the chat through the **Worker URL** (Settings) with a short-lived HMAC chat token (`POST /api/chat/auth`, phone + password) · the Tauri app has no worker session cookie, and a bearer token can be refreshed without storing the password
- 2026-11-06 · New permission module **`chat`** (view / create / edit) · staff may read and post, CA and Owner may also approve or reject a receipt; the `role_permissions` table needs no migration (missing rows fall back to the defaults)
- 2026-11-06 · Route **`/team-chat`** — desktop `#/team-chat` through the existing HashRouter, web `/team-chat` through `history.pushState` · the web app has no router and adding `react-router-dom` to `web/` would be a new dependency for one screen
- 2026-11-06 · The chat screens use **only the existing `src/App.css` colour tokens** and follow `docs/chat-in-app-preview.html` · the palette is a fixed part of the brand; no new colours, no hard-coded hex in JSX
- 2026-11-06 · `@cloudflare/workers-types` added as a **devDependency of web-worker** (types only, no runtime code) · the Team Chat Durable Object needs the `DurableObject` base class, `WebSocketPair`, `DurableObjectNamespace` and the 101-upgrade `ResponseInit.webSocket`; the package is types-only so the bundle does not grow
- 2026-11-06 · `web-worker/package.json` no longer installs drizzle-orm / @neondatabase/serverless / zod · the Worker shares the app's `src/db` and `src/logic`, and two copies of the same version made the types nominal-incompatible (`SQL` carries a private field) which broke `tsc` in the Worker; they now resolve to the root `node_modules` and there is exactly one copy
- 2026-11-06 · The chat socket authenticates with a **chat token** (`?token=`), never with the session cookie · the Durable Object can only be reached through the Worker's binding, and the token is the same HMAC secret the Worker already uses — the desktop app gets one with phone + password, the web app exchanges its session for one
- 2026-11-06 · The Team Chat mail goes out through **Gmail SMTP spoken by the Worker itself** (`cloudflare:sockets` → smtp.gmail.com:465, `AUTH LOGIN`) — the "worker-mailer" way: no third-party mail API, no Resend, and the app password never leaves the Worker. The SMTP client is written against a tiny transport interface so it can be unit-tested without a network, and every read has a 15 s timeout so a silent mail server cannot hold up the API
- 2026-11-06 · The Team Chat push goes to **ntfy** (`NTFY_TOPIC`, https://ntfy.sh) — a receipt that waits for approval and the decision that follows both push the phone of the people who need to act; the mail and the push are best effort and never block the action
- 2026-11-06 · `web-worker/.dev.vars` holds the **local-only** SMTP test values as comments (`scripts/local-smtp-server.mjs` is a fake SMTP server) — the file is gitignored, so no secret can reach the repo; miniflare refuses a connection to a literal 127.0.0.1, the hostname `localhost` works
- 2026-11-06 · The **chat token follows the sign-on**: the web app gets a token that lives 1 h (the same rule as the web session) and refreshes it every 30 min, an expired token is refused at the socket door and an open socket is closed when its token runs out · otherwise the chat (12 h token) would have kept working after the automatic logout; the desktop token keeps 12 h because the desktop session has no timeout (it locks on request)
- 2026-11-06 · **Direct chat (1-to-1)** on top of the shared shop room: a private chat is a room named `dm-<smallId>-<bigId>` (both people always land in the same room), one Durable Object per conversation, and `chat_conversations` + `chat_conversation_members` keep the membership and the unread marks · a private chat belongs to exactly two people, the shop room to everybody
- 2026-11-06 · A private chat is **private**: only its two members can read it (the Worker checks the membership on every route and refuses a room name that is not a chat room), while the activity log only notes
  that a private chat happened — "had a private chat (1 message(s) with member #4)" — and never the text · the
  owner can moderate without reading; every member can export their own conversation as a text file
- 2026-11-06 · **Delivered / read ticks** (Phase 14): one `chat_message_states` row per (message, member) —
  `delivered_at` when their device got it, `read_at` when they have seen it · the sender sees ✓ (sent), ✓✓
  (delivered) and ✓✓✓ in gold (read); the tick is computed from the *other* members, so a shop room reads
  "read" only when everybody else has read it
- 2026-11-06 · The **read mark is pushed into the room** (the Worker broadcasts a "read" frame) and the
  **typing indicator** is relayed by the Durable Object · the tick therefore turns gold on the sender's
  screen while they are looking at it, without a refresh
- 2026-11-06 · **Renaming a group is an owner job** (`POST /api/chat/rename`, role `owner` only; a staff
  member gets 403) · the shop room can be called "Morning team" instead of "Shop room"; a **private chat is
  never renamed** (it is named after the person) · the new name travels through the room as a "rename" frame,
  so the header of every member changes at once
- 2026-11-06 · The one-hour idle logout must not be **slid by a background call**: the chat screen refreshes
  its token every 30 minutes and that request used to re-issue the session cookie, so the members sitting on
  the chat screen were never signed out · a background call now carries `X-Chat-Refresh: 1` and the Worker
  leaves the session window alone for it
- 2026-11-06 · **Sign out everybody** = a `session_epoch` in the settings table, carried in the cookie; the
  owner bumps it (`POST /api/auth/logout-all`, or the "Sign out everybody now" button in the web Settings) and
  every session of the old epoch is refused at once · the desktop app (which has no server session) now signs
  itself out after an hour of inactivity
- 2026-11-06 · The **idle logout is 30 minutes** (the owner asked for half an hour) — the web session and the
  desktop app both use it; the chat token of the web follows the same rule
- 2026-11-06 · **One device at a time**: a new sign-in closes the older sessions of that member and the old
  device gets the "you were signed out" window; every sign-in is written to `login_history` (browser, OS, IP)
- 2026-11-06 · The **product tour is written from scratch** (a spotlight + tooltip) instead of adding
   Driver.js or Shepherd.js — the rule is to ask before a new dependency, so the tour works without one and
   can be swapped later
- 2026-11-06 · The **read count is public**: everybody in the conversation sees how many of the others have
   read a message ("Read by 3"), while the **text** of a private chat stays private
- 2026-11-06 · **R2 is live**: the bucket `sdhhe-receipts` was created and the binding is deployed
   (`env.RECEIPTS`) · the receipt files are stored under `receipts/<date>/<id>.<ext>`, private — they are only
   streamed through the Worker after the chat permission check; nothing is ever public
- 2026-11-06 · The **security headers** (the "zero trust" hardening in code): HSTS, a strict CSP, no framing,
   no sniffing, no camera/microphone/geolocation — on every response of the Worker (the API, the app and the
   receipt files)
- 2026-11-06 · **The chat notifications are sent by the Worker itself** (Cloudflare Web Push, RFC 8291 +
   VAPID, written with WebCrypto) — no third-party push service, no new npm package. The phones subscribe in
   the browser with one tap (🔔 in the chat header) and the Worker pushes every shop-room message
   · ntfy stays as the fallback, so a member without the browser permission still gets the phone push
   · a private chat never pushes (the channel is shared and the text is private)
- 2026-11-07 · **Chat groups** — Added group chat functionality alongside team chat; owners can create groups, members see only their groups; permission model distinguishes team vs group chats.
- 2026-11-07 · **Group management is owner-only** (`session.role === "owner"`, exactly like the rename route) instead of the planned new
   `chat.manage` permission — adding a 6th action to the roles matrix would ripple through every module's screen for one feature; CA can be given group
   rights later by swapping the role check for `allowed(permissions, "chat", "edit")` in the five group routes (BUILD_PLAN T-14.2 deviation, noted there).
- 2026-11-07 · **Groups reuse the Phase 13 tables** (`chat_conversations` kind `group` + `chat_conversation_members`) instead of the planned
   `chat_rooms` / `chat_room_members` — no migration was needed for membership; the only schema change is `chat_conversations.archived_at`
   (drizzle/0014). A group is archived (soft-deleted), never hard-deleted: its messages and members stay, but `isMember` / the room lists /
   unread counts all filter `archived_at is null`, so a retired group is unreadable everywhere at once.
- 2026-11-07 · **Removing a member kicks their socket at once** — the Worker calls a new `POST /kick` endpoint on the room's Durable Object, which
   closes that member's sockets with close code **1008** (reason `removed` / `archived`); the web client treats 1008 as "leave this room, no
   reconnect", shows a toast and falls back to the shop room. Membership changes are broadcast to the room as a `members` frame so open clients
   reload their lists; a system message ("Phani added Ravi") is written into the room history as well.
- 2026-11-07 · **AI polish (Phase 15) is a suggestion, never a silent rewrite** — the owner switches it per group (owner-only role check, like the
   rename); the Worker rewrites the draft with Ollama Cloud and returns it as a preview the sender confirms ([Send suggested] / [Send original] /
   [Edit]). The AI text is never stored unless sent; the sent message carries `ai_polished` so the bubble shows a tiny ✨. The endpoint skips the
   AI for texts under 15 characters or emoji-only, answers `{polished: null}` after 8 s (nothing is sent, "AI not available — send original?"),
   and enforces 30 requests per member per hour per isolate. Amounts rule: if the rewrite drops any number of the original, the original stands and
   the card says "Kept original — numbers changed" (Indian comma formats like 1,20,000 → 120000 are tolerated).
- 2026-11-07 · **The app ALWAYS opens on the Dashboard** — the `/team-chat` deep link no longer opens the chat on a cold load (the owner asked after
   the app kept opening on the chat because push notifications link to `/team-chat`); the URL is settled back to `/`, and the in-app Team Chat link
   still pushes `/team-chat` for sharing. Chat times are 12-hour local ("09:42 AM"), and messages can be fixed by tapping one's own bubble
   (PATCH route + `update` frame — was half-committed before: only the DB function and the import existed, no route, no UI).
- 2026-11-07 · **Installable PWA + default-on message notifications** — the site is now a real PWA (manifest + icons + Apple meta; the service
   worker existed but was NEVER registered, so Web Push could not work at all). Message notifications are ON BY DEFAULT: right after sign-in the
   app asks once and subscribes (idempotent re-sync each login, a denial is never nagged again; the 🔔 stays as the manual switch). Group messages
   push to the group's members ("X wrote in <group>"); direct chats never push. A tapped notification opens the chat via `/team-chat?notify=1` —
   the one deep link that bypasses the always-Dashboard rule (a deliberate jump), while a plain `/team-chat` address still lands on the Dashboard.
- 2026-11-07 · **Mobile boot + keyboard** — the Google-Fonts stylesheet no longer blocks the first paint (on a slow phone network it left the login
   page blank-white until the CSS arrived); index.html carries an inline boot splash (brand disc + pulse, light/dark) that React replaces on mount.
   On touch devices the chat return key makes a NEW LINE and only the send button sends (WhatsApp behaviour) — desktop keeps Enter-to-send.
- 2026-11-07 · **Message actions (T-16.2): audit + soft delete** — a message is never overwritten without a record: every edit keeps its previous
   text in `chat_message_edits`, and deleting only sets `deleted_at` (the body stays — old messages in the DB are never changed). Edits are
   author-only and only within 15 minutes (`withinEditWindow` in src/logic/chat, shared by the web client and the worker); deleting is author-only
   (the owner may delete any), a receipt only while Pending. The delete route asks for the `chat create` permission so any member can remove their
   own message; ownership is checked in `deleteMessage`. Reply / React / Pin actions were deferred to T-16.4 (they need their own tables).
- 2026-11-07 · **Chat features (T-16.4): replies, reactions, pins** — replies store only `reply_to_id` (the quoted preview is found in the loaded
   history, nothing duplicated); reactions are one row per member per message (`chat_reactions`, unique message+user — the same emoji removes it,
   a new one replaces it, no emoji library needed); pins live in `chat_pinned_messages` (unique per message, at most three per room — the 4th is
   refused). All three broadcast live through the Durable Object (`reaction` / `pins` frames) and every route first checks the room membership;
   pinning is owner-only. @mentions are computed on the client from the room roster and travel as ids in the send payload — the worker pushes
   "X mentioned you" to exactly those members, so a mention notifies even when the room would not push that member.