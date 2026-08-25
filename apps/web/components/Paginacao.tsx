"use client";

import { useState } from "react";

/**
 * PAGINAÇÃO NO NAVEGADOR
 * ============================================================================
 * Três telas montavam TODAS as linhas de uma vez — Crediário, Orçamentos e
 * Transações. Com algumas centenas de contas isso vira meio segundo de layout
 * num celular, e a tela chega a milhares de nós antes de mostrar a primeira
 * linha. Produtos já cortava em páginas de 50; aqui isso virou uma peça só,
 * usada pelas quatro.
 *
 * Isto NÃO é paginação de servidor: o corte é do que a página já baixou. O que
 * o servidor manda continua sendo um pedaço com teto — o contador diz quantos
 * são, e as telas dizem de onde veio o número.
 */
export interface Paginado<T> {
  /** só o que cabe na página atual */
  pagina: T[];
  /** total de itens antes do corte */
  total: number;
  paginaAtual: number;
  totalPaginas: number;
  porPagina: number;
  setPorPagina: (n: number) => void;
  irPara: (n: number) => void;
  /** pra reiniciar quando o filtro muda */
  aoTopo: () => void;
}

export function usePaginacao<T>(itens: T[], padrao = 50): Paginado<T> {
  const [porPagina, setPorPaginaState] = useState(padrao);
  const [pagina, setPagina] = useState(1);

  const total = itens.length;
  const totalPaginas = porPagina === 0 ? 1 : Math.max(1, Math.ceil(total / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const corte =
    porPagina === 0 ? itens : itens.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);

  return {
    pagina: corte,
    total,
    paginaAtual,
    totalPaginas,
    porPagina,
    setPorPagina: (n) => { setPorPaginaState(n); setPagina(1); },
    irPara: setPagina,
    aoTopo: () => setPagina(1),
  };
}

/** o seletor de "quantas por página" */
export function PorPagina({ p, className = "" }: { p: Paginado<unknown>; className?: string }) {
  return (
    <select
      value={p.porPagina}
      onChange={(e) => p.setPorPagina(Number(e.target.value))}
      className={`input-base w-auto ${className}`}
      aria-label="Itens por página"
    >
      <option value={10}>10 por página</option>
      <option value={50}>50 por página</option>
      <option value={100}>100 por página</option>
      <option value={0}>Todas</option>
    </select>
  );
}

/** ‹ Anterior · 2 / 7 · Próxima › — some quando só existe uma página */
export function Paginacao({ p }: { p: Paginado<unknown> }) {
  if (p.porPagina === 0 || p.totalPaginas <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 text-sm">
      <button
        disabled={p.paginaAtual <= 1}
        onClick={() => p.irPara(p.paginaAtual - 1)}
        className="rounded-xl border border-line px-3 py-1.5 transition hover:border-brand/60 disabled:opacity-40"
      >
        ‹ Anterior
      </button>
      <span className="text-muted">{p.paginaAtual} / {p.totalPaginas}</span>
      <button
        disabled={p.paginaAtual >= p.totalPaginas}
        onClick={() => p.irPara(p.paginaAtual + 1)}
        className="rounded-xl border border-line px-3 py-1.5 transition hover:border-brand/60 disabled:opacity-40"
      >
        Próxima ›
      </button>
    </div>
  );
}
