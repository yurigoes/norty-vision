"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * FAVORITOS DO MENU
 * ============================================================================
 * O menu tem quase 70 itens, mas cada pessoa vive em quatro ou cinco: a
 * recepção fica na Agenda e no Caixa, o financeiro no Crediário e na Cobrança.
 * Fixar esses itens no topo poupa a caçada diária.
 *
 * Guardado no `localStorage` deste aparelho — como os "recentes" da busca.
 * É preferência de navegação, não configuração de conta: não vale a pena uma
 * tabela, uma rota e uma migration para isso. Quem trocar de computador
 * refixa em dois cliques.
 *
 * Sem provider: qualquer componente da casca lê pelo `useFavorites()`, e
 * `toggleFavorite()` avisa todo mundo por um evento — inclusive outras abas,
 * via `storage`.
 */

export const FAVORITES_KEY = "nv-favorites";
export const FAVORITES_EVENT = "nv:favorites";
/** acima disso deixa de ser atalho e vira um segundo menu */
export const FAVORITES_MAX = 8;

const EMPTY: string[] = [];

/**
 * Instantâneo em cache. O `useSyncExternalStore` exige que leituras seguidas
 * devolvam a MESMA referência enquanto nada muda — sem isso, re-render infinito.
 */
let snapshot: string[] = EMPTY;
let loaded = false;

function parse(raw: string | null): string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const list = value.filter((h): h is string => typeof h === "string").slice(0, FAVORITES_MAX);
    return list.length ? list : EMPTY;
  } catch {
    return EMPTY;
  }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function refresh(): void {
  let next = EMPTY;
  try {
    next = parse(localStorage.getItem(FAVORITES_KEY));
  } catch {
    /* aba anônima / site data bloqueado: segue sem favoritos */
  }
  if (!sameList(next, snapshot)) snapshot = next;
  loaded = true;
}

function getSnapshot(): string[] {
  if (!loaded) refresh();
  return snapshot;
}

/** No servidor não há aparelho — a lista entra vazia e o cliente preenche. */
function getServerSnapshot(): string[] {
  return EMPTY;
}

function subscribe(onChange: () => void): () => void {
  const handler = () => {
    refresh();
    onChange();
  };
  window.addEventListener(FAVORITES_EVENT, handler);
  window.addEventListener("storage", handler); // outra aba mexeu
  return () => {
    window.removeEventListener(FAVORITES_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function persist(list: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
  } catch {
    /* sem localStorage: o favorito vale só para esta sessão */
  }
  snapshot = list.length ? list : EMPTY;
  loaded = true;
  window.dispatchEvent(new Event(FAVORITES_EVENT));
}

/** Fixa ou solta um item. Novos entram no fim, na ordem em que foram fixados. */
export function toggleFavorite(href: string): void {
  if (typeof window === "undefined") return;
  const current = getSnapshot();
  const next = current.includes(href)
    ? current.filter((h) => h !== href)
    : [...current, href].slice(-FAVORITES_MAX);
  persist(next);
}

/** Lista de hrefs fixados, reativa. */
export function useFavorites(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `[estáFixado, alternar]` para um item. */
export function useFavorite(href: string): [boolean, () => void] {
  const favorites = useFavorites();
  const toggle = useCallback(() => toggleFavorite(href), [href]);
  return [favorites.includes(href), toggle];
}
