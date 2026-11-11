import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildFcmJwt,
  buildFcmWebMessage,
  createFcmClient,
  FCM_SCOPE,
  FCM_TOKEN_URL,
  fcmConfigFrom,
  fcmSendUrl,
  mintFcmAccessToken,
  sendFcmWeb,
  type FcmConfig,
} from "./fcm";

/** A throwaway RSA key so the JWT signing is exercised for real. */
let TEST_KEY_PEM = "";
let config: FcmConfig;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
  TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----`;
  config = {
    projectId: "sdhhe-88e59",
    clientEmail: "firebase-adminsdk-fbsvc@sdhhe-88e59.iam.gserviceaccount.com",
    privateKey: TEST_KEY_PEM,
    privateKeyId: "7e6c6f20cd959980e1410637edf11832c9ada8a8",
  };
});

function b64urlDecode(part: string): string {
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const withPad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return atob(withPad);
}

describe("fcmConfigFrom", () => {
  it("parses the service-account JSON and unescapes the private key newlines", () => {
    const raw = JSON.stringify({
      type: "service_account",
      project_id: "sdhhe-88e59",
      client_email: "admin@sdhhe-88e59.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----",
      private_key_id: "abc123",
    });
    const parsed = fcmConfigFrom(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.projectId).toBe("sdhhe-88e59");
    expect(parsed?.clientEmail).toBe("admin@sdhhe-88e59.iam.gserviceaccount.com");
    expect(parsed?.privateKeyId).toBe("abc123");
    // Real newlines, not the literal \n of the JSON file.
    expect(parsed?.privateKey).toContain("\nAAA\n");
  });

  it("returns null without a usable key (FCM simply stays off)", () => {
    expect(fcmConfigFrom(undefined)).toBeNull();
    expect(fcmConfigFrom("")).toBeNull();
    expect(fcmConfigFrom("not json")).toBeNull();
    expect(fcmConfigFrom(JSON.stringify({ project_id: "x" }))).toBeNull();
    expect(fcmConfigFrom(JSON.stringify({ client_email: "a@b", private_key: "k" }))).toBeNull();
  });
});

describe("buildFcmJwt", () => {
  it("signs an RS256 JWT with the service-account claims", async () => {
    const jwt = await buildFcmJwt(config, 1_700_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(jwt.split(".")).toHaveLength(3);
    expect(signature.length).toBeGreaterThan(0);

    const head = JSON.parse(b64urlDecode(header)) as { alg: string; kid?: string };
    expect(head.alg).toBe("RS256");
    expect(head.kid).toBe(config.privateKeyId);

    const body = JSON.parse(b64urlDecode(claims)) as Record<string, string | number>;
    expect(body.iss).toBe(config.clientEmail);
    expect(body.aud).toBe(FCM_TOKEN_URL);
    expect(body.scope).toBe(FCM_SCOPE);
    expect(body.iat).toBe(1_700_000_000);
    expect(body.exp).toBe(1_700_000_000 + 3600);
  });
});

describe("mintFcmAccessToken", () => {
  it("posts the JWT to Google's token endpoint and returns the access token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "ya29.secret", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const token = await mintFcmAccessToken(config, fetchImpl, 1_700_000_000_000);
    expect(token).toBe("ya29.secret");
    expect(fetchImpl).toHaveBeenCalledWith(
      FCM_TOKEN_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/x-www-form-urlencoded" }),
        body: expect.stringMatching(
          /^grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=/,
        ),
      }),
    );
  });

  it("returns null when Google refuses the key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );
    expect(await mintFcmAccessToken(config, fetchImpl)).toBeNull();
  });

  it("never throws on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await mintFcmAccessToken(config, fetchImpl)).toBeNull();
  });
});

describe("buildFcmWebMessage", () => {
  it("carries title/body/url/id as STRING data (FCM data must be strings)", () => {
    const payload = buildFcmWebMessage("fcm-token-1", {
      title: "RAJU in Team",
      body: "Transport bill for 45000",
      url: "/team-chat?room=main&notify=1",
      messageId: 42,
      room: "main",
    });
    expect(payload.message.token).toBe("fcm-token-1");
    expect(payload.message.data).toEqual({
      title: "RAJU in Team",
      body: "Transport bill for 45000",
      url: "/team-chat?room=main&notify=1",
      messageId: "42",
      room: "main",
    });
    // Data-only on purpose: the service worker shows the notification itself
    // (sound + tap-to-chat), so FCM must not display a second one.
    expect(payload.message.notification).toBeUndefined();
    expect(payload.message.webpush?.fcm_options?.link).toBe("/team-chat?room=main&notify=1");
  });

  it("fills safe defaults when the message has no url or id", () => {
    const payload = buildFcmWebMessage("t", { title: "hi", body: "there" });
    expect(payload.message.data.url).toBe("");
    expect(payload.message.data.messageId).toBe("");
    expect(payload.message.webpush?.fcm_options?.link).toBe("/team-chat?notify=1");
  });
});

describe("sendFcmWeb", () => {
  const url = fcmSendUrl("sdhhe-88e59");
  const payload = buildFcmWebMessage("tok", { title: "t", body: "b" });

  it("posts to the FCM v1 send endpoint with the bearer token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ name: "projects/sdhhe-88e59/messages/1" }), {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await sendFcmWeb(fetchImpl, "ya29.x", url, payload);
    expect(result).toEqual({ delivered: true, invalid: false });
    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer ya29.x" }),
        body: JSON.stringify(payload),
      }),
    );
  });

  it("marks UNREGISTERED tokens invalid so the caller forgets them", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found." } }),
        { status: 404 },
      ),
    );
    expect(await sendFcmWeb(fetchImpl, "t", url, payload)).toEqual({ delivered: false, invalid: true });
  });

  it("marks a malformed registration token invalid (INVALID_ARGUMENT)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: 400, status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" },
        }),
        { status: 400 },
      ),
    );
    expect(await sendFcmWeb(fetchImpl, "t", url, payload)).toEqual({ delivered: false, invalid: true });
  });

  it("keeps the token for other INVALID_ARGUMENT errors (a bad payload, not a dead device)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid data payload" } }),
        { status: 400 },
      ),
    );
    expect(await sendFcmWeb(fetchImpl, "t", url, payload)).toEqual({ delivered: false, invalid: false });
  });

  it("treats server errors and dead networks as a no-op, not a crash", async () => {
    const busy = vi.fn(async () =>
      new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }),
    );
    expect(await sendFcmWeb(busy, "t", url, payload)).toEqual({ delivered: false, invalid: false });

    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await sendFcmWeb(offline, "t", url, payload)).toEqual({ delivered: false, invalid: false });
  });
});

describe("createFcmClient", () => {
  it("mints once and reuses the cached access token for later sends", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === FCM_TOKEN_URL) {
        return new Response(JSON.stringify({ access_token: "ya29.cached", expires_in: 3600 }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ name: "projects/x/messages/1" }), {
        headers: { "content-type": "application/json" },
      });
    });
    const client = createFcmClient(config, { fetchImpl, now: () => 1_700_000_000_000 });

    const first = await client.send("tok-a", { title: "t", body: "b" });
    const second = await client.send("tok-b", { title: "t", body: "b" });

    expect(first).toEqual({ delivered: true, invalid: false });
    expect(second).toEqual({ delivered: true, invalid: false });
    const calls = fetchImpl.mock.calls.map((call) => call[0]);
    // token mint + send + send (no second mint).
    expect(calls).toEqual([FCM_TOKEN_URL, fcmSendUrl(config.projectId), fcmSendUrl(config.projectId)]);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer ya29.cached" }),
    });
  });

  it("re-mints and retries once when the access token has expired (401)", async () => {
    let sends = 0;
    const fetchImpl = vi.fn(async (input: string) => {
      if (input === FCM_TOKEN_URL) {
        return new Response(JSON.stringify({ access_token: `ya29.try${sends}`, expires_in: 3600 }), {
          headers: { "content-type": "application/json" },
        });
      }
      sends += 1;
      if (sends === 1) {
        return new Response(JSON.stringify({ error: { status: "UNAUTHENTICATED" } }), { status: 401 });
      }
      return new Response(JSON.stringify({ name: "projects/x/messages/1" }), {
        headers: { "content-type": "application/json" },
      });
    });
    const client = createFcmClient(config, { fetchImpl });

    const result = await client.send("tok", { title: "t", body: "b" });
    expect(result).toEqual({ delivered: true, invalid: false });
    const calls = fetchImpl.mock.calls.map((call) => call[0]);
    expect(calls).toEqual([FCM_TOKEN_URL, fcmSendUrl(config.projectId), FCM_TOKEN_URL, fcmSendUrl(config.projectId)]);
  });

  it("fails quietly when the key cannot mint a token (FCM stays off)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    const client = createFcmClient(config, { fetchImpl });
    expect(await client.send("tok", { title: "t", body: "b" })).toEqual({ delivered: false, invalid: false });
    // Only the token endpoint was tried — nothing went to the send endpoint.
    expect(fetchImpl.mock.calls).toHaveLength(1);
  });
});
