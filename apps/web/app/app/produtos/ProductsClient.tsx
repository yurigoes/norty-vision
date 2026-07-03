"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Product {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  imageUrl: string | null;
  priceCashCents: number | null;
  priceCardFullCents: number | null;
  priceCardInstallmentsCents: number | null;
  priceCreditCents: number | null;
  creditInterestPct: number | null;
  earlyPaymentDiscountPct: number | null;
  maxInstallments: number | null;
  stockQty: number;
  minStockQty?: number;
  trackStock: boolean;
  isActive: boolean;
  showInCatalog?: boolean;
  laboratorySupplierId?: string | null;
  ncm?: string | null;
  cfop?: string | null;
  cest?: string | null;
  origem?: number | null;
  unidade?: string | null;
  cst?: string | null;
  csosn?: string | null;
}
interface LabOpt { id: string; name: string }

function brl(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function toCents(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : Math.round(n * 100);
}

export function ProductsClient({ initialProducts, labs = [], stores = [], niche = null }: { initialProducts: Product[]; labs?: LabOpt[]; stores?: Array<{ id: string; name: string }>; niche?: string | null }) {
  const isOtica = niche === "otica";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState<number>(50); // 0 = todas
  const [page, setPage] = useState(1);
  const [entradaFor, setEntradaFor] = useState<Product | null>(null);
  const [movFor, setMovFor] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);
  const [tips, setTips] = useState<Array<{ level: string; text: string }>>([]);
  const formRef = useRef<HTMLFormElement>(null);
  // auto-preenchimento fiscal: NCM (busca) + descrição + CEST sugerido
  const [ncmVal, setNcmVal] = useState("");
  const [cestVal, setCestVal] = useState("");
  const [ncmSugs, setNcmSugs] = useState<Array<{ codigo: string; descricao: string }>>([]);
  const [ncmDesc, setNcmDesc] = useState<string | null>(null);
  const ncmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onNcmChange(v: string) {
    setNcmVal(v); setNcmDesc(null);
    if (ncmTimer.current) clearTimeout(ncmTimer.current);
    if (v.trim().length < 2) { setNcmSugs([]); return; }
    ncmTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/fiscal/ref/ncm?q=${encodeURIComponent(v.trim())}`, { credentials: "include", headers: { "x-no-loading": "1" } });
        const d = await res.json().catch(() => null);
        setNcmSugs(res.ok ? (d?.items ?? []) : []);
      } catch { setNcmSugs([]); }
    }, 250);
  }
  async function pickNcm(it: { codigo: string; descricao: string }) {
    setNcmVal(it.codigo); setNcmDesc(it.descricao); setNcmSugs([]);
    try {
      const res = await fetch(`/api/fiscal/ref/cest?ncm=${encodeURIComponent(it.codigo)}`, { credentials: "include", headers: { "x-no-loading": "1" } });
      const d = await res.json().catch(() => null);
      const first = (d?.items ?? [])[0];
      if (first?.cest && !cestVal) setCestVal(String(first.cest));
    } catch { /* sem sugestão de CEST */ }
  }

  /** Dicas da IA (regras) ao mexer em preço/estoque — não bloqueia o fluxo. */
  async function refreshTips() {
    const f = formRef.current;
    if (!f) return;
    const fd = new FormData(f);
    const data = {
      priceCashCents: toCents(fd.get("priceCash")),
      priceCardInstallmentsCents: toCents(fd.get("priceCardInst")),
      costCents: (editing as any)?.costCents ?? null,
      stockQty: editing?.stockQty ?? Number(fd.get("stock") ?? 0),
      minStockQty: Number(fd.get("minStock") ?? 0),
      trackStock: fd.get("trackStock") === "on",
      ncm: String(fd.get("ncm") ?? ""),
    };
    try {
      const res = await fetch("/api/insights/tips", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ kind: "product", data }) });
      const d = await res.json().catch(() => null);
      if (res.ok) setTips(d?.tips ?? []);
    } catch { /* silencioso: dicas não atrapalham o fluxo */ }
  }

  // filtro por nome / SKU / valor (parte do texto)
  const filtered = (() => {
    const s = q.trim().toLowerCase();
    if (!s) return initialProducts;
    const digits = s.replace(/\D/g, "");
    return initialProducts.filter((p) => {
      const inName = p.name.toLowerCase().includes(s);
      const inSku = (p.sku ?? "").toLowerCase().includes(s);
      const inCat = (p.category ?? "").toLowerCase().includes(s);
      const inPrice = digits.length > 0 && [p.priceCashCents, p.priceCardInstallmentsCents, p.priceCreditCents]
        .some((c) => c != null && String(c).includes(digits));
      return inName || inSku || inCat || inPrice;
    });
  })();
  const total = filtered.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const curPage = Math.min(page, totalPages);
  const paged = pageSize === 0 ? filtered : filtered.slice((curPage - 1) * pageSize, curPage * pageSize);

  function startEdit(p: Product) { setEditing(p); setImageUrl(p.imageUrl ?? null); setTips([]); setNcmVal((p as any).ncm ?? ""); setCestVal((p as any).cest ?? ""); setNcmSugs([]); setNcmDesc(null); }
  function startCreate() { setCreating(true); setImageUrl(null); setTips([]); setNcmVal(""); setCestVal(""); setNcmSugs([]); setNcmDesc(null); }

  // ao abrir o modal, busca as dicas iniciais (uma vez)
  useEffect(() => {
    if (creating || editing) { const t = setTimeout(() => refreshTips(), 50); return () => clearTimeout(t); }
    setTips([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, editing]);

  async function toggleCatalog(p: Product) {
    const res = await fetch(`/api/marketplace/products/${p.id}/catalog`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ show: !(p.showInCatalog ?? true) }),
      credentials: "include",
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  /** Upload direto (so em edicao — precisa do id do produto). */
  async function uploadImage(file: File) {
    if (!editing) return;
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/products/${editing.id}/image`, { method: "POST", body: fd, credentials: "include" });
    const data = await res.json();
    if (res.ok) { setImageUrl(data.url); startTransition(() => router.refresh()); }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      sku: String(fd.get("sku") ?? "").trim() || null,
      category: String(fd.get("category") ?? "").trim() || null,
      imageUrl: String(fd.get("imageUrlLink") ?? "").trim() || imageUrl || null,
      priceCashCents: toCents(fd.get("priceCash")),
      priceCardFullCents: toCents(fd.get("priceCardFull")),
      priceCardInstallmentsCents: toCents(fd.get("priceCardInst")),
      priceCreditCents: toCents(fd.get("priceCredit")),
      creditInterestPct: fd.get("creditInterest") ? Number(fd.get("creditInterest")) : null,
      earlyPaymentDiscountPct: fd.get("earlyDiscount") ? Number(fd.get("earlyDiscount")) : null,
      maxInstallments: fd.get("maxInst") ? Number(fd.get("maxInst")) : null,
      // estoque por loja: só envia stockQty na CRIAÇÃO (vira o estoque inicial).
      // Na edição o total é calculado pela soma das lojas (read-only no form).
      ...(editing ? {} : { stockQty: Number(fd.get("stock") ?? 0) }),
      minStockQty: Number(fd.get("minStock") ?? 0),
      trackStock: fd.get("trackStock") === "on",
      isActive: fd.get("isActive") === "on",
      showInCatalog: fd.get("showInCatalog") === "on",
      laboratorySupplierId: String(fd.get("laboratorySupplierId") ?? "").trim() || null,
      ncm: String(fd.get("ncm") ?? "").replace(/\D/g, "") || null,
      cfop: String(fd.get("cfop") ?? "").replace(/\D/g, "") || null,
      cest: String(fd.get("cest") ?? "").replace(/\D/g, "") || null,
      origem: fd.get("origem") != null && String(fd.get("origem")) !== "" ? Number(fd.get("origem")) : null,
      unidade: String(fd.get("unidade") ?? "").trim().toUpperCase() || null,
      cst: String(fd.get("cst") ?? "").replace(/\D/g, "") || null,
      csosn: String(fd.get("csosn") ?? "").replace(/\D/g, "") || null,
    };
    const url = editing ? `/api/products/${editing.id}` : "/api/products";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao salvar");
      return;
    }
    setCreating(false);
    setEditing(null);
    startTransition(() => router.refresh());
  }

  const formOpen = creating || editing;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button onClick={startCreate} className="btn-grad px-5">
          + Novo produto
        </button>
        <button onClick={() => setImporting(true)} className="rounded-xl border border-line bg-surface px-5 py-2 text-sm font-semibold transition hover:border-brand/60 hover:text-brand">
          ↑ Importar estoque
        </button>
      </div>
      {importing && <ImportEstoque onClose={() => setImporting(false)} onDone={() => { setImporting(false); startTransition(() => router.refresh()); }} />}

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => { setCreating(false); setEditing(null); setError(null); }}
        >
        <form ref={formRef} onSubmit={onSubmit} onBlur={refreshTips} onClick={(e) => e.stopPropagation()} className="my-8 w-full max-w-3xl space-y-5 rounded-2xl border border-line bg-surface p-6 shadow-lg">
          <h2 className="text-lg font-semibold">{editing ? `Editar — ${editing.name}` : "Novo produto"}</h2>
          {tips.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/90">💡 Dicas da IA</p>
              {tips.map((t, i) => (
                <p key={i} className={`text-xs ${t.level === "urgent" ? "text-red-300" : t.level === "warn" ? "text-amber-200" : "text-muted"}`}>• {t.text}</p>
              ))}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="name" label="Nome" required defaultValue={editing?.name} />
            <Field name="sku" label="SKU" help={editing ? undefined : "vazio = gerado automaticamente"} defaultValue={editing?.sku ?? ""} />
            <Field name="category" label="Categoria" defaultValue={editing?.category ?? ""} />
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Preços (R$)</h3>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field name="priceCash" label="À vista" defaultValue={editing?.priceCashCents != null ? String(editing.priceCashCents / 100) : ""} />
              <Field name="priceCardFull" label="Cartão à vista" defaultValue={editing?.priceCardFullCents != null ? String(editing.priceCardFullCents / 100) : ""} />
              <Field name="priceCardInst" label="Cartão parcelado" defaultValue={editing?.priceCardInstallmentsCents != null ? String(editing.priceCardInstallmentsCents / 100) : ""} />
              <Field name="priceCredit" label="Crediário" help="vazio = calcula com juros" defaultValue={editing?.priceCreditCents != null ? String(editing.priceCreditCents / 100) : ""} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="creditInterest" label="Juros crediário %" help="se preço crediário vazio" defaultValue={editing?.creditInterestPct != null ? String(editing.creditInterestPct) : ""} />
            <Field name="earlyDiscount" label="Desc. antecipação %" defaultValue={editing?.earlyPaymentDiscountPct != null ? String(editing.earlyPaymentDiscountPct) : ""} />
            <Field name="maxInst" label="Máx parcelas" defaultValue={editing?.maxInstallments != null ? String(editing.maxInstallments) : ""} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {editing ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Estoque atual (total)</span>
                <input value={String(editing?.stockQty ?? 0)} readOnly className="input-base bg-surface-2 text-muted" />
                <p className="mt-1 text-[10px] text-muted">Total das lojas. Para alterar, use <b>Entrada</b> ou <b>Mov.</b> (por loja).</p>
              </label>
            ) : (
              <Field name="stock" label="Estoque inicial" help="entra na loja principal" defaultValue="0" />
            )}
            <Field name="minStock" label="Estoque mínimo" help="alerta quando o total ficar igual/abaixo" defaultValue={String((editing as any)?.minStockQty ?? 0)} />
          </div>
          {/* Imagem */}
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Imagem (opcional)</h3>
            <div className="flex items-center gap-4">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-line text-xs text-muted">sem</div>
              )}
              <div className="flex-1 space-y-2">
                {editing ? (
                  <label className="inline-block cursor-pointer rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">
                    Enviar arquivo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])} />
                  </label>
                ) : (
                  <p className="text-[11px] text-muted">Salve o produto primeiro pra enviar arquivo, ou cole um link abaixo.</p>
                )}
                <input
                  name="imageUrlLink"
                  placeholder="ou cole um link https://..."
                  defaultValue={editing?.imageUrl && !editing.imageUrl.includes("/storage/") ? editing.imageUrl : ""}
                  className="input-base py-1.5 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="trackStock" defaultChecked={editing?.trackStock ?? false} className="h-4 w-4" />
              Controlar estoque
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={editing?.isActive ?? true} className="h-4 w-4" />
              Ativo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="showInCatalog" defaultChecked={editing?.showInCatalog ?? true} className="h-4 w-4" />
              Mostrar na vitrine online
            </label>
          </div>

          {/* Laboratório (lentes): a lente puxa o lab no pedido. Só no nicho ótica. */}
          {isOtica && (
            <label className="block">
              <span className="mb-1 block text-xs uppercase text-muted">Laboratório (para lentes)</span>
              <select name="laboratorySupplierId" defaultValue={editing?.laboratorySupplierId ?? ""} className="input-base">
                <option value="">— nenhum —</option>
                {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <span className="mt-1 block text-[11px] text-muted">Use a categoria "lentes" para vincular o laboratório. Produtos de lente não vão à vitrine por padrão.</span>
            </label>
          )}

          {/* Fiscal (NFC-e) — usados na emissão da nota */}
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Fiscal (NFC-e)</h3>
            <p className="mb-3 text-[11px] text-muted">Preencha para emitir nota deste produto. <b>Simples Nacional</b> usa CSOSN (ex.: 102/500); <b>Regime Normal</b> usa CST (ex.: 00/60). Deixe em branco se ainda não emite.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="relative block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">NCM <span className="normal-case text-[10px] text-brand">(busca auto)</span></span>
                <input
                  name="ncm" value={ncmVal} autoComplete="off"
                  onChange={(e) => onNcmChange(e.target.value)}
                  onBlur={() => setTimeout(() => setNcmSugs([]), 150)}
                  placeholder="código ou descrição"
                  className="input-base"
                />
                {ncmSugs.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                    {ncmSugs.map((s) => (
                      <button type="button" key={s.codigo} onMouseDown={(e) => { e.preventDefault(); pickNcm(s); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-line">
                        <span className="font-mono text-brand">{s.codigo}</span> — {s.descricao}
                      </button>
                    ))}
                  </div>
                )}
                {ncmDesc && <p className="mt-1 text-[10px] text-green-300">✓ {ncmDesc}</p>}
              </div>
              <Field name="cfop" label="CFOP" help="ex.: 5102" defaultValue={editing?.cfop ?? ""} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">CEST <span className="normal-case text-[10px] text-muted">(sugerido)</span></span>
                <input name="cest" value={cestVal} onChange={(e) => setCestVal(e.target.value)} placeholder="opcional (ST)" className="input-base" />
              </label>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Origem</span>
                <select name="origem" defaultValue={String(editing?.origem ?? 0)} className="input-base">
                  <option value="0">0 — Nacional</option>
                  <option value="1">1 — Estrangeira (import. direta)</option>
                  <option value="2">2 — Estrangeira (mercado interno)</option>
                  <option value="3">3 — Nacional &gt;40% import.</option>
                  <option value="4">4 — Nacional (proc. básicos)</option>
                  <option value="5">5 — Nacional &lt;40% import.</option>
                  <option value="6">6 — Estrangeira s/ similar</option>
                  <option value="7">7 — Estrangeira mercado interno s/ similar</option>
                  <option value="8">8 — Nacional &gt;70% import.</option>
                </select>
              </label>
              <Field name="unidade" label="Unidade" help="ex.: UN, PC, KG" defaultValue={editing?.unidade ?? "UN"} />
              <Field name="csosn" label="CSOSN (Simples)" help="ex.: 102, 500" defaultValue={editing?.csosn ?? ""} />
              <Field name="cst" label="CST (Normal)" help="ex.: 00, 60" defaultValue={editing?.cst ?? ""} />
            </div>
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => { setCreating(false); setEditing(null); setError(null); }} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">Cancelar</button>
            <button type="submit" disabled={isPending} className="btn-grad px-5 disabled:opacity-50">Salvar</button>
          </div>
        </form>
        </div>
      )}

      {/* busca + itens por página */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Buscar por nome, SKU, categoria ou valor"
          className="input-base flex-1"
        />
        <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="input-base w-auto">
          <option value={10}>10 por página</option>
          <option value={50}>50 por página</option>
          <option value={100}>100 por página</option>
          <option value={0}>Todas</option>
        </select>
      </div>
      <p className="text-[11px] text-muted">{total} produto(s){q ? " (filtrados)" : ""}{pageSize !== 0 ? ` · página ${curPage}/${totalPages}` : ""}</p>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-4 py-3 font-medium">Produto</th>
              <th className="px-4 py-3 font-medium">À vista</th>
              <th className="px-4 py-3 font-medium">Cartão</th>
              <th className="px-4 py-3 font-medium">Crediário</th>
              <th className="px-4 py-3 font-medium">Estoque</th>
              <th className="px-4 py-3 font-medium">Vitrine</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">Nenhum produto.</td></tr>
            ) : paged.map((p) => (
              <tr key={p.id} className="border-t border-line transition hover:bg-surface-2">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-9 w-9 rounded object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded bg-line" />
                    )}
                    <div>
                      <button onClick={() => setViewing(p)} className="text-left font-medium hover:text-brand hover:underline" title="Ver detalhes">{p.name}</button>
                      {p.sku && <div className="font-mono text-xs text-muted">{p.sku}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{brl(p.priceCashCents)}</td>
                <td className="px-4 py-3">{brl(p.priceCardInstallmentsCents)}</td>
                <td className="px-4 py-3">{brl(p.priceCreditCents) ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {p.trackStock ? (
                    <span className={(p.stockQty ?? 0) <= (p.minStockQty ?? 0) ? "font-semibold text-red-300" : ""}>
                      {p.stockQty}{(p.stockQty ?? 0) <= (p.minStockQty ?? 0) ? " ⚠️" : ""}
                      {(p.minStockQty ?? 0) > 0 ? <span className="text-muted"> / mín {p.minStockQty}</span> : null}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleCatalog(p)}
                    title="Mostrar/ocultar na vitrine online"
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                      (p.showInCatalog ?? true) ? "bg-green-500/20 text-green-300" : "bg-line text-muted"
                    }`}
                  >
                    {(p.showInCatalog ?? true) ? "na vitrine" : "oculto"}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 text-xs">
                    <button onClick={() => startEdit(p)} className="text-brand hover:underline">Editar</button>
                    <button onClick={() => setEntradaFor(p)} className="text-muted hover:text-fg" title="Dar entrada (compra)">Entrada</button>
                    <button onClick={() => setMovFor(p)} className="text-muted hover:text-fg" title="Movimentações de estoque">Mov.</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageSize !== 0 && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} className="rounded-xl border border-line px-3 py-1.5 transition hover:border-brand/60 disabled:opacity-40">‹ Anterior</button>
          <span className="text-muted">{curPage} / {totalPages}</span>
          <button disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} className="rounded-xl border border-line px-3 py-1.5 transition hover:border-brand/60 disabled:opacity-40">Próxima ›</button>
        </div>
      )}

      {entradaFor && <EntradaModal product={entradaFor} stores={stores} onClose={() => setEntradaFor(null)} onSaved={() => { setEntradaFor(null); startTransition(() => router.refresh()); }} />}
      {movFor && <MovsModal product={movFor} stores={stores} onClose={() => setMovFor(null)} onChanged={() => startTransition(() => router.refresh())} />}
      {viewing && <ProductView product={viewing} labs={labs} onClose={() => setViewing(null)} onEdit={() => { const p = viewing; setViewing(null); startEdit(p); }} />}
    </div>
  );
}

/** Visualização (somente leitura) do produto. Editar só ao clicar em "Editar". */
function ProductView({ product, labs, onClose, onEdit }: { product: Product; labs: LabOpt[]; onClose: () => void; onEdit: () => void }) {
  const p = product as any;
  const lab = labs.find((l) => l.id === p.laboratorySupplierId);
  const ORIGEM: Record<string, string> = { "0": "0 — Nacional", "1": "1 — Estrangeira (import. direta)", "2": "2 — Estrangeira (merc. interno)", "3": "3 — Nacional >40% imp.", "4": "4 — Nacional (proc. básicos)", "5": "5 — Nacional <40% imp.", "6": "6 — Estrangeira s/ similar", "7": "7 — Estrang. merc. interno s/ similar", "8": "8 — Nacional >70% imp." };
  const Row = ({ k, v }: { k: string; v: any }) => (v === null || v === undefined || v === "" ? null : (
    <div className="flex justify-between gap-3 border-b border-line/30 py-1.5 text-sm"><span className="text-muted">{k}</span><span className="text-right font-medium">{v}</span></div>
  ));
  const money = (c: any) => (c === null || c === undefined ? null : brl(c));
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-20 w-20 rounded-lg object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-line text-xs text-muted">sem</div>}
          <div className="flex-1">
            <h2 className="text-xl font-semibold">{p.name}</h2>
            <p className="text-xs text-muted">{p.sku ? `SKU ${p.sku}` : "sem SKU"}{p.category ? ` · ${p.category}` : ""}</p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
              <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${p.isActive ? "bg-green-500/20 text-green-300" : "bg-line text-muted"}`}>{p.isActive ? "ativo" : "inativo"}</span>
              <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${(p.showInCatalog ?? true) ? "bg-green-500/20 text-green-300" : "bg-line text-muted"}`}>{(p.showInCatalog ?? true) ? "na vitrine" : "oculto"}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-x-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Preços</h3>
            <Row k="À vista" v={money(p.priceCashCents)} />
            <Row k="Cartão à vista" v={money(p.priceCardFullCents)} />
            <Row k="Cartão parcelado" v={money(p.priceCardInstallmentsCents)} />
            <Row k="Crediário" v={money(p.priceCreditCents)} />
            <Row k="Máx. parcelas" v={p.maxInstallments} />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Estoque</h3>
            <Row k="Atual (total)" v={p.trackStock ? p.stockQty : "não controla"} />
            <Row k="Mínimo" v={p.minStockQty} />
            <Row k="Laboratório" v={lab?.name} />
          </div>
        </div>

        <div className="mt-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Fiscal (NFC-e)</h3>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <div><Row k="NCM" v={p.ncm} /><Row k="CFOP" v={p.cfop} /><Row k="CEST" v={p.cest} /><Row k="Unidade" v={p.unidade} /></div>
            <div><Row k="Origem" v={ORIGEM[String(p.origem ?? "")] ?? p.origem} /><Row k="CST" v={p.cst} /><Row k="CSOSN" v={p.csosn} /></div>
          </div>
          {!p.ncm && <p className="mt-1 text-[11px] text-amber-300/80">Sem NCM — necessário para emitir nota fiscal.</p>}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">Fechar</button>
          <button onClick={onEdit} className="btn-grad px-5">Editar</button>
        </div>
      </div>
    </div>
  );
}

function EntradaModal({ product, stores, onClose, onSaved }: { product: Product; stores: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const n = Math.trunc(Number(qty));
    if (!n || n <= 0) { setErr("Informe a quantidade que entrou"); return; }
    setBusy(true); setErr(null);
    try {
      const body: any = { mode: "delta", qty: n, reason: reason.trim() || "Entrada de mercadoria" };
      if (storeId) body.storeId = storeId;
      const c = cost.trim().replace(",", ".");
      if (c) body.costCents = Math.round(Number(c) * 100);
      const res = await fetch(`/api/products/${product.id}/adjust-stock`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Não foi possível dar entrada"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Entrada — {product.name}</h3>
        <p className="mt-1 text-xs text-muted">Estoque total: <b>{product.stockQty}</b>. A quantidade entra na loja escolhida.</p>
        {stores.length > 1 && (
          <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase text-muted">Loja</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-base">
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase text-muted">Quantidade que entrou</span>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus className="input-base" />
        </label>
        <label className="mt-2 block"><span className="mb-1 block text-[10px] uppercase text-muted">Custo unitário (R$) — opcional</span>
          <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="atualiza o custo do produto" className="input-base" />
        </label>
        <label className="mt-2 block"><span className="mb-1 block text-[10px] uppercase text-muted">Motivo / nota</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: NF 1234 fornecedor X" className="input-base" />
        </label>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1 disabled:opacity-50">{busy ? "Salvando…" : "Dar entrada"}</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function MovsModal({ product, stores = [], onClose, onChanged }: { product: Product; stores?: Array<{ id: string; name: string }>; onClose: () => void; onChanged?: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [byStore, setByStore] = useState<Array<{ storeId?: string; store: string; qty: number }>>([]);
  const load = () => {
    fetch(`/api/products/${product.id}/movements`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
    fetch(`/api/products/${product.id}/store-stock`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setByStore(d?.items ?? [])).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [product.id]);
  const KIND: Record<string, string> = { sale: "Venda", purchase: "Entrada", adjustment: "Ajuste", return: "Devolução", transfer: "Transferência" };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Movimentações — {product.name}</h3>
        <p className="mt-1 text-xs text-muted">Estoque total: <b>{product.stockQty}</b></p>
        {byStore.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {byStore.map((s, i) => (
              <span key={i} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11px]">{s.store}: <b>{s.qty}</b></span>
            ))}
          </div>
        )}
        {stores.length > 1 && (
          <TransferForm product={product} stores={stores} onDone={() => { load(); onChanged?.(); }} />
        )}
        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
          {items === null ? <p className="text-sm text-muted">Carregando…</p>
            : items.length === 0 ? <p className="text-sm text-muted">Nenhuma movimentação registrada.</p>
            : items.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{KIND[m.kind] ?? m.kind}</span>
                  {m.reason && <span className="ml-2 text-xs text-muted">{m.reason}</span>}
                  <span className="block text-[10px] text-muted">{new Date(m.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <div className="text-right">
                  <span className={`font-semibold ${m.qty < 0 ? "text-red-300" : "text-green-300"}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                  {m.qtyAfter != null && <span className="block text-[10px] text-muted">saldo {m.qtyAfter}</span>}
                </div>
              </div>
            ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-xl border border-line py-2 text-sm text-muted transition hover:text-fg">fechar</button>
      </div>
    </div>
  );
}

function TransferForm({ product, stores, onDone }: { product: Product; stores: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(stores[0]?.id ?? "");
  const [to, setTo] = useState(stores[1]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/products/${product.id}/transfer-stock`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ fromStoreId: from, toStoreId: to, qty: Math.max(1, parseInt(qty || "0", 10) || 0) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setMsg(d?.error?.message ?? "Falha na transferência"); return; }
      setMsg("Transferência feita ✅"); setQty("1"); onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
      <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-brand hover:underline">{open ? "− Transferir entre lojas" : "+ Transferir entre lojas"}</button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_70px] gap-2">
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="input-base py-1">
              {stores.map((s) => <option key={s.id} value={s.id}>De: {s.name}</option>)}
            </select>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="input-base py-1">
              {stores.map((s) => <option key={s.id} value={s.id}>Para: {s.name}</option>)}
            </select>
            <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="input-base py-1" />
          </div>
          {msg && <p className="text-xs text-muted">{msg}</p>}
          <button disabled={busy || from === to} onClick={submit} className="btn-grad px-3 py-1 text-xs disabled:opacity-50">{busy ? "..." : "Transferir"}</button>
        </div>
      )}
    </div>
  );
}

type ImportRow = { sku: string; name: string; priceCents: number | null; stockQty: number; ncm: string | null };
function parseEstoque(raw: string): { rows: ImportRow[]; ignored: number } {
  const num = (s: string) => { const n = Number(String(s).trim().replace(/\./g, "").replace(",", ".")); return isNaN(n) ? null : n; };
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  let ignored = 0;
  // formato ERP "sintética": CODIGO NOME ... UN ESTOQUE PRECO NCM
  const erp = /^(\d{3,7})\s+(.+?)\s+UN\s+(-?[\d.]*,\d{2})\s+([\d.]*,\d{2})\s+([\d.]+)\s*$/;
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    let sku = "", name = "", est: number | null = 0, preco: number | null = null, ncm: string | null = null;
    const m = erp.exec(line);
    if (m) {
      sku = m[1]!; name = m[2]!.trim(); est = num(m[3]!); preco = num(m[4]!); ncm = (m[5] || "").replace(/\D/g, "") || null;
    } else if (/[;\t]/.test(line)) {
      // CSV/TSV: sku ; nome ; estoque ; preco ; ncm
      const c = line.split(/[;\t]/).map((x) => x.trim());
      if (c.length >= 2 && c[1]) { sku = c[0] || ""; name = c[1]!; est = num(c[2] || "0"); preco = num(c[3] || ""); ncm = (c[4] || "").replace(/\D/g, "") || null; }
      else { ignored++; continue; }
    } else { ignored++; continue; }
    const key = (sku || name).toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ sku, name, priceCents: preco != null ? Math.round(preco * 100) : null, stockQty: est != null ? Math.trunc(est) : 0, ncm });
  }
  return { rows, ignored };
}

function ImportEstoque({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [reuseImage, setReuseImage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const parsed = parseEstoque(text);
  const brl = (c: number | null) => c == null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  async function importar() {
    if (!parsed.rows.length) { setErr("Cole as linhas do estoque primeiro."); return; }
    setBusy(true); setErr(null);
    try {
      const items = parsed.rows.map((r) => ({ sku: r.sku || null, name: r.name, priceCents: r.priceCents, stockQty: r.stockQty, ncm: r.ncm }));
      const res = await fetch("/api/products/import", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ items, reuseImage }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Falha na importação"); return; }
      setResult(d);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Importar estoque</h3>
        <p className="mt-1 text-xs text-muted">Cole as linhas do relatório de estoque (formato do seu sistema: <code>CÓDIGO NOME … UN ESTOQUE PREÇO NCM</code>) ou um CSV <code>código;nome;estoque;preço;ncm</code>. Categoria (Armações/Lentes) e estoque negativo→0 são tratados automaticamente. Produtos com SKU já existente são ignorados.</p>
        {result ? (
          <div className="mt-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm">
            <p className="font-semibold text-green-300">Importação concluída ✅</p>
            <p className="mt-1">Criados: <b>{result.created}</b> · Ignorados (já existiam): <b>{result.skipped}</b> · Total enviado: {result.total}</p>
            <button onClick={onDone} className="btn-grad mt-3">Concluir</button>
          </div>
        ) : (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="000162 ARMA ACTION JS5017 C3 UN -1,00 390,00 90031100&#10;..." className="input-base mt-3 font-mono text-xs" />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={reuseImage} onChange={(e) => setReuseImage(e.target.checked)} className="h-4 w-4 accent-brand" /> Usar imagem de um produto já cadastrado (armação/lente) como provisória</label>
            <div className="mt-2 text-xs text-muted">Reconhecidos: <b className="text-fg">{parsed.rows.length}</b> item(ns){parsed.ignored ? ` · ${parsed.ignored} linha(s) ignorada(s) (cabeçalho/sem padrão)` : ""}.</div>
            {parsed.rows.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-left text-[10px] uppercase text-muted"><tr><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Produto</th><th className="px-2 py-1">Estoque</th><th className="px-2 py-1">Preço</th></tr></thead>
                  <tbody>
                    {parsed.rows.slice(0, 12).map((r, i) => (
                      <tr key={i} className="border-t border-line"><td className="px-2 py-1">{r.sku}</td><td className="px-2 py-1">{r.name}</td><td className="px-2 py-1">{Math.max(0, r.stockQty)}</td><td className="px-2 py-1">{brl(r.priceCents)}</td></tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 12 && <p className="px-2 py-1 text-[10px] text-muted">… e mais {parsed.rows.length - 12}.</p>}
              </div>
            )}
            {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
            <div className="mt-4 flex gap-2">
              <button disabled={busy || !parsed.rows.length} onClick={importar} className="btn-grad flex-1 disabled:opacity-50">{busy ? `Importando ${parsed.rows.length}…` : `Importar ${parsed.rows.length} produto(s)`}</button>
              <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ name, label, required, help, defaultValue }: { name: string; label: string; required?: boolean; help?: string; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}{required && <span className="text-brand"> *</span>}
      </span>
      <input name={name} required={required} defaultValue={defaultValue} autoComplete="off" className="input-base" />
      {help && <p className="mt-1 text-[10px] text-muted">{help}</p>}
    </label>
  );
}
