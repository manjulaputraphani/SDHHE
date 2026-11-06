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
  let data = { title: "Team Chat", body: "New message", url: "/team-chat" };
  try {
    data = { ...data, ...event.data.json() };
  } catch (err) {
    // A payload we do not understand still shows the default text.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: "team-chat",
      data: { url: data.url || "/team-chat" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/team-chat";
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
