"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../../../components/SystemDialog";

export function OrgImpersonateButton({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  async function impersonate() {
    const ok = await dialog.confirm({
      title: "Entrar como esta empresa",
      message: `Você vai acessar o painel de "${orgName}" como um administrador dela. Tudo o que fizer fica registrado. Para voltar ao master, use o botão "Sair da empresa" no topo.`,
      confirmLabel: "Entrar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/impersonate/${orgId}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao impersonar");
      // entra no painel da empresa
      router.push("/app");
    } catch (e: any) {
      dialog.toast(e.message, "error");
      setBusy(false);
    }
  }

  return (
    <button onClick={impersonate} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white disabled:opacity-50">
      {busy ? "Entrando..." : "Entrar como esta empresa"}
    </button>
  );
}
