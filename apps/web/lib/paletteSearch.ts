/**
 * Busca da paleta de módulos (Ctrl+K) — lógica pura, sem React.
 *
 * Fica separada da UI porque é a parte que decide se a pessoa acha ou não o
 * que procura: dá pra exercitar direto, com os rótulos reais do menu.
 */

export interface PaletteItem {
  label: string;
  href: string;
  /** categoria do menu — vira o rótulo à direita e também entra na busca */
  group: string;
  /** módulo fora do plano: mostra cadeado e leva pra Assinatura */
  locked?: boolean;
  /** atalho externo (Chatwoot/GLPI): abre em outra aba */
  external?: boolean;
  /** termos extras (sinônimos do dia a dia) */
  keywords?: string;
}

/** "Crediário" → "crediario": busca sem acento e sem caixa. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Pontuação simples e previsível — nada de fuzzy que casa qualquer coisa.
 * Quanto MENOR, melhor. `null` = não casa.
 *
 *   0  o rótulo começa com o termo               ("cred"  → Crediário)
 *   1  uma palavra do rótulo começa com o termo  ("lente" → Pedidos de lente)
 *   2  aparece no meio de uma palavra            ("bank"  → Hour bank)
 *   3  casa pela categoria, pelo endereço ou por sinônimo
 */
export function score(item: PaletteItem, term: string): number | null {
  const label = fold(item.label);
  if (label.startsWith(term)) return 0;
  // quebra em qualquer coisa que não seja letra ou número, pra que abreviação
  // entre parênteses também conte como início de palavra: "pdv" → "Vendas (PDV)"
  if (label.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(term))) return 1;
  if (label.includes(term)) return 2;
  const rest = fold(`${item.group} ${item.href} ${item.keywords ?? ""}`);
  if (rest.includes(term)) return 3;
  return null;
}

/** Todos os termos precisam casar: "nota fiscal" não traz "Notas de crédito". */
export function match(item: PaletteItem, terms: string[]): number | null {
  let total = 0;
  for (const term of terms) {
    const s = score(item, term);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** Termos digitados, já normalizados. Vazio = sem busca. */
export function terms(query: string): string[] {
  return fold(query.trim()).split(/\s+/).filter(Boolean);
}

/** Resultados ordenados (melhor primeiro), limitados a `limit`. */
export function searchPalette(
  items: PaletteItem[],
  query: string,
  limit = 40,
): PaletteItem[] {
  const t = terms(query);
  if (t.length === 0) return items.slice(0, limit);
  const scored: Array<{ item: PaletteItem; s: number }> = [];
  for (const item of items) {
    const s = match(item, t);
    if (s !== null) scored.push({ item, s });
  }
  scored.sort((a, b) => a.s - b.s || a.item.label.localeCompare(b.item.label, "pt-BR"));
  return scored.slice(0, limit).map((r) => r.item);
}
