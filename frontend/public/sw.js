const CACHE_NAME = "krnl-cache-v1";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/src/main.tsx",
  "/src/styles/theme.css",
  "/src/styles/fonts.css",
  "/src/styles/globals.css",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn("[Service Worker] Some assets failed to cache during install:", err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only handle local HTTP/S requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Avoid caching POST requests or API calls
  if (event.request.method !== "GET" || event.request.url.includes("/api/v1/")) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch((err) => {
            console.log("[Service Worker] Network request failed, using offline cache fallback:", err);
            // If completely offline and navigating, return index.html
            if (event.request.mode === "navigate") {
              return cache.match("/index.html");
            }
            return cachedResponse;
          });

        // Stale-While-Revalidate: return cache instantly if available, fetch updates in background
        return cachedResponse || fetchPromise;
      });
    })
  );
});
