/**
 * FCM HTTP v1 (the Google side of push) — the web sibling of expoPush.ts.
 *
 * One service-account key sends to BOTH the native Android app (through Expo
 * today) and the browsers (here). Messages are DATA-ONLY on purpose: the
 * service worker (web/public/sw.js) shows the notification itself, so the
 * sound, the tap-to-chat link and the delivery receipt stay ours — FCM must
 * never display a second notification.
 *
 * Best effort throughout: a dead network is a no-op, tokens Google reports as
 * unregistered come back so the caller can forget them, and a missing key
 * simply keeps FCM off (the VAPID path still covers the browsers).
 */

export type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
};

/** A fetch function, injectable so the tests never touch the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type FcmPushMessage = {
  title: string;
  body: string;
  url?: string;
  messageId?: number | string;
  room?: string;
};

export type FcmSendResult = {
  delivered: boolean;
  /** Google says the token is dead — the caller must delete it. */
  invalid: boolean;
  /** Only on 401 — the cached access token expired; the client re-mints once. */
  unauthorized?: true;
};

export const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** The v1 send endpoint of a project. */
export function fcmSendUrl(projectId: string): string {
  return `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
}

/**
 * Parse the service-account JSON (the `FCM_SERVICE_ACCOUNT` secret). Returns
 * null when it is absent or incomplete — FCM stays off, nothing throws.
 */
export function fcmConfigFrom(raw: unknown): FcmConfig | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const projectId = typeof parsed.project_id === "string" ? parsed.project_id : "";
  const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email : "";
  let privateKey = typeof parsed.private_key === "string" ? parsed.private_key : "";
  if (!projectId || !clientEmail || !privateKey.includes("PRIVATE KEY")) return null;
  // Some secret stores double-escape the key's newlines — normalise either way.
  privateKey = privateKey.replace(/\\n/g, "\n");
  const privateKeyId = typeof parsed.private_key_id === "string" ? parsed.private_key_id : undefined;
  return { projectId, clientEmail, privateKey, privateKeyId };
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/** The signed RS256 JWT that proves the request comes from the service account. */
export async function buildFcmJwt(config: FcmConfig, iatSeconds: number): Promise<string> {
  const header = {
    alg: "RS256",
    typ: "JWT",
    ...(config.privateKeyId ? { kid: config.privateKeyId } : {}),
  };
  const claims = {
    iss: config.clientEmail,
    sub: config.clientEmail,
    scope: FCM_SCOPE,
    aud: FCM_TOKEN_URL,
    iat: iatSeconds,
    exp: iatSeconds + 3600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

/** Exchange the JWT for an access token (null when Google refuses — never throws). */
export async function mintFcmAccessToken(
  config: FcmConfig,
  fetchImpl: FetchLike,
  nowMs: number = Date.now(),
): Promise<string | null> {
  try {
    const jwt = await buildFcmJwt(config, Math.floor(nowMs / 1000));
    const res = await fetchImpl(FCM_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    });
    if (!res.ok) return null;
    const parsed = (await res.json().catch(() => null)) as { access_token?: string } | null;
    return parsed?.access_token || null;
  } catch {
    return null;
  }
}

export type FcmWebPayload = {
  message: {
    token: string;
    /** FCM data values must all be strings — the worker coerces. */
    data: { title: string; body: string; url: string; messageId: string; room: string };
    webpush?: { fcm_options?: { link: string } };
  };
};

/** Build the data-only payload for ONE browser token. */
export function buildFcmWebMessage(token: string, message: FcmPushMessage): FcmWebPayload {
  const url = message.url ?? "";
  return {
    message: {
      token,
      data: {
        title: message.title,
        body: message.body,
        url,
        messageId: message.messageId != null ? String(message.messageId) : "",
        room: message.room ?? "",
      },
      // Used if FCM ever auto-displays; our data-only messages ignore it.
      webpush: { fcm_options: { link: message.url || "/team-chat?notify=1" } },
    },
  };
}

/**
 * Send one payload to FCM. No throw — an offline worker is a no-op. A token
 * Google reports as gone comes back `invalid` so the caller deletes it.
 */
export async function sendFcmWeb(
  fetchImpl: FetchLike,
  accessToken: string,
  url: string,
  payload: FcmWebPayload,
): Promise<FcmSendResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { delivered: true, invalid: false };
    const parsed = (await res.json().catch(() => null)) as {
      error?: { status?: string; message?: string };
    } | null;
    const status = parsed?.error?.status ?? "";
    const message = (parsed?.error?.message ?? "").toLowerCase();
    if (res.status === 401) return { delivered: false, invalid: false, unauthorized: true };
    const invalid =
      status === "UNREGISTERED" ||
      status === "NOT_FOUND" ||
      (status === "INVALID_ARGUMENT" &&
        (message.includes("registration token") || message.includes("fcm registration token")));
    return { delivered: false, invalid };
  } catch {
    return { delivered: false, invalid: false };
  }
}

export type FcmClient = {
  send(token: string, message: FcmPushMessage): Promise<FcmSendResult>;
};

/**
 * A small client with a cached access token: mint once, reuse for ~59 minutes,
 * re-mint and retry once when Google answers 401 (the token expired anyway).
 */
export function createFcmClient(
  config: FcmConfig,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): FcmClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = options.now ?? (() => Date.now());
  let accessToken: string | null = null;
  let expiresAt = 0;

  async function accessTokenNow(): Promise<string | null> {
    if (accessToken && now() < expiresAt) return accessToken;
    const mintedAt = now();
    const token = await mintFcmAccessToken(config, fetchImpl, mintedAt);
    if (!token) {
      accessToken = null;
      return null;
    }
    accessToken = token;
    // The token lives 3600s — refresh a minute early.
    expiresAt = mintedAt + 3540_000;
    return accessToken;
  }

  return {
    async send(token, message) {
      const first = await accessTokenNow();
      if (!first) return { delivered: false, invalid: false };
      const url = fcmSendUrl(config.projectId);
      let result = await sendFcmWeb(fetchImpl, first, url, buildFcmWebMessage(token, message));
      if (result.unauthorized) {
        accessToken = null;
        expiresAt = 0;
        const fresh = await accessTokenNow();
        if (!fresh) return { delivered: false, invalid: false };
        result = await sendFcmWeb(fetchImpl, fresh, url, buildFcmWebMessage(token, message));
      }
      return { delivered: result.delivered, invalid: result.invalid };
    },
  };
}
