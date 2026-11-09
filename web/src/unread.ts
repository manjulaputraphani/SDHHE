/**
 * One shared unread store so the sidebar badge, the drawer dot, the FAB badge
 * and the contact list all read the same numbers (no page refresh).
 *
 * The source of truth is `api.chatConversations()` — every conversation
 * already carries its `unread` count. `refreshUnread` pulls it; `markRoomRead`
 * zeroes one room after it is opened (the worker does the same server-side).
 */

import { api } from "./api";
import { membersOf } from "../../src/logic/chatPrivacy";

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
    // A 1:1 message that reached this device is delivered to its owner —
    // even when the member is on another screen, not in the chat room.
    await confirmDirectDelivered(conversations, myId);
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
 * Tell the sender "my device has it" for ALL unread messages of every 1:1
 * chat — even when the member is on another screen, not in the chat room.
 *
 * Groups keep their socket-only delivered flow; only private chats confirm
 * from the conversation sync.
 *
 * Fire-and-forget and idempotent (the server keeps the first delivered time).
 */
export async function confirmDirectDelivered(
  conversations: {
    kind: "group" | "direct";
    unread: number;
    lastMessage?: { id?: number; userId?: number | null } | null;
    other?: { id?: number } | null;
    room: string;
  }[],
  myId: number | null | undefined,
): Promise<void> {
  if (myId == null) return;

  for (const conversation of conversations) {
    if (conversation.kind !== "direct") continue;
    if (!(conversation.unread > 0)) continue;

    const room = conversation.room;
    const dm = membersOf(room);
    if (!dm) continue;
    const otherId = dm.userId === myId ? dm.otherId : dm.userId;
    if (otherId == null) continue;

    try {
      const { messages } = await api.chatMessages(room);
      for (const message of messages) {
        if (message.userId !== otherId) continue;
        const id = message.id;
        if (confirmedDelivered.has(id)) continue;
        confirmedDelivered.add(id);
        void api.markChatDelivered(id).catch(() => {
          // A failed call is retried at the next sync.
          confirmedDelivered.delete(id);
        });
      }
    } catch {
      // Failed to fetch messages — will retry on the next sync (30 s, focus,
      // visibility change).
    }
  }
}

/** Ids already confirmed in this browser (a sync repeats every 30 s). */
const confirmedDelivered = new Set<number>();
