/**
 * Login sessions and per-user usage.
 *
 * Every sign-in opens a row in `user_sessions`; signing out closes it and
 * stores how long the person was active. The same rows drive the activity
 * timeline ("Signed in", "Signed out") and the usage metrics.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { activityLog, appUsers, userSessions } from "./schema";

export type SessionSource = "web" | "desktop";

/**
 * How long a sign-in stays valid (the web token/cookie expires after this).
 * A session that is never closed explicitly is closed after this long, so the
 * usage metrics never count a session as "still active" forever.
 */
export const SESSION_MAX_SECONDS = 12 * 60 * 60;

export type SessionRow = {
  id: number;
  userId: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  source: string;
};

export type UserUsage = {
  userId: number;
  name: string;
  phone: string;
  role: string;
  sessions: number;
  /** Total active time in seconds. */
  activeSeconds: number;
  lastLoginAt: string | null;
  lastLogoutAt: string | null;
  openSessions: number;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Open a session for a user (called right after a successful sign-in). */
export async function startSession(
  db: Db,
  userId: number,
  source: SessionSource,
  name?: string,
): Promise<number> {
  // A new sign-in means the previous one is over: close it so the usage
  // numbers are right even when nobody pressed "sign out".
  await closeOpenSessions(db, userId, source);

  const [created] = await db
    .insert(userSessions)
    .values({ userId, source, startedAt: new Date() })
    .returning({ id: userSessions.id });
  const actor = name ?? (await userName(db, userId));
  await db.insert(activityLog).values({
    userId,
    actor,
    event: "user.login",
    summary: `Signed in (${source})`,
    entity: "user",
    entityId: userId,
  });
  return created.id;
}

/**
 * Close the sessions that are still open for a user.
 * The active time is capped at SESSION_MAX_SECONDS (a session cannot live
 * longer than the sign-in itself).
 */
async function closeOpenSessions(db: Db, userId: number, source?: SessionSource): Promise<void> {
  const open = await db
    .select({ id: userSessions.id, startedAt: userSessions.startedAt })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.endedAt),
        source ? eq(userSessions.source, source) : undefined,
      ),
    );

  for (const session of open) {
    const startedAt = new Date(session.startedAt).getTime();
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const duration = Math.min(Math.max(0, elapsed), SESSION_MAX_SECONDS);
    const endedAt = new Date(startedAt + duration * 1000);
    await db
      .update(userSessions)
      .set({ endedAt, durationSeconds: duration })
      .where(eq(userSessions.id, session.id));
    await db.insert(activityLog).values({
      userId,
      actor: await userName(db, userId),
      event: "user.logout",
      summary: `Session ended after ${formatDuration(duration)}`,
      entity: "user",
      entityId: userId,
    });
  }
}

/** The member's name — used as the actor on the activity rows. */
async function userName(db: Db, userId: number): Promise<string> {
  const [user] = await db
    .select({ name: appUsers.name })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return user?.name ?? `user:${userId}`;
}

/**
 * Close the user's open session(s) and store the active time.
 * Returns the seconds the session lasted (0 when there was nothing to close).
 */
export async function endSession(db: Db, userId: number, source?: SessionSource): Promise<number> {
  const open = await db
    .select({
      id: userSessions.id,
      startedAt: userSessions.startedAt,
      source: userSessions.source,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.endedAt),
        source ? eq(userSessions.source, source) : undefined,
      ),
    );

  let seconds = 0;
  const actor = await userName(db, userId);
  for (const session of open) {
    const endedAt = new Date();
    const elapsed = Math.round((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000);
    const duration = Math.min(Math.max(0, elapsed), SESSION_MAX_SECONDS);
    seconds += duration;
    await db
      .update(userSessions)
      .set({ endedAt, durationSeconds: duration })
      .where(eq(userSessions.id, session.id));
    await db.insert(activityLog).values({
      userId,
      actor,
      event: "user.logout",
      summary: `Signed out after ${formatDuration(duration)}`,
      entity: "user",
      entityId: userId,
    });
  }
  return seconds;
}

/** "1h 5m" / "50m 45s" / "0m" — whole units, never negative. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/** Recent sessions (newest first) — optional filter by user. */
export async function listSessions(db: Db, userId?: number, limit = 50): Promise<SessionRow[]> {
  const rows = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      startedAt: userSessions.startedAt,
      endedAt: userSessions.endedAt,
      durationSeconds: userSessions.durationSeconds,
      source: userSessions.source,
    })
    .from(userSessions)
    .where(userId ? eq(userSessions.userId, userId) : undefined)
    .orderBy(desc(userSessions.startedAt), desc(userSessions.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    startedAt: iso(row.startedAt),
    endedAt: row.endedAt ? iso(row.endedAt) : null,
  }));
}

/** Sessions started in the last 24 hours that still have no logout (endedAt is null).
 * Used to surface logins where the user never signed out. */
export async function getSessionsWithoutLogoutLast24Hours(db: Db): Promise<SessionRow[]> {
  const rows = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      startedAt: userSessions.startedAt,
      endedAt: userSessions.endedAt,
      durationSeconds: userSessions.durationSeconds,
      source: userSessions.source,
    })
    .from(userSessions)
    .where(
      and(
        isNull(userSessions.endedAt),
        gte(userSessions.startedAt, sql`now() - interval '24 hours'`),
      )
    )
    .orderBy(desc(userSessions.startedAt));
  return rows.map((row) => ({
    ...row,
    startedAt: iso(row.startedAt),
    endedAt: row.endedAt ? iso(row.endedAt) : null,
  }));
}

/** Usage metrics per user: sessions, active time, last login / logout. */
export async function userUsageMetrics(db: Db): Promise<UserUsage[]> {
  const rows = await db
    .select({
      userId: appUsers.id,
      name: appUsers.name,
      phone: appUsers.phone,
      role: appUsers.role,
      sessions: sql<number>`count(${userSessions.id})`.mapWith(Number),
      // An open session counts up to the cap (it is assumed to have ended when
      // the sign-in expired), so a forgotten tab never shows as "still active".
      // NOTE: `least(null, cap)` in Postgres ignores the null and returns the
      // cap, so a user with no sessions must be guarded with coalesce(…, 0).
      activeSeconds:
        sql<number>`coalesce(sum(coalesce(${userSessions.durationSeconds}, least(coalesce(extract(epoch from (now() - ${userSessions.startedAt})), 0), ${SESSION_MAX_SECONDS}))), 0)`.mapWith(Number),
      openSessions:
        sql<number>`count(${userSessions.id}) filter (where ${userSessions.endedAt} is null and ${userSessions.startedAt} > now() - interval '12 hours')`.mapWith(Number),
      lastLoginAt: sql<string | null>`max(${userSessions.startedAt})`.mapWith(String),
      lastLogoutAt: sql<string | null>`max(${userSessions.endedAt})`.mapWith(String),
    })
    .from(appUsers)
    .leftJoin(userSessions, eq(userSessions.userId, appUsers.id))
    .groupBy(appUsers.id)
    .orderBy(desc(sql`coalesce(sum(${userSessions.durationSeconds}), 0)`));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    phone: row.phone,
    role: row.role,
    sessions: row.sessions,
    activeSeconds: row.activeSeconds,
    openSessions: row.openSessions,
    lastLoginAt: row.lastLoginAt ? iso(row.lastLoginAt) : null,
    lastLogoutAt: row.lastLogoutAt ? iso(row.lastLogoutAt) : null,
  }));
}
