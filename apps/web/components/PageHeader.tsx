import Link from "next/link";
import { AutoEyebrow } from "./AutoEyebrow";

/**
 * CABEÇALHO PADRÃO DAS TELAS DO PAINEL
 * ============================================================================
 * Cada uma das 100 telas montava o próprio topo. O resultado: títulos em três
 * tamanhos diferentes, espaçamentos que não batiam, e — o que mais custava —
 * nenhuma garantia de que a tela dissesse onde a pessoa está.
 *
 * Aqui a estrutura é uma só: onde estou (categoria), o que é isto (título), o
 * que dá pra fazer (descrição) e as ações à direita.
 *
 * Sem `eyebrow`, a categoria vem do mapa do menu (`lib/nav.ts`) pela rota
 * atual — então tela nova já nasce dizendo onde está, sem ninguém lembrar de
 * escrever. Passe `eyebrow={null}` para não mostrar nenhuma.
 *
 * Não tem hook: serve tanto em Server Component quanto em tela `"use client"`.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  back,
  actions,
  children,
  className = "",
}: {
  title: React.ReactNode;
  /** categoria acima do título. Omitido = vem da rota; `null` = nenhuma. */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** link de volta pro módulo pai, em telas internas */
  back?: { href: string; label: string };
  /** botões à direita — descem pra baixo do título no celular */
  actions?: React.ReactNode;
  /** extras abaixo da descrição (avisos, filtros, abas) */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 sm:mb-8 ${className}`}>
      {back && (
        <Link
          href={back.href as never}
          className="mb-3 inline-block text-sm text-brand transition-opacity hover:opacity-80"
        >
          ← {back.label}
        </Link>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          {eyebrow === undefined ? (
            <AutoEyebrow />
          ) : eyebrow === null ? null : (
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>
          )}
          {/* 3xl quebrava feio em título longo no celular */}
          <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description && <p className="mt-2 max-w-2xl text-muted">{description}</p>}
        </div>

        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children}
    </header>
  );
}
