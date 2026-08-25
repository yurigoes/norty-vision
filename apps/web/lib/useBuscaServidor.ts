"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * BUSCA QUE ACHA O QUE EXISTE
 * ============================================================================
 * As telas de listagem carregavam um pedaço (300 clientes de 3.000, 500
 * produtos de 2.000) e filtravam esse pedaço na memória do navegador. Digitar
 * o nome de alguém fora do pedaço devolvia "nenhum resultado" — que é uma
 * resposta ERRADA, não vazia. E a API já sabia buscar em todos: aceita `?q=`,
 * procura no banco e responde em ~17 ms.
 *
 * Este hook liga uma coisa na outra:
 *
 * - até `minimo` caracteres, mostra a lista que a página já trouxe (o estado
 *   de repouso da tela, sem chamada nenhuma);
 * - a partir daí, pergunta ao servidor, com `atraso` de espera pra não
 *   disparar uma chamada por tecla;
 * - a busca anterior é abortada quando chega uma nova — sem resposta atrasada
 *   sobrescrevendo a atual.
 */
export interface BuscaServidor<T> {
  q: string;
  setQ: (v: string) => void;
  /** o que mostrar: a lista inicial, ou o resultado da busca */
  itens: T[];
  /** true enquanto a resposta do servidor não chegou */
  buscando: boolean;
  /** true quando o que está na tela veio de uma busca no servidor */
  doServidor: boolean;
  erro: string | null;
  /** refaz a busca atual (depois de criar/editar/apagar algo) */
  refazer: () => void;
}

export function useBuscaServidor<T>(opts: {
  /** ex.: "/api/customers" — o `q` e o `limit` são acrescentados aqui */
  rota: string;
  /** o que a página já trouxe, mostrado enquanto ninguém digitou */
  inicial: T[];
  /** teto de resultados pedido ao servidor */
  limite?: number;
  /** a partir de quantos caracteres vale perguntar ao servidor */
  minimo?: number;
  /** espera entre a última tecla e a chamada */
  atraso?: number;
}): BuscaServidor<T> {
  const { rota, inicial, limite = 100, minimo = 2, atraso = 300 } = opts;

  const [q, setQ] = useState("");
  const [achados, setAchados] = useState<T[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const abortar = useRef<AbortController | null>(null);
  const contador = useRef(0);

  const termo = q.trim();
  const vale = termo.length >= minimo;

  const buscar = useCallback(
    async (texto: string) => {
      abortar.current?.abort();
      const ctrl = new AbortController();
      abortar.current = ctrl;
      const meu = ++contador.current;

      setBuscando(true);
      setErro(null);
      try {
        const sep = rota.includes("?") ? "&" : "?";
        const url = `${rota}${sep}q=${encodeURIComponent(texto)}&limit=${limite}`;
        const r = await fetch(url, {
          credentials: "include",
          signal: ctrl.signal,
          headers: { "x-no-loading": "1" },
        });
        const d = await r.json();
        if (meu !== contador.current) return; // chegou fora de ordem: descarta
        if (!r.ok) throw new Error(d?.error?.message ?? "Falha na busca");
        setAchados((d?.items ?? []) as T[]);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        if (meu !== contador.current) return;
        setErro(e?.message ?? "Falha na busca");
        setAchados([]);
      } finally {
        if (meu === contador.current) setBuscando(false);
      }
    },
    [rota, limite],
  );

  useEffect(() => {
    if (!vale) {
      abortar.current?.abort();
      contador.current++;
      setAchados(null);
      setBuscando(false);
      setErro(null);
      return;
    }
    const t = setTimeout(() => void buscar(termo), atraso);
    return () => clearTimeout(t);
  }, [termo, vale, atraso, buscar]);

  useEffect(() => () => abortar.current?.abort(), []);

  const refazer = useCallback(() => {
    if (vale) void buscar(termo);
  }, [vale, termo, buscar]);

  return {
    q,
    setQ,
    itens: achados ?? inicial,
    buscando,
    doServidor: achados !== null,
    erro,
    refazer,
  };
}
