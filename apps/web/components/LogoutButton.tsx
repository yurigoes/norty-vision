"use client";

import { useState } from "react";

interface Props {
  isMaster: boolean;
  className?: string;
}

/**
 * Logout client-side: chama tanto /api/auth/logout quanto
 * /api/platform-auth/logout (idempotente) pra garantir que ambos os
 * cookies sao limpados. Depois faz hard refresh pra /login.
 */
export function LogoutButton({ isMaster, className = "" }: Props) {
  const [busy, setBusy] = useState(false);

  async function doLogout() {
    setBusy(true);
    try {
      // best-effort: tenta os 2 endpoints sempre
      await Promise.allSettled([
        fetch("/api/auth/logout", { method: "POST", credentials: "include" }),
        fetch("/api/platform-auth/logout", { method: "POST", credentials: "include" }),
      ]);
    } finally {
      // hard redirect pra forcar nova request RSC sem cookies
      window.location.href = "/login";
    }
  }

  return (
    <button
      type="button"
      onClick={doLogout}
      disabled={busy}
      className={`text-xs text-muted hover:text-fg disabled:opacity-50 ${className}`}
    >
      {busy ? "Saindo..." : "Sair"}
    </button>
  );
}
