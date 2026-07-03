"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../../../components/SystemDialog";

export function OrgProvisionButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  async function provision() {
    const ok = await dialog.confirm({
      title: "Provisionar integrações",
      message: "Criar/garantir a empresa no Chatwoot, GLPI e Evolution? É idempotente — pula o que já existe.",
      confirmLabel: "Provisionar",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/integrations/provision/${orgId}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao provisionar");
      dialog.toast("Provisionamento executado. Atualizando status...", "success");
      router.refresh();
    } catch (e: any) {
      dialog.toast(e.message, "error");
    } finally { setBusy(false); }
  }

  return (
    <button onClick={provision} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand hover:text-white disabled:opacity-50">
      {busy ? "Provisionando..." : "Provisionar / Reprovisionar integrações"}
    </button>
  );
}
