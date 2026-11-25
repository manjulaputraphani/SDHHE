# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-25 by OpenCode (native mobile pricing screen finished; docs updated; web/PWA deployed)
Tool: OpenCode

## Current state
- **Green Coffee Pricing Calculator (new "Pricing Calculator" module):**
  - Shared pure logic `src/logic/pricing.ts`: `calculatePricing()`, `validatePricingInputs()`, `formatPricingMoney()` (Indian grouping), defaults. Tests `src/logic/pricing.test.ts` (15 pass) cover the requested numbers: landed 337.36, bulk/regular/small 360/365/375, profit 22.64/27.64/37.64, monthly 11,322/8,293/3,764, total 23,379, roaster max 379.84.
  - Web UI `web/src/components/PricingCalculator.tsx` + `web/src/App.tsx` ("Pricing Calculator" under Sales): live inputs (two columns desktop, stacked mobile), headline regular price, landed + roaster max, stacked bar, buyer table + total, red/green status, collapsible formulas, GST note, inline validation, Save, History tab (grade + date filters, Open reloads inputs, owner-only Delete), "Use latest purchase price".
  - Worker `web-worker/src/index.ts`: `GET /api/pricing` (filters), `GET /api/pricing/latest-price?grade=`, `POST /api/pricing` (server re-validates + recomputes results), `DELETE /api/pricing/:id` (owner only). Route permission maps to new `pricing` module.
  - DB `src/db/pricing.ts` + `src/db/schema.ts` (`pricingCalculations`) + migration `drizzle/0021_pricing_calculations.sql`: grade, note, inputs jsonb, results jsonb, created_by/name, created_at. `latestPurchasePriceForGrade()` matches item name/category (exact then contains) and returns the newest batch price per kg (on-hand first, then latest ever).
  - Permissions `src/logic/permissions.ts`: `pricing` module added (owner all; CA view/export; Staff view/create). Decisions log updated (quotes in rupees, ledger stays paise).
- **Phone layout + discoverability:** buyer table becomes stacked cards below 640px (no sideways scroll), history uses `ResponsiveTable` stacked cards, headline shrinks to `text-4xl` on phones, and the Dashboard has a "Pricing calculator" shortcut card (visible when the role can view pricing) in addition to Sales → Pricing Calculator in the sidebar/More sheet.
- **Live:** Neon `pricing_calculations` table created (migration 0021 applied 2026-11-24); worker deployed as version `a7d22cc1-8109-46fb-9e37-6fcb8e483eeb`; live asset `assets/index-ulwgX9bT.js`; `/api/health` 200.
- **Mobile app:** `mobile/app/pricing.tsx` + `mobile/lib/pricingStore.ts` add the native screen (same shared `calculatePricing`, offline-first local queue in AsyncStorage, saved quotes sync when online, share quote, grade + note, history, latest stock price). It is linked from More → Pricing Calculator; `metro.config.js` watches `src/logic` so Metro can import the shared module; the Android APK workflow now also triggers on `src/logic/pricing.ts`. `mobile` `tsc --noEmit` clean. Not yet published — needs an EAS update/build.
- Verified: `web` `tsc --noEmit` clean, `npm run build` clean, root suite 553 pass / 2 skipped, `mobile` `tsc --noEmit` clean. Root `tsc` shows only the pre-existing test-assertion errors; worker `tsc` shows only the pre-existing `deletePushTokensForUser` + fcm.test errors.
- **Docs updated:** `README.md` (module row, stack, structure, data model, RBAC, commands, mobile run steps), `docs/BLUEPRINT.md` §4/§7/§10, `docs/BUILD_PLAN.md` P-1…P-9, `docs/TESTING.md` A6 + C4, `docs/SETUP.md` §7–8, `docs/MOBILE_APP_PLAN.md` shipped section, `docs/DECISIONS.md` (rupee-quote decision).

## Next task
1. On a phone browser: sign in → Dashboard "Pricing calculator" or More → Sales → Pricing Calculator. Check defaults (regular ₹365, landed ₹337.4, roaster max ₹380), Save, History filters/Open, and owner Delete.
2. Publish the native mobile pricing screen: `eas update` (or a new APK build) so installed Android/iOS apps receive it.
3. Older pending work still open: phone-test the mobile screens, ship the chat scroll fix via `eas update`, then Phase 5 `eas build` → Play Store + App Store (re-add Cloudflare Access before shipping).

## Blockers
- None.
