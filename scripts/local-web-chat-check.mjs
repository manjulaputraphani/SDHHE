/**
 * LOCAL check for the web Team Chat screen (Phase 12).
 *
 * Opens /team-chat in a real browser against the local worker (wrangler dev)
 * and the web dev server, sends a message and looks at the approvals panel.
 *
 *   cd web && npm run dev                # in another terminal
 *   cd web-worker && npx wrangler dev    # in another terminal
 *   node scripts/local-web-chat-check.mjs
 */
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";
import { chromium } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });
dotenv.config();

const WEB = "http://127.0.0.1:5173";
const secret = process.env.SESSION_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secret || !databaseUrl) {
  console.error("SESSION_SECRET / DATABASE_URL missing");
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

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

const sql = neon(databaseUrl);
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addCookies([
  { name: "sdhhe_session", value: `${payload}.${signature}`, domain: "127.0.0.1", path: "/" },
]);
const page = await context.newPage();

try {
  await page.goto(`${WEB}/team-chat`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Team Chat" }).waitFor({ timeout: 20000 });
  check("the screen opens at /team-chat", true);

  check("the URL stays /team-chat", new URL(page.url()).pathname === "/team-chat", page.url());
  check("the composer is there", await page.getByPlaceholder("Message the team…").isVisible());
  check(
    "the approvals panel is there",
    await page.getByRole("heading", { name: "Receipt approvals" }).isVisible(),
  );

  // The socket connects on its own.
  let status = "";
  try {
    await page.waitForFunction(
      () => document.querySelector('[data-testid="chat-status"]')?.textContent?.includes("Live"),
      undefined,
      { timeout: 15000 },
    );
  } catch {
    status = "never live";
  }
  status = status || (await page.getByTestId("chat-status").innerText());
  check("the socket is live", status.includes("Live"), status.trim().split("\n")[0]);

  // Send a message and wait for it to come back over the socket.
  const text = `Check from the local web check ${Date.now()}`;
  await page.getByPlaceholder("Message the team…").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  let seen = true;
  try {
    await page.getByText(text).waitFor({ timeout: 20000 });
  } catch {
    seen = false;
    const alert = await page.getByRole("alert").allInnerTexts();
    console.log("  (page said:", alert.join(" | ") || "nothing", ")");
  }
  check("the message appears in the room", seen);

  // The receipt form opens.
  await page.getByRole("button", { name: "Attach receipt" }).click();
  check(
    "the receipt form opens",
    await page.getByPlaceholder("Title (e.g. Transport bill)").isVisible(),
  );

  // Send a receipt and approve it.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  const filePath = "/tmp/local-web-chat-receipt.png";
  await writeFile(filePath, png);
  await page.locator('input[type="file"]').setInputFiles(filePath);
  await page.getByPlaceholder("Title (e.g. Transport bill)").fill("Local check receipt");
  await page.getByPlaceholder("Amount in ₹").fill("450");
  await page.getByRole("button", { name: "Send receipt" }).click();

  await page.getByText("Local check receipt").first().waitFor({ timeout: 20000 });
  check("the receipt shows up in the room", true);

  const approve = page.getByRole("button", { name: "Approve" }).first();
  await approve.waitFor({ timeout: 10000 });
  check("the approval button is there", true);
  await approve.click();

  await page.waitForTimeout(2500);
  const stillPending = await page
    .getByRole("button", { name: "Approve" })
    .count();
  check("the receipt left the pending list", stillPending === 0, `${stillPending} left`);
} finally {
  await browser.close();
  await sql.query("delete from receipt_requests where title = 'Local check receipt'");
  await sql.query("delete from chat_messages where body like 'Check from the local web check%' or body like 'Local check receipt%' or body like '%receipt #%'");
  console.log("cleanup: test rows removed");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
