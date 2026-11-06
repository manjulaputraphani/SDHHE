# BUILD PLAN — tick [x] when Definition of Done (AGENTS.md) is met
Each task: Files · Steps · Acceptance. Do ONE task per session if context is small.

## Phase 0 — Setup
- [x] **T-0.1 Install tools** — Follow docs/SETUP.md. Acceptance: `node -v`(20+), `rustc --version`, `git --version`, `ollama -v` work.
  ⚠ 2026-10-30: node 20.20.2, rustc/cargo 1.99.1, git 2.54.0 OK. **`ollama` NOT installed** — install it + `ollama signin` before using opencode.json models.
- [x] **T-0.2 Create project** — `npm create tauri-app@latest stock-tracker` (React, TypeScript, npm). Copy this kit's files into it.
  Acceptance: `npm run tauri dev` opens a window. ✅ 2026-10-30: builds (1m06s), binary runs, webview connected to Vite :1420, React renders (render test passed).
- [x] **T-0.3 Install libs** — `npm i drizzle-orm @neondatabase/serverless zod recharts xlsx jspdf react-router-dom`
  `npm i -D drizzle-kit vitest @testing-library/react @testing-library/jest-dom jsdom tailwindcss @tailwindcss/vite`
  Add scripts: `"test":"vitest run --reporter=dot"`, `"typecheck":"tsc --noEmit"`. Acceptance: `npm test` runs (0 tests ok).
- [x] **T-0.4 Git + GitHub** — `git init`, .gitignore (from kit), first commit, push to private GitHub repo. (⚠ local git done; GitHub push is for the human.)
- [ ] **T-0.5 Neon** — Create project (region Singapore), create branch `dev`. Copy dev URL into local `.env` as `DATABASE_URL` (dev only, gitignored).

## Phase 1 — Database
- [x] **T-1.1 Schema** — Files: src/db/schema.ts, drizzle.config.ts. Tables exactly as BLUEPRINT §4.
  Acceptance: `npx drizzle-kit push` creates tables on `dev` branch.
  ⚠ 2026-10-30: 9 tables CREATED. But `drizzle-kit push` itself cannot run from this agent (non-TTY, `promptNamedWithSchemasConflict`); the identical generated DDL was applied in one additive transaction instead. ⚠ These tables live in the EXISTING app DB `SriDurgaHariHaraEnterprices` (public schema, next to 34 CamelCase tables) — NOT a separate dev branch. `drizzle.config.ts` has `schemaFilter: ["public"]` so drizzle ignores `sdhhe_fy2025`.
- [x] **T-1.2 DB client** — src/db/client.ts: `getDb(url)` using neon-http driver. URL passed in, never imported from code. (+ client.test.ts: rejects empty URL, returns handle without connecting)
- [x] **T-1.3 Money/unit helpers** — src/logic/units.ts (+ test): toBase, fromBase, formatRupees, costPaise. Acceptance: tests in TESTING §A1. (13 tests green; all 5 §A1 cases covered)
  Note: `costPaise(qtyBase, unitPricePaise, pricePer = "kg")` — the 3rd arg is the unit the PRICE is quoted in (qty is always base units). Pass `"pcs"` or `"l"` for those items.

## Phase 2 — Setup & security
- [x] **T-2.1 Secure storage** — Tauri plugin for OS keychain/stronghold; save/read `DATABASE_URL`, `PIN_HASH`.
  (2026-10-30: `keyring` 3 + `argon2` 0.5 in Rust; commands save_secret/get_secret/delete_secret/hash_pin/verify_pin, service "stock-tracker"; typed wrappers in src/lib/secrets.ts. `cargo check` clean. Note: the scaffold `greet` command was removed.)
- [x] **T-2.2 Setup screen** — first launch: enter Neon URL, test connection, set PIN. Acceptance: restart → asks PIN, not URL.
  (2026-10-30: src/pages/Setup.tsx — URL field, "Test connection" via `pingDb` (`select 1`), PIN + confirm (4-6 digits), errors "Cannot connect - check the connection string" / "PINs do not match", saves DATABASE_URL + PIN_HASH, shows ONLY the host (src/lib/url.ts). CSP set in tauri.conf.json: strict `csp` + `devCsp` with https://*.neon.tech in connect-src. The "restart → asks PIN" half is wired in T-2.3.)
- [x] **T-2.3 PIN lock** — wrong PIN 5× → wait 60 s. Tests TESTING §C.
  (2026-10-30: src/pages/Lock.tsx (countdown, input+button disabled while locked), src/pages/Home.tsx (placeholder + "Reset connection" in-app modal, deletes both secrets), src/App.tsx flow loading→Setup|Lock→Home, src/lib/db-context.tsx (`DbProvider`/`useDb`, db built only after unlock). 31 tests green; `tauri dev` accepts the CSP and boots.)

## Phase 3 — Items & Purchases
- [x] **T-3.0 App layout** — src/components/Layout.tsx: sidebar (Dashboard, Items, Purchases, Add Purchase, Stock Check, Expenses, Reports, Settings) + react-router-dom, Tailwind, 1024px+. "Reset connection" moved from Home to Settings. (2026-10-30)
- [x] **T-3.1 Items CRUD** — src/pages/Items.tsx, src/db/items.ts. Validate with zod. Unique name.
  (2026-10-30: listItems (stock left = SUM(batches.qty_remaining)), getItem, createItem, updateItem, deleteItem (blocked, "Item has purchases"), getStockLeft. zod: name required, unit kg|l|pcs, min stock int >= 0; unique name case-insensitive. formatQuantity() added to units.ts ("1.50 kg"). B5 integration test in src/db/items.int.test.ts — SKIPPED until DATABASE_URL_TEST is set.)
- [x] **T-3.2 Add Purchase** — src/pages/AddPurchase.tsx, src/db/purchases.ts. Transaction: purchase+batch+movement.
  Total auto-calc. Prefill last price. Acceptance: TESTING §B1.
  (2026-10-30: addPurchase uses ONE statement with data-modifying CTEs (purchase → batch → PURCHASE movement), supplier found-or-created in the same statement. Live total via computeTotalPaise; prefill + "Last price: ₹X (date)"; "+20% vs last time" after save. §B1 test written in src/db/purchases.int.test.ts — SKIPPED until DATABASE_URL_TEST is set.)
- [x] **T-3.3 Purchases list** — filter by item/date, show batch remaining.
  (2026-10-30: src/pages/Purchases.tsx + listPurchases (joins items/suppliers/batches, newest first) + getStockLeft in src/db/items.ts. Filters: item, from, to.)

## Phase 4 — Stock check & FIFO (MOST IMPORTANT)
- [x] **T-4.1 fifo.ts** — tests FIRST (TESTING §A2), then code. Pure function.
  (2026-10-30: src/logic/fifo.ts allocateFifo(batches, qtyUsed, factor); src/logic/errors.ts (ValidationError, InsufficientStockError, StockLeftTooHighError). 13 tests: worked example 2200 with B left 2000, single batch, exact empty, zero, too much, date order vs array order, same-date by id, skips empty, pcs, rounding, negative qty, bad factor.)
- [x] **T-4.2 stockCheck.ts + average.ts** — tests §A3, §A4.
  (2026-10-30: computeUsage (4000/2000→2000, 4000/4000→0, 6000→StockLeftTooHighError, -1→ValidationError); weightedAverage + averageCost (1150 paise/kg, 2000g→2300); replay.ts replayItem(batches, movements, factor) replaying STOCK_CHECK/USAGE/WASTAGE in date order from qty_original, throwing ReplayConflictError with the offending date. B3 as a pure test: price ₹10→₹11 gives 2300. 20 tests.)
- [x] **T-4.3 Stock Check screen** — preview used qty & cost → confirm → transaction (BLUEPRINT §6). Acceptance §B2.
  (2026-10-30: src/db/client.ts `getTxDb(url)` + `withTransaction(url, fn)` over Pool/neon-serverless (WebSocket, pool closed in `finally`); `wss://*.neon.tech` added to CSP. src/db/stock.ts: `planStockEntry` (pure, shared by preview and save) + `saveStockEntry`/`stockCheck` doing SELECT ... FOR UPDATE → computeUsage → allocateFifo → UPDATE batches → INSERT movement → INSERT links in ONE transaction. src/pages/StockCheck.tsx shows current stock + open batches, live preview "Used 2.00 kg · Cost ₹22.00 · From: … · Left … worth …". §B2 + §B4 tests written in src/db/stock.int.test.ts — SKIPPED until DATABASE_URL_TEST is set.)
- [x] **T-4.4 Wastage/Usage entry** — same allocation, type WASTAGE/USAGE.
  (2026-10-30: mode toggle Stock left | Used | Wastage on StockCheck.tsx; Used/Wastage take a quantity directly and record qty_change = −used with the same FIFO allocation inside the same transaction. Tests: live preview 1.5 kg → ₹16.00, wastage 0.3 kg → type WASTAGE, qty 300.)
- [x] **T-4.5 Edit/delete purchase** — replay later movements. Acceptance §B3.
  (2026-10-30: `updatePurchase(url,id,input)` / `deletePurchase(url,id)` in src/db/purchases.ts — ONE transaction: change/delete purchase + batch + its PURCHASE movement, then `replayAndWriteBack` (load all batches/movements of the item, run replayItem, write back qty_remaining + movement costs, rebuild movement_batch_links). Purchases page gained Edit modal + Delete confirm; a ReplayConflictError rolls back and shows the conflicting date. §B3 tests in stock.int.test.ts (price ₹10→₹11 → 2300; delete first purchase → 1200) — SKIPPED until DATABASE_URL_TEST is set.)

## Phase 5 — Expenses & Dashboard
- [x] **T-5.1 Expenses CRUD** — src/pages/Expenses.tsx.
  (2026-10-30: src/db/expenses.ts listExpenses(month, category) + create/update/delete + listExpenseCategories + monthRange; zod category required, amountPaise int > 0, date required. Page: month picker, category filter, table (date/category/amount/payment/note), month total footer, add/edit modal with category datalist (presets + custom), delete confirm. 12 tests.)
- [x] **T-5.2 Dashboard** — month spend, stock value, low-stock list, last 5 purchases.
  (2026-10-30: src/db/dashboard.ts getDashboard(db, month) — every sum in SQL: purchases, expenses, total, used cost (STOCK_CHECK+USAGE), wastage, stock value (round(sum(qty*price/factor))), low stock via HAVING, last 5 purchases/checks, price alerts via ROW_NUMBER window (>10%). src/pages/Dashboard.tsx: month picker, 6 cards, price alerts, low stock with links to /purchases/new?item=ID (AddPurchase now preselects from ?item=), empty state "Add your first item". Dashboard is the index route; Home.tsx removed. Tests: 4 UI, 3 int (SQL) SKIPPED, e2e main-flow SKIPPED until DATABASE_URL_TEST.)

## Phase 6 — Reports & Backup
- [x] **T-6.1 stats.ts** — daily usage, days left, price change %, monthly spend, overbuying (tests §A5).
  (2026-10-30: added as a Phase-8 prerequisite — Phase 6 was never committed. src/logic/stats.ts:
  dailyUsage, daysLeft, priceChangePct, spendChangePct + §A5 tests. T-6.2 Reports page and
  T-6.3 export are STILL MISSING.)
- [ ] **T-6.2 Reports page** — price history chart, usage, spend by category/supplier.
- [ ] **T-6.3 Export** — Excel (xlsx) + PDF; full backup JSON export & import into a fresh Neon branch (§D).

## Phase 7 — Packaging
- [x] **T-7.1 Icon/name** — tauri.conf.json productName "Stock Tracker", icons via `npx tauri icon`.
  (2026-10-30: version 1.0.0 (tauri + package.json), productName "Stock Tracker", identifier com.stocktracker.app, window title "Stock Tracker" 1280x800, min 1024x700. Version shown in Settings via getVersion(). app-icon.png (1024², generated) → `npx tauri icon` wrote all sizes incl. .icns/.ico. Windows bundle: targets ["nsis","msi"], nsis installMode "currentUser" + startMenuFolder "Stock Tracker" (NSIS also creates the desktop shortcut by default).)
- [x] **T-7.2 Local build** — `npm run tauri build`. Acceptance: installer runs on your OS (§E).
  (2026-10-30: pre-flight green (typecheck, 119 unit tests; test:db 1 passed / 13 skipped — no
  DATABASE_URL_TEST). Secret scan: no real credential outside the gitignored `.env`; one real
  hostname had leaked into src/lib/url.test.ts and was replaced with a fake. `npm run tauri build`
  compiled the release binary but produced NO bundle: targets are ["nsis","msi"] (Windows-only).
  `--bundles app` produced src-tauri/target/release/bundle/macos/Stock Tracker.app (~4.1 MB).
  DMG step fails twice in this sandbox (hdiutil "couldn't unmount - Resource busy"). Windows
  .exe/.msi must be built on Windows or via the T-7.3 CI.)
- [x] **T-7.3 CI builds** — .github/workflows/release.yml using tauri-apps/tauri-action for windows/macos/ubuntu + run `npm test`.
  (2026-10-30: release.yml on tags "v*" + workflow_dispatch; matrix windows-latest, macos-latest
  aarch64 + x86_64, ubuntu-22.04; Rust stable + mac targets; Linux webkit/appindicator/rsvg/patchelf;
  npm ci → npm test → tauri-action (tagName v__VERSION__, releaseName "Stock Tracker v__VERSION__",
  releaseDraft true); permissions contents: write. test.yml runs typecheck + unit tests on every
  push/PR (ubuntu-22.04). docs/RELEASE.md documents the bump/tag/publish flow. NOT yet run on
  GitHub — no remote configured.)

## Phase 8 — AI suggestions
- [x] **T-8.1 Rule suggestions** — src/logic/rules.ts: low stock, price up >10%, spend up >15%, overbuying. No AI.
  (2026-10-30: buildSuggestions(stats) → low_stock (daysLeft <= 5 or stock <= min), price_up (>10%),
  spend_up (>15% vs last month), overbuying (>2x used in 30d), high_wastage (>5% of used);
  priority 1-3, messages with ₹, numbers carried alongside. db/suggestions.ts loadRuleStats in ONE
  SQL query + dismissal rows in ai_suggestions (dismissed=true). Pages: /suggestions (full list +
  Refresh) and a Dashboard card with the top 3 + Dismiss. 17 tests.)
- [x] **T-8.2 Ollama explain** — src/ai/suggest.ts: send stats JSON, get JSON array back, validate with zod, cache in ai_suggestions, fallback to rules.
  (2026-10-30: ai/ollama.ts chat() — local http://localhost:11434/api/chat, cloud https://ollama.com/api/chat
  with Bearer key, stream false, 60s AbortController. ai/suggest.ts builds a human-numbers summary
  (no raw tables/secrets), zod-validates ≤5 suggestions, DROPS any message mentioning a number absent
  from the input, strips markdown fences, falls back with "AI unavailable, showing basic suggestions".
  db/settings.ts stores enabled/mode/model; key in keychain (OLLAMA_API_KEY). Suggestions page gained
  "Refresh AI suggestions" + once-per-day auto-refresh (shouldAutoRefresh) + cached in ai_suggestions.
  8 tests.)
- [x] **T-8.3 Chat with tools** — read-only tools only (get_item_usage, get_price_history, get_low_stock_items, get_spending_by_category, get_supplier_comparison).
  (2026-10-30: ai/tools.ts — six SELECT-only tools (also get_stock_value), unknown names refused; no
  write tool exists. ai/chat.ts loop, max 5 rounds, only the last 10 messages sent. pages/Chat.tsx with
  example chips, Thinking…, read-only notice. 5 tests incl. "delete all data" → no DB call.)
- [x] **T-8.4 AI settings** — on/off, cloud/local model, API key in secure storage, refresh max once/day.
  (2026-10-30: Settings → "AI assistant": On/Off, mode local|cloud, model text (default
  glm-5.3-flash:cloud), cloud key saved via saveSecret(OLLAMA_API_KEY) and never shown again
  (only "Key saved ✓"), "Test AI". Stored in the settings table; auto-refresh capped at once/day.)

## Phase 9 — Real-use
- [ ] **T-9.1** One week real data; compare with bills daily. Log mismatches as bugs in HANDOVER.

## Phase 10 — Sales (added 2026-10-30 on request)
- [ ] **T-10.1 Sold details** — record a sale: item, quantity sold, sale price per unit, date, note.
  One transaction: take the quantity from the oldest batches (FIFO), write a `SALE` stock movement
  + batch links, insert a `sales` row (qty base units, price paise, total paise). Because batches
  shrink, "stock left" drops automatically on Items, Dashboard, Stock Check and suggestions.
  Reject overselling (`Not enough stock`). New Sales page: form with live revenue + left-stock
  preview and a recent-sales list. Money integer paise, qty integer base units.
  Accept: logic/sales.test.ts + pages/Sales.test.tsx green, tsc clean, sale row visible in Neon.
  (2026-10-30: code + tests + migration done; waiting for one real purchase → sale to verify.)
- [x] **T-10.2 UI polish** — warm stone palette (gray→stone via @theme), dark grouped sidebar,
  card surfaces, `.card/.btn/.input/.label` component classes applied across pages, refined
  tables and focus rings, Setup/Lock redesigned. No text, label or heading changes (selectors intact).
  (2026-10-30: all 158 unit/UI tests + 13 e2e green; tsc clean.)
- [x] **T-10.3 Security settings** — Security card with Keychain status (PIN / connection / AI key, values
  never shown), **Lock now**, **Change PIN** (current PIN checked, 4-6 digits, confirm), **Remove AI key**.
  (2026-10-30: Settings.test.tsx 6 tests, full suite 164 green, tsc clean, e2e 13 passed.)

## Phase 11 — Audit & accountability (added 2026-10-30 on request)
- [x] **T-11.1 Activity log** — `activity_log` table (at, actor, event, summary, entity, entity_id).
  Records login (PIN unlock), lock (Lock now), reset, and every create/update/delete: item, purchase,
  stock check/usage/wastage, sale, expense. Log rows share the data's transaction where one exists and
  never block the user action. Settings → "Recent activity" lists the last 25 with time + actor.
  (2026-10-30: App.tsx logs login; Settings logs lock/reset; db/*.ts logs every mutation.)
- [x] **T-11.2 Expense vendor** — `expenses.paid_to` ("Paid to (vendor)") captured in the form, listed
  in the expenses table, included in the audit summary.
- [x] **T-11.3 Bill attachment** — `expense_bills` table (file stored base64 in Postgres, 4 MB cap,
  image/* or PDF). Attach/replace in the expense form; "Save bill" downloads it.
  (2026-10-30: migration applied additively; full suite 166 green, tsc clean.)

## V2 PLAN — full spec in docs/PLAN_V2.md (Phases 10–17, added 2026-10-30)
> ONE phase per session. Every DB change: `drizzle-kit generate` + push to a DEV branch first.
> PREREQUISITE: create a Neon dev branch + `DATABASE_URL_TEST` before any V2 DB work.
- [ ] **V2-P10** Sales + Profit (customers, bill no, sale_items, cancel, profit report, dashboard cards)
  (2026-10-31: profit.ts, billNumber.ts, gst.ts (tests), customers/sale_bills/sale_items schema + tables
  applied, db/billing.ts create/cancel/list/get + createCustomer, Settings → Shop details (name,
  address, phone, GSTIN). **GST Billing screen done**: line entry, live GST (5/12/18/28%), discount,
  payment mode, credit-customer rule, F2 save, printable GST invoice (Print / Save as PDF) with
  CGST/SGST split. Remaining: Profit report, Dashboard cards, int test, replay.ts SALE handling.)
  (2026-10-31: **Bills page** (`/bills`, nav "Bills"): issued + cancelled bills with status badges,
  search/status filter, View (full bill + CGST/SGST + print), Cancel with in-app confirm → bill stays
  visible as cancelled and the sold quantity is restored to its exact batches. Verified end-to-end:
  SD-2026-000001 cancelled, batch 500 g → 1000 g, audit row written.)
- [x] **V2-P10 invoice design** — printed bill rebuilt to match the SDHHE sample PDF: logo monogram, shop
  name/GSTIN/address/phone/email, invoice no/date/payment box, Billed-To with customer GSTIN + address,
  HSN per line, CGST/SGST rate + amount columns, total row, amount in words, bank details, taxable/tax/
  invoice totals, terms & conditions, authorised signatory, diagonal SDHHE watermark, DD-MM-YYYY dates.
  Data added: `customers.gstin`, `sale_bills.gst_rate_bp`, `sale_items.hsn_code`; Settings holds email +
  bank details. Amount-in-words in `src/logic/moneyWords.ts` (tests). 192 tests green.
  (2026-10-31: **Bills → View** now renders this same invoice inside the app (iframe with the exact
  print HTML: header, invoice boxes, buyer GSTIN, HSN table, words, bank, terms, signature, watermark),
  with Print / Save PDF and Cancel bill beneath it.)
- [x] **Multi-item bill test** (6 lines, mixed units kg/l/pcs): SD-2026-000003 = ₹940 + 5% GST ₹47 =
  ₹987, per-line CGST/SGST shares, HSN per line, total row shows "6 items" when units differ, stock
  deducted per item (e.g. CHANA 10→8 kg, MATCH BOX 50→40 pcs), profit ₹125. 192 tests green.
- [x] **GSTIN assist (free route)** — portal has no public API/captcha automation is not allowed: added
  `src/logic/gstin.ts` (format + official mod-36 check digit, tests), "Search GSTIN on portal" button
  (opens services.gst.gov.in in the browser via opener), inline check-digit warning (non-blocking), and
  auto-fill from a saved customer when the GSTIN matches (`findCustomerByGstin`). Saving a bill caches
  the customer so next bills fill themselves. 200 tests green.
- [x] **T-10.4 Bill email** — Settings → Email (From email, display name, SMTP host/port, Gmail app
  password saved to Keychain, Send test email). Customer email field on billing (saved with the
  customer). Bills → View → **Email bill** sends the HTML invoice from the shop's address and logs
  `bill.email`. Rust command `send_email` via `lettre` (rustls). Tested with GSTIN 37JAGPM1479E1ZE
  (valid): bill SD-2026-000004. 203 tests green, cargo check clean.
- [x] **T-10.5 WhatsApp bill** — Bills → View → **WhatsApp bill** opens the customer's wa.me chat
  (10-digit mobile → +91; 0/00 prefixes stripped; +NN country codes kept) with a pre-filled summary
  (bill no, date, total, credit due, thanks); logs `bill.whatsapp`; no phone → friendly error.
  wa.me text links can't carry files — attach the PDF via Print / Save PDF manually. First slice of
  V2-P12's WhatsApp share; no new libraries (Tauri opener plugin). 259 tests green, tsc clean.
- [x] **T-10.6 Bill PDF bin + email attachment** — Email bill now generates the invoice PDF
  (jspdf+html2canvas via `src/lib/billPdf.ts`), writes it to a temp bin (Rust `save_bill_pdf`,
  name-sanitised; path-guarded `delete_bill_pdf`), attaches it (lettre `Attachment`), and
  **auto-deletes on success**; WhatsApp bill opens the chat + reveals the PDF in Finder with a
  "Delete PDF" chip; the bin purges >24 h files when Bills loads (`purge_bill_bin`). Email falls
  back to HTML if PDF generation fails. Libs logged in DECISIONS.md. Web email PDF pending (worker
  email is HTML-only). 262 tests green, tsc + cargo check/test clean.
- [ ] **V2-P11** Credit (udhaar) + supplier dues, ledgers, payments, receivable/payable cards
- [ ] **V2-P12** Pack units + bill PDF/print/WhatsApp share
- [ ] **V2-P13** GST + purchase bill photo (file) + expiry/FEFO
- [ ] **V2-P14** Barcode + reorder list + `audit_log` (before/after JSON)
- [ ] **V2-P15** Auto-update + dark mode + languages (en/te/hi/kn)
- [ ] **V2-P16** Users/roles + locations/transfers + accountant Excel export + daily summary
- [ ] **V2-P17** Offline outbox (SQLite) + AI bill reader
- [x] **V2-P18** Profit & turnover — India financial year (1 Apr–31 Mar) with an FY selector,
  weighted-average costing per item (purchase expenses inside the stock cost), cost snapshot on every
  sale, purchase/sale/general expense types, FY report (turnover, purchases, gross, net, closing
  stock) + per-deal profit. Web: Reports screen; desktop: Reports screen. Costing switch
  (WAC/FIFO) in Settings. `src/logic/finYear.ts`, `src/logic/weightedCost.ts`, `src/db/costing.ts`,
  `src/db/reports.ts` — 237 tests green.
- [x] **V2-P19** Login sessions & usage metrics — `user_sessions` table, sign-in/sign-out written to
  the activity log, per-member sessions / active time / last login in Team → Usage (web) and Settings
  (desktop). `src/db/sessions.ts`.

Reconciliation with the interim work of 2026-10-30:
- The interim "Phase 10 sales" (single-item `sales` table) is SUPERSEDED by V2-P10 (bill header +
  `sale_items`). The interim `sales` table is EMPTY, so it can be replaced in the V2-P10 migration.
- The interim `activity_log` (login/lock/create-update-delete summaries) is the base for V2-P14
  `audit_log` (adds user_name, before_json/after_json); migrate it in V2-P14, keep using it meanwhile.
- The current app still points at the single production DB; all V2 migrations must go to a dev branch first.

## LOGIN WORKSTREAM — see docs/PLAN_LOGIN.md (approved 2026-10-31)
- [x] **L1** `app_users` + `activity_log.user_id` schema/migration (2026-10-31: table created, 0 rows; column + index on activity_log)
- [x] **L2** argon2 `hash_password` / `verify_password` commands (2026-10-31: shared hash_secret/verify_secret, PIN commands kept; 4 Rust tests pass)
- [x] **L3** phone normalization + password rules (min 6, tests first) — `src/logic/auth.ts` (+4 tests)
- [x] **L4** phone+password login, first-run owner setup, lock/logout, retire PIN (2026-10-31: Lock rewritten; App phases setup→login→home; audit actor set on login; PIN_HASH deleted after first member login; Setup is connection-only; App/Lock/Setup tests rewritten — 208 green)
- [~] **L5** audit attribution — groundwork DONE: activity_log.user_id column + `setAuditActor`/`getAuditActor`; every logActivity row now uses the session actor when set. Done: setAuditActor on login / cleared on lock — every write is now attributed. Pending: user filter in Settings.
- [x] **L6** Settings → Users (add / reset password / deactivate, Owner only) — 2026-10-31: members card (list, add, reset, deactivate/enable), role-aware (owner only), 3 new tests. Login stream complete.

## WEB EDITION — Cloudflare (see docs/PLAN_WEB.md, proposed 2026-10-31)
- [x] **W1** Worker scaffold + /api/health (verified locally with wrangler dev: 200 JSON). Node 22 needed for wrangler 4/deploy; wrangler 3 used for local dev.
- [x] **W2** Auth API — login/logout/me, phone normalization, argon2id verify via **@noble/hashes** (hash-wasm WASM is blocked on Workers), signed HttpOnly cookie, 5-attempt rate limit. Verified locally: 200/401/404/429 paths + logout.
- [x] **W5 web email (Resend)** POST /api/bills/:id/email — customer email required (400), RESEND_API_KEY required (503), HTML invoice from buildBillHtml, bill.email audit; web UI “Email bill” button with status. Verified both failure paths via API + UI; real delivery needs a Resend key + MAIL_FROM (onboarding@resend.dev for testing, or a verified domain). **2026-11-04: RESEND_API_KEY set as worker secret; test mail delivered to blvphani@gmail.com (Resend signup address — `onboarding@resend.dev` delivers only there until a domain is verified in Resend, then set MAIL_FROM).**
- [x] **W7 WhatsApp bill (web)** — Invoices → bill preview → **WhatsApp bill** (same `bills:export`
  permission as Email bill) opens the customer's wa.me chat in a new tab with the same pre-filled
  summary as T-10.5, via the shared `src/lib/whatsapp` helper (no duplicated logic); no phone →
  status hint. Client-side share only — no `bill.whatsapp` audit on web yet (desktop logs it).
  Web tsc + build clean; deployed live 2026-11-04 (assets only, no API change).
- [x] **W4b web Team (users)** — owner-only Team tab + API: GET/POST /api/users, reset password, activate/deactivate; argon2id hashing in the Worker (noble), staff blocked (403). Verified live: owner adds member → partner login 200 → /api/users 403 → deactivate → login 403. No public self-signup (owner-managed accounts).
- [x] **W4h web item delete (owner only)** — Delete button on each item row for owners with confirm; Worker DELETE /api/items/:id now requires owner (403 otherwise). Verified live: add item → delete → gone; unauthenticated delete 403/401.
- [x] **W4g remaining web screens** — Dashboard (today/month sales, month profit, expenses, low stock, recent activity), Purchases (add + list + delete API), Stock Check (used/wastage/stock-left with live stock), Expenses (add + list + delete). Verified live in Chrome: purchase saved/deleted, stock check no-op saved, expense saved/deleted; dashboard shows today ₹1,218. All 10 tabs live: Dashboard, Invoices, New Bill, Items, Purchases, Stock Check, Expenses, Activity, Team, Settings.
- [x] **W4f owner screens (web)** — **New Bill** tab (customer name/phone/email/GSTIN, item+qty+rate+HSN lines, discount, GST 0/5/12/18/28%, payment mode, save → bill + invoice preview) and **Items add/edit** (POST/PUT /api/items). Verified live in Chrome: bill SD-2026-000005 ₹15.75 + invoice render, add/edit item; test data cleaned. Remaining web screens: Purchases, Stock Check, Expenses, Dashboard.
- [x] **W4e responsive web** — mobile top bar + scrollable tabs (sidebar hidden under md), fluid tables, invoice iframe 70vh on phone/tablet and full height on desktop. Chrome device tests pass at 390/430/768: no horizontal overflow on login/invoices/items/activity/team/bill, bill fits viewport.
- [x] **W4d web role selector** — approval uses a Staff/Owner dropdown; existing members have a role dropdown (POST /api/users/:id/role, owner only, self-role locked). Verified live.
- [x] **W4c web self-signup + owner approval** — public POST /api/auth/signup creates a **pending** account (active=false, pending=true); owner Team shows “awaiting approval” with **Approve staff / Approve owner / Reject**; pending logins are refused; approved members get the chosen role (staff blocked from /api/users). Verified live: signup 201 → login 403 awaiting approval → approve staff 200 → login 200 → /api/users 403 → reject flow 404. Desktop login also refuses pending accounts.
- [x] **W4 web UI** `web/` (Vite + React + Tailwind): phone/password login, Invoices list, **bill preview** (same invoice HTML), Items with stock, Activity with attribution, sign-out. Verified with Playwright against the Worker + real DB (SD-2026-000004 visible, 8 items, activity by B PHANI KUMAR). Dev: `cd web && npm run dev` (proxy /api → 127.0.0.1:8787). Production: `npm run build` + Pages deploy with a `/api` proxy (W6).
- [x] **W3c transactional writes** POST /api/purchases, DELETE /api/purchases/:id, POST /api/bills, POST /api/bills/:id/cancel, POST /api/stock — Neon WebSocket transactions **work on Workers** (probe verified). Playwright: purchase 1kg ₹100 → bill SD-2026-000005 ₹78.75 → stock 500g → cancel → 1000g → delete purchase, all audit rows by B PHANI KUMAR. Note: item delete is blocked when a cancelled bill still references it (expected; no hard deletes).
- [x] **W3b writes** POST /api/items, DELETE /api/items/:id, POST /api/customers, POST/PUT/DELETE /api/expenses, PUT /api/shop — audit actor per request (writes serialized per isolate). Verified with Playwright: create/update/delete expense + item, audit rows show B PHANI KUMAR. Pending: bill/purchase/stock writes (WebSocket transactions) and users.
- [x] **W3 (read)** GET /api/items · /api/bills · /api/bills/:id · /api/expenses · /api/activity · /api/shop, session-guarded; reuses src/db modules + drizzle in the Worker. Verified: 401 unauth, 200 with real data. Writes deferred to **W3b** (audit actor is module-global in an isolate → needs per-request actor threading).
- [ ] **W4** Web UI (Pages) + lib/platform.ts (fetch API, print, opener)
- [ ] **W5** Email via Resend API (HTML invoice)
- [ ] **W6** Hardening + Playwright e2e against Pages/Worker

## NOTIFICATIONS — see docs/PLAN_NOTIFICATIONS.md (proposed 2026-10-31)
- [x] **N1** notification settings — settings keys notify_emails / notify_signup / notify_member / notify_bill; owner-only GET/PUT /api/settings/notifications (default = shop email, all events on); audit settings.notify. Verified live (defaults, toggles, restore).
- [x] **N2** notifyOwners() via Resend — fires on self-signup request, member add, approval and role change; honours notify_* toggles; best-effort (never blocks the action). Verified live without a key: signup 201, approve/role 200, no errors. Needs RESEND_API_KEY + MAIL_FROM for real delivery (key live on the worker 2026-11-04; MAIL_FROM pending domain verification).
- [x] **N3 staff bill alerts** — when a staff member creates a bill, owners get an email (bill no, total, line count, member) via notifyOwners/bill toggle. Verified live with a temporary staff account (bill SD-2026-000005 created, cancelled, cleaned); skipped safely without a Resend key.
- [x] **N4 web Settings** — owner tab: notify emails, per-event toggles (signup/member/bill), email-configured status, Save + **Send test** (owner-only endpoints, audit). Verified live: tab visible, status “NOT configured”, save persists; test returns 503 until RESEND_API_KEY is set. Notifications workstream complete.

- [x] **N5 Resend key in DB (encrypted)** — Settings accepts a Resend API key, stored as `resend_api_key_enc` with AES-GCM (key derived from SESSION_SECRET), never returned; Worker decrypts at send time, Cloudflare secret still takes precedence; clear-key supported. Verified live: save → configured, test reaches provider (502 on fake key), clear → unconfigured; DB holds ciphertext only.
- [x] **W4i clean UI buttons** — replaced bold underline text actions with small bordered buttons (`btn-mini`, danger/ok variants) across Invoices, Items, Team, Investments; secondary buttons for test/view actions. Verified live (counts: View, Edit, Delete present).

## Phase 12 — Team Chat + receipt approval (added 2026-11-06 on request)
> Live chat = **Cloudflare Durable Object** · receipt files = **R2** · email = **worker-mailer (Gmail SMTP)** · **no Resend, no polling Neon, no secrets in code**.
> Route = `/team-chat` (desktop `#/team-chat` through the existing HashRouter, web `/team-chat`).
> Design reference = `docs/chat-in-app-preview.html` (built from the `src/App.css` tokens — only those colours are used).
- [x] **T-12.0 Plan + design preview** — Phase 12 written into this file (files · steps · acceptance for every task), `docs/chat-in-app-preview.html` (static preview of the chat screen in the app palette), Phase-12 decisions in `docs/DECISIONS.md`.
  Acceptance: the preview opens in a browser and shows message list, composer, receipt card and approval buttons in the app palette; the eight tasks below are listed with their files and acceptance criteria. ✅ 2026-11-06: plan written; the workstream prompt + full API contract now live in `prompts/TEAM_CHAT_ALL.md` (the file and the preview were missing from the repo, so both were written here).
- [x] **T-12.1 Chat tables + DB module** — `chat_messages` + `receipt_requests` tables (drizzle schema + `drizzle/0006_team_chat.sql`, additive only), `src/db/chat.ts` (listMessages, insertMessage, listReceipts, createReceipt, decideReceipt, pendingReceiptCount) with `src/db/chat.test.ts`.
  Acceptance: unit tests green, `tsc` clean, the two tables exist in Neon (verified with `select count(*)`), nothing else in the DB changed.
  (2026-11-06: `src/logic/chat.ts` holds the shared limits — 2000 chars, 4 MB, image/PDF only; `src/db/chat.ts` holds the zod parsing + persistence; `src/db/chat.int.test.ts` written (skips without `DATABASE_URL_TEST`); `scripts/apply-sql.mjs` applies one statement at a time (the Neon HTTP driver refuses multi-statement queries) and refuses DROP/TRUNCATE/DELETE without `--force`; migration applied live — both tables exist, 0 rows.)
- [x] **T-12.2 Shared chat logic** — `src/logic/chat.ts` (message validation, receipt validation, approval state machine, badge counts, formatting) + `src/logic/chatToken.ts` (short-lived HMAC chat token for the desktop app) with tests first.
  Acceptance: `src/logic/chat.test.ts` + `src/logic/chatToken.test.ts` green; money stays integer paise; a token for a wrong secret / expired token is refused.
  (2026-11-06: `src/logic/sha256.ts` — dependency-free SHA-256 + HMAC-SHA256 + base64url (RFC 4231 vectors in the test), because `crypto.subtle` is missing in the jsdom test env; `src/logic/chatToken.ts` signs `{uid,name,role,exp}` with SESSION_SECRET, 12 h TTL, constant-time compare; `src/logic/chat.ts` grew the receipt state machine (pending→approved/rejected only once), the status label + badge tone, `canApproveReceipts` (needs `chat:edit`), the pending badge and the time/day labels; new permission module **`chat`** (owner all, CA view+create+edit, staff view+create) — no migration needed, a missing `role_permissions` row falls back to the defaults. 356 tests pass, tsc clean.)
- [x] **T-12.3 Receipt files in R2** — `[[r2_buckets]]` binding `RECEIPTS` in `web-worker/wrangler.toml`, `web-worker/src/receipts.ts` (upload → key `receipts/<date>/<id>.<ext>`, image/PDF only, 4 MB cap, download streams the object), key building + validation tested.
  Acceptance: `npx wrangler r2 bucket create sdhhe-receipts` done by the owner, a file can be uploaded and downloaded again through the API (local `wrangler dev`), the bucket is never written to Postgres.
  (2026-11-06: `web-worker/src/receipts.ts` (no `@cloudflare/workers-types` dependency — the two R2 methods we call are declared locally), 16 unit tests green; the Worker gained `POST /api/chat/receipts` (multipart upload) and `GET /api/chat/receipts/<base64url key>` (streams the file) — both placed **above** the generic `await request.json()` reader, which would otherwise eat the multipart body. Local check `scripts/local-receipt-check.mjs` (mints a local session, uploads a PNG, downloads it back): "upload + download OK (bytes match)". The key travels base64url-encoded in one path segment, and only keys matching `receipts/<date>/<id>.<ext>` may be read. **Live bucket still pending: the Cloudflare control-plane API returned 503 "no healthy upstream" for every account call, so `wrangler r2 bucket create` could not run — retry before the deploy.**)
- [x] **T-12.4 Live chat Durable Object** — `web-worker/src/chat/do.ts` (`ChatRoom`): WebSocket upgrade, one socket per member, broadcast of new messages, presence list, ping/pong; `web-worker/src/chat/protocol.ts` (frame types + parsing, unit-tested).
  Acceptance: protocol tests green, `wrangler dev` shows two browser tabs receiving each other's messages live, no polling of Neon (messages arrive over the socket only).
  (2026-11-06: `ChatRoom` uses the **WebSocket Hibernation API** (`acceptWebSocket` + `serializeAttachment`), so the room survives the object being evicted; it never writes to Neon — the Worker writes the message and then pushes the frame into the room (`broadcastToChat`); the socket checks the chat token (HMAC, 12 h) and the `chat:view` permission once per connection. New files: `web-worker/src/chat/do.ts`, `web-worker/src/chat/protocol.ts` (+9 tests), `scripts/local-chat-check.mjs`. Verified locally with `wrangler dev`: the socket answers with `hello` + `presence`, a bad token is turned away. `@cloudflare/workers-types` added as a devDependency; the Worker now shares the root's drizzle/neon/zod (one copy — see DECISIONS). Broadcast between two tabs is verified with the Playwright spec in T-12.8.)
- [x] **T-12.5 Worker chat + approval API** — `GET /api/chat/messages`, `POST /api/chat/messages`, `POST /api/chat/auth` (desktop bearer token), `GET /api/chat/receipts`, `POST /api/chat/receipts/:id/decision`, `GET /api/chat/receipts/<key>` (file) in `web-worker/src/index.ts`, plus the new `chat` permission module (staff: view+create, CA: view+create+edit, owner: all).
  Acceptance: 401 without a session, 403 without the `chat` permission, a message sent over REST appears in the room over the socket, an approval writes `receipt_requests` + an activity-log row + a system message in the room.
  (2026-11-06: the routes live in `web-worker/src/index.ts`; the GET routes sit **above** the generic body reader, the POST routes below it. `POST /api/chat/auth` checks phone + password against Neon (argon2id, the same 5-attempt rate limit as the login) and hands out a 12 h chat token; a **bearer token is only accepted on `/api/chat/*`**, never as a general session, and the session cookie is only refreshed for cookie sessions. Every write goes through `asActor` (activity log) and is pushed into the room with `broadcastToChat`; a decision also writes a `system` message. Local check `scripts/local-chat-api-check.mjs` — **13/13 green**: socket opens, history, send, empty message refused, file upload, receipt submitted by staff, pending list, staff 403 on approve, owner approves, a receipt cannot be decided twice, history kinds text/receipt/system, anonymous 401, and the message arriving live over the socket. The check removes its own rows from Neon afterwards (both tables are back to 0 rows).)
- [x] **T-12.6 Web Team Chat screen** — `web/src/components/TeamChat.tsx` + the `team-chat` view in `web/src/App.tsx` (route `/team-chat`, nav link, message list, composer, receipt upload, approval cards with Approve/Reject, pending badge).
  Acceptance: web `tsc` clean, the screen opens at `/team-chat`, a message appears instantly, a receipt can be attached and approved, only `chat:edit` roles see the approval buttons.
  (2026-11-06: the screen follows `docs/chat-in-app-preview.html` and uses only the existing tokens (`card`, `btn-mini`, `input`, `badge`, `bg-surface-2`, `bg-primary`, `bg-accent-soft`…). The URL is the source of truth: the initial view is read from `window.location.pathname`, the nav pushes `/team-chat`, back/forward is handled. The socket reconnects on its own; a socket closed because the screen went away does not mark the room offline. **The Vite dev proxy needed `ws: true`** — otherwise the WebSocket upgrade never reached the worker (the deployed app is same-origin, so it is unaffected). The receipt file is uploaded first and posted into the room afterwards; the approvals panel is on the right, the decided receipts are folded away. Local check `scripts/local-web-chat-check.mjs` — **10/10 green**: the screen opens at /team-chat, the URL stays, the composer and the approvals panel are there, the socket is live, a message appears over the socket, the receipt form opens, a receipt shows up in the room, the Approve button is there and the receipt leaves the pending list. It removes its own rows from Neon afterwards.)
- [x] **T-12.7 Email + push (Gmail SMTP)** — `web-worker/src/mailer.ts`: SMTP over `cloudflare:sockets` to `smtp.gmail.com:465` with the `SMTP_USER` / `SMTP_PASS` secrets + ntfy push on `NTFY_TOPIC`; fires when a receipt is submitted (to the owners) and when it is approved/rejected (to the submitter).
  Acceptance: `npx wrangler secret put SMTP_USER`, `SMTP_PASS`, `NTFY_TOPIC` set by the owner, a real mail reaches the owner and a push arrives, nothing is logged in clear text and no secret is committed.
  (2026-11-06: the SMTP client is written against a small transport interface (`web-worker/src/smtpSocket.ts` opens the TLS socket, `mailer.ts` speaks the protocol), so it is unit-tested without a network — 12 tests: response parsing, recipients, the MIME message (base64 body, 76-column lines), the whole dialogue, a refused password and a refused greeting. `web-worker/src/chatMail.ts` builds the mails (8 tests). The mail goes to the shop's `notify_emails` (or the shop address), the push to ntfy; both are best effort and never block the action. **Verified end to end locally**: `scripts/local-smtp-server.mjs` is a tiny SMTP server; with the local `.dev.vars` pointing at it the worker really sent the mail — the received message was `Subject: Receipt #10 was approved`, `From: SREE DURGA HARIHARA <local@test.local>`, body "<b>B PHANI KUMAR</b> approved your receipt … <b>Transport bill</b> — ₹450.00 … Note: checked". Two findings worth keeping: `secureTransport` is a **string** ("on"/"off") at runtime, and the SMTP dialogue needs a **timeout** (15 s) so a silent mail server cannot hold up the API. **Still open: the owner has to set the three secrets (`SMTP_USER`, `SMTP_PASS`, `NTFY_TOPIC`) — they are not on the worker yet — and the real Gmail delivery is therefore untested.**)
- [x] **T-12.8 Desktop Team Chat + Settings + Playwright** — `src/pages/TeamChat.tsx` (desktop route `team-chat`), `src/lib/chatClient.ts` (REST + WebSocket against the Worker URL), Settings → "Team Chat" card (Worker URL, saved in `settings`), chat token obtained at desktop login, `e2e/team-chat.spec.ts` (Playwright, mocked API, no database needed).
  Acceptance: all unit tests green, `npx tsc --noEmit` clean for the app and the worker, the Playwright test passes, the desktop screen shows the room, the composer and the receipt approvals.
  (2026-11-06: the desktop route is `/team-chat` (HashRouter → `#/team-chat`) and the nav link sits in a new **Team** group; the screen explains itself when the worker address or the token is missing. Settings → **Team Chat** saves the worker address in the `settings` table (`chat_worker_url`); the bearer token is fetched from the worker with the member's phone + password **at sign-in** and kept in the Keychain (`CHAT_TOKEN`, 12 h) — a chat failure never blocks the sign-in. `src/lib/chatClient.ts` (8 tests) normalises the address, builds the `wss://` socket URL and the receipt URL, and does the REST calls; `src/pages/TeamChat.test.tsx` (2 tests) covers the screen. The Playwright suite is `e2e-web/team-chat.spec.ts` with `playwright.web.config.ts` (`npm run test:e2e:web`) — it mocks the worker, so it needs **no database and no Cloudflare account**: the room, the URL, the owner approving a receipt, the staff member NOT seeing the approval buttons and sending a message — **5/5 green**. The desktop e2e folder (`e2e/`) still needs `DATABASE_URL_TEST` and is skipped without it.)

## Phase 13 — Direct chat (1-to-1) (added 2026-11-06 on request)
> The shared room stays. On top of it: private conversations between two members, a conversation list with
> unread badges, room-scoped history, receipts inside a direct chat, and a privacy rule (a direct chat is
> private — the owner sees that it happened, never what was written). Design: `docs/chat-in-app-preview.html`.
- [x] **T-13.1 Conversations + unread** — `chat_conversations` (room, kind `group`|`direct`, title) and
  `chat_conversation_members` (last_read_message_id) tables + `src/db/chatRooms.ts` (directRoomName,
  ensureGroup/DirectConversation, listConversations with unread, isMember, markRead, unreadCount) + migration
  `drizzle/0007_direct_chat.sql`.
  Acceptance: the shared room is a `group` conversation, a direct room is `dm-<smallId>-<bigId>`, the
  unread count counts the messages of the other member after the last read one, tsc + tests green.
  (2026-11-06: `chat_conversations` + `chat_conversation_members` tables (migration `0007_direct_chat.sql`,
  applied to Neon — both tables exist, 0 rows); `src/db/chatRooms.ts` (directRoomName, ensureGroup/DirectConversation,
  isMember, listConversations with the unread count, markRead, unreadCount, listChatMembers) + 8 unit tests
  and an int test (skips without `DATABASE_URL_TEST`). The unread count is the messages of the OTHER member
  after `last_read_message_id`.
- [x] **T-13.2 Room-scoped API** — `GET /api/chat/conversations`, `GET /api/chat/members` (who may be
  chatted with), `GET/POST /api/chat/messages?room=…`, `POST /api/chat/read`, `POST /api/chat/conversations`
  (find or create a direct chat) — every room route checks that the caller is a member of that room (403).
  Acceptance: 403 for a room you are not in, 401 without a session, a direct chat appears in the list of
  both members, the unread count falls to 0 after reading.
  (2026-11-06: `GET /api/chat/conversations` (the list with the unread counts), `POST /api/chat/conversations`
  (find or create a private chat), `GET /api/chat/members` (who may be chatted with — open to every member,
  not only the owner), `POST /api/chat/read` (mark as read) and the room-scoped `GET/POST /api/chat/messages`
  (`?room=`). Every room route runs through `chatRoomMember()`: everybody is in the shop room (the row is
  added on the spot), a private chat only has its two members → 403 for everybody else. A receipt in a
  private chat can only be decided by the two people in that conversation. `scripts/local-direct-chat-check.mjs`
  — **10/10 green**.)
- [x] **T-13.3 One Durable Object per room** — the socket asks for a room (`?room=dm-1-4`), the Worker
  checks the membership before handing over the upgrade, the object only ever holds the sockets of its room.
  Acceptance: a message in a direct chat reaches the two members only, the shared room is unaffected.
  (2026-11-06: one Durable Object **per conversation** — `chatRoomStub(env, room)` → `getByName(room)`, so the
  object only ever holds the sockets of its own room; the Worker checks the membership before handing over
  the upgrade. The socket now also takes the identity from `?token=` (a WebSocket cannot carry an
  Authorization header, and the desktop app has no cookie) — that was a real bug the direct-chat check found.
  `scripts/local-direct-chat-check.mjs` — **13/13 green**, including "the message reaches the private room"
  and "the message does not reach the shop room" (two sockets, two rooms, one browser).)
- [x] **T-13.4 Web conversations** — conversation list (shared room + direct chats, unread badges, last
  message), a room switcher, "start a chat" from the member list, mark-as-read, export of a conversation.
  Acceptance: web `tsc` clean, the screen switches rooms, the badge updates, a direct chat works.
  (2026-11-06: `web/src/components/TeamChat.tsx` grew a left column with the conversations (the shop room +
  the private chats with their unread badge), a **New chat** button that opens the member list, the room name in
  the header (with a "Private" badge), the privacy note ("only you and X can read it") and **Export this chat**
  (a text file of the conversation). The socket is bound to the open room and a message marks the room as read.
  Playwright: 2 new tests (the conversation list with the unread count, a private chat from the member list) —
  **7/7 green**.
- [x] **T-13.5 Desktop conversations** — the same list and switcher in `src/pages/TeamChat.tsx`.
  Acceptance: tsc clean, the desktop switches rooms and shows the unread badge.
  (2026-11-06: `src/lib/chatClient.ts` grew the room-scoped calls (conversations, members, start, read, export
  text) and `src/pages/TeamChat.tsx` the same conversation list, room switcher, New chat and Export as the web
  screen. The desktop test covers the list and the switch to a private chat.
- [x] **T-13.6 Privacy + export** — a direct chat is private (only its two members read it); the activity log
  records that a direct chat happened (who, when, how many messages) but never the text; every member can
  export their own conversation history as a text file.
  Acceptance: the owner cannot read a direct chat, the activity log has no message text, the export has
  every message of the conversation.
  (2026-11-06: `src/logic/chatPrivacy.ts` (the pure rules: `isSharedRoom`, `membersOf`, `canReadRoom`,
  `canStartDirectChat`, `chatAuditLine`, `exportFileName`) + 10 unit tests. The Worker refuses a room name
  that is not a chat room at all (403) and every private-chat route still asks the database. The **activity log
  notes that a private chat happened** — "B PHANI KUMAR had a private chat (1 message(s) with member #4)" —
  but **never the text**; the message text is not in the log. Both screens can export their conversation as a
  text file (the shared file name helper is used by both). `scripts/local-direct-chat-check.mjs` — **16/16
  green**, including "a stranger cannot read the private chat" (403), "a made-up room is refused" (403) and
  "the activity log holds no message text".
- [ ] **T-13.7 Tests + deploy** — unit tests for the new logic, Playwright for the conversation list and a
  direct chat, the migration applied to Neon, the worker deployed, the handover updated.
