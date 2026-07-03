"use client";

import { use, useEffect, useMemo, useState } from "react";

interface CatProduct {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  priceCashCents: number | null;
  priceCardInstallmentsCents: number | null;
  maxInstallments: number | null;
}
interface Catalog {
  store: {
    slug: string;
    name: string;
    headline: string | null;
    city: string | null;
    state: string | null;
    logoUrl: string | null;
    primaryColor: string | null;
    orgName: string | null;
  };
  products: CatProduct[];
}
interface CartLine { id: string; name: string; qty: number; unitPriceCents: number }

function brl(cents: number | null): string {
  if (cents == null) return "sob consulta";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function StorefrontPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cat, setCat] = useState<string>("");
  const [showCheckout, setShowCheckout] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/catalog/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Catalog | null) => {
        if (!d) { setNotFound(true); return; }
        setData(d);
        const hex = d.store.primaryColor;
        if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
          const int = parseInt(hex.slice(1), 16);
          document.documentElement.style.setProperty("--brand", `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`);
        }
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (data?.products ?? []).forEach((p) => p.category && set.add(p.category));
    return Array.from(set).sort();
  }, [data]);

  const shown = useMemo(
    () => (data?.products ?? []).filter((p) => !cat || p.category === cat),
    [data, cat],
  );

  const cartTotal = cart.reduce((s, l) => s + l.unitPriceCents * l.qty, 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  function add(p: CatProduct) {
    const price = p.priceCashCents ?? 0;
    setCart((c) => {
      const ex = c.find((l) => l.id === p.id);
      if (ex) return c.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { id: p.id, name: p.name, qty: 1, unitPriceCents: price }];
    });
  }
  function setQty(id: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.id !== id) : c.map((l) => (l.id === id ? { ...l, qty } : l))));
  }

  async function submit() {
    setErr(null);
    if (name.trim().length < 2) { setErr("Informe seu nome"); return; }
    if (phone.replace(/\D/g, "").length < 8) { setErr("Informe um WhatsApp válido"); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/public/catalog/${slug}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone,
          message: msg.trim() || null,
          items: cart.map((l) => ({ productId: l.id, name: l.name, qty: l.qty, unitPriceCents: l.unitPriceCents })),
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); setErr(d?.error?.message ?? "Falha ao enviar"); return; }
      setDone(true);
      setCart([]);
    } catch {
      setErr("Erro de conexão");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Centered>Carregando vitrine...</Centered>;
  if (notFound || !data) return <Centered>Esta vitrine não está disponível.</Centered>;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8">
      {/* cabeçalho */}
      <header className="mb-8 flex flex-col items-center text-center">
        {data.store.logoUrl ? (
          <img src={data.store.logoUrl} alt={data.store.name} className="h-16 w-auto max-w-[220px] object-contain" />
        ) : (
          <h1 className="text-2xl font-bold" style={{ color: "rgb(var(--brand))" }}>{data.store.name}</h1>
        )}
        <h2 className="mt-3 text-xl font-semibold">{data.store.headline ?? data.store.name}</h2>
        {(data.store.city || data.store.state) && (
          <p className="mt-1 text-sm text-muted">{[data.store.city, data.store.state].filter(Boolean).join(" · ")}</p>
        )}
      </header>

      {/* filtros de categoria */}
      {categories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <FilterChip active={cat === ""} onClick={() => setCat("")}>Tudo</FilterChip>
          {categories.map((c) => (
            <FilterChip key={c} active={cat === c} onClick={() => setCat(c)}>{c}</FilterChip>
          ))}
        </div>
      )}

      {/* grade de produtos */}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-sm text-muted">Nenhum produto publicado.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <div key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg/60">
              <div className="aspect-square w-full bg-line/40">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted">sem foto</div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-4">
                {p.category && <span className="mb-1 text-[10px] uppercase tracking-wider text-muted">{p.category}</span>}
                <p className="font-medium">{p.name}</p>
                {p.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description}</p>}
                <div className="mt-3 flex-1">
                  <p className="text-lg font-semibold">{brl(p.priceCashCents)}</p>
                  {p.priceCardInstallmentsCents && p.maxInstallments ? (
                    <p className="text-[11px] text-muted">
                      ou {p.maxInstallments}x de {brl(Math.round(p.priceCardInstallmentsCents / p.maxInstallments))}
                    </p>
                  ) : null}
                </div>
                <button
                  onClick={() => add(p)}
                  className="mt-3 w-full rounded-lg py-2 text-sm font-semibold text-white transition hover:opacity-90"
                  style={{ background: "rgb(var(--brand))" }}
                >
                  Adicionar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* barra do carrinho fixa */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="text-sm">
              <strong>{cartCount}</strong> item(ns) · <strong>{brl(cartTotal)}</strong>
            </div>
            <button
              onClick={() => { setDone(false); setShowCheckout(true); }}
              className="rounded-lg px-5 py-2 text-sm font-semibold text-white"
              style={{ background: "rgb(var(--brand))" }}
            >
              Finalizar pedido
            </button>
          </div>
        </div>
      )}

      {/* modal de checkout / lead */}
      {showCheckout && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setShowCheckout(false)}>
          <div className="w-full max-w-md rounded-t-2xl border border-line bg-bg p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            {done ? (
              <div className="text-center">
                <h3 className="text-lg font-semibold">Pedido enviado! ✅</h3>
                <p className="mt-2 text-sm text-muted">A loja vai te chamar no WhatsApp para finalizar. Obrigado!</p>
                <button onClick={() => setShowCheckout(false)} className="mt-4 w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ background: "rgb(var(--brand))" }}>
                  Fechar
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold">Seu pedido</h3>
                <ul className="mt-3 max-h-40 space-y-2 overflow-auto text-sm">
                  {cart.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2">
                      <span className="flex-1 truncate">{l.name}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setQty(l.id, l.qty - 1)} className="h-6 w-6 rounded border border-line">−</button>
                        <span className="w-6 text-center">{l.qty}</span>
                        <button onClick={() => setQty(l.id, l.qty + 1)} className="h-6 w-6 rounded border border-line">+</button>
                      </div>
                      <span className="w-20 text-right">{brl(l.unitPriceCents * l.qty)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold">
                  <span>Total</span><span>{brl(cartTotal)}</span>
                </p>
                <div className="mt-4 space-y-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp (com DDD)" inputMode="tel" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
                  <textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Observação (opcional)" rows={2} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
                </div>
                {err && <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}
                <button onClick={submit} disabled={sending} className="mt-3 w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "rgb(var(--brand))" }}>
                  {sending ? "Enviando..." : "Enviar pedido pelo WhatsApp"}
                </button>
                <button onClick={() => setShowCheckout(false)} className="mt-2 w-full text-center text-xs text-muted hover:text-fg">continuar comprando</button>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="mt-12 pb-24 text-center text-[11px] text-muted">
        {data.store.orgName ? `${data.store.orgName} · ` : ""}Vitrine online por YUGO
      </footer>
    </main>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? "border-transparent text-white" : "border-line text-muted hover:text-fg"}`}
      style={active ? { background: "rgb(var(--brand))" } : undefined}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-muted">{children}</div>;
}
