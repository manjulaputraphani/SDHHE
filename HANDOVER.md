# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-05 by OpenCode
Tool: OpenCode

## Current state
Web LIVE: https://sdhhe.blvphani.workers.dev (worker `sdhhe`) · legacy: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
`sdhhe` uses the same Neon DB as the local `.env`; secrets set: `DATABASE_URL`, `SESSION_SECRET`. Owner account id=1 (7569208757) active.
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
- **Worker `sdhhe`** (2026-11-05): new config `web-worker/wrangler.sdhhe.toml`, same Neon DB, own `DATABASE_URL` + fresh `SESSION_SECRET`. Live at https://sdhhe.blvphani.workers.dev (version `e9d4c281`). `RESEND_API_KEY` and `OLLAMA_API_KEY` still to be added for email/AI.

## Next tasks
1. Add `RESEND_API_KEY` and `OLLAMA_API_KEY` to `sdhhe` for email/AI:
   `cd web-worker && ./node_modules/.bin/wrangler secret put RESEND_API_KEY --config wrangler.sdhhe.toml` (same for OLLAMA).
2. Owner approves/rejects analytics work → commit T-11.
3. Web edition screens, page-level UI tests, capital withdrawals, true average stock value.
4. Email finish: verify Resend domain → MAIL_FROM → Send test via UI.

## Commands
- Tests: `npx vitest run --reporter=dot` (290) · `npx tsc --noEmit`
- Desktop: `npm run tauri dev`
- Web build: `cd web && npm run build`
- Deploy `sdhhe`: `cd web-worker && ./node_modules/.bin/wrangler deploy --config wrangler.sdhhe.toml`
- Deploy legacy `sdhhe-api`: `cd web-worker && ./node_modules/.bin/wrangler deploy`

## Blockers
- On `sdhhe`, email + AI endpoints return 503 until `RESEND_API_KEY` / `OLLAMA_API_KEY` are set (billing/stock/users unaffected).
- Legacy `sdhhe-api` still has its own secrets; its `DATABASE_URL` was not verifiable. Use `sdhhe` going forward.
- Owner login: account id=1, phone `7569208757`, active.
