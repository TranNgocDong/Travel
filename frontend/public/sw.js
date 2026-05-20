const CACHE_NAME = "trail-ledger-shell-v3";
const APP_SHELL = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(request);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await cache.match(request);

          if (cached) {
            return cached;
          }

          throw new Error("Manifest is not available");
        }
      }),
    );
  }
});
