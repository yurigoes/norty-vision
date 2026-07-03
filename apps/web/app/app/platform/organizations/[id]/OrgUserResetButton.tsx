"use client";

import { useState } from "react";
import { useDialog } from "../../../../../components/SystemDialog";

export function OrgUserResetButton({ userId, userName }: { userId: string; userName: string }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  async function reset() {
    const ok = await dialog.confirm({
      title: "Resetar senha",
      message: `Gerar uma senha temporária para ${userName}? Ele será obrigado a trocá-la no próximo acesso.`,
      confirmLabel: "Resetar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/reset-password`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      await dialog.alert({
        title: "Senha temporária gerada",
        message: `Repasse ao usuário (ele troca no 1º acesso):\n\n${data.tempPassword}`,
      });
    } catch (e: any) {
      dialog.toast(e.message, "error");
    } finally { setBusy(false); }
  }

  return (
    <button onClick={reset} disabled={busy} className="text-xs text-brand hover:underline disabled:opacity-50">
      {busy ? "..." : "Resetar senha"}
    </button>
  );
}
