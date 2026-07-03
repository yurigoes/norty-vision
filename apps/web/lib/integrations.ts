import { cookies } from "next/headers";

interface IntegrationDto {
  provider: string;
  baseUrl: string;
  status: string;
  embedEnabled: boolean;
  embedLabel: string | null;
  embedIcon: string | null;
  consoleUrl: string | null;
  config?: Record<string, unknown>;
}

/**
 * Busca config publica das integrations (sem credenciais sensiveis).
 * RLS no backend ja filtra; chamamos como user normal logado.
 *
 * Endpoint /api/platform/integrations exige master. Pra users normais
 * vamos precisar de um endpoint /api/integrations/embedded (TODO).
 * Por enquanto so master ve.
 */
export async function getIntegrations(): Promise<IntegrationDto[]> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";

  try {
    const res = await fetch(`${apiBase}/api/platform/integrations`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { integrations?: IntegrationDto[] };
    return data.integrations ?? [];
  } catch {
    return [];
  }
}

/**
 * Configuracao do widget Chatwoot pra embed.
 * Master cadastra websiteToken em platform_integrations.config.chatwootWebsiteToken
 * via UI futura ou direto no DB. Sem isso, widget nao aparece.
 */
export async function getChatwootEmbedConfig(): Promise<{
  baseUrl: string;
  websiteToken: string;
} | null> {
  const all = await getIntegrations();
  const cw = all.find((i) => i.provider === "chatwoot");
  if (!cw || cw.status !== "active") return null;
  if (!cw.embedEnabled) return null;
  const cfg = (cw.config ?? {}) as { chatwootWebsiteToken?: string };
  if (!cfg.chatwootWebsiteToken) return null;
  return {
    baseUrl: cw.baseUrl,
    websiteToken: cfg.chatwootWebsiteToken,
  };
}
