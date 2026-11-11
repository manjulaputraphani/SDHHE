# SDHHE Mobile ☕

SREE DURGA HARIHARA ENTERPRISES — the native Android app of the shop's
stock / billing / expenses / **team chat** system. One codebase, built with the
same API and roles as the web app, distributed to the team as a sideload APK.

> The app talks to the shop's Cloudflare Worker (`sdhhe-api
> .blvphani.workers.dev`) — the shared backend lives in the parent repo
> (`stock-tracker` → `web-worker/`).

## What the app does

- **Dashboard** — stat cards, working capital & rotation, low stock, recent activity
- **Team chat** — WhatsApp-style: direct chats + owner-made groups, replies,
  reactions, pins, edit/delete, @mentions, in-chat search, **receipt sending**
  (camera/gallery → owner approval), delivery ticks, sound
- **Billing** — new bill with item master picker, GST, margins, credit bills
- **Inventory & purchases** — item master + batch/FIFO ledger, purchase orders,
  stock entries (used / wastage), expenses
- **More** — reports (FY summaries, per-deal profit), supplier dues, activity
  log, team management

Every screen is built to web parity. The roles-and-permissions matrix stays
web-only (owner tooling).

## Stack

| | |
|---|---|
| Framework | Expo SDK 58 (React Native 0.88, Expo Router) |
| Language | TypeScript |
| Backend API | the same worker the web app uses — phone + password login, session cookie in SecureStore |
| Push | Expo Push API ← the worker fans chat messages to registered devices |
| Build | EAS Build (`web-worker`-owned Expo project `@sdhhe/sdhhe-mobile`) |

## Run it locally (dev)

```bash
cd mobile
npx expo start            # scan the QR with Expo Go (tunnel mode works too)
npx expo lint             # lint
npx tsc --noEmit          # typecheck
```

## Build the APK for the team

```bash
npx eas-cli@latest build --platform android --profile preview --non-interactive
```

- Profile `preview` → **APK**, internal distribution (not the Play Store)
- Signed by an EAS-managed keystore (package `com.sdhhe.mobile`)
- The finished APK is uploaded to the shop's worker and served at
  **`https://sdhhe-api.blvphani.workers.dev/sdhhe-mobile.apk`**

`.npmrc` in this folder has `legacy-peer-deps=true` — the lockfile was built
with it (npm otherwise fails on a `react-dom` peer conflict; EAS runs plain
`npm ci`, so leave it in).

## Push notifications

- The app requests Android 13+ notification permission, creates the
  `team-chat` channel, registers its **Expo push token** after sign-in
  (`/api/chat/push-token`).
- The worker sends new chat messages through the **Expo Push API** next to the
  browser Web Push stack, and forgets tokens Expo reports dead.
- **Delivery to the phone still needs the owner to drop in Firebase/FCM
  credentials** — see the parent repo's `HANDOVER.md` ("Firebase/FCM step").
  Until then messages arrive only while the app is open (WebSocket live).

## Repo layout

```
app/                 Expo Router screens: (tabs)/ + login, index, access-setup
lib/                 api.ts (typed client), theme, push (registration), chatView
assets/              adaptive icon set (coffee cup, from the web icon set)
app.json             SDK 58 config — package com.sdhhe.mobile, projectId
eas.json             preview → APK; production for store builds later
```

## Notes for the owner

- **Free EAS tier**: 15 Android builds/month, low-priority queue (~15–30 min).
- **`npx wrangler r2 object put/get` defaults to LOCAL storage — add
  `--remote`** to touch the real bucket (cost us an hour; written down on
  purpose).
- Signing keystore, Expo project id and the EAS access token live with the
  owner / in the secrets (never committed).
- Re-enabling **Cloudflare Access** on the API (store cutover) brings back the
  `/access-setup` service-token screen — the gate is intentionally optional
  while Access is disabled.
