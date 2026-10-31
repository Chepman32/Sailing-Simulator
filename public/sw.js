/*
 * Service worker of the installed app (PWA).
 *
 * - The page itself: network first, so a new release is picked up as soon as
 *   it is online; offline, the last copy starts the simulator.
 * - Hashed build assets (/assets/*): cache first, they never change.
 * - Models, icons and other public files: served from the cache at once and
 *   refreshed in the background, so a second launch does not download the
 *   ~10 MB of models again.
 *
 * Bump VERSION when this file's caching rules change; old caches are dropped
 * on activation.
 */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const STATIC = `static-${VERSION}`;
const KEEP = new Set([SHELL, ASSETS, STATIC]);

const PRECACHE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !KEEP.has(name)).map((name) => caches.delete(name)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vinext/") || url.pathname === "/sw.js") return;
  // Partial downloads (media seeking) go straight to the network.
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }
  if (/\.(?:glb|gltf|bin|png|jpe?g|webp|avif|svg|ico|webmanifest|mp3|ogg|wav|m4a|woff2?|ktx2|wasm|md)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, STATIC));
  }
});

async function networkFirstPage(event) {
  const cache = await caches.open(SHELL);
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(event.request));
    if (response.ok) event.waitUntil(cache.put("/", response.clone()));
    return response;
  } catch (error) {
    const cached = (await cache.match(event.request)) || (await cache.match("/"));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache, 64);
  }
  return response;
}

/** Hashed assets of old releases pile up; keep the most recent entries. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let index = 0; index < keys.length - limit; index += 1) await cache.delete(keys[index]);
}

async function staleWhileRevalidate(event, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  return response || Response.error();
}
