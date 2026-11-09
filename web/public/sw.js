/**
 * The service worker (Phase 16) — Cloudflare Web Push for the team chat.
 *
 * It shows the notification when the app is closed and opens the chat when it
 * is tapped. Nothing else: no caching, no offline behaviour.
 */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  console.log("sw: push event received", event.data ? "with data" : "no data");
  let data = { title: "Team Chat", body: "New message", url: "/team-chat?notify=1" };
  try {
    data = { ...data, ...event.data.json() };
    console.log("sw: push data parsed", JSON.stringify(data));
  } catch (err) {
    console.log("sw: push data parse failed", err);
    // A payload we do not understand still shows the default text.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/favicon.svg",
      tag: "team-chat",
      data: { url: data.url || "/team-chat?notify=1" },
    }).then(() => {
      console.log("sw: notification shown", data.title);
    }).catch((err) => {
      console.log("sw: notification failed", err);
    }),
  );
  // Tell every open tab to play the notification sound (the OS plays its own
  // sound for closed apps; open tabs need this).
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      console.log("sw: notifying", clients.length, "open tabs");
      for (const client of clients) {
        client.postMessage({ type: "play-notification-sound" });
      }
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // ?notify=1 opens the chat straight away — a plain /team-chat address now
  // lands on the Dashboard (the owner's always-Dashboard rule).
  const url = event.notification.data?.url || "/team-chat?notify=1";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
