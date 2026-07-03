"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Faixa fixa no topo quando o master está dentro de uma empresa (impersonação).
 * Permite sair e voltar ao painel master.
 */
export function ImpersonationBanner({ orgName }: { orgName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      await fetch("/api/platform/impersonate/stop", { method: "POST", credentials: "include" });
      router.push("/app/platform/organizations");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-black">
      <span>
        👁️ Você está acessando como <strong>{orgName ?? "empresa"}</strong> (modo master).
      </span>
      <button
        onClick={stop}
        disabled={busy}
        className="rounded-md bg-black/80 px-3 py-1 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50"
      >
        {busy ? "Saindo..." : "Sair da empresa"}
      </button>
    </div>
  );
}
