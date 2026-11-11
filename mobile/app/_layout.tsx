/**
 * SREE DURGA HARIHARA ENTERPRISES — root layout.
 *
 * Wraps every screen with the theme provider and handles auth state:
 * signed out → /login, signed in → bottom-tabs shell.
 */
import { useState, useMemo, createContext, useContext, useEffect, type ReactNode, type ReactElement } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { Stack, Redirect, usePathname, useRouter } from "expo-router";

import { api, type ApiUser } from "../lib/api";
import { enableMobilePush } from "../lib/push";
import { setUnreadTotal } from "../lib/unreadStore";
import { getColors, type ThemeColors, type ThemeMode } from "../lib/theme";

type AuthContextType = {
  user: ApiUser | null;
  theme: ThemeColors;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  signOut: () => Promise<void>;
  setUser: (user: ApiUser | null) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  theme: getColors("light"),
  themeMode: "light",
  setThemeMode: () => undefined,
  signOut: async () => undefined,
  setUser: () => undefined,
});

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}

export default function RootLayout(): ReactElement | null {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const pathname = usePathname();

  const theme = useMemo(() => getColors(themeMode), [themeMode]);

  // On mount: check for an existing session.
  // Cloudflare Access credentials are OPTIONAL — the API has Access disabled
  // (2026-11-11) and accessHeaders() omits the headers when none are stored.
  // /access-setup stays reachable from the login screen; its gate comes back
  // when the owner re-enables Access (Phase 5 — see HANDOVER).
  useEffect(() => {
    async function check() {
      void api
        .me()
        .then((response) => setUser(response.user))
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    }
    void check();
  }, []);

  async function signOut() {
    // Drop the push token BEFORE the cookie dies (best effort — the server
    // forgets every device of this member).
    try { await api.deletePushToken(); } catch { /* server may be down */ }
    try { await api.logout(); } catch { /* best effort */ }
    setUser(null);
  }

  // Signed in → register the device for chat pushes (Phase 18, best effort).
  useEffect(() => {
    if (user) void enableMobilePush();
  }, [user]);

  // Signed in → keep the global unread total fresh (the Chats tab badge lives
  // on every screen, Dashboard included). Poll every 20s; the chats list
  // itself refreshes it sooner via its own loads.
  useEffect(() => {
    if (!user) {
      setUnreadTotal(0);
      return;
    }
    const poll = setInterval(() => {
      void api
        .chatConversations()
        .then(({ conversations }) =>
          setUnreadTotal(conversations.reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0)),
        )
        .catch(() => undefined);
    }, 20_000);
    return () => clearInterval(poll);
  }, [user]);

  // A tapped notification opens the exact chat when the push carries the room
  // (`data.room`, Phase 18), otherwise the chat list. The push's url field is
  // the web route ("/team-chat?notify=1"). The gate on user matters: during a
  // cold start the "/"→Dashboard redirect and this push would otherwise race.
  const router = useRouter();
  const lastNotificationResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (loading || !user || !lastNotificationResponse) return;
    const data = lastNotificationResponse.notification.request.content.data as
      | { url?: string; room?: string }
      | undefined;
    if (lastNotificationResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    if (typeof data?.room === "string" && data.room) {
      router.push({ pathname: "/(tabs)/chat/[room]", params: { room: data.room } });
    } else if (typeof data?.url === "string" && data.url.startsWith("/team-chat")) {
      router.push("/chats");
    }
    Notifications.clearLastNotificationResponse();
  }, [lastNotificationResponse, user, loading, router]);

  const auth: AuthContextType = useMemo(
    () => ({ user, theme, themeMode, setThemeMode, signOut, setUser }),
    [user, theme, themeMode],
  );

  const isAuthScreen = pathname === "/login" || pathname === "/access-setup";

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  // No live session on a signed-in screen → login (also the "/" entry point).
  if (!user && !isAuthScreen) {
    return (
      <AuthContext.Provider value={auth}>
        <Redirect href="/login" />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <StatusBar style={themeMode === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />
    </AuthContext.Provider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
});
