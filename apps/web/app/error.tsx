"use client";

// Error Boundary global. Renderizado pelo Next.js quando qualquer página
// dispara erro não-tratado (RSC ou client). MANTÉM o branding da empresa
// (subdomínio) — o usuário NÃO deve ver "yugochat" se acessou pelo slug
// da empresa dele.
//
// Carrega o branding via /api/organizations/public/by-slug/{slug} no client
// (não dá pra usar server helpers num "use client"). Cache em sessionStorage
// pra evitar flash quando o erro acontece repetidamente.

import { useEffect, useState } from "react";
import { orgSlugFromHost } from "../lib/orgSlug";

interface OrgInfo { name: string; logoUrl: string | null; primaryColor: string | null }

export default function GlobalErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [org, setOrg] = useState<OrgInfo | null>(null);

  useEffect(() => {
    // Log pro console pra debug (Next NÃO mostra digest pro usuário final).
    // eslint-disable-next-line no-console
    console.error("[error.tsx]", error.message, error.digest);
    const slug = typeof window === "undefined" ? null : orgSlugFromHost();
    if (!slug) return;
    const cacheKey = `yugo-org-brand:${slug}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) setOrg(JSON.parse(cached));
    } catch {}
    fetch(`/api/organizations/public/by-slug/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const o = d?.organization;
        if (!o) return;
        const info: OrgInfo = { name: o.name ?? slug, logoUrl: o.logoUrl ?? null, primaryColor: o.primaryColor ?? null };
        setOrg(info);
        try { sessionStorage.setItem(cacheKey, JSON.stringify(info)); } catch {}
      })
      .catch(() => undefined);
  }, [error]);

  const brand = org?.primaryColor ?? "#7c3aed";
  const name = org?.name ?? "Sistema";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg/80 p-8 text-center backdrop-blur">
        {org?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt={name} className="mx-auto mb-4 h-16 w-auto max-w-[200px] object-contain" />
        ) : (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl font-bold text-white" style={{ background: brand }}>
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}

        <h1 className="text-xl font-semibold">Ops, algo deu errado</h1>
        <p className="mt-2 text-sm text-muted">
          Aconteceu um erro ao carregar esta tela do <strong>{name}</strong>. Tente de novo —
          se persistir, fale com seu administrador.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => reset()}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: brand }}
          >
            Tentar novamente
          </button>
          <button
            onClick={() => { if (typeof window !== "undefined") window.location.href = "/"; }}
            className="rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-muted hover:text-fg"
          >
            Voltar ao início
          </button>
        </div>

        {error.digest && (
          <p className="mt-4 font-mono text-[10px] text-muted/60">ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
