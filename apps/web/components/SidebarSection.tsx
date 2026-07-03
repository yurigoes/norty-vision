"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Categoria recolhível da sidebar. Começa recolhida; abre automaticamente a
 * categoria que contém a rota ativa. O estado (aberto/fechado) é lembrado por
 * categoria no localStorage. Deixa o menu mais limpo e organizado.
 */
export function SidebarSection({
  title,
  hrefs,
  children,
  defaultOpen = false,
}: {
  title: string;
  /** rotas dos itens — usado pra auto-abrir a categoria da rota atual */
  hrefs: string[];
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const hasActive = hrefs.some((h) =>
    h === "/app" ? pathname === "/app" : pathname === h || pathname.startsWith(h + "/"),
  );
  const storageKey = `yugo-sb:${title}`;
  const [open, setOpen] = useState<boolean>(defaultOpen || hasActive);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(storageKey); } catch {}
    if (hasActive) setOpen(true);
    else if (stored === "1") setOpen(true);
    else if (stored === "0") setOpen(false);
    else setOpen(defaultOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch {}
      return next;
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted transition hover:text-fg"
      >
        <span>{title}</span>
        <span aria-hidden className={`text-[8px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>
      {open && <div className="mt-0.5 space-y-1">{children}</div>}
    </div>
  );
}
