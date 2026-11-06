import { describe, expect, it } from "vitest";
import {
  canReadRoom,
  canStartDirectChat,
  chatAuditLine,
  exportFileName,
  isSharedRoom,
  membersOf,
} from "./chatPrivacy";

describe("isSharedRoom", () => {
  it("knows the shop room", () => {
    expect(isSharedRoom("main")).toBe(true);
    expect(isSharedRoom("dm-4-9")).toBe(false);
  });
});

describe("membersOf", () => {
  it("reads the two members of a private chat", () => {
    expect(membersOf("dm-4-9")).toEqual({ userId: 4, otherId: 9 });
  });

  it("has no members for the shop room", () => {
    expect(membersOf("main")).toBeNull();
  });

  it("refuses a room that is not a chat room", () => {
    expect(membersOf("dm-4")).toBeNull();
    expect(membersOf("dm-4-4")).toBeNull();
    expect(membersOf("secret")).toBeNull();
  });
});

describe("canReadRoom", () => {
  it("lets everybody read the shop room", () => {
    expect(canReadRoom("main", 1)).toBe(true);
    expect(canReadRoom("main", 99)).toBe(true);
  });

  it("lets only the two people read a private chat", () => {
    expect(canReadRoom("dm-4-9", 4)).toBe(true);
    expect(canReadRoom("dm-4-9", 9)).toBe(true);
    expect(canReadRoom("dm-4-9", 5)).toBe(false);
    expect(canReadRoom("dm-4-9", 1)).toBe(false);
  });
});

describe("canStartDirectChat", () => {
  it("needs two different people", () => {
    expect(canStartDirectChat(4, 9)).toBe(true);
    expect(canStartDirectChat(4, 4)).toBe(false);
  });
});

describe("chatAuditLine", () => {
  it("says what happened in the shop room", () => {
    const line = chatAuditLine({
      room: "main",
      author: "ANITA",
      authorId: 3,
      messageCount: 4,
      at: "2026-11-06",
    });
    expect(line).toContain("ANITA");
    expect(line).toContain("shop room");
  });

  it("never carries the text of a private chat", () => {
    const line = chatAuditLine({
      room: "dm-4-9",
      author: "ANITA",
      authorId: 4,
      messageCount: 2,
      at: "2026-11-06",
    });
    expect(line).toContain("private chat");
    expect(line).toContain("member #9");
    expect(line).not.toContain("message(s) sent");
  });
});

describe("exportFileName", () => {
  it("is safe to use as a file name", () => {
    expect(exportFileName("main")).toBe("chat-main.txt");
    expect(exportFileName("dm-4-9")).toBe("chat-dm-4-9.txt");
    expect(exportFileName("../etc/passwd")).toBe("chat----etc-passwd.txt");
  });
});
