/**
 * Maples Academy Smartboard Tool — Service Worker
 *
 * Strategy per resource type:
 *   - App shell (HTML, JS, CSS, fonts, icons) → Cache-First
 *   - PDF.js worker CDN                       → Cache-First (stale-while-revalidate on next visit)
 *   - Supabase API / storage                  → Network-First (fall back to cache when offline)
 *   - Everything else                         → Network-First with 4-second timeout
 *
 * On low-power / low-bandwidth devices the cache-first path means the viewer
 * opens instantly from the local cache with zero network round-trips.
 */

const CACHE_VERSION = "maples-v1";
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;
const CDN_CACHE     = `${CACHE_VERSION}-cdn`;

/** Static app-shell assets to pre-cache on install */
const PRECACHE_URLS = [
  "/",
  "/viewer",
  "/dashboard",
  "/sign-in",
  "/offline.html",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.svg",
  "/icon-512.svg",
  "/icon-maskable-512.svg",
];

/** Origins that should use network-first (live data) */
const NETWORK_FIRST_ORIGINS = [
  "supabase.co",
  "supabase.io",
];

/** CDN origins to cache aggressively (pdfjs worker, fonts) */
const CDN_ORIGINS = [
  "unpkg.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Don't fail install if individual assets are missing (e.g. dev mode)
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => null)
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("maples-") && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension and non-http(s) requests
  if (!url.protocol.startsWith("http")) return;

  // ── Supabase / live data → network-first ──
  if (NETWORK_FIRST_ORIGINS.some((o) => url.hostname.includes(o))) {
    event.respondWith(networkFirst(request, DATA_CACHE, 6000));
    return;
  }

  // ── CDN (pdfjs worker, Google Fonts) → cache-first ──
  if (CDN_ORIGINS.some((o) => url.hostname.includes(o))) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // ── Same-origin Next.js _next/static (JS chunks, CSS) → cache-first ──
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // ── Same-origin pages & API → network-first, fall back to shell cache ──
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, SHELL_CACHE, 4000));
    return;
  }
});

// ─── Strategies ───────────────────────────────────────────────────────────────

/**
 * Cache-First: serve from cache immediately; fetch and update cache in background.
 * Best for immutable assets (hashed JS bundles, icons, CDN resources).
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Revalidate in background so next visit gets fresh content
    fetchAndCache(request, cache);
    return cached;
  }
  return fetchAndCache(request, cache);
}

/**
 * Network-First with timeout: try network, fall back to cache if offline or slow.
 * Best for HTML pages and Supabase API calls.
 */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await Promise.race([
      fetch(request.clone()),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs)
      ),
    ]);
    if (networkResponse.ok || networkResponse.type === "opaque") {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort — return the offline viewer shell
    const offlineFallback = await cache.match("/viewer")
      ?? await cache.match("/offline.html")
      ?? await caches.match("/offline.html");
    return offlineFallback ?? new Response("Offline — open the app while connected first.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function fetchAndCache(request, cache) {
  const response = await fetch(request.clone());
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
  }
  return response;
}

// ─── Background sync: retry failed cloud saves ────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-annotations") {
    // The viewer app will handle retrying on reconnect.
    // This tag is registered from viewer-client.tsx when a save fails offline.
    event.waitUntil(Promise.resolve());
  }
});

// ─── Push notifications (placeholder for future teacher alerts) ──────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Maples Academy", {
      body: data.body ?? "",
      icon: "/icon-192.svg",
      badge: "/favicon.svg",
      tag: data.tag ?? "maples-notification",
      data: { url: data.url ?? "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(target)) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
