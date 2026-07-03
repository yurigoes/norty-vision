"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

function brl(c: number) { return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function brNum(s: string) { return Number(String(s).replace(/\./g, "").replace(",", ".")) || 0; }
function brCents(s: string) { return Math.round(brNum(s) * 100); }

type Row = { legacyCode: string; saleDate: string; productName: string; qty: number; unitPriceCents: number; discountCents: number; totalCents: number };

/** Lê o texto colado do relatório "VENDA DE PRODUTOS" e extrai as linhas. */
function parseReport(text: string): { rows: Row[]; bad: string[] } {
  const re = /^(\d{6})\s+(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+UN\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/;
  const rows: Row[] = []; const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const m = re.exec(line);
    if (!m) { if (/^\d{6}\s/.test(line) || /\bUN\b/.test(line)) bad.push(line); continue; }
    const [, code, dd, mm, yyyy, name, qtyS, unitS, descS, totalS] = m as unknown as string[];
    rows.push({ legacyCode: code, saleDate: `${yyyy}-${mm}-${dd}`, productName: name.trim(), qty: brNum(qtyS), unitPriceCents: brCents(unitS), discountCents: brCents(descS), totalCents: brCents(totalS) });
  }
  return { rows, bad };
}

export function VendasHistoricoClient() {
  const [tab, setTab] = useState<"importar" | "relatorio">("importar");
  return (
    <div className="space-y-5">
      <nav className="flex gap-1 border-b border-line">
        <button onClick={() => setTab("importar")} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === "importar" ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>Importar</button>
        <button onClick={() => setTab("relatorio")} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === "relatorio" ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>Relatório / Lotes</button>
      </nav>
      {tab === "importar" ? <Importar /> : <Relatorio />}
    </div>
  );
}

function Importar() {
  const dialog = useDialog();
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ rows: Row[]; bad: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const total = (parsed?.rows ?? []).reduce((s, r) => s + r.totalCents, 0);

  function processar() {
    const p = parseReport(text);
    setParsed(p);
    if (p.rows.length === 0) dialog.toast("Nenhuma linha reconhecida. Cole o conteúdo do relatório (com código, data, produto, valores).", "error");
  }
  async function importar() {
    if (!parsed?.rows.length) return;
    if (!(await dialog.confirm(`Importar ${parsed.rows.length} vendas (${brl(total)})?`))) return;
    setBusy(true);
    try {
      const r = await fetch("/api/historical-sales/import", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ rows: parsed.rows, source: "relatorio-venda-produtos" }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      dialog.toast(`Importado: ${d.count} itens, ${brl(d.totalCents)} ✅`, "success");
      setText(""); setParsed(null);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="text-sm font-medium">1) Cole o relatório</p>
        <p className="mt-1 text-xs text-muted">Abra o PDF/relatório do sistema antigo, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole abaixo. O sistema entende linhas no formato <code className="text-[11px]">CÓDIGO DATA PRODUTO UN QTDE UNITÁRIO DESCONTO TOTAL</code>. Cabeçalhos/rodapés são ignorados.</p>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder="000284 10/12/2025 LENTE ESPACE BLUE UN 1,00 559,00 80,78 478,22&#10;..." className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 font-mono text-xs" />
        <div className="mt-2 flex gap-2">
          <button onClick={processar} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Processar</button>
          {parsed && <span className="self-center text-sm text-muted">{parsed.rows.length} linha(s) reconhecida(s) · {brl(total)}{parsed.bad.length ? ` · ${parsed.bad.length} ignorada(s)` : ""}</span>}
        </div>
      </div>

      {parsed && parsed.rows.length > 0 && (
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">2) Confira e importe</p>
            <button disabled={busy} onClick={importar} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Importando…" : `Importar ${parsed.rows.length} vendas`}</button>
          </div>
          <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-line/60">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg"><tr className="text-left text-muted"><th className="px-2 py-1">Cód.</th><th className="px-2 py-1">Data</th><th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Qtd</th><th className="px-2 py-1 text-right">Unit.</th><th className="px-2 py-1 text-right">Desc.</th><th className="px-2 py-1 text-right">Total</th></tr></thead>
              <tbody>
                {parsed.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-t border-line/40"><td className="px-2 py-1 font-mono">{r.legacyCode}</td><td className="px-2 py-1">{r.saleDate.split("-").reverse().join("/")}</td><td className="px-2 py-1">{r.productName}</td><td className="px-2 py-1 text-right">{r.qty}</td><td className="px-2 py-1 text-right">{brl(r.unitPriceCents)}</td><td className="px-2 py-1 text-right">{brl(r.discountCents)}</td><td className="px-2 py-1 text-right">{brl(r.totalCents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.rows.length > 100 && <p className="mt-1 text-[11px] text-muted">Mostrando 100 de {parsed.rows.length}. Todas serão importadas.</p>}
          {parsed.bad.length > 0 && (
            <details className="mt-2 text-xs"><summary className="cursor-pointer text-amber-300">{parsed.bad.length} linha(s) não reconhecida(s) — verifique se ficou faltando algo</summary>
              <div className="mt-1 max-h-40 overflow-auto rounded bg-bg/40 p-2 font-mono text-[10px] text-muted">{parsed.bad.slice(0, 50).map((b, i) => <div key={i}>{b}</div>)}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Relatorio() {
  const dialog = useDialog();
  const [sum, setSum] = useState<any | null>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const load = () => {
    fetch("/api/historical-sales/summary", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setSum).catch(() => {});
    fetch("/api/historical-sales/batches", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setBatches(d?.items ?? [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  async function undo(batchId: string) {
    if (!(await dialog.confirm("Apagar este lote importado? (não afeta nada além do histórico)"))) return;
    const r = await fetch(`/api/historical-sales/batches/${batchId}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { dialog.toast("Lote apagado", "success"); load(); } else dialog.toast("Falha", "error");
  }
  if (!sum) return <p className="text-sm text-muted">Carregando…</p>;
  const g = sum.geral ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Itens" value={g.itens ?? 0} />
        <Kpi label="Quantidade" value={Number(g.qtd ?? 0).toLocaleString("pt-BR")} />
        <Kpi label="Faturamento" value={brl(g.totalCents ?? 0)} cls="text-green-400" />
        <Kpi label="Descontos" value={brl(g.descontoCents ?? 0)} cls="text-amber-300" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <p className="mb-2 text-sm font-medium">Por mês</p>
          <div className="space-y-1">
            {(sum.porMes ?? []).map((m: any) => (
              <div key={m.mes} className="flex justify-between text-sm"><span className="text-muted">{m.mes.split("-").reverse().join("/")}</span><span>{m.itens} itens · <b>{brl(m.totalCents)}</b></span></div>
            ))}
            {(sum.porMes ?? []).length === 0 && <p className="text-sm text-muted">Sem dados ainda.</p>}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <p className="mb-2 text-sm font-medium">Top produtos (faturamento)</p>
          <div className="space-y-1">
            {(sum.topProdutos ?? []).map((p: any, i: number) => (
              <div key={i} className="flex justify-between gap-2 text-sm"><span className="truncate text-muted">{p.produto}</span><span className="shrink-0">{p.itens}× · <b>{brl(p.totalCents)}</b></span></div>
            ))}
            {(sum.topProdutos ?? []).length === 0 && <p className="text-sm text-muted">Sem dados ainda.</p>}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-2 text-sm font-medium">Lotes importados</p>
        {batches.length === 0 ? <p className="text-sm text-muted">Nenhum lote importado.</p> : batches.map((b) => (
          <div key={b.batchId} className="flex items-center justify-between border-t border-line/40 py-2 text-sm first:border-t-0">
            <span className="text-muted">{new Date(b.criadoEm).toLocaleString("pt-BR")} · {b.itens} itens · {brl(b.totalCents)}</span>
            <button onClick={() => undo(b.batchId)} className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:border-red-400">Apagar lote</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, cls }: { label: string; value: any; cls?: string }) {
  return <div className="rounded-2xl border border-line bg-bg/60 px-5 py-4"><p className="text-xs uppercase tracking-wider text-muted">{label}</p><p className={`mt-1 text-2xl font-black ${cls ?? "text-fg"}`}>{value}</p></div>;
}
