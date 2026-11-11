import type { ColorValue } from "react-native";
/**
 * Bottom tab navigation — 5 tabs matching the web app.
 * Home · New Bill · Chats · Stock · More
 *
 * Icons come from Ionicons (bundled in Expo Go). Plain Unicode glyphs
 * (◎ ▦ ◍ ▤ ☰) were used before but Android's font lacks them, so the
 * tab bar rendered blank.
 */
import { Tabs } from "expo-router";
import { useSyncExternalStore } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "../_layout";
import { getUnreadTotal, subscribeUnreadTotal } from "../../lib/unreadStore";

/** Tab icon — Ionicons glyph names (verified against the installed glyphmap). */
const ICONS = {
  home: "home",
  newbill: "receipt",
  chats: "chatbubbles",
  stock: "cube",
  more: "menu",
} as const;

type TabLabel = keyof typeof ICONS;

function TabGlyph({ label, colour }: { label: TabLabel; colour?: ColorValue | null }) {
  const { theme } = useAuth();
  // tabBarIcon can hand us a platform colour (number/undefined) — the icon
  // font only takes a CSS string, so fall back to the theme primary.
  const iconColour = typeof colour === "string" ? colour : theme.primary;
  return <Ionicons name={ICONS[label]} size={24} color={iconColour} />;
}

export default function TabsLayout(): React.ReactElement {
  const { theme, user } = useAuth();
  // The Chats tab badge lives on EVERY screen (Dashboard included) — the same
  // way the web sidebar carries the unread chip.
  const unreadTotal = useSyncExternalStore(subscribeUnreadTotal, getUnreadTotal);

  // Permission-aware tabs (same matrix as the web sidebar): a tab shows only
  // when the role's matrix allows it. More stays for everyone (it carries
  // settings + sign out). Missing rows count as denied; the owner always has
  // everything. Permissions refresh at every sign-in.
  const perms = user?.permissions as
    | Record<string, Record<string, boolean | undefined>>
    | undefined;
  const can = (moduleKey: string, action = "view"): boolean => {
    const set = perms?.[moduleKey] as { [action: string]: boolean } | undefined;
    if (set) return Boolean(set[action]);
    return user?.role === "owner";
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.muted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.line,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          href: can("dashboard") ? undefined : null,
          tabBarIcon: ({ color }) => <TabGlyph label="home" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="newbill"
        options={{
          title: "New Bill",
          href: can("billing", "create") ? undefined : null,
          tabBarIcon: ({ color }) => <TabGlyph label="newbill" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          href: can("chat") ? undefined : null,
          tabBarBadge: unreadTotal > 0 ? unreadTotal : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.badgeContact, color: theme.badgeText, fontSize: 10 },
          tabBarIcon: ({ color }) => <TabGlyph label="chats" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="stock"
        options={{
          title: "Stock",
          href: can("stock") ? undefined : null,
          tabBarIcon: ({ color }) => <TabGlyph label="stock" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) => <TabGlyph label="more" colour={color} />,
        }}
      />
      {/* Every other route in (tabs)/ is pushed from Home links or the More
          sheet — hidden from the tab bar (expo-router would otherwise append
          them as icon-less tabs). */}
      {/* Pushed screens (items, purchases, expenses, reports, suppliers,
          activity, team, chat/[room]) moved OUT of the (tabs) group into root
          stack routes — href:null tab screens are unreachable by navigation in
          SDK 58 (they fell back to the initial tab = Dashboard). */}
    </Tabs>
  );
}
