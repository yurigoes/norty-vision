"use client";

import { ROOT_DOMAIN } from "./brand";


import { SUBDOMINIOS_RESERVADOS as RESERVED } from "./subdominios";

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
