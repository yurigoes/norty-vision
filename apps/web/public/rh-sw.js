// Service worker mínimo do Portal do Funcionário (instalável como PWA).
// Network-first com fallback simples; objetivo principal é habilitar
// "Adicionar à tela inicial" abrindo direto em /rh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // passthrough (sem cache agressivo p/ não servir dados desatualizados)
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
