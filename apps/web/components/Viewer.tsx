"use client";

import { createContext, useContext } from "react";

/**
 * Quem está olhando — o mínimo que a casca precisa saber no cliente.
 *
 * Existe por causa das abas de módulo: duas do Suporte (Specs, Recuperação)
 * são só do master, e as abas são renderizadas dentro do `PageHeader`, que não
 * tem sessão. Mostrar a aba pra quem vai bater numa tela de "acesso restrito"
 * é pior do que não mostrar. Vale também para os sub-módulos que o master
 * desliga por empresa: a aba tem que sumir junto com o item do menu.
 */
export interface Viewer {
  isMaster: boolean;
  isOrgAdmin: boolean;
  /** sub-módulos desligados pelo master p/ esta empresa: { "producao.import": false } */
  submoduleFeatures: Record<string, boolean>;
  /** recursos do módulo de produção: { "financeiro": false } */
  productionFeatures: Record<string, boolean>;
}

const VAZIO: Viewer = {
  isMaster: false,
  isOrgAdmin: false,
  submoduleFeatures: {},
  productionFeatures: {},
};

const Ctx = createContext<Viewer>(VAZIO);

export function ViewerProvider({ value, children }: { value: Viewer; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useViewer(): Viewer {
  return useContext(Ctx);
}
