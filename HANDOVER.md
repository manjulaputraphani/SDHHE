# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-11 by OpenCode (mobile app mirrored to GitHub `manjulaputraphani/Mobile_app` — subtree export, mobile/README.md added)
Tool: OpenCode

## Current state
- **Chat opens on the NEWEST message — fixed everywhere (2026-11-11)** — mobile `chat/[room].tsx`: the open-scroll retry loop had a cleanup tied to `messages`, so the first WS read/receipt frame cancelled the pending tick and the per-room guard never re-armed it → the room stayed on the FIRST message (now unmount-only cleanup + metrics-based "confirmed bottom" + open-phase pin in `onContentSizeChange`). web/desktop: `scrollToBottom()` ran right after `setMessages()` (stale DOM, jsdom test caught it) → now `requestBottom()` + effect scrolls after paint. Regression tests: `TeamChat.test.tsx` "opens the room on the NEWEST message" + e2e `team-chat.spec.ts` "NEWEST message". 516 unit + 87 e2e green; mobile fix reaches the phone via `eas update` (OTA) or the next build.
- **Native app APK live (2026-11-11)** — `eas build` (`@sdhhe/sdhhe-mobile`, preview profile, **v3** 80.6MB; v2 = cold-start `sdhhe:///` fix via new `mobile/app/index.tsx` + optional Access setup; **v3 = chat room opens on the NEWEST message** (Android ignored the too-early scrollToEnd) + Expo Push wiring: app registers push token after sign-in (`mobile/lib/push.ts`), notification tap opens the chat, worker sends via Expo Push API next to browser push (`web-worker/src/expoPush.ts`, tokens in Neon `push_tokens`, route `/api/chat/push-token`, secret `EXPO_ACCESS_TOKEN`) — **push delivery still awaits the owner's Firebase/FCM credentials**: `google-services.json` + FCM v1 service-account key from console.firebase.google.com (package `com.sdhhe.mobile`), then `eas credentials` upload + ONE more build → hosted in R2 `sdhhe-receipts/apk/sdhhe-mobile.apk` (Workers assets cap 25MiB), served publicly at `/sdhhe-mobile.apk` from `web-worker/src/index.ts` (byte-verified each time). **GOTCHA: `wrangler r2 object put/get` defaults to LOCAL Miniflare storage — add `--remote`**. Pre-existing tsc error index.ts push payload `messageId` (TS2353, fails on clean HEAD too). eas.json `submit` removed (empty ios fields failed schema). Old browser-wrapper TWA still at `/sdhhe.apk`.
- **Legacy-shortcut hint (2026-11-11)** — new `web/src/components/AndroidAppInstall.tsx` used by both sidebars + More sheet. When it detects the OLD home-screen PWA shortcut (standalone display-mode + referrer ≠ `android-app://com.sdhhe.app`), it explains under the 📲 button that Chrome blocks APK downloads inside it and to use Chrome. Deployed `wrangler ae788d41`.
- **PWA install removed from web (2026-11-11)** — `web/index.html` lost `<link rel=manifest>` + all `mobile-web-app-capable` metas, so the site no longer offers "Install app"/Add to Home Screen. Team installs `sdhhe.apk` instead. Keep serving `/manifest.webmanifest` (bubblewrap APK rebuild fetches it) and `/sw.js` (team-chat push worker). Deployed `wrangler 4f9b2b88`.
- **Web LIVE `19177dd4`** (push notifications + delivery receipts + notification sound). Owner's real-device test is due.
- **Phase 3+4 committed** (`facb3b9`, `beca8ed`) — all business screens + billing + EAS deploy config.
- **`mobile/app.json` fixed `19daef5`** — SDK 58 schema: top-level `splash` removed → `expo-splash-screen` plugin; adaptive icon paths → `android-icon-*.png`. **`expo-doctor` 20/20, `tsc` clean.**
- **Phone test LIVE** — Expo Go loads over tunnel, **login works**. Icons fixed `52775f7` (Ionicons; old Unicode glyphs rendered blank on Android).
- **Mobile dashboard = web parity** (`683c88d`) — Ask AI, 6 stat cards, working capital & rotation + trend, low stock, quick expense, 14-day bars, expenses by category, recent activity. api.ts gained stats/rotation/daily/categories/activity/addExpense/aiChat (old `stats()` read the wrong field names → all cards showed ₹0.00).
- **Mobile chat = web parity, phase 1** (`5e4c4dc` list, `03d9e61` room) — list: web header/search/new-chat member picker/rows (initials, online dot, green time + pill); room: 56px ChatHeader (back/who/call/video/⋮), ⋮ menu (Search in chat, Group/Contact info), in-chat search with N matches + ↑↓ jump, members info modal, long-press own bubble → Message info. **FIX: `loadHistory()` was never called → chat room stuck on spinner forever** (history now loads over REST on connect, like web). New shared helpers: `mobile/lib/chatView.ts` (copied — Metro can't resolve outside mobile/).
- **Mobile chat = web parity, phase 2** (`0128ac4`, `9a4fb9f`) — long-press action sheet (Reply/React/Copy/Edit/Delete/Pin/Info), reply quote + jump-flash, reaction pills + 6-emoji picker, composer-swap edit (15 min) + 'edited' marker, delete confirm + tombstone, pinned bar (max 3, owner), unread 'New messages' divider + jump FAB, @mention chips, AI polish card, WS frames reaction/update/pins. api.ts: react/pins/edit/delete/polish endpoints.
- **Mobile chat = web parity, phase 3 DONE** (`d20d446`) — receipt send (composer 📎 → Gallery/Camera via `expo-image-picker` → Title/₹/Note → `POST /api/chat/receipts` multipart → receipt message), receipt cards (photo/amount/note/status badge), live WS `receipt` frames, real Copy via `expo-clipboard` + "Copied ✓" flash (dead copy modal removed). Deps `expo-clipboard`+`expo-image-picker` logged in DECISIONS.md (npm needed `--legacy-peer-deps`). Hermes lacks btoa/TextEncoder → hand-rolled `base64UrlEncode` in api.ts.
- **Mobile New Bill FIXED** (`76a3e02`) — old screen could NEVER create a bill (sent `qty`/`ratePaise` vs required `qtyBase`/`unitPricePaise`; itemId 0 rejected). Now web parity: saved-client picker or new customer (saved via `/api/customers/save`), item-master picker with searchable modal, qty in display units → qtyBase via FACTOR, HSN, avg-cost/margin%/suggested rate, GST rate 0–28% with CGST/SGST, discount + delivery ₹, date, Credit requires customer. api.ts: `Customer` type, `customers(search)`, `saveCustomer`, fixed `createBill` types.
- **Mobile chat send FIXED + Expenses parity** (`b7857fc`) — send is optimistic WhatsApp-style: bubble appears instantly on tap (⏱), server row swaps in later; failed send keeps the bubble (red border ⚠, tap → Retry/Discard); failed edit keeps the draft. Chats list reloads on focus (`useFocusEffect`) so the unread pill clears when you come back from a room. Expenses: old screen read `title`/`status` (API returns `category`/`expenseType`/`date`/`paidTo`/`note`) → rows were blank; now web parity (add form date/type/category chips/amount/paid-to/note, month total, owner Edit+Delete). api.ts: typed `addExpense`, `updateExpense`, `deleteExpense`, dead `createExpense` removed.
- **Mobile Items end to end** (`8eb1f85`) — old screen read `stockRemaining`/`wacCostPerUnitPaise` (API returns `stockLeftBase`/`avgCostPaise`) → quantities + costs were blank. Now web parity: list (thumb, HSN/category/unit/avg cost, stock left in display units, LOW badge), owner Add/Edit (name, unit kg/60kg bag, category, HSN, min stock, image link), owner Delete, Lots modal (batch ledger with expandable per-lot sales), search. api.ts: `ItemRow` fixed to real shape, typed `createItem`/`updateItem`/`deleteItem`, `batchLedger` + types. More screen now links Items/Purchases/Expenses (they were unreachable except via dashboard links).
- **Mobile Purchases + Stock end to end** (`16a9c12`) — Purchases: old rows were blank (API is raw SQL snake_case `name`/`qty_base`/`total_paise`…). Now: add form (item picker, date, qty, rate, transport, supplier, live total) for owner+staff, list with real fields, owner edit sheet (PUT /api/purchases/:id). Stock: old screen expected phantom `{rows}` of current stock — /api/stock returns recent ENTRIES; now: entry form (item picker with open-batches 'Stock:' hint, Used/Wastage/Stock-left chips, qty/enteredLeft logic, note) + recent entries list with type badges. api.ts: `PurchaseRow` fixed, `addPurchase`/`updatePurchase`, `StockEntryRow`/`stockEntries`/`saveStock`/`itemBatches` (phantom `StockRow`/`stockCheck`/`createPurchase` removed).
- **More screen complete** (`e44904d`) — Reports (FY chips, 4 summary cards, per-deal profit, closing stock; owner+CA), Supplier dues (add supplier, dues with outstanding, record payment against a purchase, recent payments; owner+staff), Activity (day groups, event dots, actor filter, Load more 25/page; owner), Team (usage table, approve/reject with role, role change, password reset, disable/enable, add member; owner — roles-&-permissions matrix stays web-only). Tab layout: all pushed screens now `href:null` (undeclared routes were appended as phantom tabs). ALL list screens load via `useFocusEffect` → lint drops from 17 problems (5+ errors) to **3 warnings / 0 errors**.
- ⚠️ **Cloudflare Access app for `sdhhe-api.blvphani.workers.dev` was DELETED** to unblock testing. **Re-create it with a Service Auth policy** (token: `db67c58f…access`) before shipping. Web login unaffected.

## Next task
**Every mobile screen now at web parity.** Phone-test the new screens (Reports/Suppliers/Activity/Team + Items/Purchases/Expenses/Stock/New Bill), fix anything the test finds — first ship the chat scroll fix via `eas update` and confirm a chat opens on its newest message,
then **Phase 5: `eas build` → Play Store + App Store** (also re-add the Cloudflare Access policy before shipping).
Known bugs to fix in that pass: `items.tsx` reads `item.stockRemaining` but `/api/items` returns `stockLeftBase` (quantities render blank); items/purchases/expenses routes exist but are not in the tab bar or linked from More (only reachable from the dashboard links).
Then Phase 5: `eas build` → Play Store + App Store. Also re-add the Cloudflare Access policy.

## Mobile app screens built
| Screen | File |
|--------|------|
| Cloudflare Access setup | `mobile/app/access-setup.tsx` — stores token in SecureStore |
| Login | `mobile/app/login.tsx` — phone + password |
| Chat list | `mobile/app/(tabs)/chats.tsx` — web header, search, new chat, online dots, badges |
| Chat room | `mobile/app/(tabs)/chat/[room].tsx` — ChatHeader + ⋮ menu, in-chat search, info modal, bubbles, ticks, typing, sound |
| Dashboard | `mobile/app/(tabs)/home.tsx` — stats |
| More | `mobile/app/(tabs)/more.tsx` — settings + sign out |
| Items | `mobile/app/(tabs)/items.tsx` — inventory list |
| Purchases | `mobile/app/(tabs)/purchases.tsx` — purchase order list |
| Expenses | `mobile/app/(tabs)/expenses.tsx` — expense list |
| Stock Check | `mobile/app/(tabs)/stock.tsx` — current stock levels |

**Cloudflare Access token placeholder** in `mobile/lib/api.ts` — fill `CF_ACCESS_CLIENT_ID` +
`CF_ACCESS_CLIENT_SECRET` and every API request passes Access automatically.

## Owner steps that are still open
1. Apple Developer Account ($99/year) for iOS App Store.
2. Google Play Console ($25) for Android Play Store.
3. **Cloudflare Access Service Token** — create at one.dash.cloudflare.com → Zero Trust → Access → Service Tokens → Create.
   Paste Client ID + Secret into `mobile/lib/api.ts`.

## Commands
- Tests: `npx vitest run --reporter=dot` (510) · `npm run test:e2e:web` (94)
- Web deploy: `nvm use 22 && cd web && npm run build && cd ../web-worker && npx wrangler deploy`
- Mobile dev: `cd mobile && npx expo start` · typecheck: `npx tsc --noEmit` · lint: `npx expo lint`
- Push diagnostics: `wrangler tail` → `/tmp/wrangler-tail.log`
