"use client";

// Painel admin de costureiras (gráfica). 3 abas:
//  - Lista: cards das costureiras com botão "ver relatório"
//  - Relatório: período + totais + lista de OSs (pago/pendente)
//  - Atribuir: lista de OSs SEM costureira atribuída + dropdown pra atribuir.

import { useEffect, useMemo, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

function brl(c: number | string | null | undefined): string {
  if (c == null) return "—";
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

interface Supplier {
  id: string;
  type: string;
  name: string;
  phone: string | null;
  status: string;
  pricePerPieceCents: string | null;
}
interface ReportItem {
  id: string;
  shortCode: string | null;
  contactName: string;
  producedAt: string;
  pieces: number;
  valueCents: number;
  paid: boolean;
}
interface PendingItem {
  id: string;
  shortCode: string | null;
  contactName: string;
  producedAt: string;
  valueCents: number;
}

export function CostureirasClient() {
  const dialog = useDialog();
  const [tab, setTab] = useState<"lista" | "atribuir">("lista");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [unassigned, setUnassigned] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/suppliers?type=costureira", { credentials: "include" })
      .then((r) => r.json()).then((d) => setSuppliers(d?.items ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab !== "atribuir") return;
    fetch("/api/production", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const active = ["novo", "arte", "producao", "costura"];
        setUnassigned((d?.items ?? []).filter((o: any) => !o.assignedSupplierId && active.includes(o.status)));
      })
      .catch(() => setUnassigned([]));
  }, [tab]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-line">
        <Tab active={tab === "lista"} onClick={() => setTab("lista")}>Costureiras</Tab>
        <Tab active={tab === "atribuir"} onClick={() => setTab("atribuir")}>Atribuir OSs sem costureira</Tab>
      </div>

      {selected ? (
        <SupplierDetailPanel supplier={selected} onBack={() => setSelected(null)} />
      ) : tab === "lista" ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {suppliers.length === 0
            ? <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhuma costureira cadastrada. Cadastre uma em <a href="/app/fornecedores" className="text-brand hover:underline">Fornecedores</a> selecionando tipo "Costureira".</p>
            : suppliers.map((s) => (
                <button key={s.id} onClick={() => setSelected(s)} className="card p-4 text-left">
                  <p className="text-base font-semibold">{s.name}</p>
                  <p className="text-xs text-muted">{s.phone ?? "sem telefone"}</p>
                  <p className="mt-2 text-xs">Valor por peça: <b>{brl(s.pricePerPieceCents)}</b></p>
                  {s.status !== "active" && <span className="mt-2 inline-block rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] uppercase text-red-300">inativa</span>}
                </button>
              ))}
        </section>
      ) : (
        <UnassignedPanel
          suppliers={suppliers}
          orders={unassigned}
          onAssigned={() => fetch("/api/production?status=novo,arte,costura,producao", { credentials: "include" }).then((r) => r.json()).then((d) => setUnassigned((d?.items ?? []).filter((o: any) => !o.assignedSupplierId))).catch(() => undefined)}
          toast={(m, t) => dialog.toast(m, t)}
        />
      )}
    </div>
  );
}

function SupplierDetailPanel({ supplier, onBack }: { supplier: Supplier; onBack: () => void }) {
  const dialog = useDialog();
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 86400_000);
  const [from, setFrom] = useState(isoDate(monthAgo));
  const [to, setTo] = useState(isoDate(today));
  const [report, setReport] = useState<{ items: ReportItem[]; totals: any } | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/production/by-supplier/${supplier.id}/report?from=${from}&to=${to}`, { credentials: "include" })
      .then((r) => r.json()).then((d) => setReport(d)).catch(() => undefined);
    fetch(`/api/production/by-supplier/${supplier.id}/pending`, { credentials: "include" })
      .then((r) => r.json()).then((d) => setPending(d?.items ?? []))
      .catch(() => setPending([]));
  }, [supplier.id, from, to]);

  const totalSel = useMemo(() => pending.filter((p) => selectedPending.has(p.id)).reduce((s, p) => s + p.valueCents, 0), [pending, selectedPending]);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-xs text-muted hover:text-fg">← Voltar</button>
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{supplier.name}</h2>
          <p className="text-xs text-muted">{supplier.phone ?? "sem telefone"} · valor por peça {brl(supplier.pricePerPieceCents)}</p>
        </div>
      </header>

      {/* Relatório do período */}
      <section className="card">
        <div className="flex flex-wrap items-end gap-3">
          <h3 className="mr-auto text-sm font-semibold uppercase tracking-wider text-muted">Relatório</h3>
          <button onClick={() => { const t = new Date(); setTo(isoDate(t)); setFrom(isoDate(new Date(t.getTime() - 7 * 86400_000))); }} className="rounded-full border border-line px-3 py-1 text-xs transition hover:border-brand/60 hover:text-brand">7d</button>
          <button onClick={() => { const t = new Date(); setTo(isoDate(t)); setFrom(isoDate(new Date(t.getTime() - 30 * 86400_000))); }} className="rounded-full border border-line px-3 py-1 text-xs transition hover:border-brand/60 hover:text-brand">30d</button>
          <label className="flex flex-col text-[10px] uppercase text-muted">de
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base" />
          </label>
          <label className="flex flex-col text-[10px] uppercase text-muted">até
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base" />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="OSs" value={String(report?.totals?.orders ?? 0)} />
          <Stat label="Peças" value={String(report?.totals?.pieces ?? 0)} />
          <Stat label="A pagar" value={brl(report?.totals?.pendingCents ?? 0)} tone="amber" />
          <Stat label="Já pago" value={brl(report?.totals?.paidCents ?? 0)} tone="green" />
        </div>
        <div className="mt-3 space-y-1">
          {(report?.items ?? []).map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs">
              <span>#{o.shortCode ?? "—"} · {o.contactName} · {o.pieces}pç</span>
              <span className="flex items-center gap-2">{brl(o.valueCents)}{o.paid ? <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[9px] text-green-300">pago</span> : <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">pend.</span>}</span>
            </div>
          ))}
          {report && report.items.length === 0 && <p className="text-xs text-muted">Nenhuma OS produzida no período.</p>}
        </div>
      </section>

      {/* OSs pendentes de pagamento */}
      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Pendente de pagamento</h3>
          {selectedPending.size > 0 && (
            <button onClick={() => setPayOpen(true)} className="btn-grad px-3 py-1.5 text-xs">
              Pagar {selectedPending.size} OS · {brl(totalSel)}
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="text-xs text-muted">Nada pendente. ✓</p>
        ) : (
          <div className="space-y-1">
            {pending.map((p) => (
              <label key={p.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs transition hover:border-brand">
                <input
                  type="checkbox"
                  checked={selectedPending.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(selectedPending);
                    if (e.target.checked) next.add(p.id); else next.delete(p.id);
                    setSelectedPending(next);
                  }}
                />
                <span className="flex-1">#{p.shortCode ?? "—"} · {p.contactName} · {new Date(p.producedAt).toLocaleDateString("pt-BR")}</span>
                <b>{brl(p.valueCents)}</b>
              </label>
            ))}
            <label className="mt-2 flex items-center gap-1 text-[11px] text-muted">
              <input type="checkbox" checked={selectedPending.size === pending.length} onChange={(e) => setSelectedPending(e.target.checked ? new Set(pending.map((p) => p.id)) : new Set())} />
              selecionar todas
            </label>
          </div>
        )}
      </section>

      {payOpen && (
        <PayoutModal
          supplierId={supplier.id}
          items={pending.filter((p) => selectedPending.has(p.id))}
          onClose={() => setPayOpen(false)}
          onPaid={() => {
            setPayOpen(false);
            setSelectedPending(new Set());
            // re-fetch
            fetch(`/api/production/by-supplier/${supplier.id}/pending`, { credentials: "include" })
              .then((r) => r.json()).then((d) => setPending(d?.items ?? []));
            fetch(`/api/production/by-supplier/${supplier.id}/report?from=${from}&to=${to}`, { credentials: "include" })
              .then((r) => r.json()).then((d) => setReport(d));
            dialog.toast("Pagamento registrado ✅", "success");
          }}
        />
      )}
    </div>
  );
}

function PayoutModal({ supplierId, items, onClose, onPaid }: { supplierId: string; items: PendingItem[]; onClose: () => void; onPaid: () => void }) {
  const [method, setMethod] = useState("pix");
  const [proofUrl, setProofUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = items.reduce((s, p) => s + p.valueCents, 0);

  async function pay() {
    setBusy(true); setErr(null);
    try {
      // 1) Cria settlement com items production_order
      const r1 = await fetch("/api/payouts/settlements", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          supplierId,
          items: items.map((p) => ({
            sourceType: "production_order",
            sourceId: p.id,
            description: `OS #${p.shortCode ?? p.id.slice(0, 8)} — ${p.contactName}`,
            amountCents: p.valueCents,
          })),
        }),
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1?.error?.message ?? "Falha ao criar fechamento");
      const settlementId = d1.settlement?.id;
      if (!settlementId) throw new Error("Resposta sem settlement");

      // 2) Marca como pago (com URL do comprovante se informada)
      const r2 = await fetch(`/api/payouts/settlements/${settlementId}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ paymentMethod: method, proofUrl: proofUrl.trim() || null }),
      });
      if (!r2.ok) { const d2 = await r2.json(); throw new Error(d2?.error?.message ?? "Falha ao confirmar pagamento"); }
      onPaid();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h3 className="text-base font-semibold">Pagar costureira</h3>
        <p className="mt-1 text-xs text-muted">{items.length} OS · Total <b className="text-fg">{brl(total)}</b></p>

        <label className="mt-4 block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Forma de pagamento</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-base">
            <option value="pix">Pix</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="transferencia">Transferência</option>
            <option value="cartao">Cartão</option>
            <option value="outro">Outro</option>
          </select>
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Link do comprovante (opcional)</span>
          <input
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            placeholder="cole a URL do comprovante (drive, foto, etc)"
            className="input-base"
          />
          <p className="mt-1 text-[10px] text-muted">A costureira vê esse link no portal /f/pagamentos. Você pode pôr depois também.</p>
        </label>

        {err && <p className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 rounded-xl border border-line py-2 text-sm text-muted transition hover:text-fg">Cancelar</button>
          <button onClick={pay} disabled={busy} className="btn-grad flex-1 disabled:opacity-50">{busy ? "Pagando…" : "Confirmar pagamento"}</button>
        </div>
      </div>
    </div>
  );
}

function UnassignedPanel({ suppliers, orders, onAssigned, toast }: { suppliers: Supplier[]; orders: any[]; onAssigned: () => void; toast: (m: string, t: "success" | "error") => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function assign(orderId: string, supplierId: string) {
    setBusy(orderId);
    try {
      const r = await fetch(`/api/production/${orderId}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ supplierId }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d?.error?.message ?? "Falha"); }
      toast("Atribuída ✅", "success");
      onAssigned();
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(null); }
  }
  if (orders.length === 0) return <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhuma OS sem costureira no momento.</p>;
  return (
    <section className="space-y-2">
      {orders.map((o) => (
        <div key={o.id} className="card flex flex-wrap items-center gap-3 p-3">
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm font-semibold">#{o.shortCode ?? o.id.slice(0, 8)} — {o.contactName ?? "—"}</p>
            <p className="text-xs text-muted">prazo {o.dueDate ? new Date(o.dueDate).toLocaleDateString("pt-BR") : "—"} · status {o.status}</p>
          </div>
          <select disabled={busy === o.id} onChange={(e) => e.target.value && assign(o.id, e.target.value)} defaultValue="" className="rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">— atribuir a —</option>
            {suppliers.filter((s) => s.status === "active").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ))}
    </section>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{children}</button>;
}
function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" }) {
  const cls = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : "text-fg";
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
