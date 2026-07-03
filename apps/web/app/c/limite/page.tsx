"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Application {
  id: string;
  status: string;
  requestedLimitCents: string | number;
  approvedLimitCents: string | number | null;
  createdAt: string;
  reviewedAt: string | null;
}

function brl(c: string | number | null): string {
  return (Number(c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
const APP_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Em análise", cls: "bg-orange-500/20 text-orange-600 dark:text-orange-300" },
  approved: { label: "Aprovado", cls: "bg-green-500/20 text-green-600 dark:text-green-300" },
  rejected: { label: "Recusado", cls: "bg-red-500/20 text-red-600 dark:text-red-300" },
};

const DOCS = [
  { type: "id_front", label: "Identidade (frente)" },
  { type: "id_back", label: "Identidade (verso)" },
  { type: "proof_residence", label: "Comprovante de residência" },
  { type: "income_proof", label: "Comprovante de renda" },
  { type: "selfie_holding_id", label: "Selfie segurando a identidade" },
] as const;

export default function PortalLimite() {
  const router = useRouter();
  const [income, setIncome] = useState("");
  const [requested, setRequested] = useState("");
  const [uploads, setUploads] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [apps, setApps] = useState<Application[]>([]);
  const [hasPending, setHasPending] = useState(false);
  const [loadingApps, setLoadingApps] = useState(true);
  const [hasAccount, setHasAccount] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    fetch("/api/portal/credit-applications", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setApps(d.items ?? []); setHasPending(!!d.hasPending); } })
      .finally(() => setLoadingApps(false));
    fetch("/api/portal/me", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.account) setHasAccount(true); });
  }, [done]);

  // cliente que JÁ tem conta: pede só aumento (sem refazer KYC)
  async function submitIncrease() {
    setSubmitting(true); setError(null);
    const res = await fetch("/api/portal/limit-request", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        requestedLimitCents: Math.round(Number(requested.replace(",", ".")) * 100),
        reason: reason.trim() || null,
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
    setDone(true);
  }

  async function upload(docType: string, file: File) {
    setUploading(docType); setError(null);
    const fd = new FormData();
    fd.append("file", file);
    // documentos KYC vão pro bucket privado (servidos só autenticado)
    const res = await fetch("/api/portal/upload?private=1", { method: "POST", body: fd, credentials: "include" });
    const data = await res.json();
    setUploading(null);
    if (res.ok) setUploads((u) => ({ ...u, [docType]: data.url }));
    else setError(data?.error?.message ?? "Falha no upload");
  }

  const allUploaded = DOCS.every((d) => uploads[d.type]);

  async function submit() {
    setSubmitting(true); setError(null);
    const res = await fetch("/api/portal/credit-application", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        incomeCents: Math.round(Number(income.replace(",", ".")) * 100),
        requestedLimitCents: Math.round(Number(requested.replace(",", ".")) * 100),
        documents: DOCS.map((d) => ({ docType: d.type, fileUrl: uploads[d.type] })).filter((x) => x.fileUrl),
      }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
    setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="rounded-2xl border border-success/40 bg-success/10 p-8 shadow-sm">
          <h1 className="text-2xl font-extrabold tracking-tight text-success">✓ Pedido enviado</h1>
          <p className="mt-2 text-sm text-muted">
            Recebemos seus dados e documentos. A loja vai analisar e você será
            avisado pelo WhatsApp. Normalmente leva pouco tempo.
          </p>
          <Link href="/c" className="btn-grad mt-6 inline-block px-6 py-2.5">
            Voltar ao painel
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/c" className="text-sm font-medium text-brand hover:underline">← voltar</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Pedir limite de crediário</h1>
      <p className="mt-2 text-sm text-muted">
        Para liberar ou aumentar seu crediário, precisamos validar seus dados.
        Tudo é analisado pela loja. Seus documentos ficam protegidos.
      </p>

      {/* linha do tempo das solicitações */}
      {!loadingApps && apps.length > 0 && (
        <div className="card mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Suas solicitações</h2>
          <ol className="space-y-2">
            {apps.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2 last:border-0 last:pb-0">
                <div className="text-sm">
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${APP_STATUS[a.status]?.cls ?? "bg-line text-muted"}`}>
                    {APP_STATUS[a.status]?.label ?? a.status}
                  </span>
                  Pedido de {brl(a.requestedLimitCents)}
                  {a.status === "approved" && a.approvedLimitCents != null && (
                    <span className="text-green-600 dark:text-green-300"> · aprovado {brl(a.approvedLimitCents)}</span>
                  )}
                </div>
                <span className="text-xs text-muted">
                  {new Date(a.createdAt).toLocaleDateString("pt-BR")}
                  {a.reviewedAt ? ` → ${new Date(a.reviewedAt).toLocaleDateString("pt-BR")}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* trava: já existe pedido em análise */}
      {hasPending && (
        <div className="mt-6 rounded-2xl border border-warn/40 bg-warn/10 p-6 text-sm shadow-sm">
          <p className="font-semibold text-warn">Você já tem um pedido em análise</p>
          <p className="mt-1 text-muted">
            Aguarde a resposta da loja. Você poderá fazer um novo pedido quando este for aprovado ou recusado.
          </p>
        </div>
      )}

      {/* cliente que JÁ tem conta: pede só aumento (sem refazer KYC) */}
      {!hasPending && hasAccount && (
        <div className="card mt-6 space-y-4">
          <p className="text-sm text-muted">Você já tem conta de crediário. Para pedir um aumento, informe o valor desejado:</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">Limite desejado (R$)</span>
              <input value={requested} onChange={(e) => setRequested(e.target.value)} className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">Motivo (opcional)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="input-base" />
            </label>
          </div>
          {error && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p>}
          <button onClick={submitIncrease} disabled={submitting || !requested} className="btn-grad w-full py-3">
            {submitting ? "Enviando..." : "Pedir aumento de limite"}
          </button>
        </div>
      )}

      {/* cliente NOVO (sem conta): KYC completo */}
      {!hasPending && !hasAccount && (
      <>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">Renda mensal (R$)</span>
          <input value={income} onChange={(e) => setIncome(e.target.value)} className="input-base" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">Limite desejado (R$)</span>
          <input value={requested} onChange={(e) => setRequested(e.target.value)} className="input-base" />
        </label>
      </div>

      <div className="mt-6 space-y-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Documentos</h2>
        {DOCS.map((d) => (
          <div key={d.type} className="flex items-center justify-between rounded-xl border border-line bg-surface p-3 shadow-sm">
            <span className="text-sm">{d.label}</span>
            {uploads[d.type] ? (
              <span className="text-xs font-medium text-success">✓ enviado</span>
            ) : (
              <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand/50 hover:text-brand">
                {uploading === d.type ? "enviando..." : "enviar"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture={d.type === "selfie_holding_id" ? "user" : undefined}
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && upload(d.type, e.target.files[0])}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting || !allUploaded || !income || !requested}
        className="btn-grad mt-6 w-full py-3"
      >
        {submitting ? "Enviando..." : "Enviar pedido"}
      </button>
      {!allUploaded && <p className="mt-2 text-center text-xs text-muted">Envie todos os documentos para continuar.</p>}
      </>
      )}
    </main>
  );
}
