"use client";

import { useEffect } from "react";

/** Registra o service worker do app de atendimento (PWA instalável em /app).
 *  O SW recebe Web Push de chamada — ver public/app-sw.js. */
export function AppPwa() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/app-sw.js", { scope: "/app" }).catch(() => undefined);
  }, []);
  return null;
}
