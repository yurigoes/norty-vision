"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";
import { openDocBlob } from "../../../lib/openDoc";

interface Account {
  id: string;
  document: string;
  holderName: string;
  limitCents: string;
  usedCents: string;
  status: string;
  score: number;
  blockedReason: string | null;
}

interface LimitRequest {
  id: string;
  currentLimitCents: string;
  requestedLimitCents: string;
  reason: string | null;
  status: string;
  createdAt: string;
  creditAccount: { id: string; holderName: string; document: string; limitCents: string };
}

function brl(cents: string | number): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface Application {
  id: string;
  incomeCents: string | null;
  requestedLimitCents: string;
  status: string;
  documentIds: string[];
  createdAt: string;
  creditAccount: { id: string; holderName: string; document: string; limitCents: string };
}

export function CreditClient({
  initialAccounts,
  initialRequests,
  initialApplications,
}: {
  initialAccounts: Account[];
  initialRequests: LimitRequest[];
  initialApplications: Application[];
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<"accounts" | "requests" | "applications">("accounts");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docVal, setDocVal] = useState("");
  const [holderVal, setHolderVal] = useState("");
  const [foundMsg, setFoundMsg] = useState<string | null>(null);
  const [docsModal, setDocsModal] = useState<{ appId: string; docs: Array<{ id: string; docType: string; viewUrl: string }> } | null>(null);

  const DOC_LABEL: Record<string, string> = {
    id_front: "Documento (frente)", id_back: "Documento (verso)", proof_residence: "Comprovante de residência",
    income_proof: "Comprovante de renda", selfie_holding_id: "Selfie com documento", other: "Outro",
  };

  async function openDocs(appId: string) {
    try {
      const res = await fetch(`/api/credit/applications/${appId}/docs`, { credentials: "include", cache: "no-store" });
      const d = await res.json();
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao carregar documentos", "error"); return; }
      setDocsModal({ appId, docs: d.documents ?? [] });
    } catch { dialog.toast("Erro ao carregar documentos", "error"); }
  }

  async function lookupCustomer() {
    const d = docVal.replace(/\D/g, "");
    if (d.length < 11) { setFoundMsg(null); return; }
    try {
      const res = await fetch(`/api/customers?q=${d}&limit=5`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      const match = (data.items ?? []).find((c: any) => (c.document ?? "").replace(/\D/g, "") === d);
      if (match) { setHolderVal(match.name); setFoundMsg(`✓ Cliente identificado: ${match.name}`); }
      else setFoundMsg("Cliente não encontrado — a conta será criada com o nome digitado.");
    } catch { /* ignora */ }
  }

  async function reviewApplication(id: string, decision: "approve" | "reject", approvedLimitCents?: number) {
    const res = await fetch(`/api/credit/applications/${id}/${decision}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(approvedLimitCents ? { approvedLimitCents } : {}),
      credentials: "include",
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      document: docVal.trim(),
      holderName: holderVal.trim(),
      limitCents: Math.round(Number(String(fd.get("limit") ?? "0").replace(",", ".")) * 100),
      guarantorName: String(fd.get("guarantorName") ?? "").trim() || null,
      guarantorDocument: String(fd.get("guarantorDocument") ?? "").trim() || null,
      guarantorPhone: String(fd.get("guarantorPhone") ?? "").trim() || null,
    };
    const res = await fetch("/api/credit/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
    setCreating(false); setDocVal(""); setHolderVal(""); setFoundMsg(null);
    startTransition(() => router.refresh());
  }

  async function reviewRequest(id: string, decision: "approve" | "reject") {
    const res = await fetch(`/api/credit/limit-requests/${id}/${decision}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-line">
        <TabBtn active={tab === "accounts"} onClick={() => setTab("accounts")}>
          Contas ({initialAccounts.length})
        </TabBtn>
        <TabBtn active={tab === "requests"} onClick={() => setTab("requests")}>
          Pedidos de limite ({initialRequests.length})
        </TabBtn>
        <TabBtn active={tab === "applications"} onClick={() => setTab("applications")}>
          Aplicações KYC ({initialApplications.length})
        </TabBtn>
      </nav>

      {tab === "accounts" && (
        <>
          {!creating && (
            <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white">
              + Nova conta de crediário
            </button>
          )}
          {creating && (
            <form onSubmit={onCreate} className="space-y-4 rounded-xl border border-line bg-bg/60 p-6">
              <h2 className="text-lg font-semibold">Nova conta</h2>
              <p className="text-xs text-muted">Digite o CPF/CNPJ — se o cliente já existir na base, os dados são puxados automaticamente.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">CPF/CNPJ <span className="text-brand">*</span></span>
                  <input
                    value={docVal}
                    onChange={(e) => setDocVal(e.target.value)}
                    onBlur={lookupCustomer}
                    required
                    className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Nome do titular <span className="text-brand">*</span></span>
                  <input
                    value={holderVal}
                    onChange={(e) => setHolderVal(e.target.value)}
                    required
                    className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                </label>
                <Field name="limit" label="Limite (R$)" required />
              </div>
              {foundMsg && (
                <p className={`text-xs ${foundMsg.startsWith("✓") ? "text-green-600 dark:text-green-300" : "text-muted"}`}>{foundMsg}</p>
              )}
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Avalista (opcional)</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <Field name="guarantorName" label="Nome avalista" />
                  <Field name="guarantorDocument" label="CPF avalista" />
                  <Field name="guarantorPhone" label="Telefone avalista" />
                </div>
              </details>
              {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => { setCreating(false); setError(null); }} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
                <button type="submit" disabled={isPending} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">Criar</button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3">Titular</th>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Limite</th>
                  <th className="px-4 py-3">Usado</th>
                  <th className="px-4 py-3">Disponível</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {initialAccounts.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">Nenhuma conta.</td></tr>
                ) : initialAccounts.map((a) => {
                  const available = Number(a.limitCents) - Number(a.usedCents);
                  return (
                    <tr key={a.id} className="border-t border-line/50">
                      <td className="px-4 py-3 font-medium">{a.holderName}</td>
                      <td className="px-4 py-3 font-mono text-xs">{a.document}</td>
                      <td className="px-4 py-3">{brl(a.limitCents)}</td>
                      <td className="px-4 py-3 text-muted">{brl(a.usedCents)}</td>
                      <td className="px-4 py-3 font-semibold">{brl(available)}</td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3">
                        <Link href={`/app/crediario/${a.id}`} className="text-xs text-brand hover:underline">Abrir →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "requests" && (
        <div className="space-y-3">
          {initialRequests.length === 0 ? (
            <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum pedido pendente.</p>
          ) : initialRequests.map((r) => (
            <div key={r.id} className="rounded-xl border border-line bg-bg/60 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{r.creditAccount.holderName}</p>
                  <p className="font-mono text-xs text-muted">{r.creditAccount.document}</p>
                  <p className="mt-2 text-sm">
                    {brl(r.currentLimitCents)} → <strong>{brl(r.requestedLimitCents)}</strong>
                  </p>
                  {r.reason && <p className="mt-1 text-xs text-muted">"{r.reason}"</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => reviewRequest(r.id, "approve")} className="rounded-md border border-line px-3 py-1.5 text-xs text-green-300 hover:border-green-500">Aprovar</button>
                  <button onClick={() => reviewRequest(r.id, "reject")} className="rounded-md border border-line px-3 py-1.5 text-xs text-red-300 hover:border-red-500">Rejeitar</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "applications" && (
        <div className="space-y-3">
          {initialApplications.length === 0 ? (
            <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">
              Nenhuma aplicação de crédito pendente. Quando um cliente pedir
              limite pelo painel (com documentos), aparece aqui.
            </p>
          ) : initialApplications.map((a) => (
            <div key={a.id} className="rounded-xl border border-line bg-bg/60 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">{a.creditAccount.holderName}</p>
                  <p className="font-mono text-xs text-muted">{a.creditAccount.document}</p>
                  <p className="mt-2 text-sm">
                    Limite atual {brl(a.creditAccount.limitCents)} · pedido{" "}
                    <strong>{brl(a.requestedLimitCents)}</strong>
                  </p>
                  {a.incomeCents && (
                    <p className="text-xs text-muted">Renda informada: {brl(a.incomeCents)}</p>
                  )}
                  <button
                    onClick={() => openDocs(a.id)}
                    className="mt-1 inline-block text-xs text-brand hover:underline"
                  >
                    Ver {a.documentIds?.length ?? 0} documento(s)
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={async () => {
                      const v = await dialog.prompt({ title: "Aprovar limite", message: "Limite a aprovar (R$):", defaultValue: String(Number(a.requestedLimitCents) / 100) });
                      if (v) reviewApplication(a.id, "approve", Math.round(Number(v.replace(",", ".")) * 100));
                    }}
                    className="rounded-md border border-line px-3 py-1.5 text-xs text-green-300 hover:border-green-500"
                  >
                    Aprovar
                  </button>
                  <button onClick={() => reviewApplication(a.id, "reject")} className="rounded-md border border-line px-3 py-1.5 text-xs text-red-300 hover:border-red-500">
                    Rejeitar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {docsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDocsModal(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Documentos enviados</h3>
            <div className="mt-3 space-y-2">
              {docsModal.docs.length === 0 ? (
                <p className="text-sm text-muted">Nenhum documento.</p>
              ) : docsModal.docs.map((d) => (
                <button key={d.id} onClick={() => openDocBlob(d.viewUrl)}
                  className="flex w-full items-center justify-between rounded-lg border border-line bg-bg/40 px-3 py-2 text-left text-sm transition hover:border-brand">
                  <span>{DOC_LABEL[d.docType] ?? d.docType}</span>
                  <span className="text-xs text-brand">abrir ↗</span>
                </button>
              ))}
            </div>
            <button onClick={() => setDocsModal(null)} className="mt-4 w-full rounded-lg border border-line py-2 text-sm text-muted hover:text-fg">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: "bg-green-500/20 text-green-300", label: "ativo" },
    blocked: { cls: "bg-red-500/20 text-red-300", label: "bloqueado" },
    frozen: { cls: "bg-blue-500/20 text-blue-300", label: "congelado" },
    defaulted: { cls: "credit-defaulted-badge text-white", label: "inadimplente" },
  };
  const m = map[status] ?? { cls: "bg-line text-muted", label: status };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${m.cls}`}>{m.label}</span>;
}

function TabBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>
      {children}
    </button>
  );
}

function Field({ name, label, required }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}{required && <span className="text-brand"> *</span>}
      </span>
      <input name={name} required={required} autoComplete="off" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
    </label>
  );
}
