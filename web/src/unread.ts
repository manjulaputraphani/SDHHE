/**
 * One shared unread store so the sidebar badge, the drawer dot, the FAB badge
 * and the contact list all read the same numbers (no page refresh).
 *
 * The source of truth is `api.chatConversations()` — every conversation
 * already carries its `unread` count. `refreshUnread` pulls it; `markRoomRead`
 * zeroes one room after it is opened (the worker does the same server-side).
 */

import { api } from "./api";

export type UnreadState = { total: number; byRoom: Record<string, number> };

let state: UnreadState = { total: 0, byRoom: {} };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getUnread(): UnreadState {
  return state;
}

export function subscribeUnread(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setByRoom(byRoom: Record<string, number>) {
  const total = Object.values(byRoom).reduce((sum, count) => sum + count, 0);
  state = { total, byRoom };
  emit();
}

/** The single room with unread — only used when there is exactly one thread. */
export function onlyUnreadRoom(): string | null {
  const rooms = Object.entries(state.byRoom).filter(([, count]) => count > 0);
  return rooms.length === 1 ? rooms[0]![0] : null;
}

/** Pull the conversation list and republish the unread counts. */
export async function refreshUnread(myId?: number | null): Promise<void> {
  try {
    const { conversations } = await api.chatConversations();
    const byRoom: Record<string, number> = {};
    for (const conversation of conversations) byRoom[conversation.room] = conversation.unread;
    setByRoom(byRoom);
    // A 1:1 message that reached this device is delivered to its owner.
    confirmDirectDelivered(conversations, myId);
  } catch {
    // Offline or not signed in — keep whatever we have.
  }
}

/**
 * Optimistically clear one room's badge (called when a conversation is
 * opened). Returns a rollback that restores the previous count if the API
 * call fails.
 */
export function markRoomRead(room: string): { rollback: () => void } | null {
  const prev = state.byRoom[room];
  if (prev == null || prev === 0) return null;
  const prevByRoom = { ...state.byRoom };
  setByRoom({ ...state.byRoom, [room]: 0 });
  return {
    rollback: () => {
      setByRoom(prevByRoom);
    },
  };
}

/** Another tab/device marked this room read — clear the badge here too. */
export function markRoomReadByOther(room: string): void {
  setByRoom({ ...state.byRoom, [room]: 0 });
}

/** Push freshly-fetched conversations into the store (no second fetch). */
export function setUnreadFromConversations(conversations: { room: string; unread: number }[]): void {
  const byRoom: Record<string, number> = {};
  for (const conversation of conversations) byRoom[conversation.room] = conversation.unread;
  setByRoom(byRoom);
}

// ---- "Delivered" for 1:1 chats (the Message info fix) ----

/**
 * The messages that just reached THIS device: the newest message of a 1:1
 * chat with unread messages from the other person. Pure — the caller decides
 * what to do with the ids (see `confirmDirectDelivered`).
 *
 * Groups keep their socket-only delivered flow; only private chats confirm
 * from the conversation sync.
 */
export function directMessagesToConfirm(
  conversations: {
    kind: "group" | "direct";
    unread: number;
    lastMessage?: { id?: number; userId?: number | null } | null;
  }[],
  myId: number | null | undefined,
): number[] {
  if (myId == null) return [];
  const ids: number[] = [];
  for (const conversation of conversations) {
    if (conversation.kind !== "direct") continue;
    if (!(conversation.unread > 0)) continue;
    const last = conversation.lastMessage;
    if (!last || typeof last.id !== "number") continue;
    // Never confirm my OWN message — the sender gets no receipt.
    if (last.userId == null || last.userId === myId) continue;
    ids.push(last.id);
  }
  return ids;
}

/** Ids already confirmed in this browser (a sync repeats every 30 s). */
const confirmedDelivered = new Set<number>();

/**
 * Tell the sender "my device has it" for the newest message of every 1:1 chat
 * with unread messages. Fire-and-forget and idempotent (the server keeps the
 * first delivered time).
 */
export function confirmDirectDelivered(
  conversations: {
    kind: "group" | "direct";
    unread: number;
    lastMessage?: { id?: number; userId?: number | null } | null;
  }[],
  myId: number | null | undefined,
): void {
  for (const id of directMessagesToConfirm(conversations, myId)) {
    if (confirmedDelivered.has(id)) continue;
    confirmedDelivered.add(id);
    void api.markChatDelivered(id).catch(() => {
      // A failed call is retried at the next sync.
      confirmedDelivered.delete(id);
    });
  }
}
