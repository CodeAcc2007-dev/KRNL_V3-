// Deploy-safe service worker.
// Navigation requests (index.html) are network-first so a new build's HTML —
// and therefore its hashed asset references — is always current; the cache is
// only a fallback when offline. Hashed static assets are cache-first (their
// filenames change every build, so cached copies never go stale). Bumping
// CACHE_NAME purges older caches on activate.
const CACHE_NAME = "krnl-cache-v3";
const PRECACHE = [
  "/",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : undefined)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req.url.startsWith(self.location.origin)) return;
  if (req.method !== "GET" || req.url.includes("/api/v1/")) return;

  // Navigation: network-first, fall back to cached shell only when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Static assets (hashed filenames): cache-first, populate on first fetch.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});

// Web Push: render the notification.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "KRNL", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "KRNL";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Focus an existing tab or open a new one at the notification's url.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
