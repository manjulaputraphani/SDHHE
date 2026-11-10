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
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "../_layout";

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
    </Tabs>
  );
}
