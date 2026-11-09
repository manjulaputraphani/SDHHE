# Native Mobile App — Build Plan
> Convert the SDHHE web app into a native mobile app (React Native + Expo)
> Estimated total: **6–8 weeks** for one developer

## Why Native?
The web app's biggest pain point is **push notifications** — Web Push on iOS/Android is
unreliable (VAPID keys, service workers, Home Screen requirement, browser restrictions).
A native app uses **FCM (Android) + APNs (iOS)** directly = notifications always work.

## What We Can Reuse (saves weeks)
| Asset | Reusable? | Notes |
|-------|-----------|-------|
| TypeScript types | ✅ 100% | All `src/logic/`, `web/src/api.ts` types |
| API client | ✅ 90% | Swap `fetch` for `axios`, same endpoints |
| Business logic | ✅ 95% | FIFO/WAC costing, chat logic, permissions |
| Database schema | ✅ 100% | Same Cloudflare Worker + Neon/D1 backend |
| WebSocket chat | ✅ 85% | Same protocol, native `ws` client |
| Auth/session | ✅ 90% | Same API, swap cookie for token |
| CSS/theme | ❌ 0% | Rewrite with React Native StyleSheet |
| React components | ❌ 20% | JSX structure similar, primitives different |

## Tech Stack
```
React Native (Expo)     — one codebase → Android + iOS
Expo Router             — file-based navigation (like Next.js)
TypeScript              — same language as web app
Zustand                 — state management (replaces React context)
expo-notifications      — native push (FCM + APNs, no VAPID)
@react-native-async-storage — local storage
react-native-gifted-chat — chat UI (or custom bubbles)
```

## Phase 1: Foundation (Week 1)
- [ ] Expo project scaffold (`npx create-expo-app sdhhe-mobile`)
- [ ] Bottom tab navigation (Home, New Bill, Chats, Stock, More)
- [ ] Login screen (phone + password, same API)
- [ ] API client port (reuse types, swap fetch for axios)
- [ ] Theme system (light/dark/contrast, same colour tokens)
- [ ] Auth token storage (SecureStore instead of cookies)

**Deliverable:** App opens, login works, lands on Dashboard with bottom tabs.

## Phase 2: Chat Module (Week 2–3) — MOST IMPORTANT
- [ ] Chat list screen (conversations, unread badges, search)
- [ ] 1:1 chat screen (bubbles, ticks ✓/✓✓/✓✓blue, typing indicator)
- [ ] Group chat (same room, member list)
- [ ] Message info panel (Read by / Delivered to / Pending)
- [ ] Push notifications (expo-notifications → FCM + APNs)
- [ ] WebSocket chat (same Durable Object protocol)
- [ ] Notification sound (native audio)
- [ ] Composer (text input, auto-grow, emoji picker)
- [ ] Receipts (image upload → R2)
- [ ] Reactions, replies, pins
- [ ] Group info / Contact info screens

**Deliverable:** Full chat with reliable native push notifications on both platforms.

## Phase 3: Core Business Screens (Week 4–5)
- [ ] Dashboard (sales stats, rotation chart, low-stock alerts)
- [ ] Items list + add/edit (image picker, stock tracking)
- [ ] Purchases (add purchase, batch/FIFO cost tracking)
- [ ] Expenses (categorised, receipt attach)
- [ ] Stock check screen
- [ ] Reports (sales, expenses, profit)

**Deliverable:** All core business operations work on mobile.

## Phase 4: Billing & Advanced (Week 6)
- [ ] Billing screen (create bill, WhatsApp share, PDF export)
- [ ] Invoice list + detail
- [ ] Customer management
- [ ] Supplier dues + payments
- [ ] Team management (roles, permissions)
- [ ] Settings (profile, theme, notifications toggle)

**Deliverable:** Complete feature parity with the web app.

## Phase 5: Polish & Deploy (Week 7–8)
- [ ] Offline caching (AsyncStorage for recent data)
- [ ] Pull-to-refresh on all lists
- [ ] App icons + splash screens (generate from existing logo)
- [ ] Android: Build APK/AAB → Play Store
- [ ] iOS: Build IPA → App Store (requires Apple Developer account $99/year)
- [ ] Deep links (notification → open specific chat)
- [ ] Testing on real devices (320px–430px)

**Deliverable:** App published on Play Store + App Store.

## Time Estimate Summary
| Phase | Duration | Cumulative |
|-------|----------|------------|
| 1. Foundation | 1 week | 1 week |
| 2. Chat + Push | 2 weeks | 3 weeks |
| 3. Core Business | 2 weeks | 5 weeks |
| 4. Billing & Advanced | 1 week | 6 weeks |
| 5. Polish & Deploy | 2 weeks | 8 weeks |

## Requirements from Owner
| Item | Cost | Notes |
|------|------|-------|
| Apple Developer Account | $99/year | Required for iOS App Store |
| Google Play Console | $25 (one-time) | Required for Play Store |
| Expo EAS (optional) | $0–$99/month | Cloud builds (can build locally for free) |
| Backend | $0 (existing) | Same Cloudflare Worker + Neon/D1 |

## Architecture
```
┌─────────────────────────────┐
│   React Native (Expo) App   │
│   ┌─────────┐ ┌──────────┐  │
│   │ Screens │ │  Logic   │  │
│   └────┬────┘ └────┬─────┘  │
│        │           │        │
│   ┌────┴───────────┴─────┐  │
│   │   API Client (axios) │  │
│   └──────────┬──────────┘  │
└──────────────┼──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Cloudflare Worker (same)   │
│  /api/* endpoints          │
│  Durable Object (chat WS)   │
│  D1 / Neon (data)          │
│  R2 (receipts, files)      │
└─────────────────────────────┘
```

## Why Not Capacitor (web wrapper)?
| | Capacitor | React Native |
|--|-----------|--------------|
| Time | 1–2 weeks | 6–8 weeks |
| Push | Web Push (unreliable) | Native FCM/APNs ✅ |
| UI | Web view | Native components ✅ |
| App Store | Allowed but limited | Full native ✅ |
| Performance | Web speed | Native speed ✅ |

**Recommendation:** React Native + Expo — solves the notification problem permanently.

## Next Steps
1. Owner confirms: React Native + Expo approach ✅/❌
2. Owner creates Apple Developer account (for iOS)
3. Start Phase 1 (I scaffold the Expo project + login)
4. Weekly milestones with deployable builds
