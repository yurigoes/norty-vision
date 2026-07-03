import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch } from "../../../lib/api";
import { VitrinePromoBanner } from "./VitrinePromoBanner";

export const dynamic = "force-dynamic";

interface OrgPublic {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  enabledModules: string[] | null;
  catalogSlug: string | null;
  headline: string | null;
  subheadline: string | null;
  about: string | null;
  banner: { imageUrl: string | null; linkUrl: string | null } | null;
  satisfaction: { avg: number; count: number } | null;
  address: string | null;
  mapsUrl: string | null;
  hours: string | null;
  social: { instagram: string | null; facebook: string | null; whatsapp: string | null; website: string | null };
  stores: Array<{ slug: string; name: string; city: string | null; state: string | null; catalogEnabled: boolean }>;
}

function instaUrl(v: string): string {
  if (/^https?:\/\//i.test(v)) return v;
  return `https://instagram.com/${v.replace(/^@/, "")}`;
}
function fbUrl(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://facebook.com/${v}`;
}
function waUrl(v: string): string {
  const d = v.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("55") ? d : "55" + d}`;
}

interface CatProduct {
  id: string;
  name: string;
  category: string | null;
  imageUrl: string | null;
  priceCashCents: number | null;
}

function brl(cents: number | null): string {
  if (cents == null) return "sob consulta";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function brandStyle(hex: string | null): React.CSSProperties {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const int = parseInt(hex.slice(1), 16);
    return { ["--brand" as any]: `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}` };
  }
  return {};
}

const LOGIN_BLOCKS = (slug: string, brandName: string) => [
  { icon: "🛍️", label: "Sou cliente", desc: "Minhas compras, crediário e parcelas", href: `/c/${slug}/login` },
  { icon: "👤", label: "Sou funcionário", desc: "Ponto, holerite e solicitações", href: `/rh/${slug}/login` },
  { icon: "🚚", label: "Sou fornecedor", desc: "Repasses e pedidos de lente", href: `/f/${slug}/login` },
  { icon: "🔑", label: "Equipe / administração", desc: `Acesso interno da ${brandName}`, href: `/e/${slug}/login` },
];

export default async function CompanyVitrine({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await apiFetch<{ organization: OrgPublic }>(`/api/organizations/public/by-slug/${slug}`);
  const org = res.data?.organization;
  if (!res.ok || !org) notFound();

  let products: CatProduct[] = [];
  if (org.catalogSlug) {
    // catálogo endereçado pelo slug da EMPRESA (único) — evita vazar o de outra
    const cat = await apiFetch<{ products: CatProduct[] }>(`/api/public/catalog/${org.slug}`);
    products = (cat.data?.products ?? []).slice(0, 6);
  }

  const stores = org.stores ?? [];
  const city = stores[0]?.city ?? null;
  const state = stores[0]?.state ?? null;
  const local = [city, state].filter(Boolean).join(" · ");
  const year = new Date().getFullYear();
  const blocks = LOGIN_BLOCKS(org.slug, org.name);
  // tolerante a versões de API antigas (sem esses campos) — evita exceção no SSR
  const social = org.social ?? { instagram: null, facebook: null, whatsapp: null, website: null };
  const satisfaction = org.satisfaction ?? null;
  const banner = org.banner ?? null;

  return (
    <main className="relative" style={brandStyle(org.primaryColor)}>
      {banner?.imageUrl && (
        <VitrinePromoBanner imageUrl={banner.imageUrl} linkUrl={banner.linkUrl} storageKey={`yugo-banner-${org.slug}`} />
      )}

      {/* Topbar */}
      <nav className="sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={org.name} className="h-9 w-auto max-w-[180px] object-contain" />
          ) : (
            <span className="text-lg font-bold" style={{ color: "rgb(var(--brand))" }}>{org.name}</span>
          )}
          <div className="flex items-center gap-3">
            {org.catalogSlug && <a href="#produtos" className="hidden text-sm text-muted hover:text-fg sm:block">Produtos</a>}
            <a href="#entrar" className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90">Entrar</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.10]" style={{ background: "radial-gradient(circle at 30% 20%, rgb(var(--brand)), transparent 60%)" }} />
        <div className="relative mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
          {org.logoUrl && <img src={org.logoUrl} alt={org.name} className="mx-auto mb-8 h-16 w-auto max-w-[240px] object-contain" />}
          <h1 className="mx-auto max-w-3xl bg-gradient-to-br from-brand via-fg to-brand bg-clip-text text-4xl font-semibold leading-tight tracking-tight text-transparent md:text-6xl">
            {org.headline ?? `Bem-vindo à ${org.name}`}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
            {org.subheadline ?? "Qualidade, atendimento de verdade e as melhores condições pra você enxergar e comprar melhor."}
          </p>
          {local && <p className="mt-3 text-sm text-muted">📍 {local}</p>}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {org.catalogSlug && (
              <a href="#produtos" className="rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">Ver produtos</a>
            )}
            <a href="#entrar" className="rounded-lg border border-line px-6 py-3 text-sm font-semibold transition hover:border-brand">Acessar minha conta</a>
          </div>
        </div>
      </section>

      {/* Destaques */}
      <section className="mx-auto max-w-5xl px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Atendimento que cuida", "Equipe pronta pra te ajudar a escolher o melhor pra você."],
            ["Qualidade garantida", "Produtos e serviços com procedência e garantia."],
            ["Compre do seu jeito", "À vista, no cartão ou no nosso crediário próprio."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-line bg-bg/60 p-5">
              <p className="font-semibold">{t}</p>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Nível de satisfação (notas reais dos clientes) */}
      {satisfaction && (
        <section className="mx-auto max-w-3xl px-6 py-12">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-bg/60 p-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Satisfação dos clientes</p>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold" style={{ color: "rgb(var(--brand))" }}>
                {satisfaction.avg.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
              <span className="text-lg text-muted">/ 10</span>
            </div>
            <div className="text-xl tracking-widest" aria-hidden>
              {(() => {
                const stars = Math.round(satisfaction.avg / 2); // 0–10 → 0–5
                return "★★★★★".slice(0, stars) + "☆☆☆☆☆".slice(0, 5 - stars);
              })()}
            </div>
            <p className="text-sm text-muted">com base em {satisfaction.count} avaliações de clientes</p>
          </div>
        </section>
      )}

      {/* Sobre */}
      {org.about && (
        <section className="mx-auto max-w-3xl px-6 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Sobre a {org.name}</h2>
          <p className="mt-4 whitespace-pre-line text-muted">{org.about}</p>
        </section>
      )}

      {/* Produtos */}
      {products.length > 0 && (
        <section id="produtos" className="mx-auto max-w-5xl px-6 py-12">
          <header className="mb-6 text-center">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Destaques da loja</h2>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
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
                  <p className="mt-2 text-lg font-semibold">{brl(p.priceCashCents)}</p>
                </div>
              </div>
            ))}
          </div>
          {org.catalogSlug && (
            <div className="mt-8 text-center">
              <Link href={`/loja/${org.slug}`} className="inline-block rounded-lg bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">
                Ver catálogo completo
              </Link>
            </div>
          )}
        </section>
      )}

      {/* Entrar — blocos de login */}
      <section id="entrar" className="mx-auto max-w-5xl scroll-mt-24 px-6 py-16">
        <header className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Acesse sua conta</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Escolha como você quer entrar:</p>
        </header>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {blocks.map((b) => (
            <Link
              key={b.href + b.label}
              href={b.href}
              className="group flex items-center gap-4 rounded-2xl border border-line bg-bg/60 p-5 transition hover:border-brand hover:shadow-lg hover:shadow-brand/10"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-2xl">{b.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{b.label}</span>
                <span className="block text-sm text-muted">{b.desc}</span>
              </span>
              <span className="text-muted transition group-hover:translate-x-0.5 group-hover:text-brand">→</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Atendimento: endereço, horário e redes */}
      {(org.address || org.hours || social.instagram || social.facebook || social.whatsapp || social.website) && (
        <section className="mx-auto max-w-5xl px-6 py-16">
          <header className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Onde nos encontrar</h2>
          </header>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {org.address && (
              <div className="rounded-2xl border border-line bg-bg/60 p-6">
                <p className="text-sm font-semibold">📍 Endereço</p>
                <p className="mt-2 whitespace-pre-line text-sm text-muted">{org.address}</p>
                <a
                  href={org.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(org.address)}`}
                  target="_blank" rel="noreferrer"
                  className="mt-3 inline-block text-sm font-medium text-brand hover:underline"
                >
                  Ver no mapa →
                </a>
              </div>
            )}
            {org.hours && (
              <div className="rounded-2xl border border-line bg-bg/60 p-6">
                <p className="text-sm font-semibold">🕒 Horário</p>
                <p className="mt-2 whitespace-pre-line text-sm text-muted">{org.hours}</p>
              </div>
            )}
            {(social.instagram || social.facebook || social.whatsapp || social.website) && (
              <div className="rounded-2xl border border-line bg-bg/60 p-6">
                <p className="text-sm font-semibold">💬 Redes sociais</p>
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  {social.whatsapp && <a href={waUrl(social.whatsapp)} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">WhatsApp</a>}
                  {social.instagram && <a href={instaUrl(social.instagram)} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">Instagram</a>}
                  {social.facebook && <a href={fbUrl(social.facebook)} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">Facebook</a>}
                  {social.website && <a href={social.website} target="_blank" rel="noreferrer" className="text-muted hover:text-brand">Site</a>}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="border-t border-line py-8 text-center text-[11px] text-muted">
        © {year} {org.name} · Plataforma por YUGO
      </footer>
    </main>
  );
}
