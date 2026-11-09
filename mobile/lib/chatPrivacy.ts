/**
 * The privacy rules of a direct chat (same as src/logic/chatPrivacy.ts, ported
 * to the mobile app so it has no cross-package imports).
 */

export type RoomAccess = "shared" | "private";

export function isSharedRoom(room: string): boolean {
  return room === "main";
}

export function isGroupRoom(room: string): boolean {
  return /^group-[a-z0-9][a-z0-9-]*$/.test(room);
}

/** The two members of a private chat (null for the shared room). */
export function membersOf(room: string): { userId: number; otherId: number } | null {
  if (isSharedRoom(room)) return null;
  const match = /^dm-(\d+)-(\d+)$/.exec(room);
  if (!match) return null;
  const small = Number(match[1]);
  const large = Number(match[2]);
  if (!Number.isInteger(small) || !Number.isInteger(large) || small === large) return null;
  return { userId: small, otherId: large };
}

/** May this member read the room? */
export function canReadRoom(room: string, userId: number): boolean {
  if (isSharedRoom(room)) return true;
  const members = membersOf(room);
  if (!members) return false;
  return members.userId === userId || members.otherId === userId;
}
