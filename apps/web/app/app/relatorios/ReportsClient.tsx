"use client";

import { useEffect, useState, useCallback } from "react";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const BUCKET_LABEL: Record<string, { label: string; cls: string }> = {
  paid: { label: "Pagas", cls: "text-green-300" },
  overdue: { label: "Vencidas", cls: "text-red-300" },
  due_soon: { label: "A vencer (5d)", cls: "text-orange-300" },
  future: { label: "Futuras", cls: "text-muted" },
};

export function ReportsClient({ summary, collections }: { summary: any; collections: any[] }) {
  const [tab, setTab] = useState<"summary" | "installments" | "collections" | "estoque">("summary");
  const [bucket, setBucket] = useState("overdue");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [lowStock, setLowStock] = useState<any | null>(null);
  const [sellers, setSellers] = useState<any | null>(null);
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [byStore, setByStore] = useState<any[] | null>(null);

  useEffect(() => {
    if (tab !== "installments") return;
    setLoading(true);
    fetch(`/api/reports/credit/installments?bucket=${bucket}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .finally(() => setLoading(false));
  }, [tab, bucket]);

  // PERÍODO DO "MAIS VENDIDOS".
  // A tela chamava `best-sellers` SEM `from`/`to`, e a API cai no padrão de 30
  // dias — então não havia como perguntar "quantas armações vendemos em
  // setembro". A rota já aceitava o período; faltava a tela oferecer.
  const brDia = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

  /**
   * CSV do que está na tela, com o período no nome do arquivo.
   *
   * Monta no cliente de propósito: o CSV do servidor (`reports/inventory.csv`,
   * `kind=sellers`) chama o relatório SEM período, então baixá-lo daria um
   * arquivo de 30 dias enquanto a tela mostra outro mês — número errado numa
   * planilha, que é onde ele vira decisão.
   */
  function baixaCsv() {
    const rows = (sellers?.byGroup ?? []) as any[];
    if (!rows.length) return;
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const num = (c: number) => ((Number(c) || 0) / 100).toFixed(2).replace(".", ",");
    const linhas = [
      ["Categoria", "Total", "PDV", "Pedido de lente", "Faturado PDV (R$)"].join(";"),
      ...rows.map((g) => [esc(g.group), g.qty, g.qtyPdv ?? g.qty, g.qtyLens ?? 0, num(g.revenueCents)].join(";")),
    ];
    const p = periodoCarregado;
    // BOM: sem ele o Excel em pt-BR abre "Armações" como "ArmaÃ§Ãµes"
    const blob = new Blob(["\uFEFF" + linhas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mais-vendidos-${p?.from ?? de}_a_${p?.to ?? ate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const hojeIso = () => new Date().toISOString().slice(0, 10);
  const menosDias = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const [de, setDe] = useState(menosDias(30));
  const [ate, setAte] = useState(hojeIso());
  /** o período efetivamente carregado — pra não dizer "setembro" mostrando outro mês */
  const [periodoCarregado, setPeriodoCarregado] = useState<{ from: string; to: string } | null>(null);

  function atalho(qual: "30d" | "mes" | "mesPassado" | "ano") {
    const h = new Date();
    if (qual === "30d") { setDe(menosDias(30)); setAte(hojeIso()); return; }
    if (qual === "mes") {
      setDe(new Date(h.getFullYear(), h.getMonth(), 1).toISOString().slice(0, 10));
      setAte(hojeIso()); return;
    }
    if (qual === "mesPassado") {
      setDe(new Date(h.getFullYear(), h.getMonth() - 1, 1).toISOString().slice(0, 10));
      setAte(new Date(h.getFullYear(), h.getMonth(), 0).toISOString().slice(0, 10)); return;
    }
    setDe(`${h.getFullYear()}-01-01`); setAte(hojeIso());
  }

  /** Só o mais vendidos depende do período; os outros três não. */
  const carregaSellers = useCallback((from: string, to: string) => {
    setLoading(true);
    fetch(`/api/products/reports/best-sellers?from=${from}&to=${to}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((bs) => { if (bs) { setSellers(bs); setPeriodoCarregado({ from: bs.from, to: bs.to }); } })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab !== "estoque" || (lowStock && sellers && analytics && byStore)) return;
    setLoading(true);
    Promise.all([
      fetch("/api/products/reports/low-stock", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/products/reports/best-sellers?from=${de}&to=${ate}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/products/reports/inventory-analytics", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/products/reports/by-store", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([ls, bs, an, bst]) => {
      if (ls) setLowStock(ls);
      if (bs) { setSellers(bs); setPeriodoCarregado({ from: bs.from, to: bs.to }); }
      if (an) setAnalytics(an);
      if (bst) setByStore(bst.items ?? []);
    }).finally(() => setLoading(false));
    // `de`/`ate` de propósito fora das deps: mudar o período recarrega pelo
    // botão Aplicar, não a cada tecla digitada na data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, lowStock, sellers, analytics, byStore]);

  const inst = summary?.installments ?? {};

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-line">
        <Tab active={tab === "summary"} onClick={() => setTab("summary")}>Resumo</Tab>
        <Tab active={tab === "installments"} onClick={() => setTab("installments")}>Parcelas</Tab>
        <Tab active={tab === "collections"} onClick={() => setTab("collections")}>Cobranças</Tab>
        <Tab active={tab === "estoque"} onClick={() => setTab("estoque")}>Estoque</Tab>
      </nav>

      {/* Exportação: Excel (CSV) + PDF em 3 modelos (relatórios de crédito) */}
      <div className={`card flex flex-wrap items-center gap-2 p-3 ${tab === "estoque" ? "hidden" : ""}`}>
        <span className="text-[10px] uppercase tracking-wider text-muted">Exportar</span>
        <a
          href={tab === "collections" ? "/api/reports/export/collections.csv" : `/api/reports/export/installments.csv?bucket=${bucket}`}
          className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand"
        >
          ↓ Excel (CSV){tab !== "collections" ? ` · ${BUCKET_LABEL[bucket]?.label ?? bucket}` : ""}
        </a>
        <span className="mx-1 h-4 w-px bg-line" />
        <span className="text-[10px] uppercase tracking-wider text-muted">PDF</span>
        <a href={`/api/reports/print/analitico?bucket=${bucket}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand">Analítico</a>
        <a href="/api/reports/print/sintetico" target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand">Sintético</a>
        <a href="/api/reports/print/dashboard" target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand">Dashboard</a>
      </div>

      {tab === "summary" && (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            {Object.entries(BUCKET_LABEL).map(([key, meta]) => {
              const b = inst[key] ?? { count: 0, total: 0 };
              return (
                <div key={key} className="card p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted">{meta.label}</p>
                  <p className={`mt-1 text-2xl font-semibold ${meta.cls}`}>{b.count}</p>
                  <p className="text-xs text-muted">{brl(b.total)}</p>
                </div>
              );
            })}
          </div>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Contas por status</h2>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {(summary?.accounts ?? []).map((a: any) => (
                <div key={a.status} className="flex items-center justify-between border-b border-line/40 py-2">
                  <span>{a.status} ({a.count})</span>
                  <span className="text-muted">limite {brl(a.limit)} · usado {brl(a.used)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "installments" && (
        <>
          <div className="flex gap-2">
            {Object.entries(BUCKET_LABEL).map(([key, meta]) => (
              <button key={key} onClick={() => setBucket(key)} className={`rounded-lg border px-3 py-1.5 text-xs ${bucket === key ? "border-brand text-fg" : "border-line text-muted"}`}>
                {meta.label}
              </button>
            ))}
          </div>
          {loading ? <p className="text-sm text-muted">Carregando...</p> : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm table-cards">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Parcela</th>
                    <th className="px-4 py-3">Vencimento</th>
                    <th className="px-4 py-3">Valor</th>
                    <th className="px-4 py-3">Status conta</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">Nenhuma parcela.</td></tr>
                  ) : items.map((i) => (
                    <tr key={i.id} className="border-t border-line/50">
                      <td className="px-4 py-3">
                        <div>{i.creditAccount?.holderName}</div>
                        <div className="font-mono text-xs text-muted">{i.creditAccount?.document}</div>
                      </td>
                      <td className="px-4 py-3 font-mono">{i.number}</td>
                      <td className="px-4 py-3">{new Date(i.dueDate).toLocaleDateString("pt-BR")}</td>
                      <td className="px-4 py-3">{brl(Number(i.amountCents))}</td>
                      <td className="px-4 py-3 text-xs">{i.creditAccount?.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "estoque" && (
        loading && !lowStock ? <p className="text-sm text-muted">Carregando...</p> : (
          <div className="space-y-6">
            {/* exportar (Excel/CSV) */}
            <div className="card flex flex-wrap items-center gap-2 p-3">
              <span className="text-[10px] uppercase tracking-wider text-muted">Exportar CSV</span>
              {[["low_stock", "Baixo estoque"], ["reorder", "Reposição"], ["abc", "Curva ABC"], ["value", "Valor (CMV)"], ["best_sellers", "Mais vendidos"]].map(([k, l]) => (
                <a key={k} href={`/api/products/reports/inventory.csv?kind=${k}`} className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand">↓ {l}</a>
              ))}
            </div>

            {/* resumo */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="card p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted">Produtos c/ controle</p>
                <p className="mt-1 text-2xl font-semibold">{lowStock?.totalTracked ?? 0}</p>
              </div>
              <div className="card p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted">Abaixo do mínimo</p>
                <p className="mt-1 text-2xl font-semibold text-red-300">{lowStock?.totalLow ?? 0}</p>
              </div>
              <div className="card p-4">
                <p className="text-[10px] uppercase tracking-wider text-muted">Giro (últimos 30d)</p>
                <p className="mt-1 text-2xl font-semibold">{(sellers?.products ?? []).reduce((s: number, p: any) => s + (p.qty ?? 0), 0)} un.</p>
              </div>
            </div>

            {/* estoque por loja */}
            {(byStore ?? []).length > 1 && (
              <section className="card p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Estoque por loja</h2>
                <table className="w-full text-sm table-cards">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-2">Loja</th><th className="py-2 text-right">Produtos (SKUs)</th><th className="py-2 text-right">Unidades</th></tr></thead>
                  <tbody>
                    {byStore!.map((s: any) => (
                      <tr key={s.storeId} className="border-t border-line/50"><td className="py-2">{s.store}</td><td className="py-2 text-right text-muted">{s.skus}</td><td className="py-2 text-right font-semibold">{s.units}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* produtos com estoque baixo */}
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Produtos com estoque baixo</h2>
              {(lowStock?.products ?? []).length === 0 ? <p className="text-sm text-muted">Tudo certo — nenhum produto abaixo do mínimo. 👍</p> : (
                <table className="w-full text-sm table-cards">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-2">Produto</th><th className="py-2">Categoria</th><th className="py-2 text-right">Estoque</th><th className="py-2 text-right">Mínimo</th></tr></thead>
                  <tbody>
                    {lowStock.products.map((p: any) => (
                      <tr key={p.id} className="border-t border-line/50">
                        <td className="py-2">{p.name}<span className="ml-2 font-mono text-[10px] text-muted">{p.sku}</span></td>
                        <td className="py-2 text-muted">{p.category}</td>
                        <td className="py-2 text-right font-semibold text-red-300">{p.stockQty}</td>
                        <td className="py-2 text-right text-muted">{p.minStockQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* baixo estoque por grupo */}
            <section className="card p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Estoque por grupo (categoria)</h2>
              <table className="w-full text-sm table-cards">
                <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-2">Grupo</th><th className="py-2 text-right">Produtos</th><th className="py-2 text-right">Em estoque</th><th className="py-2 text-right">Abaixo do mín.</th></tr></thead>
                <tbody>
                  {(lowStock?.byGroup ?? []).map((g: any) => (
                    <tr key={g.group} className="border-t border-line/50">
                      <td className="py-2">{g.group}</td>
                      <td className="py-2 text-right text-muted">{g.products}</td>
                      <td className="py-2 text-right">{g.totalQty} un.</td>
                      <td className={`py-2 text-right ${g.lowCount > 0 ? "font-semibold text-red-300" : "text-muted"}`}>{g.lowCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* mais vendidos (giro) */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="card p-5">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted">Mais vendidos — produto</h2>
                <p className="mb-3 text-[11px] text-muted">{sellers?.from} a {sellers?.to}</p>
                {(sellers?.products ?? []).length === 0 ? <p className="text-sm text-muted">Sem vendas no período.</p> : (
                  <table className="w-full text-sm table-cards">
                    <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1">Produto</th><th className="py-1 text-right">Qtd</th><th className="py-1 text-right">Faturado</th></tr></thead>
                    <tbody>
                      {sellers.products.slice(0, 15).map((p: any, i: number) => (
                        <tr key={i} className="border-t border-line/50"><td className="py-1.5">{p.name}</td><td className="py-1.5 text-right font-semibold">{p.qty}</td><td className="py-1.5 text-right text-muted">{brl(p.revenueCents)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section className="card p-5">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Mais vendidos — categoria</h2>
                    <p className="text-[11px] text-muted">
                      quantas unidades saíram por categoria
                      {periodoCarregado && <> · <b>{brDia(periodoCarregado.from)} a {brDia(periodoCarregado.to)}</b></>}
                    </p>
                  </div>
                  {/* O CSV sai do que está NA TELA, com o mesmo período: baixar um
                      arquivo de outro período do que se está olhando é o jeito
                      mais fácil de levar número errado pra uma reunião. */}
                  <button
                    type="button"
                    onClick={() => baixaCsv()}
                    disabled={!sellers?.byGroup?.length}
                    className="btn-soft px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    Baixar CSV
                  </button>
                </div>

                {/* PERÍODO — a tela não tinha, e a API sempre respondia 30 dias */}
                <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-2/40 p-2.5">
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">De</span>
                    <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="input-base py-1 text-xs" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Até</span>
                    <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} className="input-base py-1 text-xs" />
                  </label>
                  <button type="button" onClick={() => carregaSellers(de, ate)} className="btn-grad px-4 py-1.5 text-xs">Aplicar</button>
                  <span className="mx-1 h-5 w-px bg-line" />
                  {([["30d", "30 dias"], ["mes", "este mês"], ["mesPassado", "mês passado"], ["ano", "este ano"]] as const).map(([k, rot]) => (
                    <button key={k} type="button" onClick={() => { atalho(k); }} className="btn-soft px-2.5 py-1 text-[11px]">{rot}</button>
                  ))}
                  <span className="text-[10px] text-muted">os atalhos preenchem as datas; clique em Aplicar</span>
                </div>

                {(sellers?.byGroup ?? []).length === 0 ? <p className="text-sm text-muted">Nada saiu neste período.</p> : (
                  <table className="w-full text-sm table-cards">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                        <th className="py-1">Categoria</th>
                        <th className="py-1 text-right">Total</th>
                        <th className="py-1 text-right">PDV</th>
                        <th className="py-1 text-right">Pedido de lente</th>
                        <th className="py-1 text-right">Faturado (PDV)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellers.byGroup.map((g: any, i: number) => (
                        <tr key={i} className="border-t border-line/50">
                          <td className="py-1.5">{g.group}</td>
                          <td className="py-1.5 text-right font-semibold">{g.qty}</td>
                          <td className="py-1.5 text-right text-muted">{g.qtyPdv ?? g.qty}</td>
                          <td className="py-1.5 text-right text-muted">{g.qtyLens ?? 0}</td>
                          <td className="py-1.5 text-right text-muted">{brl(g.revenueCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {/* A coluna "Faturado" é só do PDV, e dizer isso é o que evita
                    alguém dividir faturado por total e achar o preço médio errado:
                    a armação que sai em pedido de lente não tem preço próprio ali. */}
                {(sellers?.byGroup ?? []).some((g: any) => (g.qtyLens ?? 0) > 0) && (
                  <p className="mt-3 text-[11px] text-muted">
                    <b>Pedido de lente</b> = armação que saiu junto com um pedido, sem venda no PDV. Conta na
                    quantidade, mas não no faturado: o valor dela está no pedido inteiro, junto com as lentes.
                  </p>
                )}
              </section>
            </div>

            {/* valor em estoque (CMV) + margem */}
            {analytics && (
              <section className="card p-5">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Valor em estoque</h2>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div><p className="text-[10px] uppercase tracking-wider text-muted">Custo (parado)</p><p className="mt-1 text-xl font-semibold">{brl(analytics.value.totalCostCents)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-muted">Venda potencial</p><p className="mt-1 text-xl font-semibold">{brl(analytics.value.totalSaleCents)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-muted">Margem prevista</p><p className="mt-1 text-xl font-semibold text-green-300">{brl(analytics.value.marginCents)}</p></div>
                </div>
                {(analytics.value.byGroup ?? []).length > 0 && (
                  <table className="mt-4 w-full text-sm table-cards">
                    <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1">Grupo</th><th className="py-1 text-right">Unid.</th><th className="py-1 text-right">Custo</th><th className="py-1 text-right">Venda</th><th className="py-1 text-right">Margem</th></tr></thead>
                    <tbody>
                      {analytics.value.byGroup.map((g: any, i: number) => (
                        <tr key={i} className="border-t border-line/50"><td className="py-1.5">{g.group}</td><td className="py-1.5 text-right text-muted">{g.units}</td><td className="py-1.5 text-right">{brl(g.costCents)}</td><td className="py-1.5 text-right">{brl(g.saleCents)}</td><td className="py-1.5 text-right text-green-300">{brl(g.marginCents)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {/* reposição sugerida */}
            {analytics && (
              <section className="card p-5">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted">Reposição sugerida</h2>
                <p className="mb-3 text-[11px] text-muted">cruza o giro dos últimos {analytics.periodDays} dias com o estoque mínimo</p>
                {(analytics.reorder ?? []).length === 0 ? <p className="text-sm text-muted">Nada a repor agora. 👍</p> : (
                  <table className="w-full text-sm table-cards">
                    <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1">Produto</th><th className="py-1 text-right">Estoque</th><th className="py-1 text-right">Vendas 90d</th><th className="py-1 text-right">Cobertura</th><th className="py-1 text-right">Comprar</th></tr></thead>
                    <tbody>
                      {analytics.reorder.map((r: any) => (
                        <tr key={r.id} className="border-t border-line/50">
                          <td className="py-1.5">{r.urgent && <span title="urgente">🔴 </span>}{r.name}<span className="ml-2 text-[10px] text-muted">{r.category}</span></td>
                          <td className="py-1.5 text-right">{r.stockQty}<span className="text-[10px] text-muted"> /mín {r.minStockQty}</span></td>
                          <td className="py-1.5 text-right text-muted">{r.sold90d}</td>
                          <td className="py-1.5 text-right text-muted">{r.coverageDays == null ? "—" : `${r.coverageDays}d`}</td>
                          <td className="py-1.5 text-right font-semibold text-brand">{r.suggestedQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {/* curva ABC */}
            {analytics && (
              <section className="card p-5">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted">Curva ABC</h2>
                <p className="mb-3 text-[11px] text-muted">classe A = 80% do faturamento · B = próximos 15% · C = resto</p>
                <div className="mb-4 flex gap-3 text-sm">
                  <span className="rounded-lg bg-green-500/15 px-3 py-1 text-green-300">A: {analytics.abc.counts.A}</span>
                  <span className="rounded-lg bg-amber-500/15 px-3 py-1 text-amber-300">B: {analytics.abc.counts.B}</span>
                  <span className="rounded-lg bg-line px-3 py-1 text-muted">C: {analytics.abc.counts.C}</span>
                </div>
                {(analytics.abc.items ?? []).length > 0 && (
                  <table className="w-full text-sm table-cards">
                    <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1">Classe</th><th className="py-1">Produto</th><th className="py-1 text-right">Faturado 90d</th><th className="py-1 text-right">% do total</th></tr></thead>
                    <tbody>
                      {analytics.abc.items.map((p: any) => (
                        <tr key={p.id} className="border-t border-line/50">
                          <td className="py-1.5"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.cls === "A" ? "bg-green-500/15 text-green-300" : p.cls === "B" ? "bg-amber-500/15 text-amber-300" : "bg-line text-muted"}`}>{p.cls}</span></td>
                          <td className="py-1.5">{p.name}<span className="ml-2 text-[10px] text-muted">{p.category}</span></td>
                          <td className="py-1.5 text-right">{brl(p.revenueCents)}</td>
                          <td className="py-1.5 text-right text-muted">{p.sharePct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </div>
        )
      )}

      {tab === "collections" && (
        <div className="space-y-2">
          {collections.length === 0 ? (
            <p className="card p-6 text-sm text-muted">
              Nenhuma cobrança disparada ainda. O sistema dispara automaticamente
              conforme a régua configurada em Cobrança.
            </p>
          ) : collections.map((e) => (
            <div key={e.id} className="card flex items-start gap-3 p-3 text-sm">
              <span className={`mt-0.5 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${e.status === "sent" ? "bg-green-500/20 text-green-300" : e.status === "failed" ? "bg-red-500/20 text-red-300" : "bg-line text-muted"}`}>
                {e.channel}
              </span>
              <div className="flex-1">
                <p className="text-xs text-muted">
                  {new Date(e.createdAt).toLocaleString("pt-BR")} · {e.daysOverdue >= 0 ? `${e.daysOverdue}d atraso` : `${Math.abs(e.daysOverdue)}d antes`}
                </p>
                <p>{e.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tab({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>
      {children}
    </button>
  );
}
