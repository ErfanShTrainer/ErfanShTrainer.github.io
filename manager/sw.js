/* ErfanSh Trainer Manager — سرویس‌ورکر سبک
   - هیچ دخالتی در build-worker.js و terser.min.js نمی‌کند (worker باید مستقیم لود شود)
   - فقط صفحه‌ی اصلی در حالت آفلاین از کش نمایش داده می‌شود */
const CACHE = "etm-shell-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["./index.html", "./icon-192.png"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // worker و terser باید مستقیم از شبکه لود شوند
  if (url.pathname.endsWith("build-worker.js") || url.pathname.endsWith("terser.min.js")) return;
  // صفحه‌ی اصلی: اول شبکه، اگه آفلاین بود از کش
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./index.html")));
  }
});
