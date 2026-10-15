// Push notifications carry no secrets: just "something needs you". Details load in the app.
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Satchel", body: "Something needs your attention", url: "/app/" };
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url }, icon: "/ui/logo.svg" }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? "/app/"));
});
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
