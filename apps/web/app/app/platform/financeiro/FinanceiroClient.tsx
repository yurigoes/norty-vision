"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

function brl(c: number | string): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function competenceLabel(c: string): string {
  const [y, m] = c.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const mi = Math.max(1, Math.min(12, parseInt(m ?? "1", 10))) - 1;
  return `${months[mi]}/${y}`;
}
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Em aberto", cls: "bg-amber-500/15 text-amber-300" },
  paid: { label: "Paga", cls: "bg-green-500/15 text-green-300" },
  canceled: { label: "Cancelada", cls: "bg-line text-muted" },
};

export function FinanceiroClient() {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  // form nova mensalidade
  const [orgId, setOrgId] = useState("");
  const [competence, setCompetence] = useState(() => new Date().toISOString().slice(0, 7));
  const [valor, setValor] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [markPaid, setMarkPaid] = useState(false);

  const load = () => {
    fetch("/api/subscription-invoices/admin", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  };
  useEffect(() => {
    load();
    fetch("/api/organizations", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => setOrgs(d?.items ?? [])).catch(() => {});
  }, []);

  async function create() {
    const cents = Math.round(Number(valor.replace(/\./g, "").replace(",", ".")) * 100) || 0;
    if (!orgId || !/^\d{4}-\d{2}$/.test(competence) || cents <= 0) { dialog.toast("Preencha empresa, competência e valor", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/subscription-invoices", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ organizationId: orgId, competence, amountCents: cents, dueDate: dueDate || null, status: markPaid ? "paid" : "pending" }),
      });
      if (!res.ok) { dialog.toast("Falha ao lançar", "error"); return; }
      dialog.toast("Mensalidade lançada ✅", "success"); setValor(""); setDueDate(""); setMarkPaid(false); load();
    } finally { setBusy(false); }
  }
  async function generateMonth() {
    setBusy(true);
    try {
      const res = await fetch("/api/subscription-invoices/generate", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
      const d = await res.json().catch(() => null);
      dialog.toast(res.ok ? `Mensalidades geradas: ${d?.created ?? 0}` : "Falha ao gerar", res.ok ? "success" : "error"); load();
    } finally { setBusy(false); }
  }
  async function runDunning() {
    setBusy(true);
    try {
      const res = await fetch("/api/subscription-invoices/run-dunning", { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      dialog.toast(res.ok ? `Avisos: ${d?.notified ?? 0} · suspensas: ${d?.suspended ?? 0}` : "Falha", res.ok ? "success" : "error"); load();
    } finally { setBusy(false); }
  }
  async function pay(id: string) {
    const method = await dialog.prompt({ title: "Marcar como paga", message: "Meio de pagamento (opcional)", placeholder: "Pix, cartão…" });
    if (method === null) return;
    await fetch(`/api/subscription-invoices/${id}/paid`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ paymentMethod: method || null }) });
    load();
  }
  async function uploadNf(id: string, file: File) {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/subscription-invoices/${id}/nf`, { method: "POST", body: fd, credentials: "include" });
    if (!res.ok) { dialog.toast("Falha no upload da NF", "error"); return; }
    dialog.toast("NF anexada ✅", "success"); load();
  }
  async function remove(id: string) {
    const ok = await dialog.confirm({ title: "Excluir mensalidade", message: "Confirma a exclusão?" });
    if (!ok) return;
    await fetch(`/api/subscription-invoices/${id}`, { method: "DELETE", credentials: "include" }); load();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-bg/60 p-4">
        <h2 className="text-sm font-semibold">Lançar mensalidade</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="rounded border border-line bg-bg/40 px-2 py-1.5 text-sm lg:col-span-2">
            <option value="">Empresa…</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className="rounded border border-line bg-bg/40 px-2 py-1.5 text-sm" />
          <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Valor (R$)" className="rounded border border-line bg-bg/40 px-2 py-1.5 text-sm" />
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="rounded border border-line bg-bg/40 px-2 py-1.5 text-sm" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={markPaid} onChange={(e) => setMarkPaid(e.target.checked)} /> já paga</label>
          <button disabled={busy} onClick={create} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "..." : "Lançar"}</button>
          <span className="text-line">·</span>
          <button disabled={busy} onClick={generateMonth} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-brand disabled:opacity-50">Gerar mensalidades do mês</button>
          <button disabled={busy} onClick={runDunning} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-brand disabled:opacity-50">Rodar cobrança agora</button>
        </div>
        <p className="mt-2 text-[11px] text-muted">A geração mensal e a régua de cobrança também rodam sozinhas (automático). Os botões são pra disparar na hora.</p>
      </section>

      {items === null ? <p className="text-sm text-muted">Carregando…</p> : items.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-muted">Nenhuma mensalidade lançada.</p>
      ) : (
        <div className="space-y-2">
          {items.map((inv) => {
            const st = STATUS[inv.status] ?? { label: inv.status, cls: "bg-line text-muted" };
            return (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4">
                <div>
                  <p className="font-medium">{inv.organization?.name ?? "—"} <span className="ml-1 text-xs text-muted">{competenceLabel(inv.competence)}</span></p>
                  <p className="text-xs text-muted">{brl(inv.amountCents)}{inv.paidAt ? ` · paga em ${new Date(inv.paidAt).toLocaleDateString("pt-BR")}` : ""}{inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${st.cls}`}>{st.label}</span>
                  {inv.status !== "paid" && <button onClick={() => pay(inv.id)} className="rounded-md border border-line px-3 py-1 text-xs text-green-300 hover:border-green-400">Marcar paga</button>}
                  {inv.status === "paid" && <a href={`/api/subscription-invoices/${inv.id}/receipt`} target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-1 text-xs hover:border-brand">Recibo</a>}
                  {inv.nfUrl
                    ? <a href={inv.nfUrl} target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-1 text-xs text-sky-300 hover:border-brand">Ver NF</a>
                    : <label className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs hover:border-brand">Subir NF<input type="file" className="hidden" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadNf(inv.id, f); e.currentTarget.value = ""; }} /></label>}
                  <button onClick={() => remove(inv.id)} className="rounded-md border border-line px-3 py-1 text-xs text-red-300 hover:border-red-400">Excluir</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
