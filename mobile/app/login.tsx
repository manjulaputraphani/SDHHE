/**
 * Login screen — phone + password sign-in.
 *
 * Uses the same backend as the web app. On success stores the auth token
 * in SecureStore and navigates to the bottom-tabs shell.
 */
import { useRouter } from "expo-router";
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";

import { api } from "../lib/api";
import { useAuth } from "./_layout";

export default function LoginScreen() {
  const { theme, setUser } = useAuth();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(phone, password);
      setUser(user);
      router.replace("/(tabs)/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.card, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
        <View style={[styles.logo, { backgroundColor: theme.primary }]}>
          <Text style={styles.logoText}>☕</Text>
        </View>
        <Text style={[styles.title, { color: theme.ink }]}>SREE DURGA HARIHARA</Text>
        <Text style={[styles.title, { color: theme.ink }]}>ENTERPRISES</Text>

        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="+91 phone"
          placeholderTextColor={theme.muted}
          keyboardType="phone-pad"
          value={phone}
          onChangeText={(text) => setPhone(text.replace(/[^+\d]/g, ""))}
          autoCapitalize="none"
        />
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="Password"
          placeholderTextColor={theme.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.primary }]}
          onPress={() => void signIn()}
          disabled={busy || !phone || !password}
        >
          {busy ? (
            <ActivityIndicator color={theme.onPrimary} size="small" />
          ) : (
            <Text style={[styles.buttonText, { color: theme.onPrimary }]}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace("/login")} style={styles.resetRow}>
          <Text style={{ color: theme.muted, fontSize: 12 }}>Sign up a new account? Ask the owner.</Text>
        </TouchableOpacity>

        {error && <Text style={[styles.error, { color: theme.error }]}>{error}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24 },
  card: {
    borderRadius: 20,
    padding: 28,
    elevation: 4,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  logo: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 18,
    marginBottom: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  logoText: { fontSize: 32 },
  title: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
    textAlign: "center",
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    fontSize: 16,
  },
  button: {
    borderRadius: 12,
    padding: 16,
    marginTop: 20,
    alignItems: "center",
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  resetRow: { marginTop: 12, alignItems: "center" },
  error: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 13,
  },
});
