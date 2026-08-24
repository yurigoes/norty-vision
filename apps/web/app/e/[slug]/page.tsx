import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicOrgBySlug } from "../../../lib/orgBranding";
import { hexToRgbTriplet } from "../../../lib/color";
import { PORTAL_META, loginPathFor, type Portal } from "../../../lib/orgMemory";
import { RememberOrg } from "../../../components/RememberOrg";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const org = await getPublicOrgBySlug(slug);
  return {
    title: org ? `Acessos — ${org.name}` : "Acessos",
    description: "Escolha por onde entrar: equipe, funcionário, cliente ou fornecedor.",
  };
}

/**
 * HUB DA EMPRESA — `/e/<slug>`
 * ============================================================================
 * O link único que a empresa manda pra todo mundo. Em vez de decorar quatro
 * endereços diferentes (`/e/…`, `/rh/…`, `/c/…`, `/f/…`), a pessoa abre um só
 * e escolhe quem ela é. Cada cartão diz, em uma linha, o que tem lá dentro.
 *
 * A página já marca a empresa como "empresa deste aparelho": a partir daqui,
 * sair do sistema e sessão expirada sempre voltam pra porta desta empresa.
 */
const ICONS: Record<Portal, React.ReactNode> = {
  equipe: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 21V9h6v12" />
      <path d="M9 7h.01M15 7h.01M9 13h.01M15 13h.01" />
    </>
  ),
  funcionario: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  cliente: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
  fornecedor: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </>
  ),
};

const ORDER: Portal[] = ["equipe", "funcionario", "cliente", "fornecedor"];

export default async function OrgHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getPublicOrgBySlug(slug);
  if (!org) notFound();

  const brandTriplet = org.primaryColor ? hexToRgbTriplet(org.primaryColor) : null;

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-5 py-10 sm:px-8 lg:py-16">
      <RememberOrg slug={slug} />
      {brandTriplet && (
        <style dangerouslySetInnerHTML={{ __html: `:root,.light,.dark{--brand:${brandTriplet};}` }} />
      )}

      {/* ------------------------------------------------------------ topo -- */}
      <header className="flex flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={org.logoUrl ?? "/brand/norty-vision.png"}
          alt={org.name}
          className="h-14 w-auto max-w-[260px] object-contain sm:h-16"
        />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-4xl">{org.name}</h1>
        <p className="mt-2 max-w-lg text-sm text-muted sm:text-base">
          Escolha por onde você entra. Cada acesso abre só o que é seu.
        </p>
      </header>

      {/* --------------------------------------------------------- portais -- */}
      <div className="mt-10 grid flex-1 content-start gap-3 sm:grid-cols-2">
        {ORDER.map((portal) => (
          <a
            key={portal}
            href={loginPathFor(portal, slug)}
            className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:border-brand/50 hover:shadow-md"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line text-muted transition group-hover:border-brand group-hover:bg-brand/10 group-hover:text-brand">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden
              >
                {ICONS[portal]}
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-fg">
                {PORTAL_META[portal].title}
              </span>
              <span className="mt-0.5 block text-sm text-muted">{PORTAL_META[portal].desc}</span>
            </span>
            <span
              aria-hidden
              className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand"
            >
              →
            </span>
          </a>
        ))}
      </div>

      {/* ----------------------------------------------------------- ajuda -- */}
      <section className="mt-10 rounded-2xl border border-line bg-surface/60 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Não sabe qual é o seu?
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-muted">
          <li>
            <strong className="text-fg">Equipe</strong> — você trabalha no balcão, no caixa ou na
            administração da {org.name}.
          </li>
          <li>
            <strong className="text-fg">Funcionário</strong> — você é registrado e quer bater ponto,
            ver holerite ou pedir férias.
          </li>
          <li>
            <strong className="text-fg">Cliente</strong> — você comprou na {org.name} e quer ver
            parcelas, pedidos ou chamados.
          </li>
          <li>
            <strong className="text-fg">Fornecedor</strong> — você é médico, laboratório ou parceiro
            de produção.
          </li>
        </ul>
      </section>

      <footer className="mt-8 flex flex-col items-center gap-2 text-center text-[11px] text-text-3">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <a href={`/empresa/${slug}`} className="text-muted transition-colors hover:text-fg">
            Ver a página pública da {org.name}
          </a>
          <a href="/login?global=1" className="text-muted transition-colors hover:text-fg">
            Entrar em outra empresa
          </a>
        </div>
        <span>
          Powered by <strong className="text-muted">Norty Vision</strong>
        </span>
      </footer>
    </main>
  );
}
