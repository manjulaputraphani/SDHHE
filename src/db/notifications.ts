/**
 * The in-app notification system (Phase 15).
 *
 * Everything lives in Neon next to the rest of the app data: the announcements,
 * the releases ("what's new"), the tours, the onboarding state and the login
 * history. The same module is used by the Worker and by the desktop app.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import {
  announcementDismissals,
  announcements,
  appUsers,
  expenses,
  items,
  loginHistory,
  releases,
  saleBills,
  settings,
  suppliers,
  userReleasesSeen,
  userSessions,
  userTours,
} from "./schema";

export type AnnouncementKind = "info" | "success" | "warning" | "critical";

export type Announcement = {
  id: number;
  title: string;
  message: string;
  kind: AnnouncementKind;
  linkLabel: string | null;
  linkUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
};

export type Release = {
  id: number;
  version: string;
  title: string;
  items: string[];
  imageUrl: string | null;
  releaseDate: string;
};

export type LoginEntry = {
  id: number;
  device: string | null;
  browser: string | null;
  os: string | null;
  ip: string | null;
  createdAt: string;
  current: boolean;
};

export type OnboardingStep = { key: string; label: string; done: boolean };

export type NotificationBootstrap = {
  user: {
    id: number;
    name: string;
    role: string;
    lastLoginAt: string | null;
    /** The member's switch for the "Welcome back" card (Phase 15 fix). */
    showWelcomeBanner: boolean;
  };
  announcements: Announcement[];
  release: Release | null;
  onboarding: { steps: OnboardingStep[]; done: number; total: number; completed: boolean };
  session: { expiresAt: string };
  tours: string[];
  loginHistory: LoginEntry[];
};

// ---------------------------------------------------------------- announcements

const announcementRows = (db: Db) =>
  db
    .select({
      id: announcements.id,
      title: announcements.title,
      message: announcements.message,
      kind: announcements.kind,
      linkLabel: announcements.linkLabel,
      linkUrl: announcements.linkUrl,
      startDate: announcements.startDate,
      endDate: announcements.endDate,
      isActive: announcements.isActive,
      createdAt: announcements.createdAt,
    })
    .from(announcements);

/** The announcements that are live right now and that this member has not dismissed. */
export async function listActiveAnnouncements(
  db: Db,
  userId: number,
  now: Date = new Date(),
): Promise<Announcement[]> {
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      message: announcements.message,
      kind: announcements.kind,
      linkLabel: announcements.linkLabel,
      linkUrl: announcements.linkUrl,
      startDate: announcements.startDate,
      endDate: announcements.endDate,
      isActive: announcements.isActive,
      createdAt: announcements.createdAt,
    })
    .from(announcements)
    .leftJoin(
      announcementDismissals,
      and(
        eq(announcementDismissals.announcementId, announcements.id),
        eq(announcementDismissals.userId, userId),
      ),
    )
    .where(
      and(
        eq(announcements.isActive, true),
        isNull(announcementDismissals.announcementId),
        or(isNull(announcements.startDate), sql`${announcements.startDate} <= ${now}`),
        or(isNull(announcements.endDate), sql`${announcements.endDate} >= ${now}`),
      ),
    )
    .orderBy(desc(announcements.createdAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    kind: row.kind as AnnouncementKind,
    linkLabel: row.linkLabel,
    linkUrl: row.linkUrl,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Every announcement (the admin list — also the inactive ones). */
export async function listAllAnnouncements(db: Db): Promise<Announcement[]> {
  const rows = await announcementRows(db).orderBy(desc(announcements.createdAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    kind: row.kind as AnnouncementKind,
    linkLabel: row.linkLabel,
    linkUrl: row.linkUrl,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Remember that this member closed the announcement (on every device). */
export async function dismissAnnouncement(
  db: Db | TxDb,
  announcementId: number,
  userId: number,
): Promise<void> {
  await db
    .insert(announcementDismissals)
    .values({ announcementId, userId })
    .onConflictDoNothing({
      target: [announcementDismissals.announcementId, announcementDismissals.userId],
    });
}

/** Create an announcement (the owner). */
export async function createAnnouncement(
  db: Db | TxDb,
  input: {
    title: string;
    message: string;
    kind: AnnouncementKind;
    linkLabel?: string | null;
    linkUrl?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    createdBy?: number | null;
  },
): Promise<Announcement> {
  const [created] = await db
    .insert(announcements)
    .values({
      title: input.title,
      message: input.message,
      kind: input.kind,
      linkLabel: input.linkLabel ?? null,
      linkUrl: input.linkUrl ?? null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      isActive: true,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return {
    id: created.id,
    title: created.title,
    message: created.message,
    kind: created.kind as AnnouncementKind,
    linkLabel: created.linkLabel,
    linkUrl: created.linkUrl,
    startDate: created.startDate ? created.startDate.toISOString() : null,
    endDate: created.endDate ? created.endDate.toISOString() : null,
    isActive: created.isActive,
    createdAt: created.createdAt.toISOString(),
  };
}

/** Change an announcement (the owner). */
export async function updateAnnouncement(
  db: Db | TxDb,
  id: number,
  input: Partial<{
    title: string;
    message: string;
    kind: AnnouncementKind;
    linkLabel: string | null;
    linkUrl: string | null;
    startDate: string | null;
    endDate: string | null;
    isActive: boolean;
  }>,
): Promise<boolean> {
  const rows = await db
    .update(announcements)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.linkLabel !== undefined ? { linkLabel: input.linkLabel } : {}),
      ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl } : {}),
      ...(input.startDate !== undefined
        ? { startDate: input.startDate ? new Date(input.startDate) : null }
        : {}),
      ...(input.endDate !== undefined
        ? { endDate: input.endDate ? new Date(input.endDate) : null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    })
    .where(eq(announcements.id, id))
    .returning();
  return rows.length > 0;
}

// ------------------------------------------------------------------- releases

function toRelease(row: {
  id: number;
  version: string;
  title: string;
  items: unknown;
  imageUrl: string | null;
  releaseDate: Date;
}): Release {
  const items = Array.isArray(row.items) ? (row.items as string[]) : [];
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    items,
    imageUrl: row.imageUrl,
    releaseDate: row.releaseDate.toISOString(),
  };
}

/** The newest release this member has not seen yet (null when there is none). */
export async function latestUnseenRelease(db: Db, userId: number): Promise<Release | null> {
  const rows = await db
    .select({
      id: releases.id,
      version: releases.version,
      title: releases.title,
      items: releases.items,
      imageUrl: releases.imageUrl,
      releaseDate: releases.releaseDate,
    })
    .from(releases)
    .leftJoin(
      userReleasesSeen,
      and(eq(userReleasesSeen.releaseId, releases.id), eq(userReleasesSeen.userId, userId)),
    )
    .where(isNull(userReleasesSeen.releaseId))
    .orderBy(desc(releases.releaseDate))
    .limit(1);
  return rows[0] ? toRelease(rows[0]) : null;
}

/** Publish a release — it shows up as "what's new" for everybody. */
export async function createRelease(
  db: Db | TxDb,
  input: { version: string; title: string; items: string[]; imageUrl?: string | null },
): Promise<Release> {
  const [created] = await db
    .insert(releases)
    .values({
      version: input.version,
      title: input.title,
      items: input.items,
      imageUrl: input.imageUrl ?? null,
    })
    .returning();
  return toRelease(created);
}

/** "I have seen this release" (it does not come back). */
export async function markReleaseSeen(
  db: Db | TxDb,
  userId: number,
  releaseId: number,
): Promise<void> {
  await db
    .insert(userReleasesSeen)
    .values({ userId, releaseId })
    .onConflictDoNothing({ target: [userReleasesSeen.userId, userReleasesSeen.releaseId] });
  await db
    .update(appUsers)
    .set({ lastSeenRelease: releaseId })
    .where(eq(appUsers.id, userId));
}

// ------------------------------------------------------------------- the tours

/** The tours this member has already finished. */
export async function completedTours(db: Db, userId: number): Promise<string[]> {
  const rows = await db
    .select({ tourId: userTours.tourId })
    .from(userTours)
    .where(eq(userTours.userId, userId));
  return rows.map((row) => row.tourId);
}

/** "I finished this tour" (it does not come back). */
export async function completeTour(
  db: Db | TxDb,
  userId: number,
  tourId: string,
): Promise<void> {
  await db
    .insert(userTours)
    .values({ userId, tourId })
    .onConflictDoNothing({ target: [userTours.userId, userTours.tourId] });
}

// ---------------------------------------------------------------- onboarding

/** The setup checklist — what is done and what is missing. */
export async function onboardingSteps(db: Db, userId: number): Promise<OnboardingStep[]> {
  const [itemsCount] = await db.select({ total: sql<number>`count(*)::int`.mapWith(Number) }).from(items);
  const [expensesCount] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(expenses);
  const [billsCount] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(saleBills);
  const [suppliersCount] = await db
    .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
    .from(suppliers);
  const shop = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "shop_name"))
    .limit(1);
  const shopName = shop[0]?.value ?? "";
  const [member] = await db
    .select({ name: appUsers.name })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);

  return [
    { key: "profile", label: "Add your name", done: Boolean(member?.name?.trim()) },
    { key: "shop", label: "Fill in the shop details", done: Boolean(shopName.trim()) },
    { key: "items", label: "Add your first item", done: (itemsCount?.total ?? 0) > 0 },
    { key: "expenses", label: "Record your first expense", done: (expensesCount?.total ?? 0) > 0 },
    { key: "bills", label: "Create your first bill", done: (billsCount?.total ?? 0) > 0 },
    { key: "suppliers", label: "Add a supplier", done: (suppliersCount?.total ?? 0) > 0 },
  ];
}

/** "I do not want the checklist any more." */
export async function completeOnboarding(db: Db | TxDb, userId: number): Promise<void> {
  await db.update(appUsers).set({ onboardingCompleted: true }).where(eq(appUsers.id, userId));
}

/** Has this member finished (or skipped) the checklist? */
export async function onboardingCompleted(db: Db, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ completed: appUsers.onboardingCompleted })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return Boolean(row?.completed);
}

// ------------------------------------------------------------- login history

/** Every sign-in of this member (the newest first). */
export async function listLoginHistory(
  db: Db,
  userId: number,
  sessionId: string | null,
  limit = 10,
): Promise<LoginEntry[]> {
  const rows = await db
    .select({
      id: loginHistory.id,
      device: loginHistory.device,
      browser: loginHistory.browser,
      os: loginHistory.os,
      ip: loginHistory.ip,
      sessionId: loginHistory.sessionId,
      createdAt: loginHistory.createdAt,
    })
    .from(loginHistory)
    .where(eq(loginHistory.userId, userId))
    .orderBy(desc(loginHistory.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    device: row.device,
    browser: row.browser,
    os: row.os,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
    current: sessionId !== null && row.sessionId === sessionId,
  }));
}

/** Write one sign-in. */
export async function recordLogin(
  db: Db | TxDb,
  entry: {
    userId: number;
    device?: string | null;
    browser?: string | null;
    os?: string | null;
    ip?: string | null;
    sessionId?: string | null;
  },
): Promise<void> {
  await db.insert(loginHistory).values({
    userId: entry.userId,
    device: entry.device ?? null,
    browser: entry.browser ?? null,
    os: entry.os ?? null,
    ip: entry.ip ?? null,
    sessionId: entry.sessionId ?? null,
  });
}

/** The last sign-in of this member (before the current one). */
export async function lastLoginAt(db: Db, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ at: appUsers.lastLoginAt })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return row?.at ? row.at.toISOString() : null;
}

/** Remember when this member signed in. */
export async function setLastLoginAt(db: Db | TxDb, userId: number, at: Date = new Date()): Promise<void> {
  await db.update(appUsers).set({ lastLoginAt: at }).where(eq(appUsers.id, userId));
}

/** Is the "Welcome back" card switched on for this member? (default: on) */
export async function getShowWelcomeBanner(db: Db, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ value: appUsers.showWelcomeBanner })
    .from(appUsers)
    .where(eq(appUsers.id, userId))
    .limit(1);
  return row?.value ?? true;
}

/** The Settings toggle / the banner's "Don't show again" link. */
export async function setShowWelcomeBanner(
  db: Db | TxDb,
  userId: number,
  value: boolean,
): Promise<void> {
  await db.update(appUsers).set({ showWelcomeBanner: value }).where(eq(appUsers.id, userId));
}

/**
 * The one-device rule: the other sessions of this member are signed out.
 *
 * Returns how many sessions were closed.
 */
export async function forceOtherSessionsOut(
  db: Db | TxDb,
  userId: number,
  keepSessionId: string,
): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ forcedOut: true, endedAt: new Date() })
    .where(
      and(
        eq(userSessions.userId, userId),
        sql`${userSessions.sessionId} is distinct from ${keepSessionId}`,
        isNull(userSessions.endedAt),
      ),
    )
    .returning();
  return rows.length;
}

/** Was this session signed out because the member signed in somewhere else? */
export async function sessionForcedOut(
  db: Db,
  userId: number,
  sessionId: string | null,
): Promise<boolean> {
  if (!sessionId) return false;
  const [row] = await db
    .select({ forced: userSessions.forcedOut })
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), eq(userSessions.sessionId, sessionId)))
    .limit(1);
  return Boolean(row?.forced);
}

/** The ids of the sessions of this member that are still open. */
export async function openSessionIds(db: Db, userId: number): Promise<string[]> {
  const rows = await db
    .select({ sessionId: userSessions.sessionId })
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.endedAt)));
  return rows.map((row) => row.sessionId).filter((id): id is string => Boolean(id));
}

/** The ids of the announcements this member dismissed. */
export async function dismissedAnnouncementIds(db: Db, userId: number): Promise<number[]> {
  const rows = await db
    .select({ id: announcementDismissals.announcementId })
    .from(announcementDismissals)
    .where(eq(announcementDismissals.userId, userId));
  return rows.map((row) => row.id);
}

/** The announcements that are live right now (every member, no filter). */
export async function liveAnnouncementIds(db: Db, now: Date = new Date()): Promise<number[]> {
  const rows = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.isActive, true),
        or(isNull(announcements.startDate), sql`${announcements.startDate} <= ${now}`),
        or(isNull(announcements.endDate), sql`${announcements.endDate} >= ${now}`),
      ),
    );
  return rows.map((row) => row.id);
}

/** The ids of the announcements in a list (helper for the admin page). */
export async function announcementsByIds(db: Db, ids: number[]): Promise<Announcement[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      message: announcements.message,
      kind: announcements.kind,
      linkLabel: announcements.linkLabel,
      linkUrl: announcements.linkUrl,
      startDate: announcements.startDate,
      endDate: announcements.endDate,
      isActive: announcements.isActive,
      createdAt: announcements.createdAt,
    })
    .from(announcements)
    .where(inArray(announcements.id, ids))
    .orderBy(desc(announcements.createdAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    kind: row.kind as AnnouncementKind,
    linkLabel: row.linkLabel,
    linkUrl: row.linkUrl,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  }));
}
