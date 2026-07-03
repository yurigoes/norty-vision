// Service worker mínimo do Portal do Cliente (instalável como PWA em /c).
// Objetivo principal: habilitar o prompt "Instalar app" / "Adicionar à tela
// inicial" e abrir direto em /c. Estratégia conservadora:
//   - NUNCA cacheia /api/* (sempre rede, pra não servir dados desatualizados);
//   - só cacheia assets estáticos (network-first com fallback pro cache);
//   - skipWaiting + clients.claim pra ativar rápido sem recarregar 2x.
const CACHE = "portal-cliente-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // só GET; deixa POST/PUT/etc passarem direto
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // nunca interceptar API nem outras origens
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // network-first: tenta rede, cacheia assets estáticos, cai pro cache offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
