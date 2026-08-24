"use client";

import { useEffect } from "react";
import { PORTAL_META, loginPathFor, orgHubPath, rememberOrgSlug, type Portal } from "../lib/orgMemory";
import { useOrgBrand } from "../lib/useOrgBrand";

/**
 * MOLDURA ÚNICA DAS TELAS DE ENTRADA (equipe, funcionário, cliente, fornecedor)
 * ============================================================================
 * Antes cada portal tinha a própria casca: dois usavam split-screen, dois um
 * card centralizado, com textos e rodapés diferentes. Quem trabalha na empresa
 * via quatro sistemas diferentes.
 *
 * Aqui existe uma casca só:
 *   - painel de marca da EMPRESA (logo + cor) à esquerda no desktop;
 *   - formulário à direita, confortável no celular (min-h-[100dvh], safe-area);
 *   - troca de portal sempre visível — ninguém fica preso na porta errada;
 *   - o slug da empresa é lembrado no aparelho, então sair e sessão expirada
 *     devolvem o usuário exatamente pra esta tela.
 */
export function PortalAuthLayout({
  portal,
  slug,
  headline,
  tagline,
  title,
  subtitle,
  children,
  hint,
}: {
  portal: Portal;
  slug: string;
  /** manchete do painel de marca (desktop) */
  headline: React.ReactNode;
  tagline?: React.ReactNode;
  /** título do formulário */
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** linha de ajuda abaixo do formulário (ex.: "primeiro acesso...") */
  hint?: React.ReactNode;
}) {
  const { brand } = useOrgBrand(slug);
  const hub = orgHubPath(slug);
  const others = (Object.keys(PORTAL_META) as Portal[]).filter((p) => p !== portal);

  // esta empresa passa a ser a empresa deste aparelho
  useEffect(() => {
    rememberOrgSlug(slug);
  }, [slug]);

  const companyName = brand?.name ?? slug;

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_0.95fr]">
      {/* ------------------------------------------------ MARCA (desktop) -- */}
      <aside className="relative hidden flex-col overflow-hidden bg-[#060a15] p-12 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 500px at 70% 8%, rgba(37,99,235,.45), transparent 60%), radial-gradient(720px 520px at 8% 92%, rgba(6,182,212,.30), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brand?.logoUrl ?? "/brand/norty-vision.png"}
            alt={companyName}
            className="h-10 w-auto max-w-[220px] object-contain"
          />
        </div>

        <div className="relative my-auto">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300/80">
            {PORTAL_META[portal].title}
          </p>
          <h2 className="mt-3 max-w-md text-4xl font-extrabold leading-tight tracking-tight">
            {headline}
          </h2>
          {tagline && <p className="mt-4 max-w-md text-slate-300">{tagline}</p>}
        </div>

        <div className="relative flex items-center justify-between text-xs text-slate-500">
          <span>Acesso seguro · Norty Vision</span>
          <span className="truncate">{companyName}</span>
        </div>
      </aside>

      {/* ---------------------------------------------------- FORMULÁRIO -- */}
      <main
        className="flex flex-col bg-bg px-5 py-8 sm:px-8 lg:px-10 lg:py-10"
        style={{
          paddingTop: "max(2rem, env(safe-area-inset-top))",
          paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          {/* logo da empresa no mobile */}
          <div className="mb-7 flex justify-center lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brand?.logoUrl ?? "/brand/norty-vision.png"}
              alt={companyName}
              className="h-12 w-auto max-w-[220px] object-contain"
            />
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            {PORTAL_META[portal].short}
          </p>
          <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight sm:text-[26px]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}

          <div className="mt-6">{children}</div>

          {hint && <p className="mt-4 text-center text-xs text-text-3">{hint}</p>}

          {/* ---------------------------------------- troca de portal ---- */}
          <div className="mt-8 border-t border-line pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Outros acessos da {companyName}
            </p>
            <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {others.map((p) => (
                <a
                  key={p}
                  href={loginPathFor(p, slug)}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg transition hover:border-brand/50 hover:text-brand"
                >
                  <span className="truncate">{PORTAL_META[p].short}</span>
                  <span aria-hidden className="text-xs text-muted">→</span>
                </a>
              ))}
            </div>
            <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
              {hub && (
                <a href={hub} className="text-xs text-muted transition-colors hover:text-fg">
                  Ver todos os acessos e ajuda
                </a>
              )}
              {/* saída pro apex: outra empresa ou acesso master */}
              <a
                href="/login?global=1"
                className="text-xs text-muted transition-colors hover:text-fg"
              >
                Entrar em outra empresa
              </a>
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] text-text-3">
            Powered by <strong className="text-muted">Norty Vision</strong>
          </p>
        </div>
      </main>
    </div>
  );
}
