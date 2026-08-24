"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFavorites, toggleFavorite } from "../lib/favorites";
import { iconForHref } from "../lib/navIcons";
import type { PaletteItem } from "../lib/paletteSearch";

/**
 * FAVORITOS NO TOPO DO MENU
 * ============================================================================
 * Cada pessoa vive em quatro ou cinco módulos dos quase 70. Aqui ficam os que
 * ela fixou (estrela ao lado de cada item), na ordem em que fixou.
 *
 * A lista de referência é a MESMA do menu e da busca — já filtrada por nicho,
 * permissão, sub-módulo e plano. Um favorito de módulo que ela perdeu o acesso
 * simplesmente some daqui, sem virar link quebrado.
 *
 * Sem favorito nenhum, a seção não aparece: menu vazio com título é ruído.
 */
export function SidebarFavorites({ items }: { items: PaletteItem[] }) {
  const favorites = useFavorites();
  const pathname = usePathname() ?? "";

  const byHref = new Map(items.filter((i) => !i.locked && !i.external).map((i) => [i.href, i]));
  const list = favorites.map((href) => byHref.get(href)).filter(Boolean) as PaletteItem[];

  if (list.length === 0) return null;

  return (
    <div className="mb-3">
      <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3 text-brand" aria-hidden>
          <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" />
        </svg>
        Favoritos
      </p>
      <div className="mt-0.5 space-y-1">
        {list.map((item) => {
          const Icon = iconForHref(item.href);
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <div
              key={item.href}
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
              <Link
                href={item.href as never}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-sm ${
                  active ? "font-semibold text-brand" : "text-muted group-hover:text-fg"
                }`}
              >
                <Icon size={16} className="shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
              <button
                type="button"
                data-on="true"
                onClick={() => toggleFavorite(item.href)}
                aria-label={`Desafixar ${item.label}`}
                title={`Desafixar ${item.label}`}
                className="fav-star ml-1 shrink-0 rounded-md p-1 text-brand transition-colors hover:text-danger"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                  <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" />
                </svg>
              </button>
              <span className="w-1.5 shrink-0" aria-hidden />
            </div>
          );
        })}
      </div>
      <div className="mx-3 mt-3 border-t border-line" />
    </div>
  );
}
