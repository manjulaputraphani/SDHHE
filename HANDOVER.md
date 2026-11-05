# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-05 by OpenCode
Tool: OpenCode

## Current state
Web LIVE: https://sdhhe-api.blvphani.workers.dev · Desktop = Tauri app in `src/`.
Analytics + Web AI approved & committed by the owner on 2026-11-04.

## Done
- **T-11 Analytics dashboard + Batch analysis** (committed `18a99e7`).
- **T-10.5 + W7 WhatsApp bill + T-10.6 PDF bin** (2026-11-04). Desktop rebuilt 2026-11-05.
- **Web email LIVE** (2026-11-04): RESEND_API_KEY set, test mail delivered to blvphani@gmail.com.
- **V2-P11 Working capital + credit aging** (2026-11-05): new `src/db/cashLedger.ts` (cash ledger, opening balance, working capital, credit aging by bucket, rotation trend), `src/db/schema.ts` (`cash_ledger` + `opening_balance` tables), migration SQL at `drizzle/0001_add_cash_ledger.sql` (NEEDS MANUAL APPLY — drizzle-kit push can't run non-TTY), Dashboard working-capital cards + aging bar chart + rotation trend line chart, Settings → Opening balance input. Auto-records cash entries on sale/payment/expense. `src/db/cashLedger.test.ts` (9 tests pass, 1 skips without DATABASE_URL_TEST). tsc clean, 290 tests pass.

## Next tasks
1. Apply `drizzle/0001_add_cash_ledger.sql` to Neon (manual — agent can't run drizzle push).
2. Owner approves/rejects analytics work → commit T-11.
3. Web edition screens, page-level UI tests, capital withdrawals, true average stock value.
4. Owner decision: SD-2026-000003/000004 real sales? Release questions.
5. Email finish: verify Resend domain → MAIL_FROM → Send test via UI.

## Commands
- Tests: `npx vitest run --reporter=dot` (290) · `npx tsc --noEmit` · cash ledger only: `npx vitest run src/db/cashLedger.test.ts`
- Desktop: `npm run tauri dev`

## Blockers
- Neon HTTP (fetch) flaky from this machine: retry 3–5× before trusting a failure.
- drizzle-kit push can't run from this agent (non-TTY): migration SQL must be applied manually.
