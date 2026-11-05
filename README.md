# Stock Tracker (SDHHE) — Billing · Inventory · Expenses · GST

A complete shop-management application: GST billing, stock tracking with batch/FIFO & weighted-average costing, purchase and expense tracking, credit (udhaar) management, financial reports, role-based access control, and a live web edition — backed by a cloud Postgres database so the data survives any laptop.

- **Live web app:** https://sdhhe-api.blvphani.workers.dev
- **Desktop app:** Tauri 2 (macOS `.app` + `.dmg` built; Windows/Linux via CI)
- **Database:** Neon Postgres (cloud) via Drizzle ORM

---

## 1. What the app does

| Module | Details |
|---|---|
| **Dashboard** | Overview + Graphs + Funds + Investors tabs. 14-day sales chart (₹, Indian short form ₹1.2L), pie/bar analytics (Recharts), "Funds with us" = actual cash position (investments + received − paid), stock value & receivables shown separately, total credit given. Working capital cards: investment (opening balance), stock value, cash in bank (cash ledger), credit outstanding, amount in rotation (stock + cash + credit). Credit aging bar chart (Current / 1–30 / 31–60 / 61–90 / 90+ days) + 30-day rotation trend line chart. |
| **Items (Inventory)** | One row per item; `unit` = kg / l / pcs; category, minimum stock, image URL, live stock and value computed from open batches |
| **Purchases** | Supplier, qty, unit price, payment mode, notes, purchase expenses (transport / loading / commission) that raise the stock cost; editing/deleting an old purchase rebuilds that item's cost pool from the remaining batches |
| **Batches & costing** | Every purchase = one batch. Costing method per settings: **FIFO** (oldest first) or **weighted average** (value pool per item: `stock_value_paise` + `avg_cost_paise`) |
| **Stock check** | Enter what is physically left → app computes used qty + cost (FIFO preview "used X, cost ₹Y" before confirming) and writes STOCK_CHECK movements with batch links |
| **Billing (GST invoices)** | Bill number `SD-YYYY-NNNNNN`, HSN per line, buyer GSTIN + address, CGST/SGST (exact split, basis points, rounded paise), discount, sale expenses (delivery, packing) charged to the deal, cost snapshot per line so later purchases never change past profit |
| **Printing & email** | GST invoice layout follows the SDHHE sample PDF; print via hidden iframe + system dialog (Save as PDF); email via Rust `lettre` SMTP (Gmail app password in OS keychain), HTML invoice body |
| **Customers** | Real master — one row per client matched by phone (digits only) → GSTIN → name; details updated in place; bill count, billed total, outstanding credit per client |
| **Credit (udhaar)** | Unpaid part of a live bill shows "Credit ₹X"; `recordBillPayment` clears it (payment never above bill total); dashboard shows total credit; cancelled bills never count. Credit aging by days overdue (bucketed: Current, 1–30, 31–60, 61–90, 90+ days, 30-day credit period) with per-bill outstanding table. |
| **Expenses** | Categories (Rent, Transport, …), `expense_type` = purchase / sale / general, optional link to a purchase or sale; bill photos stored as base64 in Postgres (`expense_bills`, 4 MB cap) |
| **Reports** | India financial year (1 Apr → 31 Mar, label "2026-27"), turnover excludes GST and subtracts discounts, profit per deal, lot-wise reports |
| **Team / RBAC** | Owner / CA / Staff roles, 13 modules × view/create/edit/delete/export, per-role permission grid, member access with expiry (`access_until`), last-active-owner guard, login sessions (12 h max) |
| **Activity log** | Every action (actor, action, when) in `activity_log`; login/logout sessions in `user_sessions` with duration metrics |
| **AI suggestions** | App computes all stats; AI only explains (rules → Ollama → read-only tool chat). Cached in `ai_suggestions` |
| **Themes** | Warm café palette (cream / coffee brown / caramel gold / sage green), light / dark / system modes, Playfair Display + Inter fonts |

## 2. Architecture

```
┌─────────────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
│ Desktop app (Tauri 2)   │   │ Web app (React/Vite) │   │ Any browser (phone)   │
│ src/ + src-tauri/       │   │ web/                 │   │                       │
└───────────┬─────────────┘   └──────────┬───────────┘   └───────────┬───────────┘
            │ Drizzle (direct)            │ fetch /cookie auth         │
            │ keyring secrets             ▼                            ▼
            │              ┌──────────────────────────────┐
            └─────────────►│  Neon Postgres (cloud DB)    │◄── Cloudflare Worker API
                           └──────────────────────────────┘   web-worker/ (routePermission 403 guard)
```

- **Desktop (primary):** React UI in a Tauri window → pure TypeScript logic → Drizzle → Neon directly. Connection string, PIN hash and Ollama key live in the OS secure storage (macOS Keychain / Windows Credential Manager via the `keyring` Rust crate). No server needed.
- **Web edition:** same shared logic/DB code (`src/lib`, `src/db`, `src/logic`), served through a **Cloudflare Worker API** (`web-worker/`) with cookie sessions and a 403 permission guard on every route.
- **One source of truth:** stock left = sum of open batches; sales are `SALE` stock movements with batch links, so cancelling restores the exact batches.

## 3. Tech stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript ~6.0, Vite 8, Tailwind CSS 4 (`@theme inline` CSS variables), react-router-dom 7 |
| Desktop shell | Tauri 2 (Rust): `keyring` (secrets), `argon2` (PIN hash, argon2id + random salt), `lettre` (SMTP email), `tauri-plugin-http` (Ollama CORS bypass) |
| Database | Neon Postgres (serverless) + Drizzle ORM (`@neondatabase/serverless`), drizzle-kit for push/generate |
| Server (web) | Cloudflare Workers (`web-worker/`), `@noble/hashes` for argon2id verification (Workers block dynamic WASM) |
| Charts / export | Recharts 3, jspdf, xlsx (Excel export) |
| Validation | zod 4 |
| Tests | Vitest 4 + React Testing Library (290 tests), DB integration tests (`vitest.db.config.ts`), Playwright e2e |
| AI | Ollama (cloud models) — suggestions + read-only chat |

## 4. Project structure

```
stock-tracker/
├── src/                    # Shared app code (desktop + web)
│   ├── pages/              # Setup, Lock, Dashboard, Items, AddPurchase, Purchases,
│   │                       # StockCheck, Billing, Bills, Sales, Expenses, Reports,
│   │                       # Settings, Suggestions, Chat
│   ├── components/         # Layout (sidebar/rail), ThemeToggle, CoffeeIcon
│   ├── logic/              # PURE functions (no DB): fifo, average, gst, gstin,
│   │                       # billNumber, finYear, moneyWords, permissions, profit,
│   │                       # purchase, replay, auth, errors — each with .test.ts
│   ├── db/                 # Drizzle schema.ts + one repo per module (items,
│   │                       # purchases, stock, billing, customers, expenses, sales,
│   │                       # sessions, users, permissions, dashboard, reports,
│   │                       # settings, activity, costing) + integration tests
│   ├── lib/                # secrets, email, printBill, theme, url, db-context
│   └── ai/                 # ollama, suggest, chat, tools (read-only)
├── src-tauri/              # Rust core + tauri.conf.json (bundles .app/.dmg/.exe/.msi/.AppImage/.deb)
├── web/                    # Web edition UI (React, own tsconfig, thin re-exports of shared code)
├── web-worker/             # Cloudflare Worker API (auth, routes, 403 permission guard)
├── docs/                   # BLUEPRINT, BUILD_PLAN, TESTING, SETUP, DECISIONS, RELEASE_PLAN…
├── prompts/                # START_SESSION, END_SESSION, RECOVER, task prompts
├── AGENTS.md               # Master rules for AI coding agents
├── HANDOVER.md             # Current state — updated every task
└── e2e/                    # Playwright specs
```

## 5. Data model (Postgres, Drizzle — `src/db/schema.ts`)

```
items(id, name unique, unit kg|l|pcs, category, min_stock_base, image_url,
      stock_value_paise, avg_cost_paise, created_at)
suppliers(id, name, phone)
purchases(id, item_id fk, supplier_id fk null, qty_base >0, unit_price_paise >=0,
      total_paise, purchase_date, payment_mode, note, created_at)
batches(id, purchase_id unique fk, item_id fk, qty_original, qty_remaining >=0,
      unit_price_paise, purchase_date)
stock_movements(id, item_id fk, type PURCHASE|STOCK_CHECK|USAGE|WASTAGE|ADJUSTMENT|SALE,
      qty_change, cost_paise, entered_qty_left null, movement_date, note)
movement_batch_links(movement_id fk, batch_id fk, qty_taken, unit_price_paise, cost_paise)
expenses(id, category, amount_paise, expense_date, payment_mode, note,
      expense_type purchase|sale|general, purchase_id null, sale_id null)
expense_bills(expense_id, base64, 4 MB cap)
customers(id, name, phone digits-only, gstin, address, …)     # master, one row per client
sale_bills(id, bill_number SD-YYYY-NNNNNN, customer_id, date, subtotal, discount,
      cgst, sgst, total, paid, status, …)
sale_items(id, sale_bill_id fk, item_id fk, qty, price_paise, hsn,
      avg_cost_paise snapshot, cost_paise snapshot, movement_id fk)
investments(id, …)                      # funds / investors (Dashboard → Funds)
cash_ledger(id, type sale|purchase|expense|withdrawal|deposit|adjustment|opening,
      amount_paise, ref_type, ref_id, entry_date, note, actor, created_at)  # every money movement
opening_balance(id, amount_paise, as_of_date, note, created_at)            # starting cash position
app_users(id, name, phone, role owner|ca|staff, access_until, active, …)
user_sessions(id, user_id, started_at, ended_at, duration)   # 12 h max
activity_log(id, actor, action, entity, entity_id, at)        # audit trail
role_permissions(role, module, can_view, can_create, can_edit, can_delete, can_export)
settings(key pk, value)                 # costing_method FIFO|AVERAGE, shop_* (name, address,
                                        # phone, gstin, email, bank), theme, …
ai_suggestions(id, type, item_id, message, priority, created_at, dismissed)
```

## 6. Money & quantity rules (STRICT — no floats)

- Money = **integer paise**. ₹12/kg → `1200`. Display: `paise/100` with 2 decimals.
- Quantity = **integer base units**: kg→grams, l→ml, pcs→pieces. 3 kg → `3000`.
- Price = paise per **display unit** (per kg / per l / per pc).
- `cost_paise = Math.round(qty_base * unit_price_paise / factor)`, factor = 1000 (kg/l) or 1 (pcs).
- GST in basis points, CGST/SGST split exactly, every step rounded to paise (`src/logic/gst.ts`).
- Weighted average keeps a **value pool** (`stock_value_paise`) so COGS never drifts with floats.

### Costing — worked example (also a test)
Batch A: 1 kg @ ₹10/kg, Batch B: 3 kg @ ₹12/kg. Stock left = 2 kg → used 2 kg:
FIFO takes 1 kg from A (₹10) + 1 kg from B (₹12) = **₹22.00** cost; B keeps 2000 g worth ₹24.
Weighted average: avg ₹11/kg → used cost **₹22.00**.

### Flows (each = ONE DB transaction)
- **Add purchase:** insert purchase → batch → PURCHASE movement.
- **Stock check:** read open batches → compute usage → allocate FIFO → update batches → STOCK_CHECK movement + batch links.
- **Edit/delete old purchase:** replay all later movements for that item in date order; purchase expenses prorated over the quantity still on hand.
- **Sale:** bill + lines + SALE movement with batch links; cost snapshot stored on each line.

## 7. Roles & permissions (RBAC)

- **13 modules** (Items, Purchases, Stock, Billing, Bills, Customers, Expenses, Reports, Team, Settings, Suggestions, …) × **5 actions** (view, create, edit, delete, export).
- Defaults: **Owner** = everything; **CA** = finance view + export, items/customers/stock view; **Staff** = entry create + bills/items view. Owner can edit any cell in the Roles & permissions grid.
- Enforced on **web** (403 guard on every API route, permissions returned by `/api/auth/login`/`me`, access-until enforced, auto-inactive on expiry, `/api/roles` owner-only, last-active-owner guard) and on **desktop** (`setCurrentPermissions` after login, `can()` gates nav, routes and action buttons; Settings → Members sets Role + Access until).
- Every permission change and login/logout is written to `activity_log` / `user_sessions`.

## 8. Security

- Neon connection string, PIN hash and Ollama API key live **only in OS secure storage** (Tauri `keyring` crate) — never in code, git or logs.
- PIN hashed with **argon2id + random salt** (Rust `argon2`); the web Worker verifies the same PHC hashes with `@noble/hashes`.
- Web sessions: httpOnly cookie, 12-hour cap, re-verified per request with role permissions.
- AI chat is **read-only** tool calls on stats summaries — never raw DB rows, never secrets.
- Full data backup (`docs/db-backup-<date>.sql`, git-ignored) before any destructive change.

## 9. Getting started

### Prerequisites
- Node.js 20 LTS+, Rust (rustup), Git
- macOS: `xcode-select --install` · Windows: VS Build Tools "Desktop development with C++" (WebView2 is built into Win 11) · Ubuntu: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- A [Neon](https://neon.com) Postgres project (region: Asia Pacific / Singapore). Use branch `dev` for testing, `main` for real data.

### Install & run
```bash
npm install
echo 'DATABASE_URL=postgres://…your-neon-dev-branch…' > .env   # git-ignored; never commit
npx drizzle-kit push        # create/refresh tables (dev branch only)

npm run tauri dev           # desktop app (first run: Setup screen → paste Neon URL + set PIN)
npm run dev                 # web UI only
npx tsc --noEmit            # typecheck (root + web + worker)
```

### Web edition deploy
```bash
cd web && npm install && npm run build
cd ../web-worker && npm install
./node_modules/.bin/wrangler deploy      # serves the API + built web assets on Workers
```

### Desktop release build
```bash
npm run tauri build        # macOS: .app + .dmg in src-tauri/target/release/bundle/
```
Windows `.exe`/`.msi`, Linux `.AppImage`/`.deb` build in CI via `release.yml` (push a tag, e.g. `v1.0.0`).
Android plan (PWA → TWA APK) and remaining release decisions: `docs/RELEASE_PLAN.md`.

## 10. Commands

| Command | Purpose |
|---|---|
| `npm run tauri dev` | Desktop app in dev mode |
| `npm run dev` / `npm run build` | Web UI dev server / production build |
| `npm test` | All 248 Vitest tests (quiet dot reporter) |
| `npm run test:watch` | Watch mode |
| `npm run test:db` | DB integration tests (needs `DATABASE_URL_TEST`) |
| `npm run test:e2e` | Playwright suite (real UI, Tauri IPC stubbed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | `drizzle-kit push` (dev branch only!) |

## 11. Testing

- **Unit tests first** for all money/qty logic (fifo, average, gst, profit, finYear, permissions…) — pure functions, no DB.
- **Component tests** with React Testing Library for every page.
- **DB integration tests** against a Neon dev branch.
- **E2E** with Playwright for Setup → Lock → Home.
- 290 tests green; typecheck clean across root, `web/` and `web-worker/`.

## 12. How this repo is built (AI-assisted workflow)

This app was built task-by-task with AI coding agents (OpenCode / Claude Code + Ollama). The repo keeps the whole workflow:

| File | Purpose |
|---|---|
| `AGENTS.md` | Master rules every AI agent follows (one task at a time, tests first, small diffs, handover discipline) |
| `HANDOVER.md` | Live state doc — updated every task and before context runs out, so no work is ever lost |
| `docs/BLUEPRINT.md` | Full spec: goal, architecture, data model, costing logic, screens, security |
| `docs/BUILD_PLAN.md` | Every task T-0.1 … with acceptance criteria and tickboxes |
| `docs/TESTING.md` | Test cases per feature |
| `docs/SETUP.md` | Toolchain install (Node, Rust, Neon, Ollama, agents) |
| `docs/DECISIONS.md` | One line per technical decision + why (66+ entries) |
| `docs/TOKEN_SAVING.md` | Rules to keep AI usage cheap |
| `docs/RELEASE_PLAN.md` | Windows / Android / Linux release plan |
| `prompts/*.md` | Copy-paste prompts: start / end / recover a session |

To continue development with an agent: open it in this folder, paste `prompts/START_SESSION.md` — it reads `HANDOVER.md` and picks up exactly where the last session stopped. One task per session; `prompts/END_SESSION.md` commits the handover.

## 13. Current status (v1.0.0)

- Web edition **live**; desktop macOS `.app` + `.dmg` built 2026-11-01.
- RBAC fully shipped (web + desktop).
- 248 tests green, typecheck clean.
- Next: Windows signed build, Android PWA → TWA, lot-wise FY report, sale preview batch breakdown, Playwright suites (see `HANDOVER.md`).