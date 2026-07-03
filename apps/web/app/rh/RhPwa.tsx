"use client";

import { useEffect } from "react";

/** Registra o service worker do portal do funcionário (PWA instalável em /rh). */
export function RhPwa() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/rh-sw.js", { scope: "/rh" }).catch(() => undefined);
  }, []);
  return null;
}
