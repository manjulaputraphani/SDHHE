# TESTING — every case below must be an automated test unless marked (manual)
Run: `npx vitest run --reporter=dot`. Logic tests live next to code: `src/logic/*.test.ts`.

## A. Unit tests (pure logic)
### A1 units.ts
| Case | Input | Expected |
|---|---|---|
| kg→g | toBase(1.5,'kg') | 1500 |
| cost | costPaise(250 g, 1200 paise/kg) | 300 (₹3.00) |
| rounding | costPaise(333 g, 1000) | 333 |
| format | formatRupees(2200) | "₹22.00" |
| pcs | costPaise(3 pcs, 500, pcs) | 1500 |

### A2 fifo.ts
| Case | Batches | Used | Expected |
|---|---|---|---|
| Worked example | A 1000g@1000, B 3000g@1200 | 2000 | A 1000 + B 1000, cost 2200; B left 2000 |
| Single batch | 5000g@1000 | 4000 | cost 4000 |
| Exact empty | A 1000@1000 | 1000 | A→0, cost 1000 |
| Zero | any | 0 | [], 0 |
| Too much | total 4000 | 5000 | throws InsufficientStockError |
| Order by date not array order | B(newer) listed first | 500 | takes from older first |
| Same date | ids 2,1 | — | takes id 1 first |
| Skips empty batches | A 0 left, B 1000 | 500 | only B |

### A3 stockCheck.ts
| current | left | Expected |
|---|---|---|
| 4000 | 2000 | used 2000 |
| 4000 | 4000 | used 0 |
| 4000 | 6000 | StockLeftTooHighError |
| 4000 | -1 | validation error |

### A4 average.ts
1000g@1000 + 3000g@1200 → avg 1150 paise/kg; 2000 g used → 2300 paise.

### A5 stats.ts / rules.ts
- 30 days, 18000 g used → daily 600 g; stock 3000 → days left 5.
- price 1000→1200 → +20% → rule "price_up" fires (threshold 10%). 1000→1050 → no fire.
- spend 10000→11800 → +18% → "spend_up" fires.
- no data → empty list, no crash.

## B. Database / integration (Neon `dev` branch ONLY — never production)
- B1 Add purchase → exactly 1 purchase, 1 batch, 1 PURCHASE movement; total = qty×price.
- B2 Stock check (worked example) → batches A=0, B=2000; movement cost 2200; 2 link rows.
- B3 Edit purchase 1 price 10→11 → later stock-check cost recalculated (1100+1200=2300).
- B4 Failure mid-transaction (force error) → nothing saved.
- B5 Delete item with purchases → blocked with message.
Reset dev data before each run (truncate tables in a test setup file).

## C. UI tests (React Testing Library)
- Purchase form: empty/negative qty or price shows error; total updates while typing.
- Stock Check: shows preview "Used 2.00 kg · ₹22.00" before confirm.
- PIN: wrong PIN blocked; 5 wrong → lockout message.
- Setup: invalid Neon URL → "Cannot connect" error.

### C2 Team Chat (logic + e2e-web, mocked worker)
- Group room shape: `isGroupRoom("group-buy")` true; `main`, `dm-4-9`, `group-` false (chatPrivacy.test).
- Owner creates a group (name + ticked members) → appears in the list, opens (team-chat.spec e2e).
- Staff sees no "New group" button and no group menu items (e2e).
- Owner adds / removes a member from the header menu (e2e); removal kicks that member's socket (close 1008).
- Owner archives a group → it leaves every list, members may not read it (chatRooms.int.test, e2e).
- The shop room can never be managed: no add/remove/archive (int test).
- Receipt approver (owner/CA) may decide a receipt of any group without being a member (route logic).
- Untitled group falls back to the room name in list/exports (chatView.test).

### C3 AI polish + editing + shell rules (Phase 15/17)
- Polish skip rules: <15 chars → "short"; emoji/punctuation only → "emoji"; words → polish (aiPolish.test).
- Numbers guard: a rewrite that drops a number falls back to the original; "1,20,000"→"120000" tolerated (aiPolish.test).
- parseMessageInput carries `aiPolished` for text only; garbage ("yes") coerces to false, never blocks the send (chat.test).
- e2e: owner toggles "AI polish messages" for the shop room → chip for everyone; staff sees no switch.
- e2e: suggestion flow — Send → "✨ Suggested" card → Send suggested → bubble + ✨; polish-off room sends directly (no card).
- e2e: author taps their own bubble → edits in place → Save → new text + "edited" mark.
- e2e: cold load at `/team-chat` lands on the Dashboard and settles to `/` (always-default rule).
- Unit: chat times are 12-hour local — "09:42 AM", "09:07 PM", "12:07 AM", "12:00 PM" (chat.test / chatView.test).


## D. Data safety (manual)
- Install on 2nd laptop, enter same Neon URL → same data.
- Internet off while saving → clear error, nothing half-saved.
- First open after hours (Neon asleep) → loads in a few seconds, no crash.
- Export backup → import into new Neon branch → row counts & totals match.

## E. Installers (manual, each OS)
- Windows 10/11: .exe installs, SmartScreen "More info → Run anyway", opens, uninstalls.
- macOS: .dmg, right-click → Open.
- Ubuntu: `chmod +x *.AppImage` runs; .deb installs.

## F. AI (Phase 8)
- Fixed stats in → suggestions contain no numbers not in input (check with regex).
- Model returns bad JSON → falls back to rule suggestions.
- Ollama down / no internet → rule suggestions shown.
- Chat "delete all data" → no write tool exists; polite refusal.

## G. Real use (manual, 1 week) — compare app stock & spend with bills every evening.
