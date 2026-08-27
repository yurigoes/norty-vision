"use client";

import { useState } from "react";
import { loginPathFor, readOrgSlug } from "../lib/orgMemory";

interface Props {
  isMaster: boolean;
  className?: string;
}

/**
 * Logout client-side: chama tanto /api/auth/logout quanto
 * /api/platform-auth/logout (idempotente) pra garantir que ambos os
 * cookies sejam limpos.
 *
 * DEPOIS volta pra PORTA DA EMPRESA (`/e/<slug>/login`, com logo e cor dela) —
 * não mais pro `/login` genérico. Era exatamente aqui que o funcionário se
 * perdia: entrava por `/e/zito-oticas/login` e o "Sair" o jogava numa tela
 * que ele nunca tinha visto. O master continua indo pro apex (`?global=1`),
 * que é a porta dele.
 */
export function LogoutButton({ isMaster, className = "" }: Props) {
  const [busy, setBusy] = useState(false);

  async function doLogout() {
    setBusy(true);
    try {
      // best-effort: tenta os 2 endpoints sempre
      await Promise.allSettled([
        fetch("/api/auth/logout", { method: "POST", credentials: "include" }),
        fetch("/api/platform-auth/logout", { method: "POST", credentials: "include" }),
      ]);
    } finally {
      // hard redirect pra forçar nova request RSC sem cookies
      const slug = readOrgSlug();
      window.location.href = isMaster ? "/login?global=1" : loginPathFor("equipe", slug);
    }
  }

  return (
    <button
      type="button"
      onClick={doLogout}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-danger disabled:opacity-50 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
      {busy ? "Saindo..." : "Sair"}
    </button>
  );
}
