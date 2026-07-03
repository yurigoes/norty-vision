"use client";

import { useState } from "react";
import { useDialog } from "../../../../../components/SystemDialog";

/** Desbloqueia a conta: limpa o lock por tentativas e reativa (status=active). */
export function OrgUserUnblockButton({ userId, userName }: { userId: string; userName: string }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);

  async function unblock() {
    const ok = await dialog.confirm({
      title: "Desbloquear conta",
      message: `Reativar o acesso de ${userName} e limpar o bloqueio por tentativas?`,
      confirmLabel: "Desbloquear",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/unblock`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      dialog.toast("Conta desbloqueada ✅", "success");
    } catch (e: any) {
      dialog.toast(e.message, "error");
    } finally { setBusy(false); }
  }

  return (
    <button onClick={unblock} disabled={busy} className="text-xs text-green-600 hover:underline disabled:opacity-50 dark:text-green-300">
      {busy ? "..." : "Desbloquear"}
    </button>
  );
}
