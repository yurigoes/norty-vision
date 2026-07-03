"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Supplier { id: string; name: string; type: string }
interface Item { sourceType: "lens_lab" | "lens_doctor" | "manual"; sourceId?: string | null; description: string; amountCents: number }
interface Settlement {
  id: string; supplierId: string; status: string; totalCents: string;
  periodStart: string | null; periodEnd: string | null;
  paymentMethod: string | null; paidAt: string | null;
  items: Array<{ description: string; amountCents: string }>;
}
interface Profit {
  rows: any[];
  totals: { revenueCents: number; labCostCents: number; doctorPayoutCents: number; profitCents: number };
}

function brl(c: number | string): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PayoutsClient({ suppliers, settlements, profit }: {
  suppliers: Supplier[]; settlements: Settlement[]; profit: Profit;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"novo" | "fechamentos" | "lucro">("novo");
  const supName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "—";

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-line">
        <Tab active={tab === "novo"} onClick={() => setTab("novo")}>Novo fechamento</Tab>
        <Tab active={tab === "fechamentos"} onClick={() => setTab("fechamentos")}>Fechamentos</Tab>
        <Tab active={tab === "lucro"} onClick={() => setTab("lucro")}>Lucro real</Tab>
      </div>

      {tab === "novo" && <NewSettlement suppliers={suppliers} onSaved={() => { setTab("fechamentos"); router.refresh(); }} />}

      {tab === "fechamentos" && (
        <SettlementsList settlements={settlements} supName={supName} onChanged={() => router.refresh()} />
      )}

      {tab === "lucro" && <ProfitView profit={profit} />}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>
      {children}
    </button>
  );
}

function NewSettlement({ suppliers, onSaved }: { suppliers: Supplier[]; onSaved: () => void }) {
  const [supplierId, setSupplierId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [manualDesc, setManualDesc] = useState("");
  const [manualVal, setManualVal] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function loadPending(id: string) {
    setSupplierId(id); setItems([]); setPicked(new Set()); setLoaded(false); setErr(null);
    if (!id) return;
    const res = await fetch(`/api/payouts/pending/${id}`, { credentials: "include" });
    const data = await res.json();
    if (res.ok) {
      const its: Item[] = data.items ?? [];
      setItems(its);
      setPicked(new Set(its.map((_, i) => i)));
      setLoaded(true);
    } else setErr(data?.error?.message ?? "Falha");
  }

  function addManual() {
    const v = Number(manualVal.replace(",", "."));
    if (!manualDesc.trim() || isNaN(v)) return;
    setItems((it) => {
      const next = [...it, { sourceType: "manual" as const, description: manualDesc.trim(), amountCents: Math.round(v * 100) }];
      setPicked((p) => new Set([...p, next.length - 1]));
      return next;
    });
    setManualDesc(""); setManualVal("");
  }

  const chosen = items.filter((_, i) => picked.has(i));
  const total = chosen.reduce((s, i) => s + i.amountCents, 0);

  async function save() {
    setBusy(true); setErr(null);
    try {
      if (chosen.length === 0) throw new Error("Selecione ao menos um item");
      const res = await fetch("/api/payouts/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplierId,
          periodStart: periodStart || null,
          periodEnd: periodEnd || null,
          items: chosen,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao criar");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Fornecedor</span>
          <select value={supplierId} onChange={(e) => loadPending(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
            <option value="">— selecione —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.type === "laboratorio" ? "lab" : s.type})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Período (início)</span>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Período (fim)</span>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
        </label>
      </div>

      {loaded && (
        <div className="rounded-lg border border-line bg-bg/60 p-4">
          <p className="mb-2 text-xs uppercase text-muted">Itens pendentes</p>
          {items.length === 0 ? (
            <p className="text-sm text-muted">Nada pendente para esse fornecedor.</p>
          ) : (
            <div className="space-y-1">
              {items.map((it, i) => (
                <label key={i} className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-line/40">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })} className="accent-brand" />
                    {it.description}{it.sourceType === "manual" && <span className="text-[10px] text-muted"> (manual)</span>}
                  </span>
                  <span>{brl(it.amountCents)}</span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line/50 pt-3">
            <input value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder="Item manual (ex.: exame 12/05)" className="flex-1 rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            <input value={manualVal} onChange={(e) => setManualVal(e.target.value)} placeholder="R$" inputMode="decimal" className="w-24 rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            <button onClick={addManual} className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand">+ adicionar</button>
          </div>

          <p className="mt-3 flex items-center justify-between text-lg font-semibold">
            <span>Total</span><span>{brl(total)}</span>
          </p>
          {err && <p className="text-xs text-red-300">{err}</p>}
          <button onClick={save} disabled={busy || chosen.length === 0} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
            {busy ? "Criando..." : "Criar fechamento"}
          </button>
        </div>
      )}
      {err && !loaded && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}

function SettlementsList({ settlements, supName, onChanged }: {
  settlements: Settlement[]; supName: (id: string) => string; onChanged: () => void;
}) {
  const [payId, setPayId] = useState<string | null>(null);
  const [method, setMethod] = useState("pix");
  const [pid, setPid] = useState("");
  const [proof, setProof] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadProof(file: File) {
    setUploading(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purpose", "comprovante-repasse");
      const res = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no upload");
      setProof(data.url);
    } catch (e: any) { setErr(e.message); } finally { setUploading(false); }
  }

  async function pay(id: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/payouts/settlements/${id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ paymentMethod: method, paymentId: pid || null, proofUrl: proof || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setPayId(null); setPid(""); setProof(""); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (settlements.length === 0) return <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum fechamento.</p>;
  return (
    <div className="space-y-2">
      {err && <p className="text-xs text-red-300">{err}</p>}
      {settlements.map((s) => (
        <div key={s.id} className="rounded-lg border border-line bg-bg/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {supName(s.supplierId)} · {brl(s.totalCents)}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${s.status === "paid" ? "bg-green-500/20 text-green-300" : "bg-orange-500/20 text-orange-300"}`}>
                  {s.status === "paid" ? "pago" : "pendente"}
                </span>
              </p>
              <p className="text-xs text-muted">{s.items.length} item(ns){s.paymentMethod ? ` · ${s.paymentMethod}` : ""}</p>
            </div>
            <div className="flex gap-2">
              <a href={`/api/payouts/settlements/${s.id}/receipt`} target="_blank" rel="noreferrer" className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand">Recibo</a>
              {s.status !== "paid" && (
                <button onClick={() => setPayId(payId === s.id ? null : s.id)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white">
                  {payId === s.id ? "Fechar" : "Registrar pagamento"}
                </button>
              )}
            </div>
          </div>
          {payId === s.id && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line/50 pt-3">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase text-muted">Forma</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                  <option value="pix">Pix</option><option value="transferencia">Transferência</option>
                  <option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option>
                </select>
              </label>
              <input value={pid} onChange={(e) => setPid(e.target.value)} placeholder="ID do pagamento" className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
              <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs transition hover:border-brand">
                {uploading ? "Enviando..." : proof ? "✓ comprovante" : "+ comprovante"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(f); e.currentTarget.value = ""; }}
                />
              </label>
              {proof && <a href={proof} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">ver</a>}
              <button onClick={() => pay(s.id)} disabled={busy || uploading} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "..." : "Confirmar pago"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProfitView({ profit }: { profit: Profit }) {
  const t = profit.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card label="Faturamento" value={brl(t.revenueCents)} />
        <Card label="Custo lab" value={brl(t.labCostCents)} />
        <Card label="Repasse médico" value={brl(t.doctorPayoutCents)} />
        <Card label="Lucro real" value={brl(t.profitCents)} highlight />
      </div>
      <p className="text-xs text-muted">Baseado nos pedidos de lente (faturado − custo da lente − repasse do médico).</p>
    </div>
  );
}

function Card({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-brand/50 bg-brand/10" : "border-line bg-bg/60"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${highlight ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}
