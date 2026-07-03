"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Counts = { atendimento: number; chamados: number; catalogo: number; estoque: number };
const EMPTY: Counts = { atendimento: 0, chamados: 0, catalogo: 0, estoque: 0 };

// mapeia a rota do item da sidebar pra chave de contador
const HREF_TO_KEY: Record<string, keyof Counts> = {
  "/app/atendimento": "atendimento",
  "/app/chamados": "chamados",
  "/app/catalogo": "catalogo",
  "/app/produtos": "estoque",
};

const Ctx = createContext<Counts>(EMPTY);

/** Busca os contadores de pendências e atualiza a cada 60s (foco também). */
export function SidebarCountsProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Counts>(EMPTY);
  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/sidebar/counts", { credentials: "include", headers: { "x-no-loading": "1" } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (active && d) setCounts({ atendimento: d.atendimento ?? 0, chamados: d.chamados ?? 0, catalogo: d.catalogo ?? 0, estoque: d.estoque ?? 0 }); })
        .catch(() => {});
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(load, 60_000);
    return () => { active = false; window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, []);
  return <Ctx.Provider value={counts}>{children}</Ctx.Provider>;
}

/** Retorna o contador do item da sidebar pela href (0 se não houver). */
export function useSidebarCount(href: string): number {
  const counts = useContext(Ctx);
  const key = HREF_TO_KEY[href];
  return key ? counts[key] : 0;
}
