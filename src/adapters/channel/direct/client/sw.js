const CACHE = "ke-v21";
// 只预缓存真正需要离线可用的核心资源。CSS/JS 通过 URL 版本号管理缓存。
const PRE_CACHE = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Pre-cache core assets so the app works offline immediately.
self.addEventListener("install", (e) => {
  self.skipWaiting();  // activate immediately, don't wait for tabs to close
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRE_CACHE)).catch(() => {})
  );
});

// Skip caching dynamic API data and WebSocket connections.
// Only cache static assets: html, css, js, images, fonts, icons.
function isCacheable(url) {
  const path = String(url.pathname || "");
  if (path.startsWith("/api/")) return false;
  if (path === "/" || path === "/index.html") return false;
  // Don't cache the base ws-handshake URL (ws connections are not GET, but be safe)
  if (path === "/ws") return false;
  return true;
}

// Don't pre-cache on install — wait for first successful fetch.
// This prevents error pages from being cached when the server is down.

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (e.request.mode === "navigate") return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.status === 200 && isCacheable(new URL(e.request.url))) {
          const cloned = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, cloned));
        }
        return res;
      })
      .catch(() => {
        if (e.request.mode === "navigate") {
          return caches.match(e.request);
        }
        return new Response("", { status: 503 });
      })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  // Take over all clients immediately so the new SW controls the page
  e.waitUntil(self.clients.claim());
});

// The client sends SKIP_WAITING when the user taps "更新"
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
