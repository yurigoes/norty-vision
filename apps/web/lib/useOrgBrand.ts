"use client";

import { useEffect, useState } from "react";

export interface OrgBrand {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  themeMode?: string | null;
}

/** cache por slug — as telas de login pedem a marca em mais de um lugar. */
const cache = new Map<string, OrgBrand | null>();
const inflight = new Map<string, Promise<OrgBrand | null>>();

export function applyBrandColor(hex: string | null | undefined): void {
  if (typeof document === "undefined") return;
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const int = parseInt(hex.slice(1), 16);
    document.documentElement.style.setProperty(
      "--brand",
      `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`,
    );
  }
}

/** tema padrão da empresa — só vale se o usuário ainda não escolheu o dele. */
export function applyOrgTheme(mode: string | null | undefined): void {
  if (typeof document === "undefined") return;
  if (mode !== "light" && mode !== "dark") return;
  try {
    if (localStorage.getItem("yugo-theme")) return;
  } catch {
    return;
  }
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(mode);
}

function load(slug: string): Promise<OrgBrand | null> {
  const cached = inflight.get(slug);
  if (cached) return cached;
  const p = fetch(`/api/organizations/public/by-slug/${encodeURIComponent(slug)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.organization as OrgBrand | undefined) ?? null)
    .catch(() => null)
    .then((org) => {
      cache.set(slug, org);
      inflight.delete(slug);
      return org;
    });
  inflight.set(slug, p);
  return p;
}

/**
 * Identidade pública da empresa (logo, nome, cor, tema) pelo slug da URL.
 * Aplica cor e tema da empresa assim que chegam — as telas de entrada já
 * abrem com a cara da empresa, não com a cara genérica do SaaS.
 */
export function useOrgBrand(slug: string | null | undefined): {
  brand: OrgBrand | null;
  loading: boolean;
} {
  const [brand, setBrand] = useState<OrgBrand | null>(() => (slug ? cache.get(slug) ?? null : null));
  const [loading, setLoading] = useState<boolean>(() => Boolean(slug) && !cache.has(slug ?? ""));

  useEffect(() => {
    if (!slug) {
      setBrand(null);
      setLoading(false);
      return;
    }
    let alive = true;
    if (cache.has(slug)) {
      const org = cache.get(slug) ?? null;
      setBrand(org);
      setLoading(false);
      applyBrandColor(org?.primaryColor);
      applyOrgTheme(org?.themeMode);
      return;
    }
    setLoading(true);
    load(slug).then((org) => {
      if (!alive) return;
      setBrand(org);
      setLoading(false);
      applyBrandColor(org?.primaryColor);
      applyOrgTheme(org?.themeMode);
    });
    return () => {
      alive = false;
    };
  }, [slug]);

  return { brand, loading };
}
