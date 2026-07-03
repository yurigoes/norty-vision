"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface IpIntegration {
  id: string;
  status: string;
  config: { handle?: string } | null;
  lastPingAt: string | null;
  lastPingStatus: string | null;
}

export function InfinitepayConfigClient({ initial }: { initial: IpIntegration | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    const handle = String(fd.get("handle") ?? "").trim().replace(/^\$/, "");
    const payload = {
      status: fd.get("status") === "on" ? "active" : "disabled",
      config: { handle },
    };
    const res = await fetch("/api/org-integrations/infinitepay", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  async function test() {
    setTestResult("testando...");
    const res = await fetch("/api/org-integrations/infinitepay/test", { method: "POST", credentials: "include" });
    const data = await res.json();
    setTestResult(data.ok ? `✓ Handle ok (${data.account})` : `✗ ${data.error ?? data.status}`);
  }

  return (
    <form onSubmit={save} className="card space-y-5 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">InfinitePay (link de pagamento)</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
          initial?.status === "active" ? "bg-green-500/20 text-green-300" : "bg-line text-muted"
        }`}>
          {initial?.status ?? "não configurado"}
        </span>
      </div>

      <p className="text-sm text-muted">
        Gera um <strong>link de checkout</strong> (Pix ou cartão em até 12x) enviado ao cliente por
        WhatsApp e e-mail. Usado em vendas por callcenter, pela IA e no portal do cliente. Para QR Pix
        embutido em PDF continua valendo o Mercado Pago.
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Handle (InfiniteTag)
        </span>
        <input
          name="handle"
          defaultValue={initial?.config?.handle ?? ""}
          placeholder="seu-handle (sem o $)"
          className="input-base"
        />
        <p className="mt-1 text-[11px] text-muted">
          É o seu nome de usuário no app InfinitePay. Use sem o símbolo <code>$</code> do início.
          O webhook de confirmação é configurado automaticamente em cada link.
        </p>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="status" defaultChecked={initial?.status === "active"} className="h-4 w-4" />
        Ativo (habilita a opção InfinitePay nas cobranças)
      </label>

      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
      {saved && <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">Salvo.</p>}

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={test} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand">
          Validar handle
        </button>
        {testResult && <span className="text-xs text-muted">{testResult}</span>}
        <button type="submit" disabled={isPending} className="btn-grad ml-auto disabled:opacity-50">
          Salvar
        </button>
      </div>
    </form>
  );
}
