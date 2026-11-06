/**
 * The Team Chat room — a Cloudflare Durable Object (Phase 12, T-12.4).
 *
 * The room is a **fan-out hub only**: the Worker writes every message and
 * receipt into Neon and then asks this object to push the frame to everybody
 * in the room. The object never touches the database for a message (it only
 * reads the role permissions once, when somebody connects) and it never polls
 * anything.
 *
 * Sockets use the hibernation API, so the room survives the object being
 * evicted and comes back with the same members.
 */
import { DurableObject } from "cloudflare:workers";
import { getDb } from "../../../src/db/client";
import { loadPermissionsForRole } from "../../../src/db/permissions";
import { allowed } from "../../../src/logic/permissions";
import { verifyChatToken } from "../../../src/logic/chatToken";
import {
  encodeFrame,
  isTokenExpired,
  presenceFrame,
  uniqueUsers,
  type ChatFrame,
  type ChatUser,
} from "./protocol";
import type { Env } from "../index";

const ROOM_NAME = "main";

export class ChatRoom extends DurableObject<Env> {
  /** The socket that asked to be left alone (no auto response). */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if ((request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket") {
      return this.openSocket(request);
    }

    // The Worker pushes a new message / receipt / decision into the room.
    if (url.pathname.endsWith("/broadcast") && request.method === "POST") {
      const frame = (await request.json()) as ChatFrame;
      this.broadcast(frame);
      return new Response("ok");
    }

    if (url.pathname.endsWith("/presence")) {
      return Response.json({ users: this.onlineUsers() });
    }

    return new Response("Not found", { status: 404 });
  }

  /** A member opened the room. */
  private async openSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const user = await this.authenticate(url.searchParams.get("token") ?? "");
    if (!user) return new Response("Not allowed", { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(user);

    const presence = this.onlineUsers();
    server.send(encodeFrame({ type: "hello", user, presence }));
    this.broadcast(presenceFrame(presence));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Who is this? A chat token (HMAC, 12 h) — the desktop app gets one with
   * its phone + password, the web app exchanges its session for one.
   */
  private async authenticate(token: string): Promise<ChatUser | null> {
    const secret = this.env.SESSION_SECRET;
    const url = this.env.DATABASE_URL;
    if (!secret || !url || !token) return null;

    const payload = verifyChatToken(token, secret);
    if (!payload) return null;

    try {
      const permissions = await loadPermissionsForRole(getDb(url), payload.role);
      if (!allowed(permissions, "chat", "view")) return null;
    } catch (err) {
      console.error("chat: permission check failed:", err);
      return null;
    }

    return { id: payload.uid, name: payload.name, role: payload.role, exp: payload.exp };
  }

  /** Everybody who is in the room right now (one entry per member). */
  private onlineUsers(): ChatUser[] {
    const users: ChatUser[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as ChatUser | null;
      if (attachment && typeof attachment.id === "number") users.push(attachment);
    }
    return uniqueUsers(users);
  }

  /** Send a frame to everybody in the room. */
  private broadcast(frame: ChatFrame): void {
    const text = encodeFrame(frame);
    for (const socket of this.ctx.getWebSockets()) {
      // The chat may not outlive the sign-on: an expired token closes the socket.
      const attachment = socket.deserializeAttachment() as ChatUser | null;
      if (isTokenExpired(attachment?.exp)) {
        try {
          socket.close(1000, "sign-on expired");
        } catch {
          // The socket was already gone.
        }
        continue;
      }
      try {
        socket.send(text);
      } catch (err) {
        console.error("chat: send failed:", err);
      }
    }
  }

  /** A member sent something (only pings today — messages go through REST). */
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === "string" && message === "ping") socket.send("pong");
  }

  /** Somebody left — tell the room. */
  webSocketClose(socket: WebSocket): void {
    this.broadcast(presenceFrame(this.onlineUsers().filter((user) => user.id !== this.userId(socket))));
  }

  /** The connection broke — tell the room. */
  webSocketError(socket: WebSocket): void {
    this.broadcast(presenceFrame(this.onlineUsers().filter((user) => user.id !== this.userId(socket))));
  }

  /** The member behind a socket (null when it has no attachment). */
  private userId(socket: WebSocket): number | null {
    const attachment = socket.deserializeAttachment() as ChatUser | null;
    return attachment && typeof attachment.id === "number" ? attachment.id : null;
  }
}

/** The room every member of the shop shares. */
export function chatRoomStub(env: Env): DurableObjectStub | null {
  return env.CHAT_ROOM ? env.CHAT_ROOM.getByName(ROOM_NAME) : null;
}
