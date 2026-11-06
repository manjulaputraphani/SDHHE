/**
 * The Web Push subscriptions (Phase 16) — who wants the phone notifications.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import { pushSubscriptions } from "./schema";

export type PushSubscriptionRow = {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Save (or refresh) the subscription of this member on this device. */
export async function savePushSubscription(
  db: Db | TxDb,
  input: { userId: number; endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: input.userId, p256dh: input.p256dh, auth: input.auth },
    });
}

/** Remove a subscription (the member turned the notifications off). */
export async function deletePushSubscription(db: Db | TxDb, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Every subscription of every member except one (the sender). */
export async function pushSubscriptionsForRoom(
  db: Db,
  exceptUserId: number,
): Promise<PushSubscriptionRow[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions);
  return rows
    .filter((row) => row.userId !== exceptUserId)
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    }));
}

/** The subscriptions of the given members (the sender is left out). */
export async function pushSubscriptionsForUsers(
  db: Db,
  userIds: number[],
  exceptUserId: number,
): Promise<PushSubscriptionRow[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
  return rows
    .filter((row) => row.userId !== exceptUserId)
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
    }));
}

/** Remove a dead subscription (the browser said 404/410). */
export async function forgetPushSubscription(db: Db | TxDb, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

/** Does this member have a subscription on this endpoint already? */
export async function hasPushSubscription(db: Db, endpoint: string): Promise<boolean> {
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);
  return rows.length > 0;
}
