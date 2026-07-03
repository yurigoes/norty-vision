"use client";

import { useCallback, useEffect, useState } from "react";

interface Seller { id: string; name: string; commissionPct: number | null }
interface Row {
  userId: string; name: string; salesCount: number;
  totalCents: number; commissionPct: number; commissionCents: number;
}

function brl(c: number): string {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Preset = "hoje" | "semana" | "quinzena" | "mes" | "trimestre";

function range(p: Preset): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const d = new Date(now);
  if (p === "hoje") { /* mesmo dia */ }
  else if (p === "semana") d.setDate(d.getDate() - 7);
  else if (p === "quinzena") d.setDate(d.getDate() - 15);
  else if (p === "mes") d.setMonth(d.getMonth() - 1);
  else if (p === "trimestre") d.setMonth(d.getMonth() - 3);
  return { start: d.toISOString().slice(0, 10), end };
}

export function ComissoesClient({ sellers: initialSellers }: { sellers: Seller[] }) {
  const [tab, setTab] = useState<"dashboard" | "config" | "pagamentos">("dashboard");
  const [preset, setPreset] = useState<Preset>("mes");
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ count: 0, totalCents: 0, commissionCents: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Preset) => {
    setLoading(true);
    try {
      const { start, end } = range(p);
      const res = await fetch(`/api/sales/dashboard/sellers?start=${start}&end=${end}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (res.ok) { setRows(data.rows ?? []); setTotals(data.totals ?? { count: 0, totalCents: 0, commissionCents: 0 }); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (tab === "dashboard") load(preset); }, [tab, preset, load]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-line">
        <Tab active={tab === "dashboard"} onClick={() => setTab("dashboard")}>Dashboard</Tab>
        <Tab active={tab === "config"} onClick={() => setTab("config")}>Comissões</Tab>
        <Tab active={tab === "pagamentos"} onClick={() => setTab("pagamentos")}>Pagamentos</Tab>
      </div>

      {tab === "dashboard" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {(["hoje", "semana", "quinzena", "mes", "trimestre"] as Preset[]).map((p) => (
              <button key={p} onClick={() => setPreset(p)} className={`rounded-full border px-3 py-1 text-xs transition ${preset === p ? "border-brand bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"}`}>
                {p === "hoje" ? "Hoje" : p === "semana" ? "7 dias" : p === "quinzena" ? "15 dias" : p === "mes" ? "Mês" : "Trimestre"}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card label="Vendas" value={String(totals.count)} />
            <Card label="Faturamento" value={brl(totals.totalCents)} />
            <Card label="Comissão total" value={brl(totals.commissionCents)} highlight />
          </div>

          {loading ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Sem vendas no período.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-3">Vendedor</th>
                    <th className="px-4 py-3">Vendas</th>
                    <th className="px-4 py-3">Faturamento</th>
                    <th className="px-4 py-3">%</th>
                    <th className="px-4 py-3">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.userId} className="border-t border-line/50">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3">{r.salesCount}</td>
                      <td className="px-4 py-3">{brl(r.totalCents)}</td>
                      <td className="px-4 py-3 text-muted">{r.commissionPct}%</td>
                      <td className="px-4 py-3 font-medium text-brand">{brl(r.commissionCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : tab === "config" ? (
        <CommissionConfig sellers={initialSellers} />
      ) : (
        <CommissionPayments sellers={initialSellers} />
      )}
    </div>
  );
}

interface Payout {
  id: string; sellerUserId: string; sellerName: string;
  periodStart: string | null; periodEnd: string | null;
  salesCount: number; baseCents: number; commissionPct: number | null;
  totalCents: number; status: string; paymentMethod: string | null;
}

function CommissionPayments({ sellers }: { sellers: Seller[] }) {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [sellerId, setSellerId] = useState(sellers[0]?.id ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [calc, setCalc] = useState<{ salesCount: number; baseCents: number; commissionPct: number; totalCents: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadPayouts = useCallback(async () => {
    const res = await fetch("/api/commissions/payouts", { credentials: "include", cache: "no-store" });
    const data = await res.json();
    if (res.ok) setPayouts(data.items ?? []);
  }, []);
  useEffect(() => { loadPayouts(); }, [loadPayouts]);

  async function preview() {
    if (!sellerId) return;
    setErr(null); setCalc(null);
    try {
      const res = await fetch(`/api/commissions/pending/${sellerId}?start=${start}&end=${end}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setCalc({ salesCount: data.salesCount, baseCents: data.baseCents, commissionPct: data.commissionPct, totalCents: data.totalCents });
    } catch (e: any) { setErr(e.message); }
  }

  async function createPayout() {
    if (!sellerId || !calc) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/commissions/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sellerUserId: sellerId, periodStart: start, periodEnd: end,
          salesCount: calc.salesCount, baseCents: calc.baseCents,
          commissionPct: calc.commissionPct, totalCents: calc.totalCents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setCalc(null); loadPayouts();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-3 text-sm font-medium">Apurar e pagar comissão</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Vendedor</span>
            <select value={sellerId} onChange={(e) => { setSellerId(e.target.value); setCalc(null); }} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm">
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">De</span>
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setCalc(null); }} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Até</span>
            <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setCalc(null); }} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
          </label>
          <button onClick={preview} className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Apurar</button>
        </div>
        {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
        {calc && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-line/50 pt-3 text-sm">
            <span className="text-muted">{calc.salesCount} venda(s)</span>
            <span>Base: <strong>{brl(calc.baseCents)}</strong></span>
            <span className="text-muted">{calc.commissionPct}%</span>
            <span>Comissão: <strong className="text-brand">{brl(calc.totalCents)}</strong></span>
            <button onClick={createPayout} disabled={busy || calc.totalCents <= 0} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "..." : "Gerar pagamento"}
            </button>
          </div>
        )}
      </div>

      <PayoutsList payouts={payouts} onChanged={loadPayouts} />
    </div>
  );
}

function PayoutsList({ payouts, onChanged }: { payouts: Payout[]; onChanged: () => void }) {
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
      fd.append("purpose", "comprovante-comissao");
      const res = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no upload");
      setProof(data.url);
    } catch (e: any) { setErr(e.message); } finally { setUploading(false); }
  }

  async function pay(id: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/commissions/payouts/${id}/pay`, {
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

  if (payouts.length === 0) return <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum pagamento de comissão.</p>;
  return (
    <div className="space-y-2">
      {err && <p className="text-xs text-red-300">{err}</p>}
      {payouts.map((p) => (
        <div key={p.id} className="rounded-lg border border-line bg-bg/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {p.sellerName} · {brl(p.totalCents)}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${p.status === "paid" ? "bg-green-500/20 text-green-300" : "bg-orange-500/20 text-orange-300"}`}>
                  {p.status === "paid" ? "pago" : "pendente"}
                </span>
              </p>
              <p className="text-xs text-muted">
                {p.salesCount} venda(s) · base {brl(p.baseCents)}{p.commissionPct != null ? ` · ${p.commissionPct}%` : ""}{p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <a href={`/api/commissions/payouts/${p.id}/receipt`} target="_blank" rel="noreferrer" className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand">Recibo</a>
              {p.status !== "paid" && (
                <button onClick={() => setPayId(payId === p.id ? null : p.id)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white">
                  {payId === p.id ? "Fechar" : "Registrar pagamento"}
                </button>
              )}
            </div>
          </div>
          {payId === p.id && (
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
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(f); e.currentTarget.value = ""; }} />
              </label>
              {proof && <a href={proof} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">ver</a>}
              <button onClick={() => pay(p.id)} disabled={busy || uploading} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "..." : "Confirmar pago"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CommissionConfig({ sellers }: { sellers: Seller[] }) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(sellers.map((s) => [s.id, s.commissionPct != null ? String(s.commissionPct) : ""])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(id: string) {
    setSavingId(id); setMsg(null);
    try {
      const raw = vals[id]?.trim() ?? "";
      const pct = raw === "" ? null : Number(raw.replace(",", "."));
      const res = await fetch(`/api/users/${id}/commission`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ commissionPct: pct }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setMsg("Comissão atualizada.");
    } catch (e: any) { setMsg(`Erro: ${e.message}`); } finally { setSavingId(null); }
  }

  if (sellers.length === 0) return <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum vendedor.</p>;
  return (
    <div className="space-y-2">
      {msg && <p className="text-xs text-muted">{msg}</p>}
      {sellers.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-4 py-3">
          <span className="text-sm font-medium">{s.name}</span>
          <div className="flex items-center gap-2">
            <input
              value={vals[s.id] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [s.id]: e.target.value }))}
              placeholder="0"
              inputMode="decimal"
              className="w-20 rounded border border-line bg-bg/60 px-2 py-1 text-right text-sm"
            />
            <span className="text-xs text-muted">%</span>
            <button onClick={() => save(s.id)} disabled={savingId === s.id} className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand disabled:opacity-50">
              {savingId === s.id ? "..." : "Salvar"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{children}</button>;
}
function Card({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-brand/50 bg-brand/10" : "border-line bg-bg/60"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${highlight ? "text-brand" : ""}`}>{value}</p>
    </div>
  );
}
