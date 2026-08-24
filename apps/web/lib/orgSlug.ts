"use client";

import { ROOT_DOMAIN } from "./brand";


const RESERVED = new Set([
  "www", "app", "api", "admin", "painel", "mail", "static", "cdn", "assets",
  "n8n", "chat", "chatwoot", "glpi", "evolution", "minio", "s3", "localhost",
  // reservados do esquema 1-nível sob norty.com.br (apex/master do Vision + serviços do PRM)
  "vision", "norty", "sorva", "license", "app-sorva",
]);

/**
 * Deriva o slug da empresa a partir do subdomínio atual.
 * Ex.: zitooticas.vision.norty.com.br → "zitooticas". No apex ou
 * em hosts reservados/localhost → null.
 */
export function orgSlugFromHost(): string | null {
  if (typeof window === "undefined") return null;
  const root = ROOT_DOMAIN.toLowerCase();
  const host = window.location.hostname.toLowerCase();
  if (!host.endsWith(root)) return null;
  const sub = host.slice(0, host.length - root.length).replace(/\.$/, "");
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
  return sub;
}
