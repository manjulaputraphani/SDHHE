/**
 * The Expo Push tokens of the native Android app (SDHHE Mobile, Phase 18) —
 * the phone-side sibling of pushSubscriptions.ts. The browser Web Push stack
 * cannot reach a React Native binary; the native app registers an Expo push
 * token here and the chat fan-out sends to it through the Expo Push API.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db, TxDb } from "./client";
import { pushTokens } from "./schema";

/** Save (or refresh) the token of this member (a device may re-register). */
export async function putPushToken(
  db: Db | TxDb,
  input: { userId: number; token: string },
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId: input.userId, token: input.token })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId: input.userId } });
}

/** Remove a token (the member signed out, or the device is gone). */
export async function deletePushToken(db: Db | TxDb, token: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.token, token));
}

/** Forget EVERY device of this member (called when the member signs out). */
export async function deletePushTokensForUser(db: Db | TxDb, userId: number): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.userId, userId));
}

/** Every token except one member's (the sender). */
export async function pushTokensForRoom(db: Db, exceptUserId: number): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(ne(pushTokens.userId, exceptUserId));
  return rows.map((row) => row.token);
}

/** The tokens of the given members (the sender is left out). */
export async function pushTokensForUsers(
  db: Db,
  userIds: number[],
  exceptUserId: number,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(and(inArray(pushTokens.userId, userIds), ne(pushTokens.userId, exceptUserId)));
  return rows.map((row) => row.token);
}
