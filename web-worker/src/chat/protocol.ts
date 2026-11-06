/**
 * The frames that travel over the Team Chat socket (Phase 12).
 *
 * The socket only carries what the browser needs to draw the room:
 * who is here, a new message, a receipt that needs a decision and errors.
 * The Worker writes to the database first and then pushes the frame, so every
 * client sees the same history.
 */

export type ChatUser = {
  id: number;
  name: string;
  role: string;
  /** When the chat token of this member runs out (seconds since the epoch). */
  exp?: number;
};

export type ChatFrame =
  | { type: "hello"; user: ChatUser; presence: ChatUser[] }
  | { type: "message"; message: unknown }
  | { type: "receipt"; receipt: unknown; message: unknown }
  | { type: "presence"; users: ChatUser[] }
  | { type: "error"; message: string };

export const CHAT_FRAME_TYPES = ["hello", "message", "receipt", "presence", "error"] as const;

/** Is this a member we can put in the presence list? */
export function isChatUser(value: unknown): value is ChatUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<ChatUser>;
  return (
    typeof user.id === "number" &&
    Number.isFinite(user.id) &&
    typeof user.name === "string" &&
    user.name.length > 0 &&
    typeof user.role === "string"
  );
}

/** Is this a frame we understand? */
export function isChatFrame(value: unknown): value is ChatFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as { type?: unknown };
  return (
    typeof frame.type === "string" &&
    (CHAT_FRAME_TYPES as readonly string[]).includes(frame.type)
  );
}

/** Read a frame off the socket (null when it is not one). */
export function parseFrame(raw: string | ArrayBuffer | Uint8Array): ChatFrame | null {
  let text: string;
  if (typeof raw === "string") text = raw;
  else text = new TextDecoder().decode(raw as ArrayBuffer);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isChatFrame(parsed) ? parsed : null;
}

/** Turn a frame into the text that goes over the wire. */
export function encodeFrame(frame: ChatFrame): string {
  return JSON.stringify(frame);
}

/** The frame that lists who is in the room. */
export function presenceFrame(users: ChatUser[]): ChatFrame {
  return { type: "presence", users };
}

/** The frame that tells the client something went wrong. */
export function errorFrame(message: string): ChatFrame {
  return { type: "error", message };
}

/** One member per id — the same person may have two tabs open. */
export function uniqueUsers(users: ChatUser[]): ChatUser[] {
  const seen = new Map<number, ChatUser>();
  for (const user of users) seen.set(user.id, user);
  return Array.from(seen.values());
}

/**
 * Has the sign-on of this member run out?
 *
 * The chat must not outlive the login: a socket whose token has expired is
 * closed, so an idle tab stops receiving messages when the member is signed
 * out after an hour.
 */
export function isTokenExpired(exp: number | undefined, now: number = Date.now()): boolean {
  if (typeof exp !== "number") return false;
  return exp * 1000 <= now;
}
