# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-15 by OpenCode (web: Customers page header + table polish; same header pattern on Items, Invoices, Purchases, Expenses)
Tool: OpenCode
## Current state
- **Customers page polished (`web/src/App.tsx`, `web/src/styles.css`, `web/src/components/ResponsiveTable.tsx`):**
  - Header is one flex row (`display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap`): title block left, search + "Add customer" right; right edge lines up with the table card below (same section padding).
  - Search + "Add customer" sit side by side (`display:flex; gap:10px; align-items:center`), both 44px tall / 12px radius; "Add customer" is now flat (no drop shadow), matching the card.
  - Search input has a magnifier icon (padding-left:38px), placeholder "Search name, phone or GSTIN", ~300px wide, focus ring = brown border + 3px soft ring.
  - "…created" / "…updated" / "…removed" messages replaced with bottom-right toasts (green ✓ for success, auto-hide after 3s); errors are error toasts.
  - Customer column ~30%, names on one line with ellipsis truncation + title tooltip; Bills "0" and Billed "₹0.00" shown in muted grey when zero; Delete is a ghost red text button (still confirms); Edit stays outlined; all cells vertically centred.
  - Below 768px the header stacks (title top, actions full width, search flex:1); tables keep scrolling horizontally inside their cards.
- Same header pattern (title left, search + primary button right, one row) applied to Items, Invoices (bills), Purchases and Expenses lists, each with client-side search over already-loaded rows (no data logic changed).
- Verified: `web` `tsc --noEmit` clean, `npm run build` (vite) clean, root suite 533 tests pass, root `tsc` errors unchanged from clean tree (pre-existing test-file issues).

## Next task
**Every mobile screen now at web parity.** Phone-test the new screens (Reports/Suppliers/Activity/Team + Items/Purchases/Expenses/Stock/New Bill), fix anything the test finds — first ship the chat scroll fix via `eas update` and confirm a chat opens on its newest message, then Phase 5: `eas build` → Play Store + App Store (also re-add the Cloudflare Access policy before shipping).
Known bugs in that pass: `items.tsx` reads `item.stockRemaining` but `/api/items` returns `stockLeftBase`; items/purchases/expenses routes exist but are not in the tab bar or linked from More.
