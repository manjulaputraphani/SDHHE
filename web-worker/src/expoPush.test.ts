import { describe, expect, it, vi } from "vitest";
import {
  buildExpoPushMessages,
  EXPO_PUSH_URL,
  isExpoPushToken,
  sendExpoPush,
  type ExpoPushResponse,
} from "./expoPush";

const message = {
  title: "RAJU in Team",
  body: "Transport bill for 45000",
  url: "/team-chat?notify=1",
  messageId: 42,
};

describe("buildExpoPushMessages", () => {
  it("turns each token into a message with the chat url and id in data", () => {
    const out = buildExpoPushMessages(["ExponentPushToken[a]", "ExponentPushToken[b]"], message);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      to: "ExponentPushToken[a]",
      title: message.title,
      body: message.body,
      sound: "default",
      data: { url: message.url, messageId: 42 },
    });
  });

  it("chunks at 100 tokens (Expo Push per-request limit)", () => {
    const tokens = Array.from({ length: 250 }, (_, i) => `tok${i}`);
    const out = buildExpoPushMessages(tokens, message);
    expect(out).toHaveLength(250);
  });
});

describe("isExpoPushToken", () => {
  it("splits the two fan-outs: Expo tokens vs FCM web tokens", () => {
    expect(isExpoPushToken("ExponentPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc]")).toBe(true);
    // An FCM registration token must NEVER reach the Expo Push API.
    expect(isExpoPushToken("dG9rZW46YWJjZGVmZ2hpamtsbW5vcA")).toBe(false);
  });
});

describe("sendExpoPush", () => {
  it("posts the messages to the Expo Push API with the bearer token", async () => {
    const fetchJson = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ status: "ok" }] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await sendExpoPush(fetchJson, "secret", [
      { to: "tok1", title: "t", body: "b", data: {} },
    ]);
    expect(fetchJson).toHaveBeenCalledWith(
      EXPO_PUSH_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
    expect(result.invalidTokens).toEqual([]);
  });

  it("collects DeviceNotRegistered tokens so the caller can forget them", async () => {
    const fetchJson = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { status: "ok" },
            { status: "error", message: "failed", details: { error: "DeviceNotRegistered" } },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const result = await sendExpoPush(fetchJson, "secret", [
      { to: "good", title: "t", body: "b", data: {} },
      { to: "dead", title: "t", body: "b", data: {} },
    ]);
    expect(result.invalidTokens).toEqual(["dead"]);
  });

  it("treats a failed API call as a no-op, not a crash", async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await sendExpoPush(fetchJson, "secret", [
      { to: "tok1", title: "t", body: "b", data: {} },
    ]);
    expect(result.invalidTokens).toEqual([]);
  });
});
