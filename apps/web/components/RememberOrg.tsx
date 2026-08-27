"use client";

import { useEffect } from "react";
import { rememberOrgSlug } from "../lib/orgMemory";

/**
 * Marca a empresa como "empresa deste aparelho" (cookie `nv_org`, 1 ano).
 * Renderiza nada. É o que faz o "Sair" e a sessão expirada devolverem o
 * usuário pra porta certa (`/e/<slug>/login`) em vez do login genérico.
 */
export function RememberOrg({ slug }: { slug: string | null | undefined }) {
  useEffect(() => {
    rememberOrgSlug(slug);
  }, [slug]);
  return null;
}
