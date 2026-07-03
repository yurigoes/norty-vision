"use client";

// Hook + utilitário pra checar permissões granulares no browser. Mesma
// semântica do `can()` server-side: master/owner/admin têm tudo, demais
// dependem do catálogo. Carrega de /api/auth/me com cache de 30s — pra
// não martelar toda vez que uma página monta.

import { useEffect, useState } from "react";

interface MeResponse {
  authenticated: boolean;
  user: {
    isOrgAdmin: boolean;
    permissions?: Record<string, boolean>;
  } | null;
  master: { id: string | null } | null;
  impersonating?: { orgId: string } | null;
}

let cache: { at: number; data: MeResponse } | null = null;
const TTL_MS = 30_000;

async function fetchMe(): Promise<MeResponse> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const r = await fetch("/api/auth/me", { credentials: "include", headers: { "x-no-loading": "1" } });
  const data: MeResponse = r.ok ? await r.json() : { authenticated: false, user: null, master: null };
  cache = { at: Date.now(), data };
  return data;
}

/** Invalida o cache (após login/logout/troca de papel). */
export function invalidatePermissionsCache() { cache = null; }

/**
 * Hook React: retorna { ready, can(key), isOrgAdmin, isMaster }.
 * Enquanto carrega (`ready=false`), trate como "ainda não sabe" — em geral
 * não renderiza nada bloqueado por permissão (evita flicker).
 */
export function usePermissions() {
  const [me, setMe] = useState<MeResponse | null>(cache?.data ?? null);
  const [ready, setReady] = useState<boolean>(!!cache);

  useEffect(() => {
    let alive = true;
    fetchMe().then((d) => { if (alive) { setMe(d); setReady(true); } });
    return () => { alive = false; };
  }, []);

  const isMaster = !!me?.master && !me?.impersonating;
  const isOrgAdmin = !!me?.user?.isOrgAdmin;

  function can(key: string): boolean {
    if (!me) return false;
    if (isMaster) return true;
    if (!me.user) return false;
    if (isOrgAdmin) return true;
    return me.user.permissions?.[key] === true;
  }

  return { ready, can, isOrgAdmin, isMaster };
}
