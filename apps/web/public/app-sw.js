// Service worker do app de atendimento (PWA instalável em /app).
// Foco: receber WEB PUSH de chamada e mostrar a notificação "Fulano está
// ligando" mesmo com o app fechado. NÃO cacheia o shell (app é autenticado;
// cachear shell pode servir página de outro usuário). Mantém um fetch handler
// no-op só pra atender o critério de instalabilidade dos navegadores.

self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });

// fetch no-op (não chamar respondWith = browser segue o caminho normal). Só
// existe pra que o navegador considere o app instalável.
self.addEventListener("fetch", () => {});

// payload esperado do servidor (vide voip.service.sendRing):
//   { type: "ring", title, body, callId, fromExt, fromName, url }
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* texto cru, ignora */ }
  const title = data.title || "Chamada entrante";
  const body = data.body || (data.fromName ? `${data.fromName} está ligando…` : "Alguém está te ligando…");
  const url = data.url || "/app/voip";
  const opts = {
    body,
    icon: "/yugo-app-icon.svg",
    badge: "/yugo-app-icon.svg",
    tag: data.callId || "yugo-call",
    renotify: true,
    requireInteraction: true,                 // não some sozinha — usuário decide
    vibrate: [200, 100, 200, 100, 200],
    data: { url, callId: data.callId, fromExt: data.fromExt, type: data.type || "ring" },
    actions: [
      { action: "answer", title: "Atender" },
      { action: "reject", title: "Recusar" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  const d = event.notification.data || {};
  // ?ringAction=answer/reject + ?callId pra a página tratar ao abrir/focar
  const url = (d.url || "/app/voip") + (action ? `?ringAction=${action}&callId=${encodeURIComponent(d.callId || "")}` : "");
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // foca uma aba do app se já estiver aberta
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.pathname.startsWith("/app")) {
          await c.focus();
          // avisa a página que veio do notification click (pra atender/recusar)
          if (action) c.postMessage({ type: "voip-notification-action", action, callId: d.callId });
          return;
        }
      } catch { /* url inválida, ignora */ }
    }
    // senão abre nova
    await self.clients.openWindow(url);
  })());
});
