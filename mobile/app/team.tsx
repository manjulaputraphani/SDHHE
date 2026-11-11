/**
 * Team screen — web parity (owner).
 *
 * Members with usage (who logged in, active time), approve/reject sign-up
 * requests, role change, password reset, disable/enable, add member.
 * Roles & permissions matrix stays web-only (16 modules × 5 switches is
 * not a phone UI).
 */
import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { api, type Member, type UsageRow } from "../lib/api";
import { useAuth } from "./_layout";

type Role = "owner" | "ca" | "staff";

const ROLES: { value: Role; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "ca", label: "CA (Accountant)" },
  { value: "owner", label: "Owner" },
];

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Web formatDuration — "2h 5m" / "45m" / "30s". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = date.getHours() % 12 || 12;
  return `${date.getDate()} ${months[date.getMonth()]}, ${String(hours).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} ${date.getHours() < 12 ? "AM" : "PM"}`;
}

function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""} ${match[1]}`;
}

function roleColour(role: string): { bg: string; ink: string } {
  if (role === "owner") return { bg: "#fdf0e3", ink: "#8a5a19" };
  if (role === "ca") return { bg: "#e8eef7", ink: "#3d5a80" };
  return { bg: "#e9f5ea", ink: "#3c7539" };
}

export default function TeamScreen() {
  const { theme, user } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<Member[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  /** Approve role per pending member (web approveRole map). */
  const [approveRole, setApproveRole] = useState<Record<number, Role>>({});
  /** Inline password reset target + draft (web resetTarget). */
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  /** Add member form (web addMember). */
  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState<Role>("staff");
  const [memberAccessUntil, setMemberAccessUntil] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ users }, { usage: list }] = await Promise.all([api.users(), api.usage()]);
      setMembers(users);
      setUsage(list);
    } catch {
      // Offline — keep whatever we have.
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(action: () => Promise<unknown>, done: string) {
    setStatus(null);
    try {
      await action();
      await load();
      setStatus(done);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  async function addMember() {
    if (!memberName.trim() || !memberPhone.trim() || !memberPassword || adding) return;
    setAdding(true);
    setStatus(null);
    try {
      await api.addUser(memberName.trim(), memberPhone.trim(), memberPassword, memberRole, memberAccessUntil || undefined);
      setStatus("Member added");
      setMemberName("");
      setMemberPhone("");
      setMemberPassword("");
      setMemberRole("staff");
      setMemberAccessUntil("");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  function toggleMember(member: Member) {
    Alert.alert(
      member.active ? `Disable ${member.name}?` : `Enable ${member.name}?`,
      member.active ? "They will not be able to sign in." : "They can sign in again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: member.active ? "Disable" : "Enable",
          style: member.active ? "destructive" : undefined,
          onPress: () =>
            void run(
              () => api.setUserActive(member.id, !member.active),
              `${member.name} ${member.active ? "disabled" : "enabled"}`,
            ),
        },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.bg, justifyContent: "center" }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().then(() => setRefreshing(false));
            }}
            tintColor={theme.muted}
          />
        }
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={22} color={theme.ink} />
          </TouchableOpacity>
          <Text style={{ fontSize: 22, fontWeight: "700", color: theme.ink, marginLeft: 12 }}>Team</Text>
        </View>

        {status && <Text style={{ paddingHorizontal: 16, paddingBottom: 6, fontSize: 13, color: theme.muted }}>{status}</Text>}

        {/* ---- Usage (web Usage table) ---- */}
        {usage.length > 0 && (
          <>
            <Text style={[styles.listTitle, { color: theme.ink }]}>Usage</Text>
            <Text style={{ paddingHorizontal: 16, paddingBottom: 6, fontSize: 11, color: theme.muted }}>
              Who logged in, when they signed out and how long they were active.
            </Text>
            {usage.map((row) => {
              const online = row.lastLoginAt != null && (row.lastLogoutAt == null || new Date(row.lastLoginAt) > new Date(row.lastLogoutAt));
              const tone = roleColour(row.role);
              return (
                <View key={row.userId} style={[styles.row, { backgroundColor: theme.surface, borderBottomColor: theme.line }]}>
                  <View style={[styles.avatar, { backgroundColor: tone.bg }]}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: tone.ink }}>{initials(row.name)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "600", color: theme.ink }}>{row.name}</Text>
                      <View style={[styles.badge, { backgroundColor: tone.bg }]}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: tone.ink }}>{row.role}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                      {row.sessions} sessions · {formatDuration(row.activeSeconds)} · login {formatDateTime(row.lastLoginAt)}
                    </Text>
                    <Text style={{ fontSize: 11, color: online ? theme.successInk : theme.muted, marginTop: 2 }}>
                      {online ? "● Online now" : `Last logout ${formatDateTime(row.lastLogoutAt)}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ---- Members ---- */}
        <Text style={[styles.listTitle, { color: theme.ink }]}>Members</Text>
        <View style={[styles.membersCard, { backgroundColor: theme.surface }]}>
          {members.map((member) => {
            const isSelf = member.id === user?.id;
            const tone = roleColour(member.role);
            const role = approveRole[member.id] ?? "staff";
            return (
              <View key={member.id} style={[styles.memberRow, { borderBottomColor: theme.line }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <View style={[styles.avatar, { backgroundColor: tone.bg }]}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: tone.ink }}>{initials(member.name)}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: theme.ink }}>{member.name}</Text>
                      {isSelf && <Text style={{ fontSize: 11, color: theme.muted }}>(you)</Text>}
                      <View style={[styles.badge, { backgroundColor: tone.bg }]}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: tone.ink }}>{member.role}</Text>
                      </View>
                      {member.pending && (
                        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: theme.accentInk }}>awaiting approval</Text>
                        </View>
                      )}
                      {!member.pending && !member.active && (
                        <View style={[styles.badge, { backgroundColor: theme.errorSoft }]}>
                          <Text style={{ fontSize: 10, fontWeight: "700", color: theme.errorInk }}>disabled</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
                      {member.phone}
                      {member.accessUntil ? ` · until ${formatDate(member.accessUntil)}` : ""}
                    </Text>
                  </View>
                </View>

                {/* Pending → approve with role / reject (web selects + buttons). */}
                {member.pending ? (
                  <View>
                    <View style={styles.chipRow}>
                      {ROLES.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.chip,
                            role === option.value
                              ? { backgroundColor: theme.primary, borderColor: theme.primary }
                              : { backgroundColor: theme.surface2, borderColor: theme.line },
                          ]}
                          onPress={() => setApproveRole({ ...approveRole, [member.id]: option.value })}
                        >
                          <Text style={{ fontSize: 10, fontWeight: "600", color: role === option.value ? theme.onPrimary : theme.ink }}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                      <TouchableOpacity
                        onPress={() => void run(() => api.approveUser(member.id, role), `${member.name} approved`)}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.successInk }}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => void run(() => api.rejectUser(member.id), "Request rejected")}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.errorInk }}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : !isSelf && member.role !== "owner" ? (
                  <View>
                    <View style={styles.chipRow}>
                      {ROLES.map((option) => (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.chip,
                            member.role === option.value
                              ? { backgroundColor: theme.primary, borderColor: theme.primary }
                              : { backgroundColor: theme.surface2, borderColor: theme.line },
                          ]}
                          onPress={() => void run(() => api.setUserRole(member.id, option.value), `${member.name} is now ${option.value}`)}
                        >
                          <Text style={{ fontSize: 10, fontWeight: "600", color: member.role === option.value ? theme.onPrimary : theme.ink }}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                      <TouchableOpacity onPress={() => { setResetTarget(member); setResetPassword(""); setStatus(null); }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.ink }}>Reset password</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => toggleMember(member)}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: member.active ? theme.errorInk : theme.successInk }}>
                          {member.active ? "Disable" : "Enable"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* ---- Inline password reset (web resetTarget row) ---- */}
        {resetTarget && (
          <View style={[styles.card, { backgroundColor: theme.surface2 }]}>
            <Text style={{ fontSize: 13, color: theme.ink }}>
              New password for <Text style={{ fontWeight: "700" }}>{resetTarget.name}</Text>:
            </Text>
            <TextInput
              style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface, marginTop: 8 }]}
              placeholder="6+ characters"
              placeholderTextColor={theme.muted}
              secureTextEntry
              autoCapitalize="none"
              value={resetPassword}
              onChangeText={setResetPassword}
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: 1, backgroundColor: resetPassword.length >= 6 ? theme.primary : theme.surface3 }]}
                disabled={resetPassword.length < 6}
                onPress={() => {
                  const target = resetTarget;
                  const password = resetPassword;
                  setResetTarget(null);
                  setResetPassword("");
                  void run(() => api.resetUserPassword(target.id, password), `Password reset for ${target.name}`);
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: resetPassword.length >= 6 ? theme.onPrimary : theme.muted }}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { flex: 1, backgroundColor: theme.surface3 }]} onPress={() => setResetTarget(null)}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.ink }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ---- Add member ---- */}
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.cardTitle, { color: theme.muted }]}>ADD MEMBER</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Full name"
            placeholderTextColor={theme.muted}
            value={memberName}
            onChangeText={setMemberName}
          />
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="10 digits"
            placeholderTextColor={theme.muted}
            keyboardType="phone-pad"
            value={memberPhone}
            onChangeText={setMemberPhone}
          />
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="Password (6+ characters)"
            placeholderTextColor={theme.muted}
            secureTextEntry
            value={memberPassword}
            onChangeText={setMemberPassword}
          />
          <Text style={[styles.label, { color: theme.muted }]}>Role</Text>
          <View style={styles.chipRow}>
            {ROLES.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  memberRole === option.value
                    ? { backgroundColor: theme.primary, borderColor: theme.primary }
                    : { backgroundColor: theme.surface2, borderColor: theme.line },
                ]}
                onPress={() => setMemberRole(option.value)}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: memberRole === option.value ? theme.onPrimary : theme.ink }}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.label, { color: theme.muted }]}>Access until (optional)</Text>
          <TextInput
            style={[styles.input, { borderColor: theme.line, color: theme.ink, backgroundColor: theme.surface2 }]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.muted}
            value={memberAccessUntil}
            onChangeText={setMemberAccessUntil}
          />
          <Text style={{ fontSize: 10, color: theme.muted, marginTop: 4 }}>The account is disabled automatically after this date.</Text>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: adding ? theme.surface3 : theme.primary }]}
            disabled={adding}
            onPress={() => void addMember()}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: adding ? theme.muted : theme.onPrimary }}>
              {adding ? "Adding…" : "Add member"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", padding: 16 },
  listTitle: { fontSize: 15, fontWeight: "700", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  membersCard: { marginHorizontal: 12, borderRadius: 14, padding: 4 },
  memberRow: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  badge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  card: {
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 12,
    marginTop: 10,
    elevation: 2,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  label: { fontSize: 11, fontWeight: "600", marginBottom: 4, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 14, minHeight: 40 },
  saveBtn: { borderRadius: 12, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
});
