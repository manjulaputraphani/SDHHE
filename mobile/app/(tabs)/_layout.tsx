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
  const { theme } = useAuth();
  // The Chats tab badge lives on EVERY screen (Dashboard included) — the same
  // way the web sidebar carries the unread chip.
  const unreadTotal = useSyncExternalStore(subscribeUnreadTotal, getUnreadTotal);

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
          tabBarIcon: ({ color }) => <TabGlyph label="home" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="newbill"
        options={{
          title: "New Bill",
          tabBarIcon: ({ color }) => <TabGlyph label="newbill" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarBadge: unreadTotal > 0 ? unreadTotal : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.badgeContact, color: theme.badgeText, fontSize: 10 },
          tabBarIcon: ({ color }) => <TabGlyph label="chats" colour={color} />,
        }}
      />
      <Tabs.Screen
        name="stock"
        options={{
          title: "Stock",
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
      <Tabs.Screen name="items" options={{ href: null }} />
      <Tabs.Screen name="purchases" options={{ href: null }} />
      <Tabs.Screen name="expenses" options={{ href: null }} />
      <Tabs.Screen name="reports" options={{ href: null }} />
      <Tabs.Screen name="suppliers" options={{ href: null }} />
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="team" options={{ href: null }} />
      <Tabs.Screen name="chat/[room]" options={{ href: null }} />
    </Tabs>
  );
}
