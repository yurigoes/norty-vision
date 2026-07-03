"use client";

import { useEffect } from "react";
import { orgSlugFromHost } from "../lib/orgSlug";

/**
 * Tema da EMPRESA predominante em todo o slug.
 *
 * Quando o visitante está num subdomínio de empresa (ex.:
 * zitooticas.yugochat.com.br), descobrimos o slug pelo host e buscamos o
 * `themeMode` da empresa. Se for 'light'/'dark', aplicamos no <html> — desde a
 * vitrine até os portais (cliente/funcionário/fornecedor). Respeitamos a
 * escolha manual do visitante: se ele já trocou pelo toggle (grava
 * 'yugo-theme'), não sobrescrevemos.
 *
 * No apex ou em hosts reservados (app, api, ...), `orgSlugFromHost` retorna
 * null e este componente não faz nada — o /app e a landing seguem com o tema
 * padrão / branding próprio.
 */
export function CompanyThemeScript() {
  useEffect(() => {
    const slug = orgSlugFromHost();
    if (!slug) return;
    // visitante já escolheu manualmente → respeita
    try {
      const stored = localStorage.getItem("yugo-theme");
      if (stored === "light" || stored === "dark") return;
    } catch {
      return;
    }

    const apply = (mode: string) => {
      if (mode !== "light" && mode !== "dark") return;
      const r = document.documentElement;
      r.classList.remove("light", "dark");
      r.classList.add(mode);
    };

    // cache por-slug pra aplicar instantâneo em navegações seguintes e evitar flash
    const cacheKey = `yugo-org-theme:${slug}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) apply(cached);
    } catch {}

    fetch(`/api/organizations/public/by-slug/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const mode = d?.organization?.themeMode;
        if (typeof mode === "string") {
          try { sessionStorage.setItem(cacheKey, mode); } catch {}
          // só aplica se o visitante ainda não trocou manualmente nesse meio tempo
          try {
            const stored = localStorage.getItem("yugo-theme");
            if (stored === "light" || stored === "dark") return;
          } catch {}
          apply(mode);
        }
      })
      .catch(() => {});
  }, []);

  return null;
}
