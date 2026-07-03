"use client";

// global-error.tsx é renderizado pelo Next.js quando o ERRO acontece DENTRO
// do root layout (escapando o error.tsx normal). Como o layout falhou,
// renderizamos uma página independente que precisa incluir <html> e <body>.
//
// Foco: NUNCA mostrar a marca do Yugo aqui — se o usuário acessou pelo
// subdomínio dele, a mensagem de erro deve aparecer com a marca da empresa.

import { useEffect, useState } from "react";

interface OrgInfo { name: string; logoUrl: string | null; primaryColor: string | null }

const ROOT_DOMAIN = "yugochat.com.br";
const RESERVED = new Set(["www", "app", "api", "admin", "painel", "mail", "static", "cdn", "assets", "n8n", "chat", "chatwoot", "glpi", "evolution", "minio", "s3"]);

function slugFromHost(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.host.split(":")[0]?.toLowerCase() ?? "";
  if (!host.endsWith(ROOT_DOMAIN)) return null;
  const sub = host.slice(0, host.length - ROOT_DOMAIN.length).replace(/\.$/, "");
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
  return sub;
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [org, setOrg] = useState<OrgInfo | null>(null);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[global-error]", error.message, error.digest);
    const slug = slugFromHost();
    if (!slug) return;
    fetch(`/api/organizations/public/by-slug/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const o = d?.organization;
        if (!o) return;
        setOrg({ name: o.name ?? slug, logoUrl: o.logoUrl ?? null, primaryColor: o.primaryColor ?? null });
      })
      .catch(() => undefined);
  }, [error]);

  const brand = org?.primaryColor ?? "#7c3aed";
  const name = org?.name ?? "Sistema";
  const bg = "#0a0a0b", fg = "#fafafc", muted = "#a1a1aa", line = "#27272a";

  return (
    <html lang="pt-BR">
      <body style={{ background: bg, color: fg, margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
        <div style={{ width: "100%", maxWidth: 420, padding: 32, borderRadius: 16, border: `1px solid ${line}`, textAlign: "center" }}>
          {org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={name} style={{ height: 64, maxWidth: 200, margin: "0 auto 16px", objectFit: "contain" }} />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: brand, color: "#fff", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>{name.slice(0, 1).toUpperCase()}</div>
          )}
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Falha grave ao carregar</h1>
          <p style={{ fontSize: 14, color: muted, margin: "0 0 24px" }}>
            Aconteceu um erro inesperado no <strong style={{ color: fg }}>{name}</strong>. Tente recarregar.
          </p>
          <button onClick={() => reset()} style={{ background: brand, color: "#fff", border: 0, borderRadius: 8, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Tentar novamente
          </button>
          {error.digest && <p style={{ marginTop: 16, fontSize: 10, color: muted, fontFamily: "monospace" }}>ref: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
