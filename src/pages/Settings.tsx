import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import LoadingMark from "../components/LoadingMark";
import { DEFAULT_AI_CONFIG, getAiConfig, saveAiConfig, type AiConfig } from "../db/settings";
import { useDb } from "../lib/db-context";
import { deleteSecret, getSecret, hashPin, saveSecret, SECRET_KEYS, verifyPin } from "../lib/secrets";
import { callAiApi } from "../lib/aiApi";
import { getAuditActor, listActivity, logActivity, type ActivityRow } from "../db/activity";
import {
  createUser,
  listAppUsers,
  resetUserPassword,
  setUserActive,
  setUserRole,
  type AppUser,
} from "../db/users";
import { can, getRoleMatrix, saveRolePermissions } from "../db/permissions";
import {
  ACTION_LABELS,
  MODULES,
  MODULE_LABELS,
  PERMISSION_ACTIONS,
  type ModuleKey,
  type PermissionAction,
  type Role,
  type RolePermissions,
} from "../logic/permissions";
import {
  DEFAULT_EMAIL,
  DEFAULT_SHOP,
  getChatWorkerUrl,
  getEmailSettings,
  getShopDetails,
  saveChatWorkerUrl,
  saveEmailSettings,
  saveShopDetails,
  type EmailSettings,
  type ShopDetails,
} from "../db/settings";
import { sendEmail } from "../lib/email";
import { endSession } from "../db/sessions";
import { getCostingMethod, setCostingMethod, type CostingMethod } from "../db/costing";
import {
  getOpeningBalance,
  saveOpeningBalance,
  type OpeningBalance,
} from "../db/cashLedger";
import { formatRupees } from "../logic/units";

const PIN_RE = /^\d{4,6}$/;

export default function Settings({
  onReset,
  onLock,
}: {
  onReset: () => void;
  onLock: () => void;
}) {
  const db = useDb();
  const [ai, setAi] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const [aiKeySaved, setAiKeySaved] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [stored, setStored] = useState<{ db: boolean; pin: boolean; aiKey: boolean } | null>(null);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinStatus, setPinStatus] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [activityFilter, setActivityFilter] = useState("");
  const [shop, setShop] = useState<ShopDetails>(DEFAULT_SHOP);
  const [emailCfg, setEmailCfg] = useState<EmailSettings>(DEFAULT_EMAIL);
  const [emailKeyInput, setEmailKeyInput] = useState("");
  const [emailKeySaved, setEmailKeySaved] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [shopStatus, setShopStatus] = useState<string | null>(null);
  const [costingMethod, setCostingMethodState] = useState<CostingMethod>("WAC");
  const [costingStatus, setCostingStatus] = useState<string | null>(null);
  /** The Cloudflare Worker that holds the Team Chat (Phase 12). */
  const [chatWorkerUrl, setChatWorkerUrl] = useState("");
  const [chatWorkerStatus, setChatWorkerStatus] = useState<string | null>(null);
  const [openingBalance, setOpeningBalanceState] = useState<OpeningBalance | null>(null);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [openingNote, setOpeningNote] = useState("");
  const [openingStatus, setOpeningStatus] = useState<string | null>(null);
  const [members, setMembers] = useState<AppUser[]>([]);
  const [membersStatus, setMembersStatus] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberRole, setMemberRole] = useState<Role>("staff");
  const [memberAccessUntil, setMemberAccessUntil] = useState("");
  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [roleMatrix, setRoleMatrix] = useState<Record<Role, RolePermissions> | null>(null);
  const [rolesMsg, setRolesMsg] = useState<string | null>(null);
  const canTeamView = can("team", "view");
  const isOwner = getAuditActor().role === "owner";

  useEffect(() => {
    listActivity(db)
      .then(setActivity)
      .catch(() => setActivity([]));
  }, [db]);

  useEffect(() => {
    getCostingMethod(db)
      .then(setCostingMethodState)
      .catch(() => setCostingMethodState("WAC"));
  }, [db]);

  useEffect(() => {
    getOpeningBalance(db)
      .then(setOpeningBalanceState)
      .catch(() => setOpeningBalanceState(null));
  }, [db]);

  async function loadMembers() {
    setMembers(await listAppUsers(db));
  }

  useEffect(() => {
    if (can("team", "view")) {
      listAppUsers(db).then(setMembers).catch(() => setMembers([]));
    }
    if (getAuditActor().role === "owner") {
      getRoleMatrix(db).then(setRoleMatrix).catch(() => setRoleMatrix(null));
    }
  }, [db]);

  async function addMember() {
    setError(null);
    setMembersStatus(null);
    try {
      await createUser(db, {
        name: memberName,
        phone: memberPhone,
        password: memberPassword,
        role: memberRole,
        accessUntil: memberAccessUntil || null,
      });
      setMembersStatus("Member added");
      setMemberName("");
      setMemberPhone("");
      setMemberPassword("");
      setMemberRole("staff");
      setMemberAccessUntil("");
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveResetPassword() {
    if (!resetTarget) return;
    setError(null);
    setMembersStatus(null);
    try {
      await resetUserPassword(db, resetTarget.id, resetPassword);
      setMembersStatus(`Password reset for ${resetTarget.name}`);
      setResetTarget(null);
      setResetPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleMember(user: AppUser) {
    setError(null);
    setMembersStatus(null);
    try {
      await setUserActive(db, user.id, !user.active);
      setMembersStatus(`${user.name} ${user.active ? "disabled" : "enabled"}`);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function changeMemberRole(member: AppUser, role: Role) {
    setError(null);
    setMembersStatus(null);
    try {
      await setUserRole(db, member.id, role);
      setMembersStatus(`${member.name} is now ${role}`);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function togglePermission(role: "ca" | "staff", moduleKey: ModuleKey, action: PermissionAction) {
    setRoleMatrix((current) => {
      if (!current) return current;
      return {
        ...current,
        [role]: {
          ...current[role],
          [moduleKey]: {
            ...current[role][moduleKey],
            [action]: !current[role][moduleKey][action],
          },
        },
      };
    });
  }

  async function saveRoles() {
    if (!roleMatrix) return;
    setRolesMsg(null);
    try {
      const ca = await saveRolePermissions(db, "ca", roleMatrix.ca);
      const staff = await saveRolePermissions(db, "staff", roleMatrix.staff);
      setRoleMatrix({ owner: roleMatrix.owner, ca, staff });
      setRolesMsg("Permissions saved");
    } catch (err) {
      setRolesMsg(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    getShopDetails(db)
      .then(setShop)
      .catch(() => setShop(DEFAULT_SHOP));
    getEmailSettings(db)
      .then(setEmailCfg)
      .catch(() => setEmailCfg(DEFAULT_EMAIL));
    getChatWorkerUrl(db)
      .then(setChatWorkerUrl)
      .catch(() => setChatWorkerUrl(""));
    getSecret(SECRET_KEYS.SMTP_PASSWORD)
      .then((value) => setEmailKeySaved(Boolean(value)))
      .catch(() => setEmailKeySaved(false));
  }, [db]);

  async function saveEmailCfg() {
    setError(null);
    setEmailStatus(null);
    try {
      await saveEmailSettings(db, emailCfg);
      setEmailStatus("Email settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveEmailKey() {
    const value = emailKeyInput.trim();
    if (!value) return;
    setError(null);
    try {
      await saveSecret(SECRET_KEYS.SMTP_PASSWORD, value);
      setEmailKeyInput("");
      setEmailKeySaved(true);
      setEmailStatus("App password saved to Keychain");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function sendTestEmail() {
    setEmailStatus("Sending test email…");
    try {
      const password = await getSecret(SECRET_KEYS.SMTP_PASSWORD);
      if (!password) {
        setEmailStatus("Save the Gmail app password first");
        return;
      }
      await sendEmail({
        host: emailCfg.host,
        port: Number(emailCfg.port) || 465,
        username: emailCfg.fromEmail,
        password,
        fromEmail: emailCfg.fromEmail,
        fromName: emailCfg.fromName,
        to: testTo.trim() || emailCfg.fromEmail,
        subject: "Stock Tracker test email",
        html: "<p>This is a test email from Stock Tracker. Your bill emails are ready.</p>",
      });
      setEmailStatus("Test email sent — check your inbox");
    } catch (err) {
      setEmailStatus(`Email failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function saveShop() {
    setError(null);
    setShopStatus(null);
    try {
      await saveShopDetails(db, shop);
      setShopStatus("Shop details saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [dbUrl, pinHash] = await Promise.all([
          getSecret(SECRET_KEYS.DATABASE_URL),
          getSecret(SECRET_KEYS.PIN_HASH),
        ]);
        setStored({ db: Boolean(dbUrl), pin: Boolean(pinHash), aiKey: false });
        setAiKeySaved(false);
      } catch {
        setStored({ db: false, pin: false, aiKey: false });
      }
    })();
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  useEffect(() => {
    getAiConfig(db)
      .then(setAi)
      .catch(() => setAi(DEFAULT_AI_CONFIG));
  }, [db]);

  async function persistAi(next: AiConfig) {
    setAi(next);
    try {
      await saveAiConfig(db, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveKey() {
    setError(null);
    setKeyInput("");
    setAiKeySaved(false);
    setError("The AI key is stored in Cloudflare — nothing to save locally.");
    window.setTimeout(() => setError(null), 4000);
  }

  async function testAi() {
    setAiStatus("Testing…");
    try {
      const workerUrl = await getChatWorkerUrl(db);
      if (!workerUrl) {
        setAiStatus("AI failed: worker URL not set");
        return;
      }
      await callAiApi(workerUrl, "Reply with the single word OK.", []);
      setAiStatus("AI OK");
    } catch (err) {
      setAiStatus(`AI failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function resetConnection() {
    setBusy(true);
    setError(null);
    try {
      await deleteSecret(SECRET_KEYS.DATABASE_URL);
      await deleteSecret(SECRET_KEYS.PIN_HASH);
      try {
        await logActivity(db, {
          event: "reset",
          summary: "Connection and PIN removed from this computer",
        });
      } catch {
        // Logging must not block the reset.
      }
      onReset();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function lockNow() {
    try {
      await logActivity(db, { event: "user.logout", summary: "Locked the app (session closed)" });
    } catch {
      // Never block locking on a logging failure.
    }
    // Close the open session so the usage metrics know the active time.
    try {
      const actor = getAuditActor();
      if (actor?.userId) await endSession(db, actor.userId, "desktop");
    } catch {
      // Never block locking on a session-tracking failure.
    }
    onLock();
  }

  async function changePin() {
    setPinError(null);
    setPinStatus(null);
    if (!PIN_RE.test(newPin)) {
      setPinError("PIN must be 4-6 digits");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("PINs do not match");
      return;
    }
    setPinBusy(true);
    try {
      const hash = await getSecret(SECRET_KEYS.PIN_HASH);
      if (!hash) {
        setPinError("No PIN is saved on this computer. Reset the connection to start again.");
        return;
      }
      if (!(await verifyPin(currentPin, hash))) {
        setPinError("Current PIN is incorrect");
        return;
      }
      await saveSecret(SECRET_KEYS.PIN_HASH, await hashPin(newPin));
      setPinStatus("PIN updated");
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (err) {
      setPinError(err instanceof Error ? err.message : String(err));
    } finally {
      setPinBusy(false);
    }
  }

  async function removeAiKey() {
    setError(null);
    setAiKeySaved(false);
    setError("Nothing to remove — the AI key is stored in Cloudflare, not locally.");
    window.setTimeout(() => setError(null), 4000);
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Settings</h1>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Security</h2>
          <p className="text-sm text-muted">
            Secrets live in this Mac's Keychain — never in files or the database. The PIN is stored
            only as an argon2id hash.
          </p>
        </div>
        <ul className="space-y-1 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <li className={stored?.pin ? "text-success-ink" : "text-accent-ink"}>
            PIN: {stored ? (stored.pin ? "set" : "not set") : "checking…"}
          </li>
          <li className={stored?.db ? "text-success-ink" : "text-accent-ink"}>
            Database connection: {stored ? (stored.db ? "saved" : "not saved") : "checking…"}
          </li>
          <li className={stored?.aiKey ? "text-success-ink" : "text-muted"}>
            AI cloud key: {stored ? (stored.aiKey ? "saved" : "not saved") : "checking…"}
          </li>
        </ul>
        <button type="button" className="btn-ghost" onClick={() => void lockNow()}>
          Lock now
        </button>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Change PIN</h2>
          <p className="text-sm text-muted">Requested every time the app starts.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="label" htmlFor="pin-current">
              Current PIN
            </label>
            <input
              id="pin-current"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              className="input w-full"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="pin-new">
              New PIN
            </label>
            <input
              id="pin-new"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className="input w-full"
              value={newPin}
              onChange={(e) => setNewPin(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="pin-confirm">
              Confirm new PIN
            </label>
            <input
              id="pin-confirm"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className="input w-full"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.currentTarget.value)}
            />
          </div>
        </div>
        {pinError && (
          <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
            {pinError}
          </p>
        )}
        {pinStatus && !pinError && (
          <p role="status" className="rounded bg-success-soft px-3 py-2 text-sm text-success-ink">
            {pinStatus}
          </p>
        )}
        <button
          type="button"
          className="btn-primary"
          onClick={() => void changePin()}
          disabled={pinBusy}
        >
          Update PIN
        </button>
      </section>

      {canTeamView && (
        <section className="space-y-3 card p-4" data-testid="members-card">
          <div>
            <h2 className="text-sm font-medium">Members</h2>
            <p className="text-sm text-muted">
              Members sign in with their phone number and password.
            </p>
          </div>
          {members.length === 0 ? (
            <p className="text-sm text-muted">No members yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {members.map((member) => {
                const isSelf = getAuditActor().userId === member.id;
                return (
                  <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>
                      <b>{member.name}</b> · {member.phone}{" "}
                      <span className={`badge ${member.role === "owner" ? "badge-ok" : ""}`}>
                        {member.role === "ca" ? "CA" : member.role}
                      </span>{" "}
                      {member.accessUntil && <span className="text-xs text-muted">until {member.accessUntil}</span>}{" "}
                      {!member.active && <span className="badge badge-bad">disabled</span>}
                    </span>
                    {!isSelf && can("team", "edit") && (
                      <span className="flex flex-wrap items-center gap-2">
                        <select
                          className="input text-sm"
                          value={member.role}
                          disabled={member.role === "owner"}
                          onChange={(e) => void changeMemberRole(member, e.currentTarget.value as Role)}
                          aria-label={`Role for ${member.name}`}
                        >
                          <option value="staff">Staff</option>
                          <option value="ca">CA</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button
                          type="button"
                          className="text-sm underline"
                          onClick={() => {
                            setResetTarget(member);
                            setResetPassword("");
                          }}
                        >
                          Reset password
                        </button>
                        {member.active ? (
                          member.role !== "owner" && (
                            <button
                              type="button"
                              className="text-sm text-error-ink underline"
                              onClick={() => void toggleMember(member)}
                            >
                              Deactivate
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            className="text-sm text-success-ink underline"
                            onClick={() => void toggleMember(member)}
                          >
                            Enable
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {can("team", "create") && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="label" htmlFor="member-name">Member name</label>
                  <input id="member-name" className="input w-full" value={memberName}
                    onChange={(e) => setMemberName(e.currentTarget.value)} />
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-phone">Member phone</label>
                  <input id="member-phone" className="input w-full" inputMode="numeric" value={memberPhone}
                    onChange={(e) => setMemberPhone(e.currentTarget.value)} />
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-password">Member password</label>
                  <input id="member-password" type="password" className="input w-full" value={memberPassword}
                    onChange={(e) => setMemberPassword(e.currentTarget.value)} />
                </div>
                <div className="space-y-1">
                  <label className="label" htmlFor="member-role">Member role</label>
                  <select id="member-role" className="input w-full" value={memberRole}
                    onChange={(e) => setMemberRole(e.currentTarget.value as Role)}>
                    <option value="staff">Staff</option>
                    <option value="ca">CA (Accountant)</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="label" htmlFor="member-access-until">Access until (optional)</label>
                  <input id="member-access-until" type="date" className="input w-full" value={memberAccessUntil}
                    onChange={(e) => setMemberAccessUntil(e.currentTarget.value)} />
                </div>
              </div>
              <button type="button" className="btn-primary" onClick={() => void addMember()}>
                Add member
              </button>
            </>
          )}

          {resetTarget && (
            <div className="space-y-2 rounded-xl bg-surface-2 p-3">
              <p className="text-sm">New password for <b>{resetTarget.name}</b></p>
              <div className="flex gap-2">
                <input
                  className="flex-1 input"
                  type="password"
                  placeholder="At least 6 characters"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.currentTarget.value)}
                />
                <button type="button" className="btn-primary" onClick={() => void saveResetPassword()}>
                  Save password
                </button>
                <button type="button" className="btn-ghost" onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {membersStatus && <p role="status" className="text-sm text-success-ink">{membersStatus}</p>}
        </section>
      )}

      {isOwner && can("team", "edit") && (
        <section className="space-y-3 card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">Roles &amp; permissions</h2>
              <p className="text-sm text-muted">Owner always has full access. Changes are logged in Activity.</p>
            </div>
            <button type="button" className="btn-primary" onClick={() => void saveRoles()} disabled={!roleMatrix}>
              Save changes
            </button>
          </div>
          {rolesMsg && <p role="status" className="text-sm text-muted">{rolesMsg}</p>}
          {!roleMatrix ? (
            <LoadingMark />
          ) : (
            (["ca", "staff"] as const).map((role) => (
              <div key={role} className="space-y-2">
                <h3 className="text-sm font-semibold">{role === "ca" ? "CA (Accountant)" : "Staff"}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2">Module</th>
                        {PERMISSION_ACTIONS.map((action) => (
                          <th key={action} className="px-3 py-2 text-center">{ACTION_LABELS[action]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MODULES.map((moduleKey) => (
                        <tr key={moduleKey} className="border-t border-line">
                          <td className="px-3 py-2 font-medium">{MODULE_LABELS[moduleKey]}</td>
                          {PERMISSION_ACTIONS.map((action) => (
                            <td key={action} className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={roleMatrix[role][moduleKey][action]}
                                onChange={() => togglePermission(role, moduleKey, action)}
                                aria-label={`${MODULE_LABELS[moduleKey]} ${ACTION_LABELS[action]} for ${role}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Email (send bills)</h2>
          <p className="text-sm text-muted">
            Gmail SMTP + app password. Bills go out from your own address with the PDF invoice attached.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="label" htmlFor="email-from">From email</label>
            <input id="email-from" type="email" className="input w-full" value={emailCfg.fromEmail}
              onChange={(e) => setEmailCfg({ ...emailCfg, fromEmail: e.currentTarget.value })} />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="email-name">Display name</label>
            <input id="email-name" className="input w-full" value={emailCfg.fromName}
              onChange={(e) => setEmailCfg({ ...emailCfg, fromName: e.currentTarget.value })} />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="email-host">SMTP host</label>
            <input id="email-host" className="input w-full" value={emailCfg.host}
              onChange={(e) => setEmailCfg({ ...emailCfg, host: e.currentTarget.value })} />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="email-port">Port</label>
            <input id="email-port" className="input w-full" value={emailCfg.port}
              onChange={(e) => setEmailCfg({ ...emailCfg, port: e.currentTarget.value })} />
          </div>
        </div>
        <div className="space-y-1">
          <label className="label" htmlFor="email-password">Gmail app password</label>
          <div className="flex gap-2">
            <input id="email-password" type="password" autoComplete="off" className="flex-1 input"
              placeholder={emailKeySaved ? "App password saved — enter a new one to replace" : "16-character app password"}
              value={emailKeyInput} onChange={(e) => setEmailKeyInput(e.currentTarget.value)} />
            <button type="button" className="btn-ghost" onClick={() => void saveEmailKey()}>Save password</button>
          </div>
        </div>
        {emailStatus && <p role="status" className="text-sm text-ink">{emailStatus}</p>}
        <div className="space-y-1">
          <label className="label" htmlFor="email-test-to">Send test to (optional)</label>
          <input id="email-test-to" type="email" className="input w-full" placeholder="Defaults to the From email"
            value={testTo} onChange={(e) => setTestTo(e.currentTarget.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => void saveEmailCfg()}>Save email settings</button>
          <button type="button" className="btn-ghost" onClick={() => void sendTestEmail()}>Send test email</button>
        </div>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Team Chat</h2>
          <p className="text-sm text-muted">
            The chat runs on the Cloudflare Worker (live messages, receipt files, approvals). Paste its
            address here, then sign out and sign in again so the app can get a chat token.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1 space-y-1">
            <label className="label text-xs" htmlFor="chat-worker-url">
              Worker address
            </label>
            <input
              id="chat-worker-url"
              type="url"
              className="input text-sm"
              placeholder="https://sdhhe-api.blvphani.workers.dev"
              value={chatWorkerUrl}
              onChange={(e) => setChatWorkerUrl(e.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() =>
              void saveChatWorkerUrl(db, chatWorkerUrl).then(() =>
                setChatWorkerStatus(
                  chatWorkerUrl.trim() ? "Worker address saved — sign in again to connect" : "Worker address cleared",
                ),
              )
            }
          >
            Save
          </button>
          {chatWorkerStatus && <span className="text-sm text-muted">{chatWorkerStatus}</span>}
        </div>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Stock costing</h2>
          <p className="text-sm text-muted">
            Weighted average keeps one average cost per item (purchase expenses included). FIFO costs each
            sale from the oldest batch.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select
            className="input w-56"
            value={costingMethod}
            onChange={(e) => {
              const method = e.currentTarget.value as CostingMethod;
              setCostingMethodState(method);
              void setCostingMethod(db, method).then(() => setCostingStatus(`Costing method set to ${method}`));
            }}
          >
            <option value="WAC">Weighted average (WAC)</option>
            <option value="FIFO">FIFO (batch-wise)</option>
          </select>
          {costingStatus && <span className="text-sm text-muted">{costingStatus}</span>}
        </div>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Opening balance (investment)</h2>
          <p className="text-sm text-muted">
            Starting cash/bank balance used for working-capital calculations.
          </p>
        </div>
        {openingBalance && (
          <p className="text-xs text-muted">
            Current: {formatRupees(openingBalance.amountPaise)} as of{" "}
            {openingBalance.asOfDate}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3 items-end">
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="opening-amount">
              Amount (₹)
            </label>
            <input
              id="opening-amount"
              type="text"
              className="input text-sm"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="opening-date">
              As of date
            </label>
            <input
              id="opening-date"
              type="date"
              className="input text-sm"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="label text-xs" htmlFor="opening-note">Note</label>
            <input
              id="opening-note"
              type="text"
              className="input text-sm"
              value={openingNote}
              onChange={(e) => setOpeningNote(e.currentTarget.value)}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              const amountRupees = parseFloat(openingAmount.replace(/,/g, ""));
              if (!openingDate || !Number.isFinite(amountRupees) || amountRupees < 0) {
                setOpeningStatus("Enter a valid amount and date");
                return;
              }
              const amountPaise = Math.round(amountRupees * 100);
              try {
                await saveOpeningBalance(db, {
                  amountPaise,
                  asOfDate: openingDate,
                  note: openingNote.trim() || null,
                });
                setOpeningStatus("Opening balance saved");
                setOpeningAmount("");
                setOpeningNote("");
                void getOpeningBalance(db).then(setOpeningBalanceState);
              } catch (err) {
                setOpeningStatus(
                  err instanceof Error ? err.message : String(err),
                );
              }
            }}
          >
            Save
          </button>
          {openingStatus && <span className="text-sm text-muted">{openingStatus}</span>}
        </div>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Shop details</h2>
          <p className="text-sm text-muted">Printed on every GST bill.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="label" htmlFor="shop-name">
              Shop name
            </label>
            <input
              id="shop-name"
              className="input w-full"
              value={shop.name}
              onChange={(e) => setShop({ ...shop, name: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-short-name">
              Short name (bill mark)
            </label>
            <input
              id="shop-short-name"
              className="input w-full uppercase"
              placeholder="SDHHE"
              value={shop.shortName}
              onChange={(e) => setShop({ ...shop, shortName: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-phone">
              Phone
            </label>
            <input
              id="shop-phone"
              className="input w-full"
              value={shop.phone}
              onChange={(e) => setShop({ ...shop, phone: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-address">
              Address
            </label>
            <input
              id="shop-address"
              className="input w-full"
              value={shop.address}
              onChange={(e) => setShop({ ...shop, address: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-gstin">
              GSTIN
            </label>
            <input
              id="shop-gstin"
              className="input w-full uppercase"
              value={shop.gstin}
              onChange={(e) => setShop({ ...shop, gstin: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-email">
              Email
            </label>
            <input
              id="shop-email"
              className="input w-full"
              value={shop.email}
              onChange={(e) => setShop({ ...shop, email: e.currentTarget.value })}
            />
          </div>
        </div>

        <p className="pt-1 text-[13px] font-medium text-ink">Bank details (printed on the bill)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="label" htmlFor="shop-bank-name">
              Bank name
            </label>
            <input
              id="shop-bank-name"
              className="input w-full"
              value={shop.bankName}
              onChange={(e) => setShop({ ...shop, bankName: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-bank-account">
              Account number
            </label>
            <input
              id="shop-bank-account"
              className="input w-full"
              value={shop.bankAccount}
              onChange={(e) => setShop({ ...shop, bankAccount: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-bank-ifsc">
              IFSC
            </label>
            <input
              id="shop-bank-ifsc"
              className="input w-full uppercase"
              value={shop.bankIfsc}
              onChange={(e) => setShop({ ...shop, bankIfsc: e.currentTarget.value })}
            />
          </div>
          <div className="space-y-1">
            <label className="label" htmlFor="shop-bank-branch">
              Branch
            </label>
            <input
              id="shop-bank-branch"
              className="input w-full"
              value={shop.bankBranch}
              onChange={(e) => setShop({ ...shop, bankBranch: e.currentTarget.value })}
            />
          </div>
        </div>
        {shopStatus && (
          <p role="status" className="rounded bg-success-soft px-3 py-2 text-sm text-success-ink">
            {shopStatus}
          </p>
        )}
        <button type="button" className="btn-primary" onClick={() => void saveShop()}>
          Save shop details
        </button>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Connection</h2>
          <p className="text-sm text-muted">
            Remove the saved database connection and PIN from this computer.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-error/50 px-3 py-1 text-sm text-error-ink hover:bg-error-soft"
          onClick={() => setConfirming(true)}
        >
          Reset connection
        </button>
      </section>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">AI assistant</h2>
          <p className="text-sm text-muted">
            Optional. The app always shows rule-based suggestions without it.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={(e) => void persistAi({ ...ai, enabled: e.currentTarget.checked })}
          />
          Use AI
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="label" htmlFor="ai-mode">
              Mode
            </label>
            <select
              id="ai-mode"
              className="input w-full"
              value={ai.mode}
              onChange={(e) =>
                void persistAi({ ...ai, mode: e.currentTarget.value === "cloud" ? "cloud" : "local" })
              }
            >
              <option value="local">local (Ollama on this Mac)</option>
              <option value="cloud">cloud (ollama.com)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="label" htmlFor="ai-model">
              Model
            </label>
            <input
              id="ai-model"
              className="input w-full"
              value={ai.model}
              onChange={(e) => setAi({ ...ai, model: e.currentTarget.value })}
              onBlur={() => void persistAi(ai)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="label" htmlFor="ai-key">
            Cloud API key
          </label>
          <div className="flex gap-2">
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              className="flex-1 input"
              placeholder={aiKeySaved ? "Key saved — enter a new one to replace" : "Ollama cloud key"}
              value={keyInput}
              onChange={(e) => setKeyInput(e.currentTarget.value)}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void saveKey()}
            >
              Save key
            </button>
            {aiKeySaved && (
              <button
                type="button"
                className="btn-ghost text-error-ink hover:bg-error-soft"
                onClick={() => void removeAiKey()}
              >
                Remove key
              </button>
            )}
          </div>
          {aiKeySaved && <p className="text-xs text-success-ink">Key saved ✓</p>}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void testAi()}
          >
            Test AI
          </button>
          {aiStatus && <span className="text-sm text-ink">{aiStatus}</span>}
        </div>
      </section>

      <p className="text-sm text-muted">More settings coming soon.</p>

      <section className="space-y-3 card p-4">
        <div>
          <h2 className="text-sm font-medium">Recent activity</h2>
          <p className="text-sm text-muted">
            Logins, locks and every change — stored in the database.
          </p>
        </div>
        {activity.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="label" htmlFor="activity-filter">
              Member
            </label>
            <select
              id="activity-filter"
              className="input"
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.currentTarget.value)}
            >
              <option value="">All members</option>
              {[...new Set(activity.map((row) => row.actor))].sort().map((actor) => (
                <option key={actor} value={actor}>
                  {actor}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void listActivity(db).then(setActivity).catch(() => setActivity([]))}
            >
              Refresh
            </button>
          </div>
        )}
        {activity.length === 0 ? (
          <p className="text-sm text-muted">No activity recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {activity
              .filter((row) => !activityFilter || row.actor === activityFilter)
              .map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span>{row.summary}</span>
                <span className="text-xs text-muted">
                  {new Date(row.at).toLocaleString()} · {row.actor}
                </span>
              </li>
            ))}
          </ul>
        )}
        {activity.length > 0 && activityFilter && (
          <p className="text-xs text-muted">
            Showing {activity.filter((row) => row.actor === activityFilter).length} event(s) for{" "}
            {activityFilter}.
          </p>
        )}
      </section>

      <p className="text-xs text-muted">Stock Tracker v{version ?? "—"}</p>

      {error && (
        <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
          {error}
        </p>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-title"
          className="fixed inset-0 flex items-center justify-center bg-scrim p-4"
        >
          <div className="w-full max-w-sm space-y-4 card p-5">
            <h2 id="reset-title" className="text-lg font-semibold">
              Reset connection?
            </h2>
            <p className="text-sm text-ink">
              This removes the saved database connection and PIN from this computer. Your data in
              the database is not deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-error px-3 py-1 text-sm font-medium text-on-error disabled:opacity-50"
                onClick={resetConnection}
                disabled={busy}
              >
                Yes, reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
