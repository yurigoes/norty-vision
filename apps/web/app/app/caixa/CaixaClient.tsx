"use client";

import { useCallback, useEffect, useState } from "react";

interface Store { id: string; name: string }
interface Totals { cash: number; pix: number; cardCredit: number; cardDebit: number; card: number; credit: number; other: number; total: number; salesCount: number }
interface Register {
  id: string;
  openedAt: string;
  openingFloatCents: number;
  status: string;
}
interface ClosedRegister {
  id: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: string;
  closingCountedCents: string | null;
  expectedCashCents: string | null;
  totals: Totals;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CaixaClient({ stores }: { stores: Store[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [loading, setLoading] = useState(true);
  const [register, setRegister] = useState<Register | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [examTotals, setExamTotals] = useState<Totals | null>(null);
  const [expectedCash, setExpectedCash] = useState(0);
  const [history, setHistory] = useState<ClosedRegister[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // forms
  const [openingFloat, setOpeningFloat] = useState("0");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");

  const qs = storeId ? `?storeId=${storeId}` : "";

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [curRes, histRes] = await Promise.all([
        fetch(`/api/cash/current${qs}`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/cash/history${qs}`, { credentials: "include" }).then((r) => r.json()),
      ]);
      setRegister(curRes.register ?? null);
      setTotals(curRes.totals ?? null);
      setExamTotals(curRes.examTotals ?? null);
      setExpectedCash(curRes.expectedCashCents ?? 0);
      setHistory(histRes.items ?? []);
    } catch { setErr("Falha ao carregar"); }
    finally { setLoading(false); }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  async function openRegister() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/cash/open", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ storeId: storeId || undefined, openingFloatCents: Math.round(Number(openingFloat.replace(",", ".")) * 100) || 0 }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao abrir"); return; }
      setOpeningFloat("0");
      load();
    } finally { setBusy(false); }
  }

  async function closeRegister() {
    if (!register) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/cash/${register.id}/close`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ countedCents: counted ? Math.round(Number(counted.replace(",", ".")) * 100) : undefined, notes: notes || null }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao fechar"); return; }
      setCounted(""); setNotes("");
      load();
    } finally { setBusy(false); }
  }

  const diff = counted ? Math.round(Number(counted.replace(",", ".")) * 100) - expectedCash : null;

  return (
    <div className="space-y-6">
      {stores.length > 1 && (
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      {loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : !register ? (
        <div className="rounded-xl border border-line bg-bg/60 p-6">
          <p className="text-sm text-muted">Nenhum caixa aberto nesta loja.</p>
          <div className="mt-4 flex items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Troco inicial (R$)</span>
              <input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal" className="w-40 rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            </label>
            <button onClick={openRegister} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Abrindo..." : "Abrir caixa"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-green-500/40 bg-bg/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-green-300">● Caixa aberto</p>
              <p className="text-xs text-muted">desde {new Date(register.openedAt).toLocaleString("pt-BR")} · troco {brl(register.openingFloatCents)}</p>
            </div>
            <button onClick={load} className="text-xs text-muted hover:text-fg">↻ atualizar</button>
          </div>

          {totals && (
            <>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-muted">Vendas (óculos / lentes)</p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Tile label="Dinheiro" value={totals.cash} />
                <Tile label="Pix" value={totals.pix} />
                <Tile label="Cartão crédito" value={totals.cardCredit} />
                <Tile label="Cartão débito" value={totals.cardDebit} />
                {totals.card > 0 && <Tile label="Cartão (outros)" value={totals.card} />}
                <Tile label="Crediário" value={totals.credit} />
                {totals.other > 0 && <Tile label="Outros" value={totals.other} />}
                <Tile label="Total vendas" value={totals.total} highlight />
              </div>
            </>
          )}

          {examTotals && (
            <>
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wider text-muted">Exames (consultas) — caixa separado</p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Tile label="Dinheiro" value={examTotals.cash} />
                <Tile label="Pix" value={examTotals.pix} />
                <Tile label="Cartão crédito" value={examTotals.cardCredit} />
                <Tile label="Cartão débito" value={examTotals.cardDebit} />
                {examTotals.card > 0 && <Tile label="Cartão (outros)" value={examTotals.card} />}
                <Tile label="Total exames" value={examTotals.total} highlight />
              </div>
            </>
          )}

          <div className="mt-5 rounded-lg border border-line bg-bg/40 p-4">
            <p className="text-sm font-medium">Fechar caixa</p>
            <p className="mt-1 text-xs text-muted">Esperado em dinheiro (troco + vendas dinheiro): <strong>{brl(expectedCash)}</strong></p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Dinheiro contado (R$)</span>
                <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-40 rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
              </label>
              {diff !== null && (
                <span className={`text-sm font-semibold ${diff === 0 ? "text-green-300" : diff > 0 ? "text-blue-300" : "text-red-300"}`}>
                  {diff === 0 ? "Bate certinho" : diff > 0 ? `Sobra ${brl(diff)}` : `Falta ${brl(-diff)}`}
                </span>
              )}
            </div>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observação (opcional)" className="mt-3 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            <button onClick={closeRegister} disabled={busy} className="mt-3 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Fechando..." : "Fechar caixa"}
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Fechamentos anteriores</h2>
          <div className="space-y-2">
            {history.map((h) => {
              const exp = Number(h.expectedCashCents ?? 0);
              const cnt = h.closingCountedCents != null ? Number(h.closingCountedCents) : null;
              const d = cnt != null ? cnt - exp : null;
              return (
                <div key={h.id} className="rounded-lg border border-line bg-bg/60 p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{h.closedAt ? new Date(h.closedAt).toLocaleString("pt-BR") : "—"}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">{brl(h.totals?.total ?? 0)}</span>
                      <a href={`/app/caixa/relatorio?id=${h.id}`} className="text-xs text-brand hover:underline">Ver relatório</a>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Dinheiro {brl(h.totals?.cash ?? 0)} · Pix {brl(h.totals?.pix ?? 0)} · Crédito {brl(h.totals?.cardCredit ?? 0)} · Débito {brl(h.totals?.cardDebit ?? 0)} · Crediário {brl(h.totals?.credit ?? 0)}
                    {d !== null && <> · {d === 0 ? "conferido ✓" : d > 0 ? `sobra ${brl(d)}` : `falta ${brl(-d)}`}</>}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-brand/40 bg-brand/10" : "border-line bg-bg/40"}`}>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{brl(value)}</p>
    </div>
  );
}
