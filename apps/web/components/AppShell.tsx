"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * CASCA DO PAINEL — responsiva de verdade (celular, tablet e desktop)
 * ============================================================================
 * Antes o menu do painel era só `hidden md:block`: no celular e no iPad em
 * retrato ele simplesmente NÃO EXISTIA. Quem abria o sistema no telefone
 * ficava preso na tela em que caiu, sem nenhuma forma de navegar.
 *
 * Agora:
 *   - < 1024px  → barra superior fixa com botão de menu + gaveta lateral
 *                 (fecha ao navegar, ao tocar fora, no Esc e trava o scroll
 *                 do fundo enquanto está aberta);
 *   - >= 1024px → a mesma sidebar fixa de sempre, sem mudanças pra quem usa
 *                 no computador.
 *
 * O iPad em retrato (768px) entra no modo gaveta de propósito: com a sidebar
 * fixa sobrava pouca largura pras tabelas do sistema.
 */
export function AppShell({
  logo,
  sidebar,
  actions,
  children,
}: {
  /** logo da empresa (aparece na barra do celular) */
  logo: React.ReactNode;
  /** conteúdo do menu — o mesmo no desktop e na gaveta */
  sidebar: React.ReactNode;
  /** ações à direita da barra do celular (tema, etc.) */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // navegou → fecha a gaveta
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // gaveta aberta: trava o scroll do fundo e fecha no Esc
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex min-h-[100dvh]">
      {/* ------------------------------------------ fundo escuro da gaveta -- */}
      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] lg:hidden"
        />
      )}

      {/* ------------------------------------------------------- MENU ----- */}
      <aside
        id="app-sidebar"
        aria-hidden={!open ? undefined : false}
        className={[
          "scroll-themed fixed inset-y-0 left-0 z-50 w-[min(86vw,300px)] overflow-y-auto",
          "border-r border-line bg-surface px-4 py-6 transition-transform duration-300 ease-out",
          open ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          // desktop: volta pro fluxo, fixa e sem transform
          "lg:sticky lg:top-0 lg:z-auto lg:h-[100dvh] lg:w-60 lg:shrink-0 lg:translate-x-0",
          "lg:bg-surface/80 lg:shadow-none lg:backdrop-blur-xl",
        ].join(" ")}
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* fechar (só na gaveta) */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Fechar menu"
          className="mb-2 ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition hover:text-fg lg:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        {sidebar}
      </aside>

      {/* ------------------------------------------------ CONTEÚDO -------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* barra superior — só celular/tablet */}
        <header
          className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/85 px-3 backdrop-blur-xl lg:hidden"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="flex h-14 w-full items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Abrir menu"
              aria-controls="app-sidebar"
              aria-expanded={open}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-fg transition active:scale-95"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                className="h-5 w-5"
                aria-hidden
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <span className="flex min-w-0 flex-1 items-center">{logo}</span>
            {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
