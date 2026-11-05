# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-05 by OpenCode
Tool: OpenCode

## Current state
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Analytics + Web AI approved & committed by the owner on 2026-11-04.
Migrations applied to Neon: `0001_add_cash_ledger.sql` + `0002_supplier_dues.sql` (both OK).

## Done
- **T-11 Analytics + Batch analysis** (committed `18a99e7`).
- **T-10.5 + W7 WhatsApp bill + T-10.6 PDF bin** (2026-11-04). Desktop rebuilt.
- **Web email LIVE** (2026-11-04): RESEND_API_KEY set, test mail delivered.
- **V2-P11 Working capital + credit aging** (2026-11-05): `src/db/cashLedger.ts`, `cash_ledger` + `opening_balance` tables, Dashboard cards + aging chart + rotation trend, Settings → Opening balance. `src/db/cashLedger.test.ts` (9 tests).
- **Supplier dues / payable — backend + frontend** (2026-11-05): `paid_paise` on purchases + `supplier_payments` table, `src/db/suppliers.ts`, `src/pages/Suppliers.tsx` (/suppliers route). `src/db/suppliers.test.ts` (5 tests). `listPurchases` returns `paidPaise`.
- **UI responsiveness improvements** (2026-11-05): Layout.tsx mobile sidebar/top bar, Suppliers + Dashboard polish.
- **Supplier dues — web edition** (2026-11-05): `src/logic/permissions.ts` (suppliers module), `web-worker/src/index.ts` (API routes /api/suppliers, /api/supplier-dues, /api/supplier-payments), `web/src/api.ts` (client types + functions), `web/src/App.tsx` (View, Money nav tab, suppliers page). Web built + deployed.
- **Session security — web edition** (2026-11-05): 1-hour inactivity auto-logout with sliding window (lastActivity refreshed on every API response, clearCookie on idle expiry); 24-hour login-without-logout check (`getSessionsWithoutLogoutLast24Hours`, GET /api/sessions/open, owner only); frontend dispatches `sdhhe:unauthorized` on 401 and clears user state. tsc clean (root/web/web-worker), 290 tests pass, web built + deployed.

## Next tasks
1. Owner approves/rejects analytics work → commit T-11.
2. Web edition screens, page-level UI tests, capital withdrawals, true average stock value.
3. Email finish: verify Resend domain → MAIL_FROM → Send test via UI.

## Commands
- Tests: `npx vitest run --reporter=dot` (290) · `npx tsc --noEmit`
- Desktop: `npm run tauri dev`
- Web build: `cd web && npm run build` · deploy: `cd ../web-worker && ./node_modules/.bin/wrangler deploy`

## Blockers
- None.