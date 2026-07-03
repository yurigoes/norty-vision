"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface MpIntegration {
  id: string;
  status: string;
  hasToken: boolean;
  hasWebhookSecret: boolean;
  publicKey: string | null;
  lastPingAt: string | null;
  lastPingStatus: string | null;
}

export function PaymentsConfigClient({
  initial,
  orgId,
}: {
  initial: MpIntegration | null;
  orgId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const webhookUrl = `https://yugochat.com.br/api/payments/webhooks/mercadopago/${orgId}`;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      status: fd.get("status") === "on" ? "active" : "disabled",
      publicKey: String(fd.get("publicKey") ?? "").trim() || null,
    };
    const token = String(fd.get("accessToken") ?? "").trim();
    if (token) payload.accessToken = token;
    const secret = String(fd.get("webhookSecret") ?? "").trim();
    if (secret) payload.webhookSecret = secret;

    const res = await fetch("/api/org-integrations/mercadopago", {
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
    const res = await fetch("/api/org-integrations/mercadopago/test", {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json();
    setTestResult(
      data.ok
        ? `✓ Conectado${data.account ? ` (${data.account})` : ""}`
        : `✗ Falhou: ${data.error ?? data.status}`,
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="card space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Credenciais</h2>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
            initial?.status === "active" ? "bg-green-500/20 text-green-300" : "bg-line text-muted"
          }`}>
            {initial?.status ?? "não configurado"}
          </span>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Access Token (Production){initial?.hasToken && <span className="ml-2 text-green-300">✓ configurado</span>}
          </span>
          <input
            name="accessToken"
            type="password"
            placeholder={initial?.hasToken ? "•••••• (deixe vazio pra manter)" : "APP_USR-..."}
            className="input-base"
          />
          <p className="mt-1 text-[11px] text-muted">
            Em mercadopago.com.br/developers → sua aplicação → Credenciais de
            produção → Access Token.
          </p>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Public Key (opcional)
          </span>
          <input
            name="publicKey"
            defaultValue={initial?.publicKey ?? ""}
            placeholder="APP_USR-xxxx"
            className="input-base"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="status" defaultChecked={initial?.status === "active"} className="h-4 w-4" />
          Ativo (habilita cobranças)
        </label>

        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        {saved && <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">Salvo.</p>}

        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={test} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand">
            Testar conexão
          </button>
          {testResult && <span className="text-xs text-muted">{testResult}</span>}
          <button type="submit" disabled={isPending} className="btn-grad ml-auto disabled:opacity-50">
            Salvar
          </button>
        </div>
      </form>

      <form onSubmit={save} className="card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Webhook</h3>
        <p className="mt-2 text-sm text-muted">
          1) Cole esta URL no painel do Mercado Pago em <strong>Sua aplicação →
          Webhooks → Produção</strong>, eventos <code className="font-mono text-xs">payment</code>:
        </p>
        <code className="mt-3 block break-all rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs">
          {webhookUrl}
        </code>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            2) Assinatura secreta (do mesmo painel)
            {initial?.hasWebhookSecret && <span className="ml-2 text-green-300">✓ configurada</span>}
          </span>
          <input
            name="webhookSecret"
            type="password"
            placeholder={initial?.hasWebhookSecret ? "•••••• (deixe vazio pra manter)" : "cole a chave secreta do webhook"}
            className="input-base"
          />
          <p className="mt-1 text-[11px] text-muted">
            Usada pra validar que a notificação veio mesmo do Mercado Pago.
            Sem ela, aceitamos o webhook sem validação de assinatura.
          </p>
        </label>
        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={isPending} className="btn-grad disabled:opacity-50">
            Salvar webhook
          </button>
        </div>
      </form>
    </div>
  );
}
