import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";
import { BrandLogo } from "../components/BrandLogo";
import { EntrarMenu } from "../components/EntrarMenu";
import { ContactForm } from "../components/ContactForm";
import { getPublicSettings } from "../lib/platform";
import { apiFetch } from "../lib/api";
import { MODULE_GROUPS, moduleLabel, planLimitLines } from "../lib/modules";

export const dynamic = "force-dynamic";

interface Plan {
  id: string; slug: string; name: string; description: string | null; highlight: string | null;
  priceCents: number; currency: string; interval: string; trialDays: number;
  maxStores: number | null; maxUsers: number | null; maxMessagesMonth: number | null;
  features: string[]; extraHighlights?: string[]; isActive: boolean; displayOrder: number;
}

const GROUP_BLURB: Record<string, string> = {
  "Operação": "O dia a dia: agenda com confirmação por WhatsApp, leads, disparos, PDV e caixa.",
  "Comercial": "Clientes, mala direta, catálogo online, comissões e NPS para vender mais.",
  "Ótica": "Fornecedores, pedidos de lente com rastreio e repasses para médicos/laboratórios.",
  "Financeiro": "Crediário próprio, pagamentos (Pix/cartão), régua de cobrança e relatórios.",
  "Documentos": "Contratos com assinatura eletrônica e modelos de mensagem.",
  "Pessoas": "RH completo: ponto com selfie, holerite, escala, férias, vale e empréstimos.",
};

export default async function HomePage() {
  const s = await getPublicSettings();
  const year = new Date().getFullYear();
  const plansRes = await apiFetch<{ items: Plan[] }>("/api/plans");
  const plans = (plansRes.data?.items ?? []).filter((p) => p.isActive);
  const supportWhats = (s as any).supportWhatsapp || (s as any).supportPhone || null;

  return (
    <main className="relative">
      {/* Topbar */}
      <nav className="sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <BrandLogo size="md" className="transition-opacity hover:opacity-80" />
          <div className="flex items-center gap-3">
            <Link href="/apresentacao" className="hidden text-sm text-muted hover:text-fg sm:block">Demonstração</Link>
            <a href="#solucoes" className="hidden text-sm text-muted hover:text-fg sm:block">Soluções</a>
            <a href="#modulos" className="hidden text-sm text-muted hover:text-fg sm:block">Módulos</a>
            <a href="#planos" className="hidden text-sm text-muted hover:text-fg sm:block">Planos</a>
            <a href="#contato" className="hidden text-sm text-muted hover:text-fg sm:block">Contato</a>
            <EntrarMenu />
            <ThemeToggle />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 text-center">
        <span className="inline-block rounded-full border border-brand/40 bg-brand/10 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
          SaaS multi-loja · Óticas, clínicas e varejo
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl bg-gradient-to-br from-brand via-fg to-brand bg-clip-text text-5xl font-semibold leading-tight tracking-tight text-transparent md:text-6xl">
          Toda a sua operação num só sistema.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          {s.tagline ?? "Agenda, vendas, crediário, cobrança, ótica e RH — com WhatsApp integrado, contratos com assinatura digital e relatórios de verdade. Sem planilha, sem gambiarra."}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/apresentacao" className="rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">▶ Ver demonstração</Link>
          <a href="#solucoes" className="rounded-lg border border-line px-6 py-3 text-sm font-semibold transition hover:border-brand">Soluções</a>
          <Link href="/planos" className="rounded-lg border border-line px-6 py-3 text-sm font-semibold transition hover:border-brand">Ver planos</Link>
        </div>
        <p className="mt-4 text-xs text-muted">14 dias grátis · sem cartão no cadastro · cancele quando quiser</p>
      </section>

      {/* Destaques */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Agenda + WhatsApp", "Confirma, lembra e reagenda o paciente sozinho. Menos falta, mais cadeira ocupada."],
            ["Crediário próprio", "Venda parcelada com análise, contrato assinado e cobrança automática."],
            ["RH completo", "Ponto com selfie e geolocalização, holerite, escala, férias e empréstimos."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-line bg-bg/60 p-5">
              <p className="font-semibold">{t}</p>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Soluções por necessidade */}
      <section id="solucoes" className="mx-auto max-w-6xl px-6 py-20">
        <header className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Do jeito que a sua empresa precisa</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">Pegue o pacote completo da sua ótica, ou só o módulo que resolve a sua dor. Cresça contratando mais quando quiser.</p>
        </header>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {/* Ótica completa */}
          <div className="rounded-2xl border border-brand bg-brand/5 p-6 shadow-lg shadow-brand/10">
            <span className="rounded-full bg-brand px-3 py-1 text-[10px] font-semibold uppercase text-white">Mais completo</span>
            <h3 className="mt-3 text-xl font-semibold">Ótica completa 👓</h3>
            <p className="mt-2 text-sm text-muted">Tudo o que a sua ótica usa no dia a dia, integrado e com WhatsApp:</p>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {["Agenda + lembretes", "Vendas (PDV)", "Caixa diário", "Clientes", "Atendimento (IA)", "Chamados / OS", "Mala direta", "Produtos & vitrine", "Crediário próprio", "Cobrança automática", "Pedidos de lente", "RH & ponto"].map((x) => (
                <li key={x} className="flex items-center gap-2"><span className="text-brand">✓</span>{x}</li>
              ))}
            </ul>
            <Link href="/planos" className="mt-6 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">Ver planos completos</Link>
          </div>

          {/* Cards menores */}
          <div className="grid gap-5">
            <div className="rounded-2xl border border-line bg-bg/60 p-6">
              <h3 className="text-lg font-semibold">Só atendimento 🎧</h3>
              <p className="mt-2 text-sm text-muted">Central de WhatsApp com <b>IA integrada</b>: tria, responde, mostra produtos, agenda e transfere pro humano. Vários números, fila, supervisão e relatórios — sem precisar do resto.</p>
              <Link href="/apresentacao" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">Ver como funciona →</Link>
            </div>
            <div className="rounded-2xl border border-line bg-bg/60 p-6">
              <h3 className="text-lg font-semibold">Só agenda 📅</h3>
              <p className="mt-2 text-sm text-muted">Para qualquer empresa que marca horário: a agenda confirma, lembra e reagenda pelo WhatsApp sozinha. Menos falta, mais horário ocupado.</p>
              <Link href="/apresentacao" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">Ver como funciona →</Link>
            </div>
            <div className="rounded-2xl border border-line bg-bg/60 p-6">
              <h3 className="text-lg font-semibold">Monte do seu jeito 🧩</h3>
              <p className="mt-2 text-sm text-muted">Escolha um plano e ative só os módulos que usa. Precisou de mais? Contrate <b>módulos avulsos (à la carte)</b> a qualquer momento — sem trocar de plano.</p>
              <Link href="/planos" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">Ver planos →</Link>
            </div>
          </div>
        </div>

        {/* Portais */}
        <div className="mt-10">
          <h3 className="text-center text-lg font-semibold">Portais externos, inclusos e com a sua marca</h3>
          <div className="mt-5 grid gap-5 md:grid-cols-3">
            {[
              ["🙍 Portal do cliente", "Pedidos, 2ª via de Pix do crediário, contratos assinados, documentos e nota fiscal — no subdomínio da sua empresa."],
              ["🧑‍💼 Portal do funcionário (RH)", "Ponto com selfie, holerite, escala, férias, vale, atestado e comissões — tudo na mão do colaborador."],
              ["🏭 Portal do fornecedor", "Médicos e laboratórios recebem pedidos de lente, atualizam status e veem repasses, com login 2FA por WhatsApp."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-line bg-bg/60 p-5">
                <p className="font-semibold">{t}</p>
                <p className="mt-2 text-sm text-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Módulos */}
      <section id="modulos" className="mx-auto max-w-6xl px-6 py-20">
        <header className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Tudo num lugar só</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">Ative só os módulos que você precisa — e cresça contratando mais quando quiser.</p>
        </header>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {MODULE_GROUPS.map((g) => (
            <div key={g.group} className="rounded-2xl border border-line bg-bg/60 p-6">
              <h3 className="text-lg font-semibold text-brand">{g.group}</h3>
              <p className="mt-1 text-sm text-muted">{GROUP_BLURB[g.group]}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {g.modules.map((m) => (
                  <li key={m.key} className="flex items-center gap-2"><span className="text-brand">✓</span>{m.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Planos */}
      {plans.length > 0 && (
        <section id="planos" className="mx-auto max-w-6xl px-6 py-10">
          <header className="text-center">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Planos que cabem na sua operação</h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted">Todos com 14 dias grátis. Faça upgrade ou contrate módulos avulsos a qualquer momento.</p>
          </header>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const price = (p.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: p.currency });
              return (
                <div key={p.id} className={`relative flex flex-col rounded-2xl border bg-bg/60 p-6 ${p.highlight ? "border-brand shadow-lg shadow-brand/20" : "border-line"}`}>
                  {p.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-[10px] font-semibold uppercase text-white">{p.highlight}</div>}
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
                  <div className="mt-5 flex items-baseline gap-1"><span className="text-4xl font-semibold">{price}</span><span className="text-sm text-muted">{p.interval === "yearly" ? "/ano" : "/mês"}</span></div>
                  <ul className="mt-6 space-y-2 text-sm">
                    {planLimitLines(p).map((l) => <li key={l} className="flex gap-2 text-muted"><span>•</span>{l}</li>)}
                    {p.features.slice(0, 8).map((k) => <li key={k} className="flex gap-2"><span className="text-brand">✓</span>{moduleLabel(k)}</li>)}
                    {(p.extraHighlights ?? []).map((h, i) => <li key={i} className="flex gap-2"><span className="text-brand">★</span>{h}</li>)}
                  </ul>
                  <Link href={`/signup?plan=${p.slug}`} className={`mt-8 block rounded-lg py-3 text-center text-sm font-semibold transition ${p.highlight ? "bg-brand text-white hover:opacity-90" : "border border-line hover:border-brand"}`}>Começar grátis</Link>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Contato */}
      <section id="contato" className="mx-auto max-w-3xl px-6 py-20">
        <header className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Fale com a gente</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Deixe seus dados e nossa equipe entra em contato para uma demonstração.{supportWhats ? " Ou chame no WhatsApp." : ""}</p>
          {supportWhats && (
            <a href={`https://wa.me/55${String(supportWhats).replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-lg border border-line px-5 py-2 text-sm transition hover:border-brand">
              WhatsApp {supportWhats}
            </a>
          )}
        </header>
        <div className="mt-8"><ContactForm /></div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-muted sm:flex-row">
          <BrandLogo size="sm" />
          <p>© {year} {(s as any).companyTradeName ?? (s as any).productName ?? "yugochat"} — todos os direitos reservados.</p>
          <div className="flex gap-4">
            <Link href="/planos" className="hover:text-fg">Planos</Link>
            {s.supportEmail && <a href={`mailto:${s.supportEmail}`} className="hover:text-fg">Suporte</a>}
            <Link href="/login" className="hover:text-fg">Entrar</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
