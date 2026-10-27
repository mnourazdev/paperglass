/**
 * Paperglass offline shell.
 *
 * Bump CACHE_VERSION when the precache list changes so old entries are
 * discarded. Normal asset updates are picked up in the background because
 * scripts and styles use stale-while-revalidate.
 */

const CACHE_VERSION = "paperglass-v2";
const SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/scanner.js",
  "./js/pdf.js",
  "./js/zip.js",
  "./js/db.js",
  "./js/i18n.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Documents: prefer fresh HTML, fall back to the cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match("./index.html");
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put("./index.html", response.clone());
            return response;
          }
          return cached || response;
        } catch (error) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Assets: serve the cached copy immediately and refresh it in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      const response = await network;
      return (
        response ||
        new Response("Offline", {
          status: 503,
          statusText: "Offline",
        })
      );
    })()
  );
});
