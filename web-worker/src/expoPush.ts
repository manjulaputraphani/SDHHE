/**
 * The Expo Push fan-out for the native Android app (SDHHE Mobile, Phase 18) —
 * the phone-side sibling of webpush.ts. The messages carry the same title/body
 * the browsers get, plus the team-chat url in `data` (the app navigates to the
 * chat when the notification is tapped).
 *
 * Best effort throughout: a network hiccup is a no-op, tokens marked
 * DeviceNotRegistered by Expo come back so the caller can forget them.
 */

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: "default";
  data?: Record<string, unknown>;
};

export type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoPushResponse = { data?: ExpoPushTicket[] };

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo Push accepts at most 100 messages per request. */
export const EXPO_CHUNK = 100;

/**
 * Expo tokens look like `ExponentPushToken[...]`. Everything else in
 * `push_tokens` is an FCM registration token (the web) — the two fan-outs
 * must never receive each other's tokens.
 */
export function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

/** Build one Expo message per token (chunked lists come straight from here). */
export function buildExpoPushMessages(
  tokens: string[],
  message: { title: string; body: string; url?: string; messageId?: number; room?: string },
): ExpoPushMessage[] {
  return tokens.map((to) => ({
    to,
    title: message.title,
    body: message.body,
    sound: "default" as const,
    data: {
      url: message.url,
      messageId: message.messageId,
      room: message.room,
    },
  }));
}

/** A fetch function, injectable so the tests never touch the network. */
export type FetchJsonLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Send the messages (already chunked) to the Expo Push API. No throw — a
 * dead network is a no-op. Tokens Expo reports as unregistered are returned
 * so the caller can delete them from the database.
 */
export async function sendExpoPush(
  fetchImpl: FetchJsonLike,
  accessToken: string,
  messages: ExpoPushMessage[],
): Promise<{ invalidTokens: string[] }> {
  const invalidTokens: string[] = [];
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });
      const parsed = (await res.json().catch(() => ({}))) as ExpoPushResponse;
      (parsed.data ?? []).forEach((ticket, offset) => {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          const token = chunk[offset]?.to;
          if (token) invalidTokens.push(token);
        }
      });
    } catch {
      // Offline / Expo hiccup — the next message retry catches up.
    }
  }
  return { invalidTokens };
}
