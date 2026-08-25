"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A LISTA QUE DIZ A VERDADE
 * ============================================================================
 * Antes, cada tela de listagem recebia um pedaço com teto silencioso — 300
 * clientes de 3.000, 500 vendas de quantas fossem — e não tinha como saber que
 * era um pedaço. A tela dizia "500 vendas" e ninguém percebia as outras 2.700.
 *
 * As rotas agora respondem `{ items, total, limit, offset, hasMore }`. Este
 * hook liga isso na tela e faz três coisas:
 *
 *   1. mostra o que a página já trouxe (o primeiro pedaço, vindo do servidor);
 *   2. **carrega mais** ao pedir, emendando o pedaço seguinte na lista;
 *   3. **busca no servidor** a partir de `minimo` letras — a busca troca a
 *      lista pelo resultado, e o "carregar mais" passa a paginar dentro dela.
 *
 * O `total` é sempre o do servidor, com os filtros atuais: é o que permite
 * dizer "mostrando 50 de 3.184" em vez de "50 clientes", que era mentira.
 */
export interface ListaServidor<T> {
  /** o que mostrar */
  itens: T[];
  /** quantos existem no servidor (com a busca atual, se houver) */
  total: number;
  /** ainda tem coisa pra carregar? */
  temMais: boolean;
  /** emenda o próximo pedaço */
  carregarMais: () => void;
  /** true enquanto o próximo pedaço não chegou */
  carregando: boolean;

  /** busca no servidor */
  q: string;
  setQ: (v: string) => void;
  buscando: boolean;
  /** true quando o que está na tela é resultado de busca, não a lista de repouso */
  doServidor: boolean;

  erro: string | null;
  /** recarrega do zero (depois de criar/editar/apagar algo) */
  refazer: () => void;
}

export function useListaServidor<T>(opts: {
  /** ex.: "/api/customers" — pode já vir com filtros (`?status=pago`) */
  rota: string;
  /** o primeiro pedaço, que a página trouxe no servidor */
  inicial: T[];
  /** quantos existem no total, segundo o servidor */
  totalInicial?: number;
  /** tamanho de cada pedaço */
  passo?: number;
  /** a partir de quantas letras vale perguntar ao servidor */
  minimo?: number;
  /** espera entre a última tecla e a chamada */
  atraso?: number;
  /** desliga a busca (telas que só querem "carregar mais") */
  buscavel?: boolean;
  /**
   * Telas que carregam no navegador (não vêm com o primeiro pedaço pronto do
   * servidor): busca a primeira página sozinha, e de novo quando a rota muda —
   * é assim que uma aba de filtro (`?status=pago`) recomeça do zero.
   */
  autoCarregar?: boolean;
}): ListaServidor<T> {
  const {
    rota,
    inicial,
    totalInicial,
    passo = 50,
    minimo = 2,
    atraso = 300,
    buscavel = true,
    autoCarregar = false,
  } = opts;

  const [q, setQ] = useState("");
  /** null = ninguém mexeu ainda: vale o que a página trouxe */
  const [lista, setLista] = useState<T[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState(false); // a lista atual é de uma busca?
  const [recarga, setRecarga] = useState(0);  // pra `refazer()` no modo automático

  const abortar = useRef<AbortController | null>(null);
  const contador = useRef(0);

  const termo = q.trim();
  const vale = buscavel && termo.length >= minimo;

  const itens = lista ?? inicial;
  const totalReal = total ?? totalInicial ?? inicial.length;

  const pedir = useCallback(
    async (texto: string, offset: number): Promise<{ items: T[]; total: number } | null> => {
      abortar.current?.abort();
      const ctrl = new AbortController();
      abortar.current = ctrl;
      const meu = ++contador.current;

      const sep = rota.includes("?") ? "&" : "?";
      const url =
        `${rota}${sep}limit=${passo}&offset=${offset}` +
        (texto ? `&q=${encodeURIComponent(texto)}` : "");
      try {
        const r = await fetch(url, {
          credentials: "include",
          signal: ctrl.signal,
          headers: { "x-no-loading": "1" },
        });
        const d = await r.json();
        if (meu !== contador.current) return null; // chegou fora de ordem
        if (!r.ok) throw new Error(d?.error?.message ?? "Falha ao carregar");
        const items = (d?.items ?? []) as T[];
        // rota antiga, sem `total`: o melhor palpite é o que veio
        const t = typeof d?.total === "number" ? d.total : offset + items.length;
        return { items, total: t };
      } catch (e: any) {
        if (e?.name === "AbortError") return null;
        if (meu !== contador.current) return null;
        setErro(e?.message ?? "Falha ao carregar");
        return null;
      }
    },
    [rota, passo],
  );

  // BUSCA: troca a lista pelo resultado
  useEffect(() => {
    if (!vale) {
      abortar.current?.abort();
      contador.current++;
      setLista(null);
      setTotal(null);
      setBusca(false);
      setBuscando(false);
      setErro(null);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      setErro(null);
      const r = await pedir(termo, 0);
      if (r) {
        setLista(r.items);
        setTotal(r.total);
        setBusca(true);
      }
      setBuscando(false);
    }, atraso);
    return () => clearTimeout(t);
  }, [termo, vale, atraso, pedir]);

  // primeira página por conta própria (e recomeço quando a rota/filtro muda)
  useEffect(() => {
    if (!autoCarregar) return;
    let vivo = true;
    setCarregando(true);
    setLista(null);
    setTotal(null);
    setBusca(false);
    void (async () => {
      const r = await pedir("", 0);
      if (vivo && r) { setLista(r.items); setTotal(r.total); }
      if (vivo) setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [autoCarregar, pedir, recarga]);

  useEffect(() => () => abortar.current?.abort(), []);

  const temMais = itens.length < totalReal;

  const carregarMais = useCallback(() => {
    if (carregando || !temMais) return;
    setCarregando(true);
    setErro(null);
    void (async () => {
      const r = await pedir(busca ? termo : "", itens.length);
      if (r) {
        // emenda, sem repetir o que já está na tela
        setLista((atual) => {
          const base = atual ?? inicial;
          const vistos = new Set(base.map((x: any) => x?.id));
          return [...base, ...r.items.filter((x: any) => !vistos.has(x?.id))];
        });
        setTotal(r.total);
      }
      setCarregando(false);
    })();
  }, [carregando, temMais, pedir, busca, termo, itens.length, inicial]);

  const refazer = useCallback(() => {
    contador.current++;
    setLista(null);
    setTotal(null);
    setBusca(false);
    if (autoCarregar) { setRecarga((n) => n + 1); return; }
    if (vale) {
      setBuscando(true);
      void (async () => {
        const r = await pedir(termo, 0);
        if (r) { setLista(r.items); setTotal(r.total); setBusca(true); }
        setBuscando(false);
      })();
    }
  }, [vale, termo, pedir, autoCarregar]);

  return {
    itens,
    total: totalReal,
    temMais,
    carregarMais,
    carregando,
    q,
    setQ,
    buscando,
    doServidor: busca,
    erro,
    refazer,
  };
}
