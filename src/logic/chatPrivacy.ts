/**
 * The privacy rule of a direct chat (Phase 13).
 *
 * A private chat belongs to exactly two people. The shop room belongs to
 * everybody. The functions below are the pure rules the API and the screens
 * use; the worker refuses every request for a room the caller is not in.
 */

export type RoomAccess = "shared" | "private";

/** Is this room the shared shop room? */
export function isSharedRoom(room: string): boolean {
  return room === "main";
}

/**
 * Is this room an owner-made group (Phase 14)?
 *
 * Group rooms are named `group-<slug>` (the Worker picks the slug); the two
 * people of a private chat are NOT part of such a room — only the members
 * the owner picked.
 */
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

/** May this member start a private chat with the other one? */
export function canStartDirectChat(userId: number, otherId: number): boolean {
  return Number.isInteger(userId) && Number.isInteger(otherId) && userId !== otherId;
}

/**
 * What the activity log may show about a private chat.
 *
 * The owner can see THAT a direct chat happened (who with, when, how many
 * messages) — but never what was written in it. The text of a message is
 * never part of the log.
 */
export function chatAuditLine(entry: {
  room: string;
  author: string;
  authorId: number;
  messageCount: number;
  at: string;
}): string {
  if (isSharedRoom(entry.room)) {
    return `${entry.author} sent ${entry.messageCount} message(s) to the shop room`;
  }
  const members = membersOf(entry.room);
  const partner = members
    ? members.userId === entry.authorId
      ? members.otherId
      : members.userId
    : null;
  return `${entry.author} had a private chat (${entry.messageCount} message(s)${
    partner ? ` with member #${partner}` : ""
  })`;
}

/** The name of the file a conversation is exported to. */
export function exportFileName(room: string): string {
  return `chat-${room.replace(/[^a-z0-9-]/gi, "-")}.txt`;
}
