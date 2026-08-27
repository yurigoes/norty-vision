"use client";

import { usePathname } from "next/navigation";
import { routeMeta } from "../lib/nav";

/**
 * "Você está em..." derivado da rota, pelo mapa do menu (`lib/nav.ts`).
 *
 * Mostra o MÓDULO — o mesmo nome que está no menu lateral. Numa tela interna
 * (`/app/agenda/pacientes`) mostra o módulo pai ("Agenda"): a pessoa sabe onde
 * está mesmo que a tela não tenha cabeçalho escrito à mão.
 *
 * NÃO tenta adivinhar o nome da sub-página a partir da URL. O slug vem sem
 * acento — "duvidas", "botoes", "relatorios" — e sairia errado em maiúsculas,
 * que é como o cabeçalho é exibido. Quando o nome da tela importa, ele é
 * escrito na própria tela (`eyebrow="Atendimento · Dúvidas"`).
 *
 * Rota fora do menu → não mostra nada. Melhor silêncio do que lugar errado.
 */
export function AutoEyebrow() {
  const pathname = usePathname() ?? "";
  const meta = routeMeta(pathname);
  if (!meta) return null;
  return <p className="text-xs font-semibold uppercase tracking-wider text-brand">{meta.label}</p>;
}
