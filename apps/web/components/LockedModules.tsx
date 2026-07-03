"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Seção recolhida só com os módulos NÃO liberados (fora do plano da empresa).
 * Cada item leva pra página do módulo, que explica pra que serve e oferece
 * comprar à la carte ou trocar de plano. Mantém o cadeado, mas tira a bagunça
 * de espalhar bloqueados pelas categorias.
 */
export function LockedModules({ items }: { items: Array<{ key: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(localStorage.getItem("yugo-sb:locked") === "1"); } catch {}
  }, []);
  if (items.length === 0) return null;
  function toggle() {
    setOpen((v) => { const n = !v; try { localStorage.setItem("yugo-sb:locked", n ? "1" : "0"); } catch {} return n; });
  }
  return (
    <div className="mt-4 border-t border-line pt-3">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted transition hover:text-fg"
      >
        <span>🔒 Não liberados ({items.length})</span>
        <span aria-hidden className={`text-[8px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
      </button>
      {open && (
        <div className="mt-0.5 space-y-1">
          {items.map((m) => (
            <Link
              key={m.key}
              href={`/app/modulos/${m.key}`}
              title="Conheça e libere este módulo"
              className="flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-muted/70 transition hover:bg-line/60"
            >
              <span className="truncate">{m.label}</span>
              <span aria-hidden className="ml-2 shrink-0 text-xs">🔒</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
