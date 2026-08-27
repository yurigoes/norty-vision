"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchPalette, terms, type PaletteItem } from "../lib/paletteSearch";
import { useFavorites } from "../lib/favorites";

export type { PaletteItem };

/**
 * BUSCA DE MÓDULOS (Ctrl+K / ⌘K)
 * ============================================================================
 * O menu do painel tem quase 70 itens, em sete categorias recolhíveis, só
 * texto. Quem não lembra o nome exato do módulo — ou em qual categoria ele
 * mora — vai abrindo seção por seção até achar. Aqui a pessoa digita "cred",
 * "nota", "ponto" e chega.
 *
 * A lista vem pronta do servidor: são exatamente os itens que ESTE usuário vê
 * no menu, já filtrados por nicho, permissão, sub-módulo e plano. Nada aparece
 * aqui que não apareceria lá.
 */

/** Evento global — qualquer botão da casca abre a paleta sem precisar de contexto. */
export const OPEN_PALETTE_EVENT = "nv:command-palette";

export function openCommandPalette(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
}

const RECENTS_KEY = "nv-palette-recents";
const RECENTS_MAX = 5;

export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const favorites = useFavorites();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const byHref = useMemo(() => new Map(items.map((i) => [i.href, i])), [items]);

  /* ------------------------------------------------------------ abrir --- */
  const openPalette = useCallback(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setCursor(0);
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      // o que está no localStorage não é confiável: pode ter sido editado à mão
      setRecents(Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : []);
    } catch {
      setRecents([]);
    }
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    restoreFocus.current?.focus?.();
  }, []);

  // o atalho precisa saber se já está aberto sem re-registrar o listener a
  // cada render — e sem efeito colateral dentro do updater do useState.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl+K / ⌘K em qualquer lugar do painel — alterna
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) closePalette();
        else openPalette();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, openPalette);
    };
  }, [openPalette, closePalette]);

  // trava o scroll do fundo e põe o cursor no campo
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  /* --------------------------------------------------------- resultados -- */
  const results = useMemo(() => {
    // sem busca: primeiro os fixados, depois os últimos usados, depois o menu
    if (terms(query).length === 0) {
      const pick = (hrefs: string[], skip: Set<string>) =>
        hrefs
          .filter((h) => !skip.has(h))
          .map((h) => byHref.get(h))
          .filter(Boolean) as PaletteItem[];

      const fav = pick(favorites, new Set());
      const favSet = new Set(fav.map((i) => i.href));
      const recent = pick(recents, favSet);
      const shown = new Set([...favSet, ...recent.map((i) => i.href)]);
      const rest = items.filter((i) => !shown.has(i.href));
      return {
        tags: [...fav.map(() => "fixado"), ...recent.map(() => "recente")],
        list: [...fav, ...recent, ...rest].slice(0, 40),
      };
    }
    return { tags: [] as string[], list: searchPalette(items, query) };
  }, [query, items, recents, favorites, byHref]);

  const list = results.list;

  useEffect(() => {
    setCursor(0);
  }, [query]);

  // mantém o item destacado visível ao navegar pelo teclado
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  /* ------------------------------------------------------------ abrir --- */
  function go(item: PaletteItem | undefined) {
    if (!item) return;
    // módulo bloqueado não vira "recente": todos levam pra mesma tela de plano
    if (!item.locked && !item.external) {
      try {
        const next = [item.href, ...recents.filter((h) => h !== item.href)].slice(0, RECENTS_MAX);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* sem localStorage (aba anônima, site data bloqueado): segue sem histórico */
      }
    }
    setOpen(false);
    if (item.external) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }
    // bloqueado vai pra página do módulo, que explica pra que serve e oferece
    // liberar — mesmo destino do cadeado no menu.
    // `as never` porque typedRoutes só aceita literal, e aqui a rota vem de dados
    router.push(item.href as never);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (list.length ? (c + 1) % list.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (list.length ? (c - 1 + list.length) % list.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      go(list[cursor]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pb-4"
      style={{ paddingTop: "max(4rem, env(safe-area-inset-top))" }}
      role="dialog"
      aria-modal="true"
      aria-label="Buscar no sistema"
    >
      <button
        type="button"
        aria-label="Fechar busca"
        onClick={closePalette}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      <div className="relative flex max-h-[min(70dvh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        {/* -------------------------------------------------------- campo -- */}
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="h-4 w-4 shrink-0 text-muted"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Buscar módulo — crediário, ponto, nota fiscal..."
            aria-label="Buscar módulo"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent py-4 text-[15px] text-fg outline-none placeholder:text-text-3"
          />
          <button
            type="button"
            onClick={closePalette}
            className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted transition hover:text-fg sm:block"
          >
            esc
          </button>
        </div>

        {/* ---------------------------------------------------- resultados -- */}
        <div ref={listRef} className="scroll-themed flex-1 overflow-y-auto p-2">
          {list.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              Nada encontrado para “{query.trim()}”.
              <span className="mt-1 block text-xs text-text-3">
                Tente o nome do módulo (crediário, escala, repasses) ou o que você quer fazer.
              </span>
            </p>
          ) : (
            list.map((item, index) => {
              const active = index === cursor;
              const tag = results.tags[index];
              return (
                <button
                  key={`${item.href}-${index}`}
                  type="button"
                  data-index={index}
                  onMouseMove={() => setCursor(index)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    active ? "bg-brand/10 text-brand" : "text-fg hover:bg-surface-2"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {item.locked && (
                      <span aria-hidden className="mr-1.5">
                        🔒
                      </span>
                    )}
                    {item.label}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {tag ?? item.group}
                    {item.external && <span aria-hidden> ↗</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* ---------------------------------------------------------- pé --- */}
        <div className="hidden items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-muted sm:flex">
          <span>
            <kbd className="rounded border border-line px-1 font-mono">↑</kbd>{" "}
            <kbd className="rounded border border-line px-1 font-mono">↓</kbd> navegar
          </span>
          <span>
            <kbd className="rounded border border-line px-1 font-mono">enter</kbd> abrir
          </span>
          <span className="ml-auto">
            <kbd className="rounded border border-line px-1 font-mono">ctrl</kbd>{" "}
            <kbd className="rounded border border-line px-1 font-mono">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
