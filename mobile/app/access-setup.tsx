/**
 * Cloudflare Access setup screen (shown ONCE on first launch).
 *
 * The Worker is protected by Cloudflare Access (Zero Trust). The owner
 * creates a Service Token in the Cloudflare dashboard and pastes it here.
 * The app stores it in SecureStore and sends it with EVERY request so the
 * Cloudflare Access layer always lets the request through.
 *
 * Setup guide (shown on screen):
 *   1. one.dash.cloudflare.com → Zero Trust → Access → Service Tokens
 *   2. Create Service Token → copy Client ID + Secret
 *   3. Zero Trust → Access → Applications → [app] → policy: Service Auth →
 *      Selector "Service Token" → include the token you just created
 */
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Linking,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import { setAccessCredentials, accessCredentialsSet } from "../lib/api";
import { useAuth } from "./_layout";

export default function AccessSetupScreen() {
  const { theme } = useAuth();
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await setAccessCredentials(clientId.trim(), clientSecret.trim());
      router.replace("/login");
    } catch {
      // Failed to save — user can retry.
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollViewContent theme={theme}>
        <Text style={[styles.title, { color: theme.ink }]}>Cloudflare Access Setup</Text>
        <Text style={[styles.subtitle, { color: theme.muted }]}>One-time setup — paste the Service Token</Text>

        {/* Step-by-step guide */}
        <View style={[styles.guide, { backgroundColor: theme.surface, shadowColor: theme.shadow }]}>
          <Text style={[styles.guideTitle, { color: theme.primary }]}>Create the token</Text>
          <Text style={[styles.guideStep, { color: theme.ink }]}>
            1. Open the Cloudflare Zero Trust dashboard
          </Text>
          <TouchableOpacity onPress={() => Linking.openURL("https://one.dash.cloudflare.com")}>
            <Text style={[styles.guideLink, { color: theme.accent }]}>→ Open Zero Trust dashboard</Text>
          </TouchableOpacity>
          <Text style={[styles.guideStep, { color: theme.ink }]}>
            2. Left menu: Access → Service Auth → Service Tokens
          </Text>
          <Text style={[styles.guideStep, { color: theme.ink }]}>
            3. Create Service Token → copy both values (secret shows once)
          </Text>
          <Text style={[styles.guideStep, { color: theme.ink }]}>
            4. Access → Applications → [SDHHE] → policy: Service Auth → include the token
          </Text>
        </View>

        {/* Token inputs */}
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="CF-Access-Client-Id"
          placeholderTextColor={theme.muted}
          value={clientId}
          onChangeText={setClientId}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
          placeholder="CF-Access-Client-Secret"
          placeholderTextColor={theme.muted}
          value={clientSecret}
          onChangeText={setClientSecret}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={clientSecret.length > 4}
        />

        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme.primary, opacity: clientId || clientSecret ? 1 : 0.6 }]}
          onPress={() => void save()}
          disabled={saving}
        >
          <Text style={{ color: theme.onPrimary, fontSize: 15, fontWeight: "600" }}>Save and continue →</Text>
        </TouchableOpacity>
      </ScrollViewContent>
    </KeyboardAvoidingView>
  );
}

function ScrollViewContent({ theme, children }: { theme: ReturnType<typeof useAuth>["theme"]; children: React.ReactNode }) {
  return <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 13, marginBottom: 16 },
  guide: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    elevation: 2,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  guideTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
  guideStep: { fontSize: 12, marginBottom: 4, lineHeight: 17 },
  guideLink: { fontSize: 13, fontWeight: "600", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontSize: 14,
  },
  button: {
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
});
