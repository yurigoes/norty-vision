// Service worker do app de Ponto (instalável como PWA no balcão da filial).
// Cacheia o shell pra abrir offline; dados (API) ficam network-first.
// A fila de marcações offline é gerida na página (localStorage) e sincroniza
// quando a conexão volta.
const SHELL = "ponto-shell-v1";
const ASSETS = ["/ponto-app", "/ponto.webmanifest", "/rh-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // POST de marcação nunca é cacheado
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  // shell: cache-first com atualização em background
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("/ponto-app"))),
  );
});
