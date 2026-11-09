import { describe, expect, it } from "vitest";
import {
  confirmDirectDelivered,
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
  const conversation = (over: Partial<{
    kind: "group" | "direct";
    unread: number;
    room: string;
    other?: { id?: number } | null;
    lastMessage?: { id?: number; userId?: number | null } | null;
  }>) => ({
    kind: "direct" as const,
    unread: 1,
    room: "dm-1-2",
    other: { id: 2 },
    ...over,
  });

  it("confirmDirectDelivered is async and returns a promise", () => {
    const result = confirmDirectDelivered([], 1);
    expect(result).toBeInstanceOf(Promise);
    void result;
  });

  it("returns immediately when there are no unread conversations", async () => {
    await expect(confirmDirectDelivered([], 1)).resolves.toBeUndefined();
    await expect(
      confirmDirectDelivered([{ kind: "group" as const, unread: 5, room: "main" }], 1),
    ).resolves.toBeUndefined();
  });

  it("ignores my own messages and null user ids", async () => {
    // my own message — should not confirm
    await expect(
      confirmDirectDelivered([conversation({ lastMessage: { id: 7, userId: 1 } })], 1),
    ).resolves.toBeUndefined();
    // null userId — should not confirm
    await expect(
      confirmDirectDelivered([conversation({ lastMessage: { id: 7, userId: null } })], 1),
    ).resolves.toBeUndefined();
  });

  it("ignores null myId", async () => {
    await expect(confirmDirectDelivered([conversation({})], null)).resolves.toBeUndefined();
  });
});
