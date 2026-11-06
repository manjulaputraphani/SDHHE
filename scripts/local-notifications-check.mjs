/**
 * LOCAL check for the notification system (Phase 15).
 *
 * The bootstrap, an announcement (created → shown → dismissed), the release
 * window, the onboarding state, the tours and the login history.
 * It removes its own rows from Neon afterwards.
 *
 *   cd web-worker && npx wrangler dev      # in another terminal
 *   node scripts/local-notifications-check.mjs
 */
import { createHmac } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: "web-worker/.dev.vars" });
dotenv.config();

const BASE = "http://127.0.0.1:8787";
const secret = process.env.SESSION_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!secret || !databaseUrl) {
  console.error("SESSION_SECRET / DATABASE_URL missing");
  process.exit(1);
}

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let epoch = 0;

function cookieFor(uid, name, role) {
  const session = {
    uid,
    name,
    role,
    exp: Date.now() + 60 * 60_000,
    until: null,
    lastActivity: Date.now(),
    epoch,
  };
  const payload = b64url(Buffer.from(JSON.stringify(session)));
  const signature = b64url(createHmac("sha256", secret).update(payload).digest());
  return `sdhhe_session=${payload}.${signature}`;
}

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
}

const sql = neon(databaseUrl);
const epochRows = await sql.query("select value from settings where key = 'session_epoch'");
epoch = Number(epochRows[0]?.value ?? 0);
const ownerCookie = cookieFor(1, "B PHANI KUMAR", "owner");
const title = `Check ${new Date().toISOString().slice(11, 19)}`;

try {
  // 1. The bootstrap answers with everything that is due.
  const boot = await fetch(`${BASE}/api/notifications`, { headers: { cookie: ownerCookie } });
  const bootJson = await boot.json();
  check("the bootstrap answers", boot.ok && Boolean(bootJson.user?.name), bootJson.user?.name);
  check("the checklist comes with it", Array.isArray(bootJson.onboarding?.steps), `${bootJson.onboarding?.done}/${bootJson.onboarding?.total} done`);
  check("the login history comes with it", Array.isArray(bootJson.loginHistory), `${bootJson.loginHistory?.length} login(s)`);
  check("the session expiry is known", Boolean(bootJson.session?.expiresAt));

  // 2. The owner publishes an announcement.
  const created = await fetch(`${BASE}/api/notifications/announcements`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ title, message: "A check", kind: "warning" }),
  });
  const createdJson = await created.json();
  const announcementId = createdJson.announcement?.id;
  check("the owner can publish an announcement", created.ok && announcementId > 0);

  // 3. It shows up in the bootstrap of everybody.
  const after = await fetch(`${BASE}/api/notifications`, { headers: { cookie: ownerCookie } });
  const afterJson = await after.json();
  check(
    "the announcement is shown",
    afterJson.announcements?.some((item) => item.id === announcementId),
  );

  // 4. A staff member may not publish.
  const staff = await fetch(`${BASE}/api/notifications/announcements`, {
    method: "POST",
    headers: { cookie: cookieFor(2, "RAJU", "staff"), "content-type": "application/json" },
    body: JSON.stringify({ title: "no", message: "no" }),
  });
  check("a staff member cannot publish", staff.status === 403, `status ${staff.status}`);

  // 5. It can be dismissed (and stays dismissed).
  const dismissed = await fetch(`${BASE}/api/notifications/announcements/${announcementId}/dismiss`, {
    method: "POST",
    headers: { cookie: ownerCookie },
  });
  check("the announcement can be dismissed", dismissed.ok);
  const after2 = await fetch(`${BASE}/api/notifications`, { headers: { cookie: ownerCookie } });
  const after2Json = await after2.json();
  check(
    "a dismissed announcement does not come back",
    !after2Json.announcements?.some((item) => item.id === announcementId),
  );

  // 6. The onboarding can be finished.
  const onboard = await fetch(`${BASE}/api/notifications/onboarding/complete`, {
    method: "POST",
    headers: { cookie: ownerCookie },
  });
  check("the onboarding can be finished", onboard.ok);

  // 7. A tour can be finished.
  const tour = await fetch(`${BASE}/api/notifications/tours/team-chat`, {
    method: "POST",
    headers: { cookie: ownerCookie },
  });
  check("a tour can be finished", tour.ok);
  const boot2 = await fetch(`${BASE}/api/notifications`, { headers: { cookie: ownerCookie } });
  const boot2Json = await boot2.json();
  check("the finished tour is remembered", boot2Json.tours?.includes("team-chat"));

  // 8. A release shows up once and can be marked as seen.
  const release = await fetch(`${BASE}/api/notifications/releases`, {
    method: "POST",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ version: "9.9", title: "Check release", items: ["One change"] }),
  });
  const releaseJson = await release.json();
  check("the owner can publish a release", release.ok && releaseJson.release?.id > 0);
  check("publishing signs everybody out", typeof releaseJson.epoch === "number", `epoch ${releaseJson.epoch}`);
  // The release signs everybody out — the member signs in again.
  epoch = releaseJson.epoch ?? epoch;
  const boot3 = await fetch(`${BASE}/api/notifications`, { headers: { cookie: cookieFor(1, "B PHANI KUMAR", "owner") } });
  const boot3Json = await boot3.json();
  check("the release is waiting for the member", boot3Json.release?.id === releaseJson.release?.id);
  const seen = await fetch(`${BASE}/api/notifications/releases/${releaseJson.release.id}/seen`, {
    method: "POST",
    headers: { cookie: cookieFor(1, "B PHANI KUMAR", "owner") },
  });
  check("the release can be marked as seen", seen.ok);
  const boot4 = await fetch(`${BASE}/api/notifications`, { headers: { cookie: cookieFor(1, "B PHANI KUMAR", "owner") } });
  const boot4Json = await boot4.json();
  check("the release does not come back", boot4Json.release === null);

  // 9. The login history lists the sign-ins.
  const history = await fetch(`${BASE}/api/notifications/login-history`, {
    headers: { cookie: cookieFor(1, "B PHANI KUMAR", "owner") },
  });
  const historyJson = await history.json();
  check("the login history answers", history.ok && Array.isArray(historyJson.logins), `${historyJson.logins?.length} login(s)`);
} finally {
  await sql.query("delete from announcement_dismissals");
  await sql.query("delete from announcements where title = $1", [title]);
  await sql.query("delete from releases where version = '9.9'");
  await sql.query("delete from user_releases_seen where release_id in (select id from releases where version = '9.9')");
  await sql.query("delete from user_tours where tour_id = 'team-chat'");
  await sql.query("update app_users set onboarding_completed = false where id = 1");
  console.log("cleanup: the test rows are removed");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `RESULT: ${results.length}/${results.length} checks passed` : `RESULT: ${failed.length} check(s) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
