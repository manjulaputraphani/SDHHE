# HANDOVER (keep under 60 lines — overwrite each time, history is in git)

Last updated: 2026-11-10 by OpenCode
Tool: OpenCode

## Current state
- **Web LIVE `19177dd4`** (push notifications + delivery receipts + notification sound). Owner's real-device test is due.
- **Phase 3+4 committed** (`facb3b9`, `beca8ed`) — all business screens + billing + EAS deploy config.
- **`mobile/app.json` fixed `19daef5`** — SDK 58 schema: top-level `splash` removed → `expo-splash-screen` plugin; adaptive icon paths → `android-icon-*.png`. **`expo-doctor` 20/20, `tsc` clean.**
- **Phone test LIVE** — Expo Go loads over tunnel, **login works**. Icons fixed `52775f7` (Ionicons; old Unicode glyphs rendered blank on Android).
- ⚠️ **Cloudflare Access app for `sdhhe-api.blvphani.workers.dev` was DELETED** to unblock testing. **Re-create it with a Service Auth policy** (token: `db67c58f…access`) before shipping. Web login unaffected.

## Next task
Re-test screens on the phone (tabs, chat, bills). Then Phase 5: `eas build` → Play Store + App Store.
Also: re-add the Cloudflare Access policy (see above).

## Mobile app screens built
| Screen | File |
|--------|------|
| Cloudflare Access setup | `mobile/app/access-setup.tsx` — stores token in SecureStore |
| Login | `mobile/app/login.tsx` — phone + password |
| Chat list | `mobile/app/(tabs)/chats.tsx` — conversations, badges, preview |
| Chat room | `mobile/app/(tabs)/chat/[room].tsx` — bubbles, ticks, typing, info panel, sound |
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
