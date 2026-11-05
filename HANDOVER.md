# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-05 by OpenCode
Tool: OpenCode

## Current state
Web LIVE: https://sdhhe-api.blvphani.workers.dev (worker `sdhhe-api`, all four secrets set) · Desktop = Tauri app in `src/`.
Same Neon DB as the local `.env`; owner account id=1 (7569208757) active.
Analytics + Web AI approved & committed by the owner on 2026-11-04.
Migrations applied to Neon: `0001_add_cash_ledger.sql` + `0002_supplier_dues.sql` (both OK).
DB WIPED 2026-11-05: all 22 app tables empty, sequences reset (verified 0 rows).
DB backup intentionally NOT taken (owner chose no backup).

## Done
- **T-11 Analytics + Batch analysis** (committed `18a99e7`).
- **T-10.5 + W7 WhatsApp bill + T-10.6 PDF bin** (2026-11-04). Desktop rebuilt.
- **Web email LIVE** (2026-11-04): RESEND_API_KEY set, test mail delivered.
- **V2-P11 Working capital + credit aging** (2026-11-05): `src/db/cashLedger.ts`, `cash_ledger` + `opening_balance` tables, Dashboard cards + aging chart + rotation trend, Settings → Opening balance. `src/db/cashLedger.test.ts` (9 tests).
- **Supplier dues / payable — backend + frontend** (2026-11-05): `paid_paise` on purchases + `supplier_payments` table, `src/db/suppliers.ts`, `src/pages/Suppliers.tsx` (/suppliers route). `src/db/suppliers.test.ts` (5 tests). `listPurchases` returns `paidPaise`.
- **UI responsiveness improvements** (2026-11-05): Layout.tsx mobile sidebar/top bar, Suppliers + Dashboard polish.
- **Invoice deletion for admin** (2026-11-05): Added DELETE /api/bills/:id endpoint (owner only) in web-worker/src/index.ts and UI delete button in bills page (visible only for owner). (WhatsApp bill button hidden; PDF via print/download only).
- **Session security — web edition** (2026-11-05): 1-hour inactivity auto-logout with sliding window (lastActivity refreshed on every API response, clearCookie on idle expiry now properly matches Secure flag for HTTPS sites); 24-hour login-without-logout check (`getSessionsWithoutLogoutLast24Hours`, GET /api/sessions/open, owner only); frontend dispatches `sdhhe:unauthorized` on 401 and clears user state. tsc clean (root/web/web-worker), 290 tests pass, web built + deployed.
- **Production DB reset** (2026-11-05): `TRUNCATE` on the 22 explicit app tables only (never CamelCase/unrelated tables or `sdhhe_fy2025`), `RESTART IDENTITY CASCADE`; verified 0 rows. Unrelated tables in the Neon project untouched.
- **Build unblock + redeploy** (2026-11-05): fixed missing arrow-function closing brace in the bills actions column in `web/src/App.tsx`; moved `const actor` above the read routes in `web-worker/src/index.ts` (TDZ error). `tsc` clean (web + worker), 290 tests pass, web build OK, deployed `sdhhe-api` version `e41948e1`.
- **Worker cleanup** (2026-11-05): briefly created `sdhhe` (same DB, version `e9d4c281`), then deleted it at owner request; config `web-worker/wrangler.sdhhe.toml` removed. Only `sdhhe-api` remains (verified 200; `sdhhe` now 404).
- **Item HSN code** (2026-11-05): `items.hsn_code` (migration `drizzle/0003_item_hsn_code.sql`, applied to Neon). HSN field on the item form + list in web and desktop; bill lines fall back to the item HSN when the line HSN is blank. Web item edit now preserves min stock. 293 tests pass, tsc clean, deployed `sdhhe-api` version `b33ef219`.
- **Item units** (2026-11-05): item form now offers only `kg` and `60 kg bag` (1 bag = 60 kg = 60,000 g); `l` and `pcs` removed from the form. Bag factor wired through costing, stock valuation SQL, analytics, dashboard, cash ledger and web display. 294 tests pass, deployed `sdhhe-api` version `15de4fe4`.
- **Purchases date** (2026-11-05): Date field on the web Purchases form (defaults to today, past dates allowed). If left blank it silently falls back to today; same fallback added to desktop AddPurchase. 294 tests pass, deployed `sdhhe-api` version `0476dd7f`.
- **Owner purchase edit** (2026-11-05): Recent purchases now has an owner-only **Edit** action opening a full modal (date, qty, rate, transport, supplier, payment mode, note). `PUT /api/purchases/:id` (owner only) reuses `updatePurchase`, updating purchase + batch + PURCHASE movement (incl. expenses), replaying FIFO and rebuilding WAC. 296 tests pass, deployed `sdhhe-api` version `e8680d02`.
- **Supplier edit check** (2026-11-05): verified `updatePurchase` changes a purchase's supplier server-side (temporary 1 g purchase created, updated to `U C F`, deleted; no leftovers). Web edit modal now puts Supplier at the top, offers existing suppliers via datalist, and scrolls on small screens. Deployed `sdhhe-api` version `91676053`.
- **Supplier correction + save guard** (2026-11-05): set purchase #1's supplier to `U C W` (id 4); verified item, qty, rate, total, transport, date, paid, mode and note unchanged. Removed the unused `U C F` supplier. Web edit modal now disables Save while saving (no multiple clicks) and shows errors inline. Deployed `sdhhe-api` version `c3c81b2b`.
- **Expense / cash-ledger fix** (2026-11-05): manual migrations created `created_at NOT NULL` with no default on `cash_ledger`, `opening_balance`, `supplier_payments`; added `DEFAULT now()` (migration `drizzle/0004_created_at_defaults.sql`, applied live). Deduplicated three identical failed transport expenses to one and posted its ₹100 ledger entry. Web expense buttons now disable while saving. Deployed `sdhhe-api` version `da707348`.
- **Owner expense delete** (2026-11-05): Recent expenses has an owner-only **Delete** action with confirm. `DELETE /api/expenses/:id` is owner-only and now also removes the linked `cash_ledger` expense entry (previously it was left behind). 296 tests pass, deployed `sdhhe-api` version `f4ec8d2c`.
- **Purchase edit prefill** (2026-11-05): the API returns `purchase_date` as a full ISO timestamp, which `<input type="date">` rejects. Edit now normalises it to `YYYY-MM-DD`, so date/qty/rate/transport/supplier/mode/note all open prefilled; only the field you change is effectively edited. Deployed `sdhhe-api` version `b3586dfd`.
- **Owner expense edit** (2026-11-05): Recent expenses has an owner-only **Edit** modal prefilled with date/type/category/amount/paid-to/mode/note. `PUT /api/expenses/:id` is owner-only and now syncs the linked `cash_ledger` entry (amount/date/note). 296 tests pass, deployed `sdhhe-api` version `5b5a7f1f`.
- **Roasted seeds** (2026-11-05): new `roastings` table, `purchases.source`, `ROASTING` movement type. Web **Roasting** tab (Inventory): raw item → roasted item, editable yield (default 1.200), ₹/kg roasted charge, date, margin %, live cost/kg + suggested price. Server consumes raw FIFO/WAC, creates an internal roasted purchase/batch (excluded from Purchases, spend stats and supplier dues), transfers the exact cost. Migration `0005_roasting.sql` applied live. E2E verified: 120 kg raw @ ₹100 → 100 kg roasted, ₹2,000 charge, ₹14,000 total, ₹140/kg, ₹168/kg at 20%. 303 tests pass, deployed `sdhhe-api` version `7288972a`.
- **Invoice GSTIN** (2026-11-05): missing seller/buyer GSTIN now prints **NA** (was `—`). When either GSTIN is missing (B2C/unregistered), the bill screen defaults to intra-state CGST+SGST, matching the printed invoice. Deployed `sdhhe-api` version `47d0ee77`.
- **Customer without GST** (2026-11-05): GSTIN is explicitly optional in Add/Edit customer and billing; blank fields are omitted (stored as null). Inline name validation, saving state and in-form error message added. DB already accepted a null GSTIN (verified with a temp customer). Deployed `sdhhe-api` version `16cbdb22`.
- **GSTIN "NA" collision fix** (2026-11-05): `normaliseGstin` treats `NA`, `N/A`, `-` and blank as null, so adding another no-GST customer no longer matches/updates the first one. Existing `NA` GSTIN/email values cleaned to null. Deployed `sdhhe-api` version `601102c5`.
- **Customer create/update split** (2026-11-05): `POST /api/customers` is now create-only (never updates; duplicate phone/GSTIN gives “use Edit”); `PUT /api/customers/:id` updates; `POST /api/customers/save` remains the billing find-or-create. UI has separate **Create customer** / **Update customer** buttons and functions. Verified create + duplicate block against the live DB. Deployed `sdhhe-api` version `4e6555be`.
- **Roasting nav fix** (2026-11-05): sidebar filtering now maps the Roasting link to the **stock** permission (`module: "stock"`), so it appears for stock-view roles. Deployed `sdhhe-api` version `037413bc` (bundle contains `Roasting`).
- **Roasting redirect fix** (2026-11-05): the "can I view this tab" redirect also maps `roasting` → `stock`; previously it bounced Roasting back to Dashboard. Deployed `sdhhe-api` version `b9e62880`.
- **New Bill pricing helper** (2026-11-05): selecting an item auto-fills **HSN** from the item master. Web + desktop New Bill show **avg cost/unit**, an editable **margin %** and **suggested rate**, with a **Use suggested** button. Deployed `sdhhe-api` version `d691ed77`.
- **Margin default** (2026-11-05): New Bill helper and Roasting margin now default to **6%** (was 20%). Deployed `sdhhe-api` version `fc8361a8`.

## Next tasks
1. Add the **Roasting** screen to the desktop app (shared `createRoasting`/`listRoastings` already work; only web UI exists).
2. Roasted-batch cost is a snapshot: editing an old raw purchase does not recost past roasts (future enhancement).
3. Owner approves/rejects analytics work → commit T-11.
4. Web edition screens, page-level UI tests, capital withdrawals, true average stock value.
5. Email finish: verify Resend domain → MAIL_FROM → Send test via UI.

## Commands
- Tests: `npx vitest run --reporter=dot` (303) · `npx tsc --noEmit`
- Desktop: `npm run tauri dev`
- Web build: `cd web && npm run build`
- Deploy: `cd web-worker && ./node_modules/.bin/wrangler deploy`

## Blockers
- `sdhhe-api.DATABASE_URL` was not readable/verifiable, but login probes confirm it sees the same owner row as the local `.env` DB.
- Owner login: account id=1, phone `7569208757`, active.
