"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../../components/SystemDialog";

export function AccountActions({
  account,
}: {
  account: { id: string; status: string; limitCents: string };
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [showLimit, setShowLimit] = useState(false);
  const [newLimit, setNewLimit] = useState(String(Number(account.limitCents) / 100));
  const [showContract, setShowContract] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; title: string; kind?: string }>>([]);
  const [tplId, setTplId] = useState("");
  const [sending, setSending] = useState(false);

  async function openContract() {
    setShowContract((v) => !v);
    if (templates.length === 0) {
      try {
        const res = await fetch("/api/contracts/templates", { credentials: "include", cache: "no-store" });
        const data = await res.json();
        if (res.ok) setTemplates(data.items ?? []);
      } catch { /* ignora */ }
    }
  }

  async function sendContract() {
    setSending(true);
    try {
      const res = await fetch("/api/contracts/for-account", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ creditAccountId: account.id, templateId: tplId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      dialog.toast("Contrato enviado ao cliente (WhatsApp/email) e disponível no portal.", "success");
      setShowContract(false);
      startTransition(() => router.refresh());
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setSending(false); }
  }

  async function call(path: string, body?: any) {
    const res = await fetch(`/api/credit/accounts/${account.id}/${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "include",
    });
    if (res.ok) startTransition(() => router.refresh());
    else {
      const d = await res.json().catch(() => ({}));
      dialog.toast(d?.error?.message ?? "Falha", "error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={() => setShowLimit(!showLimit)} className="rounded-md border border-line px-3 py-1.5 text-xs hover:border-brand">
          Alterar limite
        </button>
        <button onClick={openContract} className="rounded-md border border-line px-3 py-1.5 text-xs hover:border-brand">
          Enviar contrato
        </button>
        {account.status === "blocked" ? (
          <button onClick={() => call("unblock")} className="rounded-md border border-line px-3 py-1.5 text-xs text-green-300 hover:border-green-500">
            Desbloquear
          </button>
        ) : (
          <button
            onClick={async () => {
              const reason = await dialog.prompt({ title: "Bloquear conta", message: "Informe o motivo do bloqueio:", placeholder: "Ex.: inadimplência" });
              if (reason) call("block", { reason });
            }}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-red-300 hover:border-red-500"
          >
            Bloquear
          </button>
        )}
      </div>
      {showContract && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-bg/60 p-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Modelo de contrato</span>
            <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-xs">
              <option value="">Padrão de crediário</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}{t.kind === "credit" ? " (crediário)" : ""}</option>
              ))}
            </select>
          </label>
          <button onClick={sendContract} disabled={sending} className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {sending ? "Enviando..." : "Enviar ao cliente"}
          </button>
        </div>
      )}
      {showLimit && (
        <div className="flex gap-2 rounded-lg border border-line bg-bg/60 p-2">
          <input
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value)}
            className="w-28 rounded border border-line bg-bg/60 px-2 py-1 text-xs"
            placeholder="R$"
          />
          <button
            disabled={isPending}
            onClick={() => call("limit", { limitCents: Math.round(Number(newLimit.replace(",", ".")) * 100) })}
            className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      )}
    </div>
  );
}
