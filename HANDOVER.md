# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-05 by OpenCode
Tool: OpenCode

## Current state
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Analytics + Web AI approved & committed by the owner on 2026-11-04.

## Done
- **T-11 Analytics + Batch analysis** (committed `18a99e7`).
- **T-10.5 + W7 WhatsApp bill + T-10.6 PDF bin** (2026-11-04). Desktop rebuilt.
- **Web email LIVE** (2026-11-04): RESEND_API_KEY set, test mail delivered.
- **V2-P11 Working capital + credit aging** (2026-11-05): `src/db/cashLedger.ts`, `cash_ledger` + `opening_balance` tables, migration `drizzle/0001_add_cash_ledger.sql`, Dashboard cards + aging chart + rotation trend, Settings → Opening balance. `src/db/cashLedger.test.ts` (9 tests).
- **Supplier dues / payable — backend + frontend** (2026-11-05): `paid_paise` on purchases + `supplier_payments` table, migration `drizzle/0002_supplier_dues.sql`, `src/db/suppliers.ts`, `src/pages/Suppliers.tsx` (/suppliers route), sidebar + route added. `src/db/suppliers.test.ts` (5 tests). `listPurchases` returns `paidPaise`.
- **UI responsiveness improvements** (2026-11-05): Layout.tsx — mobile hamburger menu, collapsible sidebar, mobile top bar, responsive padding. Suppliers.tsx — stacked mobile header, warn badges for outstanding dues, tel input for phone. Dashboard.tsx — stacked mobile header. tsc clean, 290 tests pass, web built + deployed.

## Next tasks
1. Apply `drizzle/0001_add_cash_ledger.sql` + `drizzle/0002_supplier_dues.sql` to Neon (manual — agent can't run drizzle push).
2. Owner approves/rejects analytics work → commit T-11.
3. Web edition screens, page-level UI tests, capital withdrawals, true average stock value.
4. Email finish: verify Resend domain → MAIL_FROM → Send test via UI.

## Commands
- Tests: `npx vitest run --reporter=dot` (290) · `npx tsc --noEmit`
- Desktop: `npm run tauri dev`
- Web build: `cd web && npm run build` · deploy: `cd ../web-worker && ./node_modules/.bin/wrangler deploy`

## Blockers
- Neon HTTP (fetch) flaky from this machine: retry 3–5× before trusting a failure.
- drizzle-kit push can't run from this agent (non-TTY): migration SQL must be applied manually.
