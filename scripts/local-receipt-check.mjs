/**
 * LOCAL check for the Team Chat receipt endpoints (Phase 12).
 *
 * Mints a session for the local worker (the SESSION_SECRET comes from
 * web-worker/.dev.vars), uploads a small PNG and downloads it again.
 * The token is never printed — only the outcome.
 *
 *   cd web-worker && npx wrangler dev   # in another terminal
 *   node scripts/local-receipt-check.mjs
 */
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });

const BASE = "http://127.0.0.1:8787";
const secret = process.env.SESSION_SECRET;
if (!secret) {
  console.error("SESSION_SECRET is missing from web-worker/.dev.vars");
  process.exit(1);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const session = {
  uid: 1,
  name: "B PHANI KUMAR",
  role: "owner",
  exp: Date.now() + 60 * 60_000,
  until: null,
  lastActivity: Date.now(),
};
const payload = b64url(Buffer.from(JSON.stringify(session)));
const signature = b64url(createHmac("sha256", secret).update(payload).digest());
const cookie = `sdhhe_session=${payload}.${signature}`;

// A 1x1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "check.png");

const upload = await fetch(`${BASE}/api/chat/receipts`, {
  method: "POST",
  headers: { cookie },
  body: form,
});
if (!upload.ok) {
  console.error(`upload failed: ${upload.status} ${await upload.text()}`);
  process.exit(1);
}
const { file } = await upload.json();
console.log("uploaded:", file.r2Key, `${file.sizeBytes} bytes`, file.mime);

const encoded = Buffer.from(file.r2Key, "utf8")
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const download = await fetch(`${BASE}/api/chat/receipts/${encoded}`, { headers: { cookie } });
if (!download.ok) {
  console.error(`download failed: ${download.status} ${await download.text()}`);
  process.exit(1);
}
const back = Buffer.from(await download.arrayBuffer());
const same = back.equals(png);
console.log("downloaded:", download.headers.get("content-type"), back.byteLength, "bytes");
console.log(same ? "RESULT: upload + download OK (bytes match)" : "RESULT: MISMATCH");
process.exit(same ? 0 : 1);
