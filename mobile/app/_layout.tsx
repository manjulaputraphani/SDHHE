/**
 * SREE DURGA HARIHARA ENTERPRISES — root layout.
 *
 * Wraps every screen with the theme provider and handles auth state:
 * signed out → /login, signed in → bottom-tabs shell.
 */
import { useState, useMemo, createContext, useContext, useEffect, type ReactNode, type ReactElement } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Stack, Redirect, usePathname } from "expo-router";

import { api, type ApiUser } from "../lib/api";import { getColors, type ThemeColors, type ThemeMode } from "../lib/theme";

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
    try { await api.logout(); } catch { /* best effort */ }
    setUser(null);
  }

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
