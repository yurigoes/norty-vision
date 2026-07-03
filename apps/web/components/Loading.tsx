"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Loading global: mostra um modal de carregamento (na cor da marca) em TODA
 * ação que modifica dados (POST/PUT/PATCH/DELETE via fetch) e durante navegações
 * de menu. Bloqueia a tela enquanto carrega → evita cliques repetidos / envios
 * duplicados. Some sozinho ao terminar.
 *
 * Pollers (autorefresh) podem se isentar mandando o header `x-no-loading: 1`.
 */
type LoadingCtx = { begin: () => void; end: () => void };
const Ctx = createContext<LoadingCtx>({ begin: () => {}, end: () => {} });
export function useLoading() {
  return useContext(Ctx);
}

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const countRef = useRef(0);
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bump = useCallback((d: number) => {
    countRef.current = Math.max(0, countRef.current + d);
    setCount(countRef.current);
  }, []);

  // pequeno atraso antes de mostrar: ações rápidas não piscam o overlay
  useEffect(() => {
    if (count > 0) {
      if (!timer.current) timer.current = setTimeout(() => setVisible(true), 180);
    } else {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      setVisible(false);
    }
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [count]);

  // intercepta fetch: conta requisições que modificam dados
  useEffect(() => {
    const orig = window.fetch;
    window.fetch = async (input: any, init?: any) => {
      let method = (init?.method ?? (input && typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET").toUpperCase();
      let optOut = false;
      try { optOut = !!new Headers(init?.headers).get("x-no-loading"); } catch { /* ignore */ }
      const track = method !== "GET" && method !== "HEAD" && !optOut;
      if (track) bump(1);
      try {
        return await orig(input, init);
      } finally {
        if (track) bump(-1);
      }
    };
    return () => { window.fetch = orig; };
  }, [bump]);

  return (
    <Ctx.Provider value={{ begin: () => bump(1), end: () => bump(-1) }}>
      {children}
      {visible && <LoadingOverlay />}
    </Ctx.Provider>
  );
}

/** Overlay com o spinner de bolinhas (estilo boot do Windows) na cor da marca. */
export function LoadingOverlay({ label }: { label?: string }) {
  return (
    <div className="yugo-loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="yugo-loading-card">
        <div className="yugo-loader" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <i key={i} style={{ transform: `rotate(${i * 45}deg)` }}>
              <b style={{ animationDelay: `${i * 0.12}s` }} />
            </i>
          ))}
        </div>
        <span className="yugo-loading-label">{label ?? "Processando…"}</span>
      </div>
    </div>
  );
}
