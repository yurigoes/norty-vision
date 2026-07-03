"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Botão "Entrar" do header da landing com submenu de portais:
 *  - Empresa    → /login    (equipe / administração)
 *  - Cliente    → /c/login  (portal do crediário)
 *  - Fornecedor → /f/login  (médicos e laboratórios)
 */
const PORTALS = [
  {
    href: "/login",
    title: "Empresa",
    desc: "Equipe e administração",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 21V9h6v12" />
        <path d="M9 7h.01M15 7h.01M9 13h.01M15 13h.01" />
      </>
    ),
  },
  {
    href: "/c/login",
    title: "Cliente",
    desc: "Portal do crediário",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
      </>
    ),
  },
  {
    href: "/f/login",
    title: "Fornecedor",
    desc: "Médicos e laboratórios",
    icon: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M3 12h18" />
      </>
    ),
  },
  {
    href: "/rh/login",
    title: "Funcionário",
    desc: "Ponto, holerite e RH",
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
];

export function EntrarMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:translate-y-[-1px] hover:opacity-90"
      >
        Entrar
        <span className={`text-xs transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-bg/95 shadow-2xl backdrop-blur-md"
        >
          <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Escolha seu acesso
          </p>
          {PORTALS.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-3 px-4 py-3 transition hover:bg-brand/10"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition group-hover:border-brand group-hover:text-brand">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  {p.icon}
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{p.title}</span>
                <span className="block text-xs text-muted">{p.desc}</span>
              </span>
              <span className="ml-auto text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
