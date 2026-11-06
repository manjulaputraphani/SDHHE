/**
 * LOCAL check for the Team Chat socket (Phase 12).
 *
 * Mints a chat token, opens the Durable Object socket and prints the frames
 * that arrive. The token is never printed.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-chat-check.mjs
 */
import { createHmac } from "node:crypto";
import { chromium } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });

const secret = process.env.SESSION_SECRET;
if (!secret) {
  console.error("SESSION_SECRET is missing from web-worker/.dev.vars");
  process.exit(1);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const payload = {
  uid: 1,
  name: "B PHANI KUMAR",
  role: "owner",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const body = b64url(Buffer.from(JSON.stringify(payload)));
const signature = b64url(createHmac("sha256", secret).update(body).digest());
const token = `${body}.${signature}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const frames = await page.evaluate(async (chatToken) => {
  const received = [];
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:8787/api/chat/ws?token=${chatToken}`);
    const timer = setTimeout(() => reject(new Error("timeout waiting for the first frame")), 15000);
    socket.onmessage = (event) => {
      received.push(String(event.data));
      if (received.length >= 2) {
        clearTimeout(timer);
        socket.close();
        resolve(received);
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("socket error"));
    };
    socket.onopen = () => socket.send("ping");
  });
}, token);

await browser.close();

for (const frame of frames) console.log("frame:", frame);
const hello = JSON.parse(frames[0]);
console.log(
  hello.type === "hello"
    ? `RESULT: socket OK — ${hello.user.name} is in the room (${hello.presence.length} present)`
    : "RESULT: unexpected first frame",
);

// A bad token must not get into the room.
const browser2 = await chromium.launch();
const page2 = await browser2.newPage();
const rejected = await page2.evaluate(async () => {
  return await new Promise((resolve) => {
    const socket = new WebSocket("ws://127.0.0.1:8787/api/chat/ws?token=not-a-real-token");
    const timer = setTimeout(() => resolve("timeout"), 10000);
    socket.onmessage = () => {
      clearTimeout(timer);
      resolve("accepted");
    };
    socket.onerror = () => {
      clearTimeout(timer);
      resolve("rejected");
    };
    socket.onclose = () => {
      clearTimeout(timer);
      resolve("closed");
    };
  });
});
await browser2.close();
console.log(
  rejected === "rejected" || rejected === "closed"
    ? "RESULT: a bad token is turned away"
    : `RESULT: PROBLEM — a bad token was ${rejected}`,
);
