# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-15 by OpenCode (row actions are icon-only buttons: Customers, Items, Invoices, Purchases, Expenses, Investments)
Tool: OpenCode
## Current state
- **Customers page polished (`web/src/App.tsx`, `web/src/styles.css`, `web/src/components/ResponsiveTable.tsx`):**
  - Header is one flex row (`display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap`): title block left, search + "Add customer" right; right edge lines up with the table card below (same section padding).
  - Search + "Add customer" sit side by side (`display:flex; gap:10px; align-items:center`), both 44px tall / 12px radius; "Add customer" is now flat (no drop shadow), matching the card.
  - Search input has a magnifier icon (padding-left:38px), placeholder "Search name, phone or GSTIN", ~300px wide, focus ring = brown border + 3px soft ring.
  - "…created" / "…updated" / "…removed" messages replaced with bottom-right toasts (green ✓ for success, auto-hide after 3s); errors are error toasts.
  - Customer column ~30%, names on one line with ellipsis truncation + title tooltip; Bills "0" and Billed "₹0.00" shown in muted grey when zero; Edit/Delete are now 36px icon-only circle buttons (pencil/trash, 18px icons, beige `#fbf7f1` + `#e6dccf` border, brown `#5c4632` / red `#b0412e`, red hover `#fbe9e5`), side by side with 8px gap, title + aria-label, delete still confirms; table row padding shrunk to `py-1.5`.
  - Same icon row actions (`web/src/components/RowActions.tsx` + `.row-action` in `styles.css`, icons `IconPencil`/`IconTrash2` in `components/icons.tsx`) used on Items, Invoices (delete), Purchases (edit), Expenses and Investments tables.
  - Below 768px the header stacks (title top, actions full width, search flex:1); tables keep scrolling horizontally inside their cards.
- Same header pattern (title left, search + primary button right, one row) applied to Items, Invoices (bills), Purchases and Expenses lists, each with client-side search over already-loaded rows (no data logic changed).
- Verified: `web` `tsc --noEmit` clean, `npm run build` (vite) clean, root suite 533 tests pass, root `tsc` errors unchanged from clean tree (pre-existing test-file issues).
- **Deployed 2026-11-15**: worker `sdhhe-api` version `489f7f7e-4d79-4cfc-a0d9-eddb9529f506` — live at https://sdhhe-api.blvphani.workers.dev, site + `/api/health` 200, new CSS/JS assets confirmed.

## Next task
**Every mobile screen now at web parity.** Phone-test the new screens (Reports/Suppliers/Activity/Team + Items/Purchases/Expenses/Stock/New Bill), fix anything the test finds — first ship the chat scroll fix via `eas update` and confirm a chat opens on its newest message, then Phase 5: `eas build` → Play Store + App Store (also re-add the Cloudflare Access policy before shipping).
Known bugs in that pass: `items.tsx` reads `item.stockRemaining` but `/api/items` returns `stockLeftBase`; items/purchases/expenses routes exist but are not in the tab bar or linked from More.
