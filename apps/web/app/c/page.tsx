"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandLogoClient } from "../../components/BrandLogoClient";
import { LensOrders } from "./LensOrders";

function brl(cents: number | string): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PortalDashboard() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    fetch("/api/portal/me", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => {
        if (d) {
          // troca obrigatoria no 1o acesso: força quando ainda não há senha
          // pessoal (entrou via WhatsApp/CPF) ou flag de reset marcada
          if (d.account?.mustResetPassword || d.hasPassword === false) {
            router.push("/c/redefinir"); return;
          }
          setData(d);
          // aplica cor da loja
          const hex = d.storeBrand?.primaryColor;
          if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
            const int = parseInt(hex.slice(1), 16);
            const triplet = `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
            document.documentElement.style.setProperty("--brand", triplet);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => { reload(); }, [reload]);

  // auto-refresh leve: atualiza ao voltar o foco pra aba + a cada 60s
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    const t = setInterval(reload, 60_000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [reload]);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST", credentials: "include" });
    router.push("/c/login");
  }

  if (loading) return <Centered>Carregando...</Centered>;
  if (!data) return <Centered>Carregando...</Centered>;

  // recursos do portal configurados pela empresa (null = mostra todos)
  const pf: string[] | null = Array.isArray(data.portalConfig) ? data.portalConfig : null;
  const showFeat = (k: string) => pf === null || pf.includes(k);

  // acc pode ser null: cliente sem crediário ainda acessa o portal
  const acc = data.account;
  const customer = data.customer;
  const displayName = (acc?.holderName ?? customer?.name ?? "Cliente").split(" ")[0];
  const displayDoc = acc?.document ?? customer?.document ?? "";
  const today = new Date();

  // situacao geral pro destaque (so quando ha crediario)
  const allInst = acc ? acc.purchases.flatMap((p: any) => p.installments) : [];
  const overdue = allInst.filter((i: any) => i.status !== "paid" && new Date(i.dueDate) < today);
  const soon = allInst.filter((i: any) => {
    const d = Math.floor((new Date(i.dueDate).getTime() - today.getTime()) / 86400_000);
    return i.status !== "paid" && d >= 0 && d <= 5;
  });
  const available = acc ? Number(acc.limitCents) - Number(acc.usedCents) : 0;
  const isDefaulted = acc?.status === "defaulted" || overdue.length >= 3;
  const frameClass = isDefaulted
    ? "credit-defaulted-frame"
    : overdue.length > 0
      ? "border-red-500/60"
      : soon.length > 0
        ? "border-orange-500/60"
        : "border-green-500/50";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        {data.storeBrand?.logoUrl ? (
          // logo do contratante de forma absoluta (object-contain, nao cortada)
          <img
            src={data.storeBrand.logoUrl}
            alt="logo"
            className="h-12 w-auto max-w-[180px] object-contain"
          />
        ) : (
          <BrandLogoClient size="md" />
        )}
        <nav className="flex items-center gap-4 text-sm">
          <button onClick={() => reload()} className="text-muted hover:text-fg" title="Atualizar">↻ Atualizar</button>
          <Link href="/c/dados" className="text-muted hover:text-fg">Meus dados</Link>
          {showFeat("chamados") && <Link href="/c/chamados" className="text-muted hover:text-fg">Chamados</Link>}
          {showFeat("os") && <Link href="/c/os" className="text-muted hover:text-fg">Ordens de serviço</Link>}
          {showFeat("pedidos") && <Link href="/c/pedidos" className="text-muted hover:text-fg">Meus pedidos</Link>}
          <Link href="/c/ajuda" className="text-muted hover:text-fg">Ajuda</Link>
          {showFeat("contratos") && <Link href="/c/contratos" className="text-muted hover:text-fg">Contratos</Link>}
          {showFeat("crediario") && <Link href="/c/limite" className="text-muted hover:text-fg">Pedir limite</Link>}
          <button onClick={logout} className="text-muted hover:text-red-300">Sair</button>
        </nav>
      </header>

      <div className="mb-6 flex items-center gap-3">
        {data.customer?.avatarUrl && (
          <img src={data.customer.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-2xl font-semibold">Olá, {displayName}</h1>
          <p className="text-sm text-muted">{displayDoc}</p>
        </div>
      </div>

      {/* Quadro do crediário — só quando a empresa usa crediário (portalConfig) */}
      {showFeat("crediario") && (acc ? (
        <section className={`rounded-2xl border bg-bg/60 p-6 ${frameClass}`}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Limite</p>
              <p className="mt-1 text-xl font-semibold">{brl(acc.limitCents)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Em uso</p>
              <p className="mt-1 text-xl font-semibold">{brl(acc.usedCents)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">Disponível</p>
              <p className="mt-1 text-xl font-semibold text-green-300">{brl(available)}</p>
            </div>
          </div>
          <p className="mt-4 text-sm">
            {isDefaulted ? (
              <span className="font-semibold text-red-300">⚠ Há parcelas em atraso. Regularize para evitar restrições.</span>
            ) : overdue.length > 0 ? (
              <span className="text-red-300">Você tem {overdue.length} parcela(s) vencida(s).</span>
            ) : soon.length > 0 ? (
              <span className="text-orange-300">Você tem {soon.length} parcela(s) a vencer em breve.</span>
            ) : (
              <span className="text-green-300">✓ Tudo em dia. Obrigado!</span>
            )}
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-bg/60 p-6">
          <p className="text-sm text-muted">
            Você ainda não tem crediário. Se quiser comprar parcelado, solicite um limite.
          </p>
          <Link href="/c/limite" className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
            Pedir limite
          </Link>
        </section>
      ))}

      {/* Cartão salvo p/ cobrança automática (só quando há crediário) */}
      {showFeat("crediario") && acc && <SavedCardSection onChanged={reload} />}

      {/* Agendamentos / exames */}
      {Array.isArray(data.appointments) && data.appointments.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold">Meus agendamentos</h2>
          <div className="space-y-2">
            {data.appointments.map((ap: any) => {
              const st: Record<string, string> = {
                pending: "Aguardando confirmação", confirmed: "Confirmado", rescheduled: "Reagendado",
                canceled: "Cancelado", attended: "Atendido", in_progress: "Em atendimento", no_show: "Faltou",
              };
              const d = new Date(ap.startsAt);
              return (
                <div key={ap.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4">
                  <div>
                    <p className="font-medium">{ap.serviceName || "Exame de vista"}</p>
                    <p className="text-xs text-muted">
                      {d.toLocaleDateString("pt-BR", { timeZone: "UTC" })} ·{" "}
                      {ap.byArrival ? `a partir das ${d.toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })} (ordem de chegada)` : d.toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}
                      {ap.professionalName ? ` · ${ap.professionalName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-muted">{st[ap.status] ?? ap.status}</span>
                    {ap.shortCode && ["pending", "confirmed", "rescheduled"].includes(ap.status) && (
                      <a href={`/a/${ap.shortCode}`} className="text-xs text-brand hover:underline">gerenciar</a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Avaliação (NPS) sempre disponível */}
      <NpsCard />

      {/* Rastreio + detalhes dos pedidos de lente */}
      <LensOrders orders={data.lensOrders ?? []} onRefresh={reload} />

      {/* Minhas compras (qualquer meio de pagamento) */}
      {Array.isArray(data.purchases) && data.purchases.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold">Minhas compras</h2>
          <div className="space-y-2">
            {data.purchases.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-line bg-bg/60 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {(Number(p.totalCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-muted">{p.paymentMethod}</span>
                  </p>
                  <span className="text-xs text-muted">{new Date(p.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
                {Array.isArray(p.items) && p.items.length > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    {p.items.map((i: any) => `${i.qty}× ${i.name}`).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Compras + parcelas — só quando a empresa usa crediário */}
      {showFeat("crediario") && acc && (
      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Minhas compras</h2>
        {acc.purchases.length === 0 ? (
          <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhuma compra no crediário.</p>
        ) : (
          <div className="space-y-4">
            {acc.purchases.map((p: any) => (
              <div key={p.id} className="rounded-xl border border-line bg-bg/60 p-5">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{brl(p.totalCents)} em {p.installmentsCount}x</p>
                  <span className="text-xs text-muted">{new Date(p.createdAt).toLocaleDateString("pt-BR")}</span>
                </div>
                <div className="mt-3 space-y-1">
                  {p.installments.map((inst: any) => {
                    const due = new Date(inst.dueDate);
                    const days = Math.floor((due.getTime() - today.getTime()) / 86400_000);
                    let cls = "text-muted", label = "em dia";
                    if (inst.status === "paid") { cls = "text-green-300"; label = "pago"; }
                    else if (days < 0) { cls = "text-red-300"; label = "vencido"; }
                    else if (days <= 5) { cls = "text-orange-300"; label = "a vencer"; }
                    const discount = Number(inst.discountCents ?? 0);
                    const original = Number(inst.originalAmountCents ?? 0);
                    return (
                      <div key={inst.id} className="border-b border-line/40 py-2 last:border-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-mono text-xs">{inst.number}. {due.toLocaleDateString("pt-BR")}</span>
                          <span>{brl(inst.amountCents)}</span>
                          <span className={`text-xs ${cls}`}>{label}</span>
                          {inst.status !== "paid" && (
                            <PayInstallment installmentId={inst.id} onPaid={reload} />
                          )}
                        </div>
                        {inst.status === "paid" && discount > 0 && (
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 pl-4 text-[11px] text-muted">
                            {original > 0 && <span>Valor com encargos: <s>{brl(original)}</s></span>}
                            <span className="text-green-300">Desconto: {brl(discount)}</span>
                            <span>Total pago: <strong>{brl(inst.paidAmountCents ?? inst.amountCents)}</strong></span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted">{children}</div>;
}

// carrega o SDK do Mercado Pago (v2) uma única vez
let mpSdkPromise: Promise<any> | null = null;
function loadMpSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if ((window as any).MercadoPago) return Promise.resolve((window as any).MercadoPago);
  if (mpSdkPromise) return mpSdkPromise;
  mpSdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://sdk.mercadopago.com/js/v2";
    s.async = true;
    s.onload = () => resolve((window as any).MercadoPago);
    s.onerror = () => reject(new Error("Falha ao carregar Mercado Pago"));
    document.head.appendChild(s);
  });
  return mpSdkPromise;
}

/**
 * Cartão salvo para cobrança automática do crediário.
 * Modelo: cartão salvo no MP + cobrança avulsa de cada parcela no vencimento.
 * A tokenização usa o SDK do MP (Secure Fields) — o número do cartão NUNCA passa
 * pelo nosso código; só recebemos o token + bandeira/4 últimos.
 */
function SavedCardSection({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<{ hasCard: boolean; autoCharge: boolean; last4: string | null; brand: string | null; publicKey: string | null } | null>(null);
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [holder, setHolder] = useState("");
  const [ready, setReady] = useState(false);
  const mpRef = useState<{ mp: any; fields: any; pmId: string | null }>({ mp: null, fields: null, pmId: null })[0];

  const load = useCallback(() => {
    fetch("/api/portal/credit-card", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // monta os Secure Fields quando abre o formulário
  useEffect(() => {
    if (!form || !status?.publicKey) return;
    let canceled = false;
    (async () => {
      try {
        const MP = await loadMpSdk();
        if (canceled) return;
        const mp = new MP(status.publicKey, { locale: "pt-BR" });
        const fields = mp.fields;
        const opts = { placeholder: "" };
        fields.create("cardNumber", { ...opts, placeholder: "Número do cartão" }).mount("mp-card-number");
        fields.create("expirationDate", { ...opts, placeholder: "MM/AA" }).mount("mp-card-exp");
        fields.create("securityCode", { ...opts, placeholder: "CVV" }).mount("mp-card-cvv");
        mpRef.mp = mp;
        mpRef.fields = fields;
        // detecta a bandeira pelo BIN p/ obter o payment_method_id
        fields.on("binChange", async (e: any) => {
          const bin = e?.bin;
          if (!bin || bin.length < 6) return;
          try {
            const pm = await mp.getPaymentMethods({ bin });
            mpRef.pmId = pm?.results?.[0]?.id ?? null;
          } catch { /* ignore */ }
        });
        setReady(true);
      } catch (e: any) {
        setErr(e?.message ?? "Falha ao carregar o cartão");
      }
    })();
    return () => { canceled = true; };
  }, [form, status?.publicKey, mpRef]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      if (!mpRef.fields) throw new Error("Formulário não carregou");
      const token = await mpRef.fields.createCardToken({ cardholderName: holder || undefined });
      const tokenId = token?.id ?? token?.token;
      if (!tokenId) throw new Error("Não foi possível validar o cartão");
      const res = await fetch("/api/portal/credit-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          cardToken: tokenId,
          last4: token?.last_four_digits ?? null,
          brand: mpRef.pmId ?? null,
          pmId: mpRef.pmId ?? null,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao salvar o cartão"); return; }
      setForm(false); setReady(false); setHolder("");
      load(); onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar o cartão");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remover o cartão salvo? A cobrança automática será desligada.")) return;
    setBusy(true);
    try {
      await fetch("/api/portal/credit-card/remove", { method: "POST", credentials: "include" });
      load(); onChanged();
    } finally { setBusy(false); }
  }

  if (!status) return null;
  // sem chave pública configurada na empresa → não dá pra tokenizar
  const canTokenize = !!status.publicKey;

  return (
    <section className="mt-6 rounded-2xl border border-line bg-bg/60 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Cobrança automática</h2>
          <p className="text-xs text-muted">Cadastre um cartão e suas parcelas são pagas sozinhas no vencimento.</p>
        </div>
        {status.hasCard && (
          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">ativa</span>
        )}
      </div>

      {status.hasCard ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-bg/40 p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded bg-line px-2 py-1 text-xs uppercase">{status.brand ?? "cartão"}</span>
            <span className="font-mono">•••• {status.last4 ?? "????"}</span>
          </div>
          <button disabled={busy} onClick={remove} className="text-xs text-red-300 hover:underline disabled:opacity-50">remover</button>
        </div>
      ) : !canTokenize ? (
        <p className="mt-4 rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs text-muted">
          Cobrança automática indisponível nesta loja no momento.
        </p>
      ) : !form ? (
        <button onClick={() => setForm(true)} className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          Cadastrar cartão
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}
          <input
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="Nome impresso no cartão"
            className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div id="mp-card-number" className="h-10 rounded-lg border border-line bg-bg/40 px-3" />
          <div className="grid grid-cols-2 gap-3">
            <div id="mp-card-exp" className="h-10 rounded-lg border border-line bg-bg/40 px-3" />
            <div id="mp-card-cvv" className="h-10 rounded-lg border border-line bg-bg/40 px-3" />
          </div>
          <div className="flex items-center gap-2">
            <button disabled={busy || !ready} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Salvando…" : ready ? "Salvar cartão" : "Carregando…"}
            </button>
            <button disabled={busy} onClick={() => { setForm(false); setReady(false); setErr(null); }} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">
              cancelar
            </button>
          </div>
          <p className="text-[10px] text-muted">🔒 Seus dados vão direto e criptografados ao Mercado Pago. Não guardamos o número do cartão.</p>
        </div>
      )}
    </section>
  );
}

/** Avaliação NPS sempre visível: o cliente dá uma nota de 0 a 10 quando quiser. */
function NpsCard() {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (score == null) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/portal/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ npsScore: score, comment: comment || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha ao enviar");
      setDone(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="mt-8 rounded-2xl border border-line bg-bg/60 p-6">
      <h2 className="text-lg font-semibold">Como você avalia nosso atendimento?</h2>
      {done ? (
        <p className="mt-3 text-sm text-green-300">✓ Obrigado pela sua avaliação!</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">De 0 (não recomendaria) a 10 (recomendaria com certeza).</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, i) => i).map((n) => (
              <button
                key={n}
                onClick={() => setScore(n)}
                className={`h-9 w-9 rounded-lg border text-sm font-medium transition ${score === n ? "border-brand bg-brand text-white" : "border-line text-muted hover:border-brand"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Quer deixar um comentário? (opcional)"
            rows={2}
            className="mt-3 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
          />
          {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          <button
            onClick={submit}
            disabled={busy || score == null}
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Enviando..." : "Enviar avaliação"}
          </button>
        </>
      )}
    </section>
  );
}

/** Botão "pagar" da parcela: escolhe Pix (QR) ou Cartão (link MP). Baixa automática via webhook. */
function PayInstallment({ installmentId, onPaid }: { installmentId: string; onPaid: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pix, setPix] = useState<{ qrCode: string | null; qrCodeBase64: string | null } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pixPaid, setPixPaid] = useState(false);

  // autorefresh: enquanto o Pix está aberto, consulta o status a cada 5s
  useEffect(() => {
    if (!pix || pixPaid) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/portal/installments/${installmentId}/check`, { method: "POST", credentials: "include", headers: { "x-no-loading": "1" } });
        const d = await r.json().catch(() => null);
        if (d && d.status === "paid") { setPixPaid(true); onPaid(); }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, [pix, pixPaid, installmentId]);

  async function pay(method: "pix" | "card" | "infinitepay") {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/portal/installments/${installmentId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error?.message ?? "Falha ao gerar pagamento"); return; }
      if (method === "card") {
        if (data.initPoint) window.open(data.initPoint, "_blank");
        setOpen(false);
        onPaid();
      } else if (method === "infinitepay") {
        if (data.link) window.open(data.link, "_blank");
        setLink(data.link ?? null);
      } else {
        setPix({ qrCode: data.qrCode ?? null, qrCodeBase64: data.qrCodeBase64 ?? null });
      }
    } catch {
      setErr("Erro de conexão");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false); setPix(null); setLink(null); setErr(null); setCopied(false);
    onPaid();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-brand hover:underline">
        pagar
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {link ? (
              <>
                <h3 className="text-base font-semibold">Link de pagamento</h3>
                <p className="mt-1 text-sm text-muted">Pague por Pix ou cartão (até 12x) no link abaixo.</p>
                <a href={link} target="_blank" rel="noreferrer" className="mt-4 block w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white">Abrir pagamento ↗</a>
                <button
                  onClick={() => { navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
                  className="mt-3 w-full break-all rounded-lg border border-line bg-bg/60 px-3 py-2 text-[11px] text-muted transition hover:border-brand"
                >
                  {copied ? "✓ copiado!" : link}
                </button>
                <button onClick={close} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">fechar</button>
              </>
            ) : pix ? (
              <>
                <h3 className="text-base font-semibold">Pix gerado</h3>
                {pixPaid ? (
                  <p className="mt-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-300">✅ Pagamento confirmado!</p>
                ) : (
                  <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted">
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Aguardando pagamento… (confirma automático)
                  </p>
                )}
                {pix.qrCodeBase64 ? (
                  <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Pix" className="mx-auto mt-4 h-56 w-56 rounded-lg bg-white p-2" />
                ) : (
                  <p className="mt-4 text-xs text-muted">QR indisponível — use o código copia e cola.</p>
                )}
                {pix.qrCode && (
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(pix.qrCode!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
                    }}
                    className="mt-4 w-full break-all rounded-lg border border-line bg-bg/60 px-3 py-2 text-[11px] text-muted transition hover:border-brand"
                  >
                    {copied ? "✓ copiado!" : pix.qrCode}
                  </button>
                )}
                <button onClick={close} className="mt-3 w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white">Concluir</button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold">Como deseja pagar?</h3>
                {err && <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}
                <div className="mt-4 grid gap-2">
                  <button disabled={busy} onClick={() => pay("pix")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand disabled:opacity-50">
                    <span className="block text-sm font-medium">Pix</span>
                    <span className="block text-xs text-muted">Gera o QR Code na hora.</span>
                  </button>
                  <button disabled={busy} onClick={() => pay("card")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand disabled:opacity-50">
                    <span className="block text-sm font-medium">Cartão</span>
                    <span className="block text-xs text-muted">Abre o checkout do Mercado Pago.</span>
                  </button>
                  <button disabled={busy} onClick={() => pay("infinitepay")} className="rounded-lg border border-line bg-bg/60 p-3 text-left transition hover:border-brand disabled:opacity-50">
                    <span className="block text-sm font-medium">InfinitePay (Pix ou cartão)</span>
                    <span className="block text-xs text-muted">Abre o checkout da InfinitePay.</span>
                  </button>
                </div>
                <button onClick={close} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">cancelar</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
