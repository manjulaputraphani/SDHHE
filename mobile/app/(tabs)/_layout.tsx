import type { ColorValue } from "react-native";
/**
 * Bottom tab navigation — 5 tabs matching the web app.
 * Home · New Bill · Chats · Stock · More
 */
import { Tabs } from "expo-router";
import { Text } from "react-native";

import { useAuth } from "../_layout";

/** Tab icon — the app's own glyphs (no icon library dependency). */
const ICONS: Record<string, string> = {
  home: "◎",
  newbill: "▦",
  chats: "◍",
  stock: "▤",
  more: "☰",
};

function TabGlyph({ label, colour }: { label: string; colour: ColorValue | undefined }) {
  return <Text style={{ fontSize: 22, color: colour, lineHeight: 26 }}>{ICONS[label] ?? "●"}</Text>;
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
