import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  errorFrame,
  isChatFrame,
  isChatUser,
  parseFrame,
  presenceFrame,
  uniqueUsers,
} from "./protocol";

const anita = { id: 3, name: "ANITA", role: "staff" };
const raju = { id: 5, name: "RAJU", role: "staff" };

describe("parseFrame", () => {
  it("reads a hello frame", () => {
    const frame = parseFrame(JSON.stringify({ type: "hello", user: anita, presence: [anita] }));
    expect(frame).toEqual({ type: "hello", user: anita, presence: [anita] });
  });

  it("reads a frame that came as bytes", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ type: "presence", users: [anita] }));
    expect(parseFrame(bytes)).toEqual({ type: "presence", users: [anita] });
  });

  it("refuses rubbish", () => {
    expect(parseFrame("not json")).toBeNull();
    expect(parseFrame("{}")).toBeNull();
    expect(parseFrame(JSON.stringify({ type: "delete-everything" }))).toBeNull();
    expect(parseFrame(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});

describe("encodeFrame", () => {
  it("round-trips", () => {
    const frame = presenceFrame([anita, raju]);
    expect(parseFrame(encodeFrame(frame))).toEqual(frame);
  });
});

describe("isChatUser", () => {
  it("accepts a member", () => {
    expect(isChatUser(anita)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isChatUser(null)).toBe(false);
    expect(isChatUser({ id: "3", name: "ANITA", role: "staff" })).toBe(false);
    expect(isChatUser({ id: 3, name: "", role: "staff" })).toBe(false);
    expect(isChatUser({ id: 3, name: "ANITA" })).toBe(false);
  });
});

describe("isChatFrame", () => {
  it("knows the five frame types", () => {
    expect(isChatFrame({ type: "hello" })).toBe(true);
    expect(isChatFrame({ type: "message" })).toBe(true);
    expect(isChatFrame({ type: "receipt" })).toBe(true);
    expect(isChatFrame({ type: "presence" })).toBe(true);
    expect(isChatFrame({ type: "error" })).toBe(true);
    expect(isChatFrame({ type: "admin" })).toBe(false);
  });
});

describe("errorFrame", () => {
  it("carries the message", () => {
    expect(errorFrame("Chat is not ready")).toEqual({ type: "error", message: "Chat is not ready" });
  });
});

describe("uniqueUsers", () => {
  it("keeps one entry per member", () => {
    expect(uniqueUsers([anita, raju, anita])).toEqual([anita, raju]);
  });
});
