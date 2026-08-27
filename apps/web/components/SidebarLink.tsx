"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSidebarCount } from "./SidebarCounts";
import { useFavorite } from "../lib/favorites";
import { iconForHref } from "../lib/navIcons";

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Botão de fixar. Fica FORA do <Link> de propósito: um <button> dentro de um
 * <a> é HTML inválido e quebra o clique no meio.
 *
 * Visibilidade (regras em globals.css, classe `.fav-star`): sempre visível
 * quando o item está fixado; no hover/foco quando não está; e permanentemente
 * esmaecido em aparelho sem mouse, onde "hover" não existe e a estrela ficaria
 * invisível para sempre.
 */
function FavoriteStar({ href, label }: { href: string; label: string }) {
  const [on, toggle] = useFavorite(href);
  return (
    <button
      type="button"
      data-on={on ? "true" : "false"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      aria-pressed={on}
      title={on ? `Desafixar ${label}` : `Fixar ${label} no topo`}
      aria-label={on ? `Desafixar ${label}` : `Fixar ${label} no topo`}
      className={`fav-star ml-1 shrink-0 rounded-md p-1 transition-colors ${on ? "text-brand" : "text-text-3 hover:text-brand"}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" />
      </svg>
    </button>
  );
}

/**
 * Item de menu: ícone, rótulo, contador e a estrela de favorito.
 * O item da rota atual ganha fundo e barra na cor da marca.
 */
export function SidebarLink({
  href,
  children,
  favoritable = true,
}: {
  href: string;
  children: React.ReactNode;
  /** Itens que não fazem sentido fixar (nenhum hoje) podem sair dos favoritos. */
  favoritable?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const count = useSidebarCount(href);
  const Icon = iconForHref(href);

  // ativo = match exato, ou prefixo (mas "/app" so casa exato pra nao pegar tudo)
  const active =
    href === "/app"
      ? pathname === "/app"
      : pathname === href || pathname.startsWith(href + "/");

  const label = typeof children === "string" ? children : href;

  return (
    <div
      className={`group relative flex items-center rounded-lg transition ${
        active ? "bg-brand/10" : "hover:bg-surface-2"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand"
        />
      )}
      {/* Link puro: quem dá o retorno da navegação agora é o `loading.tsx` da
          rota (esqueleto no lugar do conteúdo). Antes daqui saía um
          startTransition que acendia o overlay "Processando…" — que bloqueia a
          tela inteira e é a linguagem de quem está SALVANDO algo, não de quem
          está abrindo uma página. O overlay continua, só que para mutações. */}
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 ${
          active ? "font-semibold text-brand" : "text-muted group-hover:text-fg"
        }`}
      >
        <Icon size={16} className="shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <CountBadge n={count} />
      </Link>
      {favoritable && <FavoriteStar href={href} label={label} />}
      <span className="w-1.5 shrink-0" aria-hidden />
    </div>
  );
}
