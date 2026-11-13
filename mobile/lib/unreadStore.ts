/**
 * The shared unread store — the mobile mirror of `web/src/unread.ts`.
 *
 * One source of truth so the Chats tab badge (visible on every screen,
 * Dashboard included), the chats list and the room screens all read the same
 * numbers with no manual refreshes.
 *
 * The source of truth is `api.chatConversations()` — every conversation
 * already carries its `unread` count. `setUnreadFromConversations` republishes
 * the map; `markRoomRead` zeroes one room the moment it is opened (the worker
 * does the same server-side).
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
  return () => {
    listeners.delete(listener);
  };
}

function setByRoom(byRoom: Record<string, number>) {
  const total = Object.values(byRoom).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
  state = { total, byRoom };
  emit();
}

/** Republish from a loaded conversation list (chats list / global poll). */
export function setUnreadFromConversations(
  conversations: Array<{ room: string; unread: number }>,
): void {
  const byRoom: Record<string, number> = {};
  for (const conversation of conversations) {
    byRoom[conversation.room] = conversation.unread > 0 ? conversation.unread : 0;
  }
  setByRoom(byRoom);
}

/** The member opened this room — drop its badge instantly (worker marks it too). */
export function markRoomRead(room: string): void {
  if (!(room in state.byRoom) || state.byRoom[room] === 0) return;
  setByRoom({ ...state.byRoom, [room]: 0 });
}
