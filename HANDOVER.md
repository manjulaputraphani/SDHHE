# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-24 by OpenCode (Green Coffee Pricing Calculator added to the web app + worker)
Tool: OpenCode

## Current state
- **Green Coffee Pricing Calculator (new "Pricing Calculator" module):**
  - Shared pure logic `src/logic/pricing.ts`: `calculatePricing()`, `validatePricingInputs()`, `formatPricingMoney()` (Indian grouping), defaults. Tests `src/logic/pricing.test.ts` (15 pass) cover the requested numbers: landed 337.36, bulk/regular/small 360/365/375, profit 22.64/27.64/37.64, monthly 11,322/8,293/3,764, total 23,379, roaster max 379.84.
  - Web UI `web/src/components/PricingCalculator.tsx` + `web/src/App.tsx` ("Pricing Calculator" under Sales): live inputs (two columns desktop, stacked mobile), headline regular price, landed + roaster max, stacked bar, buyer table + total, red/green status, collapsible formulas, GST note, inline validation, Save, History tab (grade + date filters, Open reloads inputs, owner-only Delete), "Use latest purchase price".
  - Worker `web-worker/src/index.ts`: `GET /api/pricing` (filters), `GET /api/pricing/latest-price?grade=`, `POST /api/pricing` (server re-validates + recomputes results), `DELETE /api/pricing/:id` (owner only). Route permission maps to new `pricing` module.
  - DB `src/db/pricing.ts` + `src/db/schema.ts` (`pricingCalculations`) + migration `drizzle/0021_pricing_calculations.sql`: grade, note, inputs jsonb, results jsonb, created_by/name, created_at. `latestPurchasePriceForGrade()` matches item name/category (exact then contains) and returns the newest batch price per kg (on-hand first, then latest ever).
  - Permissions `src/logic/permissions.ts`: `pricing` module added (owner all; CA view/export; Staff view/create). Decisions log updated (quotes in rupees, ledger stays paise).
- Verified: `web` `tsc --noEmit` clean, `npm run build` clean, root suite 553 pass / 2 skipped. Root `tsc` shows only the pre-existing test-assertion errors; worker `tsc` shows only the pre-existing `deletePushTokensForUser` + fcm.test errors.
- Not yet done: apply `drizzle/0021_pricing_calculations.sql` (or `npx drizzle-kit push` on the dev Neon branch), deploy the worker (`wrangler deploy`) and rebuild the web assets. No DB was touched in this session.

## Next task
1. Apply migration 0021, deploy worker + web build, then open Pricing Calculator and check defaults (regular ₹365, landed ₹337.4, roaster max ₹380) and save/history/delete.
2. Older pending work still open: phone-test the mobile screens, ship the chat scroll fix via `eas update`, then Phase 5 `eas build` → Play Store + App Store (re-add Cloudflare Access before shipping).

## Blockers
- None.
