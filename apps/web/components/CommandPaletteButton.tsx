"use client";

import { useEffect, useState } from "react";
import { openCommandPalette } from "./CommandPalette";

/**
 * Abre a busca de módulos. Existe em dois lugares da casca:
 *
 *  - `variant="field"` — no topo do menu, com cara de campo de busca e o
 *    atalho à direita, pra que a existência do Ctrl+K seja descoberta sem
 *    ninguém precisar contar;
 *  - `variant="icon"`  — na barra do celular, onde não cabe o campo.
 */
export function CommandPaletteButton({ variant = "field" }: { variant?: "field" | "icon" }) {
  // ⌘K no Mac, Ctrl K no resto — só depois de montar (o servidor não sabe)
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  const icon = (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Buscar módulo"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-fg transition active:scale-95"
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className="mb-4 flex w-full items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-sm text-muted transition hover:border-brand/40 hover:text-fg"
    >
      {icon}
      <span className="flex-1 text-left">Buscar...</span>
      <span className="hidden shrink-0 items-center gap-0.5 font-mono text-[10px] text-text-3 sm:flex">
        <kbd className="rounded border border-line px-1 py-0.5">{mac ? "⌘" : "ctrl"}</kbd>
        <kbd className="rounded border border-line px-1 py-0.5">K</kbd>
      </span>
    </button>
  );
}
