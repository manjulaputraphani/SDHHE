import { describe, expect, it } from "vitest";
import {
  directMessagesToConfirm,
  getUnread,
  markRoomRead,
  markRoomReadByOther,
  setUnreadFromConversations,
  subscribeUnread,
} from "./unread";

describe("unread store", () => {
  it("marks a room read optimistically and returns a rollback", () => {
    setUnreadFromConversations([
      { room: "main", unread: 1 },
      { room: "dm-1-2", unread: 3 },
    ]);
    expect(getUnread().total).toBe(4);

    const rollback = markRoomRead("dm-1-2");
    expect(rollback).not.toBeNull();
    expect(getUnread().byRoom["dm-1-2"]).toBe(0);
    expect(getUnread().total).toBe(1); // only "main" left

    rollback!.rollback();
    expect(getUnread().byRoom["dm-1-2"]).toBe(3);
    expect(getUnread().total).toBe(4);
  });

  it("returns null when the room is already at zero", () => {
    setUnreadFromConversations([{ room: "main", unread: 0 }]);
    expect(markRoomRead("main")).toBeNull();
    expect(getUnread().total).toBe(0);
  });

  it("markRoomReadByOther clears the badge (another tab/device read it)", () => {
    setUnreadFromConversations([{ room: "main", unread: 5 }]);
    markRoomReadByOther("main");
    expect(getUnread().byRoom["main"]).toBe(0);
    expect(getUnread().total).toBe(0);
  });

  it("notifies subscribers when the badge changes", () => {
    setUnreadFromConversations([{ room: "main", unread: 2 }]);
    const calls: number[] = [];
    const unsub = subscribeUnread(() => calls.push(getUnread().total));
    markRoomReadByOther("main");
    expect(calls).toContain(0);
    unsub();
  });
});

describe("1:1 delivered from the conversation sync", () => {
  const conversation = (over: Partial<{ kind: "group" | "direct"; unread: number; lastMessage: { id?: number; userId?: number | null } | null }>) => ({
    kind: "direct" as const,
    unread: 1,
    lastMessage: { id: 7, userId: 2 },
    ...over,
  });

  it("confirms the newest message of an unread 1:1 chat", () => {
    expect(directMessagesToConfirm([conversation({})], 1)).toEqual([7]);
  });

  it("never confirms my OWN message (the sender gets no receipt)", () => {
    expect(directMessagesToConfirm([conversation({ lastMessage: { id: 7, userId: 1 } })], 1)).toEqual([]);
    expect(directMessagesToConfirm([conversation({ lastMessage: { id: 7, userId: null } })], 1)).toEqual([]);
  });

  it("ignores groups, read chats and chats without a known message", () => {
    expect(directMessagesToConfirm([conversation({ kind: "group" })], 1)).toEqual([]);
    expect(directMessagesToConfirm([conversation({ unread: 0 })], 1)).toEqual([]);
    expect(directMessagesToConfirm([conversation({ lastMessage: null })], 1)).toEqual([]);
    expect(directMessagesToConfirm([conversation({})], null)).toEqual([]);
  });
});
