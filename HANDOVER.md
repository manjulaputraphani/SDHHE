# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-15 by OpenCode (1:1 chat "Last seen Invalid Date" fixed — Hermes timestamp parsing + API now sends strict ISO)
Tool: OpenCode
## Current state
- **1:1 chat presence fixed (`src/logic/chat.ts`, `src/logic/chatView.ts`, `mobile/lib/chatView.ts`, `web-worker/src/index.ts`):**
  - The worker's `/api/chat/members` returned Postgres `timestamptz::text` (`2026-11-15 09:55:51.840273+00`). Chrome parses that, but Hermes (the React Native engine) rejects the hour-only `+00` offset → `new Date()` = Invalid Date, so a private chat header showed `Last seen Invalid Date at Invalid Date`.
  - API now returns `to_char(... at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` (strict ISO 8601). Both chatView copies also normalise `YYYY-MM-DD HH:MM:SS(.ffffff)+HH` before parsing and fall back to "Offline" if it is still invalid; list/day times use the same parser.
  - Tests: new presence/parse cases in `src/logic/chatView.test.ts`; root suite 538 pass, `mobile` + `web` `tsc --noEmit` clean.
  - **Deployed 2026-11-15**: worker `sdhhe-api` version `2cf903ce-66db-4282-ae17-fa3fdfa01ea8` — live at https://sdhhe-api.blvphani.workers.dev, `/api/health` 200, web assets rebuilt (`index-CUxiAGuZ.js`).
- **Customers page polished (`web/src/App.tsx`, `web/src/styles.css`, `web/src/components/ResponsiveTable.tsx`):**
  - Header is one flex row (`display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap`): title block left, search + "Add customer" right; right edge lines up with the table card below (same section padding).
  - Search + "Add customer" sit side by side (`display:flex; gap:10px; align-items:center`), both 44px tall / 12px radius; "Add customer" is now flat (no drop shadow), matching the card.
  - Search input has a magnifier icon (padding-left:38px), placeholder "Search name, phone or GSTIN", ~300px wide, focus ring = brown border + 3px soft ring.
  - "…created" / "…updated" / "…removed" messages replaced with bottom-right toasts (green ✓ for success, auto-hide after 3s); errors are error toasts.
  - Customer column ~30%, names on one line with ellipsis truncation + title tooltip; Bills "0" and Billed "₹0.00" shown in muted grey when zero; Edit/Delete are now 36px icon-only circle buttons (pencil/trash, 18px icons, beige `#fbf7f1` + `#e6dccf` border, brown `#5c4632` / red `#b0412e`, red hover `#fbe9e5`), side by side with 8px gap, title + aria-label, delete still confirms; table row padding shrunk to `py-1.5`.
  - Same icon row actions (`web/src/components/RowActions.tsx` + `.row-action` in `styles.css`, icons `IconPencil`/`IconTrash2` in `components/icons.tsx`) used on Items, Invoices (delete), Purchases (edit), Expenses and Investments tables.
  - Below 768px the header stacks (title top, actions full width, search flex:1); tables keep scrolling horizontally inside their cards.
- Same header pattern (title left, search + primary button right, one row) applied to Items, Invoices (bills), Purchases and Expenses lists, each with client-side search over already-loaded rows (no data logic changed).
- Verified: `web` `tsc --noEmit` clean, `npm run build` (vite) clean, root suite 538 tests pass, root `tsc` errors unchanged from clean tree (pre-existing test-file issues).

## Next task
**Every mobile screen now at web parity.** Phone-test the new screens (Reports/Suppliers/Activity/Team + Items/Purchases/Expenses/Stock/New Bill), fix anything the test finds — first ship the chat scroll fix via `eas update` and confirm a chat opens on its newest message, then Phase 5: `eas build` → Play Store + App Store (also re-add the Cloudflare Access policy before shipping).
Known bugs in that pass: `items.tsx` reads `item.stockRemaining` but `/api/items` returns `stockLeftBase`; items/purchases/expenses routes exist but are not in the tab bar or linked from More.
