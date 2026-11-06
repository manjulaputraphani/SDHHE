import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getDb } from "../db/client";
import { countUsers, createUser, findUserByPhone, setUserActive, type AppUser } from "../db/users";
import { logActivity, setAuditActor } from "../db/activity";
import { loadPermissionsForRole, setCurrentPermissions } from "../db/permissions";
import { DEFAULT_ROLE_PERMISSIONS } from "../logic/permissions";
import { deleteSecret, saveSecret, SECRET_KEYS, verifyPassword } from "../lib/secrets";
import { normalizePhone } from "../logic/auth";
import { startSession } from "../db/sessions";
import { getChatWorkerUrl } from "../db/settings";
import { chatLogin } from "../lib/chatClient";
import CoffeeIcon from "../components/CoffeeIcon";
import ThemeToggle from "../components/ThemeToggle";

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

type Props = { url: string; onLogin: (user: AppUser) => void };

export default function Lock({ url, onLogin }: Props) {
  const db = useMemo(() => getDb(url), [url]);
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isLocked = lockedUntil !== null && now < lockedUntil;
  const secondsLeft = isLocked ? Math.ceil((lockedUntil - now) / 1000) : 0;

  useEffect(() => {
    countUsers(db)
      .then((count) => setFirstRun(count === 0))
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setFirstRun(false);
      });
  }, [db]);

  useEffect(() => {
    if (lockedUntil === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setAttempts(0);
        setError(null);
      }
    }, 250);
    return () => clearInterval(id);
  }, [lockedUntil]);

  async function finishLogin(user: AppUser) {
    setAuditActor({ userId: user.id, name: user.name, role: user.role });
    try {
      const permissions = await loadPermissionsForRole(db, user.role);
      setCurrentPermissions(permissions);
    } catch {
      setCurrentPermissions(DEFAULT_ROLE_PERMISSIONS[user.role]);
    }
    try {
      await logActivity(db, { event: "user.login", summary: `${user.name} signed in` });
    } catch {
      // logging must never block sign-in
    }
    // Open a session so the usage metrics know who was in and for how long.
    try {
      await startSession(db, user.id, "desktop", user.name);
    } catch {
      // session tracking must never block sign-in
    }
    // The PIN is retired once member login works.
    try {
      await deleteSecret(SECRET_KEYS.PIN_HASH);
    } catch {
      // already gone is fine
    }
    onLogin(user);
  }

  async function createOwner(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Enter your name");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const owner = await createUser(db, { name, phone, password, role: "owner" });
      await finishLogin(owner);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (isLocked || busy) return;
    setError(null);
    const check = normalizePhone(phone);
    if (!check.valid) {
      setError(check.reason ?? "Enter a valid phone number");
      return;
    }
    setBusy(true);
    try {
      const user = await findUserByPhone(db, check.phone);
      if (!user) {
        setError("No account found for this number");
        return;
      }
      if (user.pending) {
        setError("This account is awaiting owner approval");
        return;
      }
      if (!user.active) {
        setError("This account is disabled — ask the owner");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      if (user.accessUntil && user.accessUntil < today) {
        await setUserActive(db, user.id, false).catch(() => undefined);
        setError("Access expired — ask the owner");
        return;
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        const next = attempts + 1;
        setAttempts(next);
        setPassword("");
        if (next >= MAX_ATTEMPTS) {
          setNow(Date.now());
          setLockedUntil(Date.now() + LOCK_MS);
        } else {
          setError(`Wrong password. ${MAX_ATTEMPTS - next} attempt(s) left.`);
        }
        return;
      }
      setAttempts(0);
      await finishLogin(user);
      // The chat lives on the Cloudflare Worker — get a token for it while the
      // password is still at hand. The chat is optional: a failure here must
      // never stop the sign-in.
      void connectChat(check.phone, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Ask the chat worker for a token and keep it in the Keychain. */
  async function connectChat(memberPhone: string, memberPassword: string) {
    try {
      const workerUrl = await getChatWorkerUrl(db);
      if (!workerUrl) return;
      const { token, expiresAt } = await chatLogin(workerUrl, memberPhone, memberPassword);
      await saveSecret(SECRET_KEYS.CHAT_TOKEN, JSON.stringify({ token, expiresAt }));
    } catch {
      // The member can sign in again later; the chat screen explains itself.
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-sm p-6">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-on-primary">
              <CoffeeIcon />
            </span>
            <span className="space-y-0.5">
              <h1 className="text-[13px] font-semibold uppercase leading-snug tracking-[0.06em]">
                SREE DURGA HARIHARA ENTERPRISES
              </h1>
              <p className="text-sm text-muted">
                {firstRun === null
                  ? "Loading…"
                  : firstRun
                    ? "First run — create the owner account."
                    : "Sign in with your phone number and password."}
              </p>
            </span>
          </div>
          <ThemeToggle />
        </header>

        {firstRun === null ? null : firstRun ? (
          <form className="space-y-4" onSubmit={createOwner} data-testid="owner-form">
            <div className="space-y-1">
              <label className="label" htmlFor="owner-name">
                Your name
              </label>
              <input
                id="owner-name"
                className="input w-full"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="label" htmlFor="owner-phone">
                Phone number
              </label>
              <input
                id="owner-phone"
                className="input w-full"
                inputMode="numeric"
                placeholder="10 digits"
                value={phone}
                onChange={(e) => setPhone(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="label" htmlFor="owner-password">
                Password
              </label>
              <input
                id="owner-password"
                type="password"
                autoComplete="new-password"
                className="input w-full"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="label" htmlFor="owner-confirm">
                Confirm password
              </label>
              <input
                id="owner-confirm"
                type="password"
                autoComplete="new-password"
                className="input w-full"
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
              />
            </div>
            {error && (
              <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
                {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              Create owner
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={signIn} data-testid="login-form">
            <div className="space-y-1">
              <label className="label" htmlFor="login-phone">
                Phone number
              </label>
              <input
                id="login-phone"
                className="input w-full"
                inputMode="numeric"
                placeholder="10 digits"
                autoFocus
                value={phone}
                disabled={isLocked}
                onChange={(e) => setPhone(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="label" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                className="input w-full"
                value={password}
                disabled={isLocked}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </div>

            {isLocked ? (
              <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
                Too many wrong attempts. Try again in {secondsLeft}s.
              </p>
            ) : (
              error && (
                <p role="alert" className="rounded bg-error-soft px-3 py-2 text-sm text-error-ink">
                  {error}
                </p>
              )
            )}

            <button type="submit" className="btn-primary w-full" disabled={isLocked || busy}>
              Sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
