"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Product {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  priceCashCents: number | null;
  priceCardFullCents: number | null;
  priceCardInstallmentsCents: number | null;
  priceCreditCents: number | null;
  maxInstallments: number | null;
  stockQty?: number;
  minStockQty?: number;
  trackStock?: boolean;
}
interface Store { id: string; name: string }
interface Customer { id: string; name: string; document: string | null; phone: string | null; birthDate?: string | null }
interface Account { id: string; document: string; holderName: string; limitCents: string; usedCents: string; status: string }

type PayMethod = "cash" | "pix" | "card_full" | "card_installments" | "credit";
type TenderMethod = "cash" | "pix" | "card";

interface CartItem {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
}

interface Tender {
  id: string;
  method: TenderMethod;
  amountCents: number;
  provider: "mp" | "infinitepay" | null;
  cardType?: "credit" | "debit" | null;
}

const TENDER_LABEL: Record<TenderMethod, string> = {
  cash: "Dinheiro",
  pix: "Pix",
  card: "Cartão",
};

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function priceFor(p: Product, method: PayMethod): number {
  switch (method) {
    case "cash":
    case "pix":
      return p.priceCashCents ?? 0;
    case "card_full":
      return p.priceCardFullCents ?? p.priceCashCents ?? 0;
    case "card_installments":
      return p.priceCardInstallmentsCents ?? p.priceCashCents ?? 0;
    case "credit":
      return p.priceCreditCents ?? p.priceCashCents ?? 0;
  }
}

export function SalesClient({
  products,
  stores,
  customers,
  accounts,
  recentSales,
  defaultMaxInstallments,
  sellers = [],
}: {
  products: Product[];
  stores: Store[];
  customers: Customer[];
  accounts: Account[];
  recentSales: any[];
  defaultMaxInstallments: number;
  sellers?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [sellerId, setSellerId] = useState("");
  const [prodQ, setProdQ] = useState("");
  // saldo por LOJA (atualiza ao trocar de loja) → aviso de estoque por loja
  const [storeStock, setStoreStock] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!storeId) { setStoreStock({}); return; }
    fetch(`/api/products?storeId=${storeId}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const map: Record<string, number> = {};
        for (const p of d?.items ?? []) map[p.id] = p.storeStockQty ?? p.stockQty ?? 0;
        setStoreStock(map);
      })
      .catch(() => setStoreStock({}));
  }, [storeId]);
  const stockOf = (p: { id: string; stockQty?: number | null }) => (p.id in storeStock ? storeStock[p.id] : (p.stockQty ?? 0));

  // filtra por nome/SKU/valor e agrupa por categoria
  const filteredProductGroups = (() => {
    const s = prodQ.trim().toLowerCase();
    const digits = s.replace(/\D/g, "");
    const filtered = !s ? products : products.filter((p) => {
      const inName = p.name.toLowerCase().includes(s);
      const inSku = (p.sku ?? "").toLowerCase().includes(s);
      const inPrice = digits.length > 0 && [p.priceCashCents, p.priceCardInstallmentsCents, p.priceCreditCents].some((c) => c != null && String(c).includes(digits));
      return inName || inSku || inPrice;
    });
    const groups = new Map<string, Product[]>();
    for (const p of filtered) {
      const cat = (p.category ?? "").trim() || "Outros";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();
  // busca unica de cliente (nome / cpf / nascimento) + selecao
  const [custQuery, setCustQuery] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  // cadastro de cliente novo (walk-in) — colapsado
  const [showNewCust, setShowNewCust] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBirth, setNewBirth] = useState("");
  const [newDoc, setNewDoc] = useState("");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [accountId, setAccountId] = useState("");
  const [installments, setInstallments] = useState(1);
  const [downPayment, setDownPayment] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Pix (forma única): modal manual vs MP vs InfinitePay
  const [pixMode, setPixMode] = useState<"manual" | "mp" | "infinitepay">("manual");
  const [showPixModal, setShowPixModal] = useState(false);
  const [pixModalTarget, setPixModalTarget] = useState<"single" | "split">("single");
  // sub-passo do modal de Pix: escolha principal ou opções InfinitePay
  const [pixStep, setPixStep] = useState<"main" | "infinitepay">("main");
  // links InfinitePay gerados após a venda (mostra/copia/abre)
  const [linkResult, setLinkResult] = useState<string | null>(null);
  // split de pagamento
  const [split, setSplit] = useState(false);
  const [tenders, setTenders] = useState<Tender[]>([]);
  // crediário como PARTE do split: valor financiado (o resto/entrada vai nos tenders)
  const [creditSplitAmount, setCreditSplitAmount] = useState("0");
  // QR retornado após gerar Pix MP
  const [qrResult, setQrResult] = useState<{ qrCode: string; qrBase64: string } | null>(null);
  const [qrCopied, setQrCopied] = useState(false);
  const [pixSalePaymentId, setPixSalePaymentId] = useState<string | null>(null);
  const [pixPaid, setPixPaid] = useState(false);

  // autorefresh: enquanto o QR Pix MP está aberto, consulta o status no MP a cada 5s
  useEffect(() => {
    if (!qrResult || !pixSalePaymentId || pixPaid) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/payments/transactions/sale/${pixSalePaymentId}/force`, { method: "POST", credentials: "include", headers: { "x-no-loading": "1" } });
        const d = await r.json().catch(() => null);
        if (d && ["paid", "approved"].includes(d.status)) {
          setPixPaid(true);
          // mostra "pago" por ~1,8s e fecha o modal sozinho
          setTimeout(() => setQrResult(null), 1800);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, [qrResult, pixSalePaymentId, pixPaid]);
  // caixa: PDV exige caixa aberto. undefined=carregando, null=fechado, obj=aberto
  const [cashRegister, setCashRegister] = useState<any | null | undefined>(undefined);
  const [openingFloat, setOpeningFloat] = useState("0");
  const [openingCaixa, setOpeningCaixa] = useState(false);

  const loadCash = useMemo(() => async (sid: string) => {
    if (!sid) { setCashRegister(null); return; }
    try {
      const res = await fetch(`/api/cash/current?storeId=${sid}`, { credentials: "include", cache: "no-store" });
      const d = await res.json().catch(() => null);
      setCashRegister(d?.register ?? null);
    } catch { setCashRegister(null); }
  }, []);
  useEffect(() => { setCashRegister(undefined); void loadCash(storeId); }, [storeId, loadCash]);

  async function abrirCaixa() {
    setOpeningCaixa(true); setError(null);
    try {
      const res = await fetch("/api/cash/open", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ storeId, openingFloatCents: Math.round((parseFloat(openingFloat.replace(",", ".")) || 0) * 100) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setError(d?.error?.message ?? "Falha ao abrir caixa"); return; }
      setCashRegister(d?.register ?? null);
      setError(null);
    } finally { setOpeningCaixa(false); }
  }

  const priceMethod: PayMethod = method;
  const total = useMemo(
    () => cart.reduce((s, it) => s + it.unitPriceCents * it.qty, 0),
    [cart],
  );
  const tendersTotal = useMemo(() => tenders.reduce((s, t) => s + t.amountCents, 0), [tenders]);
  const creditSplitCents = split ? Math.max(0, Math.round(Number(creditSplitAmount.replace(",", ".")) * 100)) : 0;
  const remaining = total - tendersTotal - creditSplitCents;

  // busca clientes por nome, CPF (digitos) ou data de nascimento
  const custMatches = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    return customers
      .filter((c) => {
        const byName = c.name.toLowerCase().includes(q);
        const byDoc = digits.length >= 3 && (c.document ?? "").replace(/\D/g, "").includes(digits);
        const byBirth = digits.length >= 3 && (c.birthDate ?? "").replace(/\D/g, "").includes(digits);
        return byName || byDoc || byBirth;
      })
      .slice(0, 8);
  }, [custQuery, customers]);

  function pickCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustQuery("");
    setCustOpen(false);
    setShowNewCust(false);
  }
  function clearCustomer() {
    setSelectedCustomer(null);
    setCustQuery("");
  }

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const accountAvailable = selectedAccount
    ? Number(selectedAccount.limitCents) - Number(selectedAccount.usedCents)
    : 0;
  const financed = total - Math.round(Number(downPayment.replace(",", ".")) * 100);
  const creditExceeds =
    method === "credit" && selectedAccount && financed > accountAvailable;
  const creditBlocked =
    method === "credit" && selectedAccount && selectedAccount.status !== "active";

  const [stockWarn, setStockWarn] = useState<string | null>(null);
  function addProduct(p: Product) {
    const existing = cart.find((it) => it.productId === p.id);
    const newQty = (existing?.qty ?? 0) + 1;
    // aviso (não bloqueia): produto com controle de estoque sem saldo NA LOJA
    if (p.trackStock && newQty > stockOf(p)) setStockWarn(`⚠️ ${p.name}: sem saldo nesta loja (atual ${stockOf(p)}). A venda fica negativa.`);
    else setStockWarn(null);
    setCart((c) => {
      const ex = c.find((it) => it.productId === p.id);
      if (ex) return c.map((it) => (it.productId === p.id ? { ...it, qty: it.qty + 1 } : it));
      return [...c, { productId: p.id, name: p.name, qty: 1, unitPriceCents: priceFor(p, priceMethod) }];
    });
  }

  function updateMethod(m: PayMethod) {
    setMethod(m);
    // recalcula precos do carrinho pra forma escolhida
    setCart((c) =>
      c.map((it) => {
        const p = products.find((x) => x.id === it.productId);
        return p ? { ...it, unitPriceCents: priceFor(p, m) } : it;
      }),
    );
    // crediário não aceita split
    if (m === "credit") setSplit(false);
    // ao escolher Pix como forma única, abre o modal manual/MP
    if (m === "pix" && !split) {
      setPixModalTarget("single");
      setShowPixModal(true);
    }
  }

  // ---- split / tenders ----
  function addTender(tm: TenderMethod, provider: "mp" | "infinitepay" | null = null) {
    const amt = Math.max(0, remaining);
    setTenders((t) => [...t, { id: uid(), method: tm, amountCents: amt, provider, cardType: tm === "card" ? "credit" : null }]);
  }
  function setTenderCardType(id: string, cardType: "credit" | "debit") {
    setTenders((t) => t.map((x) => (x.id === id ? { ...x, cardType } : x)));
  }
  function startAddTender(tm: TenderMethod) {
    if (tm === "pix") {
      setPixModalTarget("split");
      setShowPixModal(true);
      return;
    }
    addTender(tm, null);
  }
  function setTenderCents(id: string, cents: number) {
    setTenders((t) => t.map((x) => (x.id === id ? { ...x, amountCents: Math.max(0, cents) } : x)));
  }
  function removeTender(id: string) {
    setTenders((t) => t.filter((x) => x.id !== id));
  }
  function choosePix(mode: "manual" | "mp" | "infinitepay_link" | "infinitepay_manual") {
    // "maquininha manual" da InfinitePay = passa direto (igual Pix manual);
    // "link" gera o checkout InfinitePay (provider infinitepay).
    const provider: "mp" | "infinitepay" | null =
      mode === "mp" ? "mp" : mode === "infinitepay_link" ? "infinitepay" : null;
    const single: "manual" | "mp" | "infinitepay" =
      mode === "mp" ? "mp" : mode === "infinitepay_link" ? "infinitepay" : "manual";
    if (pixModalTarget === "split") {
      addTender("pix", provider);
    } else {
      setPixMode(single);
    }
    setShowPixModal(false);
    setPixStep("main");
  }
  function toggleSplit() {
    setSplit((s) => {
      const next = !s;
      if (!next) setTenders([]);
      return next;
    });
  }

  /** Monta o array de pagamentos enviado ao backend (split ou Pix MP único). */
  function buildPayments(): Tender[] | null {
    if (method === "credit") return null;
    if (split) {
      return tenders.length > 0 ? tenders : null;
    }
    // forma única em Pix MP → gera 1 pagamento Pix MP (resto do fluxo é "passa direto")
    if (method === "pix" && pixMode === "mp") {
      return [{ id: "single", method: "pix", amountCents: total, provider: "mp" }];
    }
    // forma única em Pix InfinitePay (link) → 1 pagamento provider infinitepay
    if (method === "pix" && pixMode === "infinitepay") {
      return [{ id: "single", method: "pix", amountCents: total, provider: "infinitepay" }];
    }
    return null;
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    setQrResult(null);
    if (!cashRegister) { setError("Caixa fechado. Abra o caixa para vender."); return; }
    if (cart.length === 0) { setError("Carrinho vazio"); return; }
    if (method === "credit" && !accountId) { setError("Selecione a conta de crediário"); return; }
    if (split && creditSplitCents > 0 && !accountId) { setError("Selecione a conta de crediário para a parte parcelada"); return; }
    if (split) {
      if (tenders.length === 0 && creditSplitCents === 0) { setError("Adicione ao menos um pagamento ao dividir"); return; }
      if (remaining !== 0) {
        setError(remaining > 0 ? `Faltam ${brl(remaining)} para fechar o total` : `Excedeu ${brl(-remaining)} do total`);
        return;
      }
    }

    const payments = buildPayments();
    const payload: any = {
      storeId,
      sellerUserId: sellerId || null,
      customerId: selectedCustomer?.id ?? null,
      customerInline:
        !selectedCustomer && showNewCust && newName.trim()
          ? { name: newName.trim(), document: newDoc.trim() || null, birthDate: newBirth.trim() || null }
          : null,
      paymentMethod: method,
      items: cart.map((it) => ({
        productId: it.productId,
        productName: it.name,
        qty: it.qty,
        unitPriceCents: it.unitPriceCents,
        priceType:
          method === "pix" ? "cash" : (method as any),
      })),
    };
    if (payments) {
      payload.payments = payments.map((t) => ({
        method: t.method,
        amountCents: t.amountCents,
        provider: t.provider ?? undefined,
        cardType: t.method === "card" ? (t.cardType ?? "credit") : undefined,
      }));
    }
    if (method === "credit") {
      payload.creditAccountId = accountId;
      payload.installmentsCount = installments;
      payload.downPaymentCents = Math.round(Number(downPayment.replace(",", ".")) * 100);
    }
    // crediário como parte do split: financia a fatia; tenders pagam o resto/entrada
    if (split && creditSplitCents > 0) {
      payload.paymentMethod = "credit";
      payload.creditAmountCents = creditSplitCents;
      payload.creditAccountId = accountId;
      payload.installmentsCount = installments;
    }

    const res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) { setError(data?.error?.message ?? "Falha na venda"); return; }

    // Pix MP retornou QR? mostra para o cliente pagar
    const pixMp = (data.sale?.payments ?? []).find(
      (p: any) => p.method === "pix" && p.provider === "mp" && (p.mpQrBase64 || p.mpQrCode),
    );
    const requestedPixMp = !!payments?.some((t) => t.method === "pix" && t.provider === "mp");
    if (pixMp) {
      setQrResult({ qrCode: pixMp.mpQrCode ?? "", qrBase64: pixMp.mpQrBase64 ?? "" });
      setPixSalePaymentId(pixMp.id ?? null);
      setPixPaid(false);
    } else if (requestedPixMp) {
      // venda registrou, mas o MP não devolveu QR (provável: integração inativa)
      setError("Venda registrada, mas o Pix do Mercado Pago não foi gerado. Verifique em Pagamentos se o Mercado Pago da empresa está conectado e ativo.");
    }

    // InfinitePay: pagamento com link gerado → mostra/abre o link (já enviado por WhatsApp/e-mail)
    const ipPay = (data.sale?.payments ?? []).find((p: any) => p.provider === "infinitepay" && p.link);
    const requestedInfinitepay = !!payments?.some((t) => t.method === "pix" && t.provider === "infinitepay");
    if (ipPay?.link) {
      setLinkResult(ipPay.link);
    } else if (requestedInfinitepay) {
      setError("Venda registrada, mas o link InfinitePay não foi gerado. Verifique em Pagamentos se a InfinitePay está ativa (handle informada).");
    }

    const ref = data.sale.shortCode ?? data.sale.id;
    setSuccess((requestedPixMp || requestedInfinitepay) ? `Venda ${ref} registrada como PENDENTE — confirma sozinha quando o pagamento cair (acompanhe em Transações).` : `Venda registrada: ${ref}`);
    setCart([]);
    setAccountId("");
    setSelectedCustomer(null);
    setShowNewCust(false);
    setNewName(""); setNewBirth(""); setNewDoc("");
    setCustQuery("");
    setSplit(false);
    setTenders([]);
    setPixMode("manual");
    startTransition(() => router.refresh());
  }

  const [showSales, setShowSales] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <button onClick={() => setShowSales(true)} className="fixed bottom-4 left-4 z-40 rounded-full border border-line bg-bg/90 px-4 py-2 text-xs font-semibold shadow-lg backdrop-blur transition hover:border-brand">↺ Vendas / emitir NF-e / devoluções</button>
      {showSales && <RecentSalesModal sales={recentSales} onClose={() => setShowSales(false)} onChanged={() => startTransition(() => router.refresh())} />}
      {/* Gate obrigatório: sem caixa aberto não vende */}
      {cashRegister === null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 text-2xl">🔒</div>
            <h3 className="text-lg font-semibold">Caixa fechado</h3>
            <p className="mt-1 text-sm text-muted">Para vender no PDV é preciso abrir o caixa desta loja.</p>
            {stores.length > 1 && (
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="mt-4 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <label className="mt-3 block text-left">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Troco inicial (fundo de caixa)</span>
              <input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal" placeholder="0,00" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            </label>
            {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>}
            <button onClick={abrirCaixa} disabled={openingCaixa || !storeId} className="mt-4 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {openingCaixa ? "Abrindo..." : "Abrir caixa"}
            </button>
            <a href="/app" className="mt-2 inline-block text-xs text-muted hover:text-fg">voltar ao painel</a>
          </div>
        </div>
      )}

      {/* Catálogo (busca + agrupado por categoria) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Produtos</h2>
        {stockWarn && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>{stockWarn}</span>
            <button onClick={() => setStockWarn(null)} className="shrink-0 text-amber-200/70 hover:text-amber-100">✕</button>
          </div>
        )}
        <input
          value={prodQ}
          onChange={(e) => setProdQ(e.target.value)}
          placeholder="Buscar por nome, SKU ou valor"
          className="mb-3 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
        />
        {filteredProductGroups.length === 0 ? (
          <p className="text-sm text-muted">{products.length === 0 ? "Nenhum produto ativo. Cadastre em Produtos." : "Nenhum produto encontrado."}</p>
        ) : filteredProductGroups.map(([cat, items]) => (
          <div key={cat} className="mb-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-brand">{cat} <span className="text-muted">({items.length})</span></p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className="flex items-center gap-3 rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand"
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-line text-[10px] text-muted">sem foto</div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{brl(priceFor(p, priceMethod))}</p>
                    {p.trackStock && (
                      <p className={`mt-0.5 text-[10px] font-semibold ${stockOf(p) <= 0 ? "text-red-300" : stockOf(p) <= (p.minStockQty ?? 0) ? "text-amber-300" : "text-muted"}`}>
                        {stockOf(p) <= 0 ? "sem estoque (loja)" : `estoque loja: ${stockOf(p)}`}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Carrinho / checkout */}
      <aside className="space-y-4 rounded-xl border border-line bg-bg/60 p-5 h-fit lg:sticky lg:top-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Venda</h2>

        {stores.length > 1 && (
          <Select label="Loja" value={storeId} onChange={setStoreId} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
        )}
        {sellers.length > 0 && (
          <Select
            label="Vendedor (comissão)"
            value={sellerId}
            onChange={setSellerId}
            options={[{ value: "", label: "— eu mesmo —" }, ...sellers.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
        <div className="space-y-2 rounded-lg border border-line bg-bg/40 p-3">
          <span className="block text-xs font-medium uppercase tracking-wider text-muted">Cliente</span>

          {selectedCustomer ? (
            <div className="flex items-center justify-between gap-2 rounded border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {selectedCustomer.name}
                {selectedCustomer.document ? ` · ${selectedCustomer.document}` : ""}
              </span>
              <button onClick={clearCustomer} className="shrink-0 text-muted hover:text-red-300">×</button>
            </div>
          ) : showNewCust ? (
            <div className="space-y-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do novo cliente"
                className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newBirth}
                  onChange={(e) => setNewBirth(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="nascimento ddmmaaaa"
                  inputMode="numeric"
                  className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
                />
                <input
                  value={newDoc}
                  onChange={(e) => setNewDoc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="CPF (só números)"
                  inputMode="numeric"
                  className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
                />
              </div>
              <button onClick={() => setShowNewCust(false)} className="text-[11px] text-muted hover:text-fg">
                ← buscar cliente existente
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={custQuery}
                onChange={(e) => { setCustQuery(e.target.value); setCustOpen(true); }}
                onFocus={() => setCustOpen(true)}
                placeholder="Buscar por nome, CPF ou nascimento"
                className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
              />
              {custOpen && custMatches.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-bg shadow-xl">
                  {custMatches.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => pickCustomer(c)}
                        className="block w-full px-3 py-2 text-left text-sm transition hover:bg-line"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.document && <span className="text-xs text-muted"> · {c.document}</span>}
                        {c.phone && <span className="block text-[11px] text-muted">{c.phone}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {custQuery.trim().length >= 2 && custMatches.length === 0 && (
                <p className="mt-1 text-[11px] text-muted">Nenhum cliente encontrado.</p>
              )}
              <button
                onClick={() => { setShowNewCust(true); setCustOpen(false); }}
                className="mt-2 text-[11px] text-brand hover:underline"
              >
                + cadastrar novo cliente
              </button>
            </div>
          )}
        </div>

        <Select
          label="Forma de pagamento"
          value={method}
          onChange={(v) => updateMethod(v as PayMethod)}
          options={[
            { value: "cash", label: "Dinheiro" },
            { value: "pix", label: "Pix" },
            { value: "card_full", label: "Cartão à vista" },
            { value: "card_installments", label: "Cartão parcelado" },
            { value: "credit", label: "Crediário" },
          ]}
        />

        {/* Pix forma única: indica manual/MP e permite trocar */}
        {method === "pix" && !split && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
            <span>
              Pix: <strong>{pixMode === "mp" ? "Mercado Pago (gera QR)" : "Manual (passa direto)"}</strong>
            </span>
            <button
              onClick={() => { setPixModalTarget("single"); setShowPixModal(true); }}
              className="shrink-0 text-xs text-brand hover:underline"
            >
              trocar
            </button>
          </div>
        )}

        {/* Dividir pagamento em vários meios (não disponível no crediário) */}
        {method !== "credit" && (
          <div className="space-y-3 rounded-lg border border-line bg-bg/40 p-3">
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">Dividir pagamento</span>
              <input type="checkbox" checked={split} onChange={toggleSplit} className="h-4 w-4 accent-[var(--brand,#6d28d9)]" />
            </label>

            {split && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {(["cash", "pix", "card"] as TenderMethod[]).map((tm) => (
                    <button
                      key={tm}
                      onClick={() => startAddTender(tm)}
                      className="rounded-lg border border-line bg-bg/60 px-3 py-1.5 text-xs font-medium transition hover:border-brand"
                    >
                      + {TENDER_LABEL[tm]}
                    </button>
                  ))}
                </div>

                {tenders.length === 0 ? (
                  <p className="text-[11px] text-muted">Adicione os meios usados (ex.: R$100 cartão + R$50 Pix + R$50 dinheiro).</p>
                ) : (
                  <ul className="space-y-2">
                    {tenders.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="w-20 shrink-0 text-xs">
                          {TENDER_LABEL[t.method]}
                          {t.method === "pix" && (
                            <span className="block text-[10px] text-muted">{t.provider === "mp" ? "MP" : "manual"}</span>
                          )}
                        </span>
                        <TenderAmountInput cents={t.amountCents} onChangeCents={(c) => setTenderCents(t.id, c)} />
                        <button onClick={() => removeTender(t.id)} className="shrink-0 text-muted hover:text-red-300">×</button>
                        {t.method === "card" && (
                          <div className="flex w-full gap-1 pl-20">
                            {(["credit", "debit"] as const).map((ct) => (
                              <button
                                key={ct}
                                onClick={() => setTenderCardType(t.id, ct)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${ (t.cardType ?? "credit") === ct ? "border-brand text-brand" : "border-line text-muted"}`}
                              >
                                {ct === "credit" ? "Crédito" : "Débito"}
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Crediário como PARTE do split — financia uma fatia; o resto é a entrada (meios acima) */}
                <div className="rounded-lg border border-line bg-bg/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">💳 Crediário (parcelar parte)</span>
                    <TenderAmountInput cents={creditSplitCents} onChangeCents={(c) => setCreditSplitAmount(((c || 0) / 100).toFixed(2))} />
                  </div>
                  {creditSplitCents > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs">
                        <option value="">conta de crediário…</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.holderName}</option>)}
                      </select>
                      <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs">
                        {Array.from({ length: Math.max(1, defaultMaxInstallments) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}x</option>)}
                      </select>
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-muted">A entrada/restante é paga nos meios acima (dinheiro, cartão crédito/débito, Pix maquininha ou Pix MP).</p>
                </div>

                <p className="flex items-center justify-between text-xs">
                  <span className="text-muted">Restante</span>
                  <strong className={remaining === 0 ? "text-green-300" : "text-red-300"}>{brl(remaining)}</strong>
                </p>
              </div>
            )}
          </div>
        )}

        {method === "credit" && (
          <div className="space-y-3 rounded-lg border border-brand/30 bg-bg/40 p-3">
            <Select
              label="Conta de crediário"
              value={accountId}
              onChange={setAccountId}
              options={[{ value: "", label: "— selecione —" }, ...accounts.map((a) => ({ value: a.id, label: `${a.holderName} · ${a.document}` }))]}
            />
            {selectedAccount && (
              <p className="text-xs text-muted">
                Disponível: <strong className={accountAvailable < financed ? "text-red-300" : "text-green-300"}>{brl(accountAvailable)}</strong>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase text-muted">Entrada (R$)</span>
                <input value={downPayment} onChange={(e) => setDownPayment(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase text-muted">Parcelas</span>
                <select value={installments} onChange={(e) => setInstallments(Number(e.target.value))} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                  {Array.from({ length: defaultMaxInstallments }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}x</option>
                  ))}
                </select>
              </label>
            </div>
            {creditBlocked && <p className="text-xs text-red-300">⚠ Cliente {selectedAccount?.status} — venda bloqueada</p>}
            {creditExceeds && <p className="text-xs text-red-300">⚠ Limite insuficiente</p>}
          </div>
        )}

        <div className="border-t border-line pt-3">
          {cart.length === 0 ? (
            <p className="text-sm text-muted">Carrinho vazio.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {cart.map((it) => (
                <li key={it.productId} className="flex items-center justify-between gap-2">
                  <span className="flex-1 truncate">{it.qty}× {it.name}</span>
                  <span>{brl(it.unitPriceCents * it.qty)}</span>
                  <button onClick={() => setCart((c) => c.filter((x) => x.productId !== it.productId))} className="text-muted hover:text-red-300">×</button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex items-center justify-between text-lg font-semibold">
            <span>Total</span><span>{brl(total)}</span>
          </p>
        </div>

        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        {success && <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-200">{success}</p>}

        <button
          onClick={submit}
          disabled={isPending || cart.length === 0 || !!creditExceeds || !!creditBlocked || (split && ((tenders.length === 0 && creditSplitCents === 0) || remaining !== 0))}
          className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Registrando..." : "Finalizar venda"}
        </button>
      </aside>

      {/* Modal: Pix manual ou Pix MP */}
      {showPixModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => { setShowPixModal(false); setPixStep("main"); }}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {pixStep === "main" ? (
              <>
                <h3 className="text-base font-semibold">Como receber em Pix?</h3>
                <p className="mt-1 text-sm text-muted">Escolha a forma de cobrança.</p>
                <div className="mt-4 grid gap-2">
                  <button onClick={() => choosePix("manual")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand">
                    <span className="block text-sm font-medium">Pix manual</span>
                    <span className="block text-xs text-muted">Cliente já pagou na sua chave — passa direto.</span>
                  </button>
                  <button onClick={() => choosePix("mp")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand">
                    <span className="block text-sm font-medium">Pix Mercado Pago</span>
                    <span className="block text-xs text-muted">Gera o QR Code com baixa automática.</span>
                  </button>
                  <button onClick={() => setPixStep("infinitepay")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand">
                    <span className="block text-sm font-medium">Pix InfinitePay</span>
                    <span className="block text-xs text-muted">Link de pagamento ou maquininha manual.</span>
                  </button>
                </div>
                <button onClick={() => { setShowPixModal(false); setPixStep("main"); }} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">
                  cancelar
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">InfinitePay</h3>
                <p className="mt-1 text-sm text-muted">Como deseja cobrar?</p>
                <div className="mt-4 grid gap-2">
                  <button onClick={() => choosePix("infinitepay_link")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand">
                    <span className="block text-sm font-medium">Cobrar com link InfinitePay</span>
                    <span className="block text-xs text-muted">Gera o link (Pix/cartão até 12x) e envia ao cliente por WhatsApp/e-mail. Baixa automática.</span>
                  </button>
                  <button onClick={() => choosePix("infinitepay_manual")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand">
                    <span className="block text-sm font-medium">Maquininha manual</span>
                    <span className="block text-xs text-muted">Você cobra na maquininha física — passa direto.</span>
                  </button>
                </div>
                <button onClick={() => setPixStep("main")} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">
                  ‹ voltar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: link InfinitePay gerado */}
      {linkResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setLinkResult(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Link InfinitePay gerado</h3>
            <p className="mt-1 text-sm text-muted">Enviado ao cliente por WhatsApp/e-mail. Baixa automática quando pagar.</p>
            <a href={linkResult} target="_blank" rel="noreferrer" className="mt-4 block w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white">Abrir link ↗</a>
            <button
              onClick={() => { navigator.clipboard?.writeText(linkResult).then(() => { setQrCopied(true); setTimeout(() => setQrCopied(false), 2000); }); }}
              className="mt-3 w-full break-all rounded-lg border border-line bg-bg/60 px-3 py-2 text-[11px] text-muted transition hover:border-brand"
            >
              {qrCopied ? "✓ copiado!" : linkResult}
            </button>
            <button onClick={() => setLinkResult(null)} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">fechar</button>
          </div>
        </div>
      )}

      {/* Modal: QR Code do Pix MP gerado */}
      {qrResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setQrResult(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Pix gerado</h3>
            {pixPaid ? (
              <p className="mt-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-300">✅ Pagamento confirmado!</p>
            ) : (
              <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Aguardando pagamento… (confirma automático)
              </p>
            )}
            {qrResult.qrBase64 ? (
              <img src={`data:image/png;base64,${qrResult.qrBase64}`} alt="QR Pix" className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2" />
            ) : (
              <p className="mt-4 text-xs text-muted">QR indisponível — use o código copia e cola abaixo.</p>
            )}
            {qrResult.qrCode && (
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(qrResult.qrCode).then(() => {
                    setQrCopied(true);
                    setTimeout(() => setQrCopied(false), 2000);
                  });
                }}
                className="mt-4 w-full break-all rounded-lg border border-line bg-bg/60 px-3 py-2 text-[11px] text-muted transition hover:border-brand"
              >
                {qrCopied ? "✓ copiado!" : qrResult.qrCode}
              </button>
            )}
            <button onClick={() => setQrResult(null)} className="mt-3 w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white transition hover:opacity-90">
              Concluir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Campo de valor do split: digitação livre (números , .) e formata em R$ no blur. */
function TenderAmountInput({ cents, onChangeCents }: { cents: number; onChangeCents: (cents: number) => void }) {
  const [str, setStr] = useState(cents ? (cents / 100).toFixed(2) : "");
  // sincroniza quando o valor externo muda sem ser por digitação (ex.: default ao adicionar)
  useEffect(() => {
    const current = Math.round((Number(str.replace(/\./g, "").replace(",", ".")) || 0) * 100);
    if (current !== cents) setStr(cents ? (cents / 100).toFixed(2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);

  function handle(raw: string) {
    const cleaned = raw.replace(/[^\d.,]/g, "");
    setStr(cleaned);
    const n = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    onChangeCents(isNaN(n) ? 0 : Math.round(n * 100));
  }
  function blur() {
    setStr(cents ? (cents / 100).toFixed(2) : "");
  }

  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">R$</span>
      <input
        value={str}
        onChange={(e) => handle(e.target.value)}
        onBlur={blur}
        inputMode="decimal"
        placeholder="0,00"
        className="w-full rounded border border-line bg-bg/60 py-1 pl-7 pr-2 text-sm"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function RecentSalesModal({ sales, onClose, onChanged }: { sales: any[]; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nfce, setNfce] = useState<Record<string, { ok: boolean; msg: string; docId?: string; status?: string }>>({});
  const [nfeFor, setNfeFor] = useState<any | null>(null);
  const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  async function cancel(id: string) {
    if (!confirm("Cancelar/devolver esta venda? Os produtos com controle de estoque voltam ao estoque.")) return;
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/sales/${id}/cancel`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ reason: "Devolução no PDV" }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Não foi possível cancelar"); return; }
      onChanged();
    } finally { setBusy(null); }
  }
  async function emitirNfce(id: string) {
    setBusy(`nfce:${id}`); setErr(null);
    try {
      const res = await fetch("/api/fiscal/nfce/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ saleId: id }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setNfce((m) => ({ ...m, [id]: { ok: false, msg: d?.error?.message ?? "Falha ao emitir NFC-e" } })); return; }
      const autorizada = d?.status === "autorizada";
      setNfce((m) => ({ ...m, [id]: { ok: autorizada, msg: autorizada ? `Autorizada · chave ${d?.chave ?? ""}` : `${d?.cStat ?? ""} ${d?.xMotivo ?? "rejeitada"}`.trim(), docId: d?.id, status: d?.status } }));
    } finally { setBusy(null); }
  }
  async function enviarNfce(saleId: string, docId: string) {
    setBusy(`envia:${saleId}`); setErr(null);
    try {
      const res = await fetch(`/api/fiscal/nfce/${docId}/enviar`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setNfce((m) => ({ ...m, [saleId]: { ...(m[saleId] ?? { ok: true, msg: "" }), msg: d?.error?.message ?? "Falha ao enviar" } })); return; }
      const wa = d?.sent?.whatsapp, em = d?.sent?.email;
      const canais = [wa ? "WhatsApp" : null, em ? "e-mail" : null].filter(Boolean).join(" + ");
      setNfce((m) => ({ ...m, [saleId]: { ...(m[saleId] ?? { ok: true, msg: "" }), msg: canais ? `Nota enviada por ${canais} ✅` : "Sem canal de contato do cliente" } }));
    } finally { setBusy(null); }
  }
  async function correcaoNfce(saleId: string, docId: string) {
    const corr = prompt("Texto da carta de correção (15 a 1000 caracteres). Não pode mudar valores de imposto, destinatário ou data:");
    if (corr == null) return;
    if (corr.trim().length < 15) { setErr("A correção precisa ter ao menos 15 caracteres."); return; }
    setBusy(`cce:${saleId}`); setErr(null);
    try {
      const res = await fetch(`/api/fiscal/nfce/${docId}/correcao`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ correcao: corr.trim() }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setNfce((m) => ({ ...m, [saleId]: { ...(m[saleId] ?? { ok: false, msg: "" }), msg: d?.error?.message ?? "Falha na correção" } })); return; }
      setNfce((m) => ({ ...m, [saleId]: { ...(m[saleId] ?? { ok: true, msg: "" }), msg: d?.registrada ? "Carta de correção registrada ✅" : `CC-e ${d?.cStat ?? ""} ${d?.xMotivo ?? "não registrada"}`.trim() } }));
    } finally { setBusy(null); }
  }
  async function cancelarNfce(saleId: string, docId: string) {
    const just = prompt("Justificativa do cancelamento (15 a 255 caracteres):");
    if (just == null) return;
    if (just.trim().length < 15) { setErr("A justificativa precisa ter ao menos 15 caracteres."); return; }
    setBusy(`cancnfce:${saleId}`); setErr(null);
    try {
      const res = await fetch(`/api/fiscal/nfce/${docId}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ justificativa: just.trim() }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setNfce((m) => ({ ...m, [saleId]: { ...(m[saleId] ?? { ok: false, msg: "" }), msg: d?.error?.message ?? "Falha ao cancelar" } })); return; }
      const cancelada = d?.status === "cancelada";
      setNfce((m) => ({ ...m, [saleId]: { ok: cancelada, msg: cancelada ? "NFC-e cancelada ✅" : `${d?.cStat ?? ""} ${d?.xMotivo ?? "não cancelada"}`.trim(), docId, status: d?.status } }));
    } finally { setBusy(null); }
  }
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Vendas — emitir nota / devolver</h3>
        <p className="mt-1 text-xs text-muted">A venda não exige nota: emita a <b>NFC-e</b> ou <b>NF-e</b> aqui quando quiser (precisa do certificado A1 + CSC configurados em <b>Nota fiscal</b>). Cancelar/devolver repõe o estoque.</p>
        {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
        <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
          {(!sales || sales.length === 0) ? <p className="text-sm text-muted">Nenhuma venda recente.</p> : sales.map((s) => (
            <div key={s.id} className="rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{brl(Number(s.totalCents))}</span>
                  <span className="ml-2 text-xs text-muted">{s.paymentMethod}{s.shortCode ? ` · ${s.shortCode}` : ""}</span>
                  <span className="block text-[10px] text-muted">{new Date(s.createdAt).toLocaleString("pt-BR")} · {(s.items?.length ?? 0)} item(ns)</span>
                </div>
                {s.status === "canceled" ? (
                  <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">cancelada</span>
                ) : (
                  <div className="flex shrink-0 gap-1.5">
                    <button disabled={busy === `nfce:${s.id}`} onClick={() => emitirNfce(s.id)} className="rounded-md border border-line px-2 py-1 text-xs text-brand hover:border-brand disabled:opacity-50">{busy === `nfce:${s.id}` ? "..." : "Emitir NFC-e"}</button>
                    <button onClick={() => setNfeFor(s)} className="rounded-md border border-line px-2 py-1 text-xs text-brand hover:border-brand">NF-e</button>
                    <button disabled={busy === s.id} onClick={() => cancel(s.id)} className="rounded-md border border-line px-2 py-1 text-xs text-red-300 hover:border-red-400 disabled:opacity-50">{busy === s.id ? "..." : "Devolver"}</button>
                  </div>
                )}
              </div>
              {nfce[s.id] && (
                <div className="mt-1.5">
                  <p className={`rounded-md px-2 py-1 text-[11px] ${nfce[s.id].ok ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>{nfce[s.id].ok ? "✓ " : "⚠ "}{nfce[s.id].msg}</p>
                  {nfce[s.id].docId && nfce[s.id].status === "autorizada" && (
                    <div className="mt-1 flex gap-1.5">
                      <a href={`/api/fiscal/nfce/${nfce[s.id].docId}/danfce`} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2 py-1 text-[11px] hover:border-brand">DANFE (PDF)</a>
                      <button disabled={busy === `envia:${s.id}`} onClick={() => enviarNfce(s.id, nfce[s.id].docId!)} className="rounded-md border border-line px-2 py-1 text-[11px] hover:border-brand disabled:opacity-50">{busy === `envia:${s.id}` ? "..." : "Enviar ao cliente"}</button>
                      <button disabled={busy === `cce:${s.id}`} onClick={() => correcaoNfce(s.id, nfce[s.id].docId!)} className="rounded-md border border-line px-2 py-1 text-[11px] hover:border-brand disabled:opacity-50">{busy === `cce:${s.id}` ? "..." : "Carta de correção"}</button>
                      <button disabled={busy === `cancnfce:${s.id}`} onClick={() => cancelarNfce(s.id, nfce[s.id].docId!)} className="rounded-md border border-line px-2 py-1 text-[11px] text-red-300 hover:border-red-400 disabled:opacity-50">{busy === `cancnfce:${s.id}` ? "..." : "Cancelar"}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-line py-2 text-sm text-muted hover:text-fg">fechar</button>
      </div>
      {nfeFor && <NfeModal sale={nfeFor} onClose={() => setNfeFor(null)} onResult={(r) => setNfce((m) => ({ ...m, [nfeFor.id]: r }))} />}
    </div>
  );
}

function NfeModal({ sale, onClose, onResult }: { sale: any; onClose: () => void; onResult: (r: { ok: boolean; msg: string; docId?: string; status?: string }) => void }) {
  const [d, setD] = useState<any>({ documento: "", nome: "", indIEDest: "9", ie: "", logradouro: "", numero: "", bairro: "", municipio: "", cmun: "", uf: "", cep: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setD((s: any) => ({ ...s, [k]: v }));
  async function emitir() {
    const doc = d.documento.replace(/\D/g, "");
    if (doc.length !== 11 && doc.length !== 14) { setErr("Informe CPF (11) ou CNPJ (14) do destinatário."); return; }
    if (!d.uf || !d.cmun.replace(/\D/g, "")) { setErr("UF e código IBGE do município são obrigatórios."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/fiscal/nfe/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ saleId: sale.id, dest: { ...d, indIEDest: Number(d.indIEDest) } }) });
      const r = await res.json().catch(() => null);
      if (!res.ok) { setErr(r?.error?.message ?? "Falha ao emitir NF-e"); return; }
      const autorizada = r?.status === "autorizada";
      onResult({ ok: autorizada, msg: autorizada ? `NF-e autorizada · chave ${r?.chave ?? ""}` : `NF-e ${r?.cStat ?? ""} ${r?.xMotivo ?? "rejeitada"}`.trim(), docId: r?.id, status: r?.status });
      onClose();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Emitir NF-e (55)</h3>
        <p className="mt-1 text-xs text-muted">Destinatário da nota. O <b>código IBGE do município</b> (7 dígitos) é obrigatório no XML.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <NfeInp label="CPF/CNPJ" v={d.documento} on={(v) => set("documento", v)} />
          <NfeInp label="Nome / Razão social" v={d.nome} on={(v) => set("nome", v)} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Indicador IE</span>
            <select value={d.indIEDest} onChange={(e) => set("indIEDest", e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
              <option value="9">9 — Não contribuinte</option><option value="1">1 — Contribuinte ICMS</option><option value="2">2 — Isento de IE</option>
            </select></label>
          <NfeInp label="IE (se contribuinte)" v={d.ie} on={(v) => set("ie", v)} />
          <NfeInp label="Logradouro" v={d.logradouro} on={(v) => set("logradouro", v)} />
          <NfeInp label="Número" v={d.numero} on={(v) => set("numero", v)} />
          <NfeInp label="Bairro" v={d.bairro} on={(v) => set("bairro", v)} />
          <NfeInp label="Município" v={d.municipio} on={(v) => set("municipio", v)} />
          <NfeInp label="Cód. IBGE município" v={d.cmun} on={(v) => set("cmun", v)} />
          <NfeInp label="UF" v={d.uf} on={(v) => set("uf", v.toUpperCase().slice(0, 2))} />
          <NfeInp label="CEP" v={d.cep} on={(v) => set("cep", v)} />
          <NfeInp label="E-mail (opcional)" v={d.email} on={(v) => set("email", v)} />
        </div>
        {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={emitir} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Emitindo…" : "Emitir NF-e"}</button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function NfeInp({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">{label}</span><input value={v ?? ""} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>;
}
