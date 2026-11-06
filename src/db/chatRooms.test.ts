import { describe, it, expect } from "vitest";
import { directRoomName, isSameRoom, roomTitleFor, SHARED_ROOM } from "./chatRooms";

describe("directRoomName", () => {
  it("is the same for both people", () => {
    expect(directRoomName(4, 9)).toBe(directRoomName(9, 4));
  });

  it("puts the smaller id first", () => {
    expect(directRoomName(9, 4)).toBe("dm-4-9");
    expect(directRoomName(4, 9)).toBe("dm-4-9");
  });

  it("refuses a chat with yourself", () => {
    expect(directRoomName(4, 4)).toBeNull();
  });
});

describe("isSameRoom", () => {
  it("is true for the same room", () => {
    expect(isSameRoom("main", "main")).toBe(true);
    expect(isSameRoom("dm-4-9", "dm-4-9")).toBe(true);
  });

  it("is false for different rooms", () => {
    expect(isSameRoom("main", "dm-4-9")).toBe(false);
  });
});

describe("roomTitleFor", () => {
  it("names the shared room", () => {
    expect(roomTitleFor(SHARED_ROOM, null)).toBe("Shop room");
  });

  it("names a direct chat after the other member", () => {
    expect(roomTitleFor("dm-4-9", { id: 4, name: "RAJU", role: "staff" })).toBe("RAJU");
  });

  it("falls back to the room name", () => {
    expect(roomTitleFor("dm-4-9", null)).toBe("dm-4-9");
  });
});
