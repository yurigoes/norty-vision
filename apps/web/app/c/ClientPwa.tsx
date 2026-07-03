"use client";

import { useEffect } from "react";

/** Registra o service worker do Portal do Cliente (PWA instalável em /c). */
export function ClientPwa() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/c-sw.js", { scope: "/c" }).catch(() => undefined);
  }, []);
  return null;
}
