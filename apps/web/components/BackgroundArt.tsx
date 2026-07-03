"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * BackgroundArt — marca d'agua por modulo.
 *
 * Cada aba tem seu proprio icone (linha, monocromatico). O elemento fica
 * ancorado ABSOLUTAMENTE A DIREITA e so METADE dele aparece (a outra metade
 * sai da tela) pra dar um ar profissional. A cada troca de aba o icone faz
 * uma transicao suave (slide + escala).
 */

// icones em grid 24x24 (stroke = currentColor via .bg-icon)
const ICONS: Record<string, ReactNode> = {
  painel: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </>
  ),
  agenda: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
    </>
  ),
  vendas: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
  crediario: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </>
  ),
  produtos: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </>
  ),
  relatorios: (
    <>
      <line x1="5" y1="21" x2="5" y2="11" />
      <line x1="12" y1="21" x2="12" y2="4" />
      <line x1="19" y1="21" x2="19" y2="14" />
      <line x1="2" y1="21" x2="22" y2="21" />
    </>
  ),
  cobranca: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 9H4c0-2 2-3 2-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  contratos: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </>
  ),
  modelos: (
    <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z" />
  ),
  pagamentos: (
    <>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <line x1="2" y1="11" x2="22" y2="11" />
      <path d="M17 15.5h2" />
    </>
  ),
  leads: <path d="M3 4h18l-7 8.2V20l-4 2v-9.8z" />,
  fornecedores: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </>
  ),
  lentes: (
    <>
      <circle cx="6" cy="14" r="4" />
      <circle cx="18" cy="14" r="4" />
      <path d="M10 13c1-1 3-1 4 0" />
      <path d="M2 11l2-4h3" />
      <path d="M22 11l-2-4h-3" />
    </>
  ),
  repasses: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9v.01" />
      <path d="M18 15v.01" />
    </>
  ),
  disparador: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </>
  ),
  clientes: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M21.5 20v-1a5 5 0 0 0-3.5-4.7" />
    </>
  ),
  maladireta: (
    <>
      <path d="M3 11l18-7-7 18-3-7-8-4z" />
      <path d="M10 14l4-4" />
    </>
  ),
  comissoes: (
    <>
      <line x1="5" y1="21" x2="5" y2="13" />
      <line x1="12" y1="21" x2="12" y2="7" />
      <line x1="19" y1="21" x2="19" y2="11" />
      <path d="M4 6l6-2 4 2 6-3" />
    </>
  ),
  pesquisas: (
    <>
      <path d="M9 11l3 3 6-6" />
      <path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
      <path d="M12 17l-2 1 .5-2.2L9 14h2.2L12 12l.8 2H15l-1.5 1.8L14 18z" />
    </>
  ),
  config: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 16a1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 9.4a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 5.6h.09A1.65 1.65 0 0 0 9.4 4.09V4a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 16 5.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 11v.09A1.65 1.65 0 0 0 21 12.6h.09" />
    </>
  ),
  suporte: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <line x1="14.5" y1="9.5" x2="18.5" y2="5.5" />
      <line x1="5.5" y1="18.5" x2="9.5" y2="14.5" />
      <line x1="14.5" y1="14.5" x2="18.5" y2="18.5" />
      <line x1="5.5" y1="5.5" x2="9.5" y2="9.5" />
    </>
  ),
  platform: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  portal: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </>
  ),
  // call center / atendimento: headset (arco + conchas + microfone)
  headset: (
    <>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2" y="13" width="4.5" height="7" rx="1.6" />
      <rect x="17.5" y="13" width="4.5" height="7" rx="1.6" />
      <path d="M20 20v1a3 3 0 0 1-3 3h-4" />
    </>
  ),
  // produção (uniformes): camiseta
  producao: (
    <path d="M9 3 4 6l2 4 3-1v9h6v-9l3 1 2-4-5-3a3 3 0 0 1-6 0z" />
  ),
  // orçamentos: documento com cifrão
  orcamentos: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 11.5c-1.4 0-2 .7-2 1.5s.8 1.2 2 1.5 2 .7 2 1.5-.6 1.5-2 1.5m0-7.5v1m0 5.5v1" />
    </>
  ),
  // chamados / service desk: ticket de suporte com picote
  chamados: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
      <line x1="10" y1="6" x2="10" y2="18" strokeDasharray="2 2.5" />
      <line x1="14" y1="10" x2="17" y2="10" />
      <line x1="14" y1="14" x2="17" y2="14" />
    </>
  ),
  // fallback: simbolo yugo (triangulo + lemniscata)
  default: (
    <>
      <path d="M12 3 8 9h8z" />
      <path d="M8 9c-3 0-3 6 0 6 2 0 3-2 4-6 1 4 2 6 4 6 3 0 3-6 0-6" />
    </>
  ),
};

function sceneFor(p: string): keyof typeof ICONS {
  if (p === "/app" || p === "/") return "painel";
  if (p.startsWith("/app/agenda")) return "agenda";
  if (p.startsWith("/app/vendas")) return "vendas";
  if (p.startsWith("/app/crediario")) return "crediario";
  if (p.startsWith("/app/produtos")) return "produtos";
  if (p.startsWith("/app/fornecedores")) return "fornecedores";
  if (p.startsWith("/app/pedidos-lente")) return "lentes";
  if (p.startsWith("/app/repasses")) return "repasses";
  if (p.startsWith("/app/clientes")) return "clientes";
  if (p.startsWith("/app/mala-direta")) return "maladireta";
  if (p.startsWith("/app/comissoes")) return "comissoes";
  if (p.startsWith("/app/pesquisas")) return "pesquisas";
  if (p.startsWith("/app/relatorios")) return "relatorios";
  if (p.startsWith("/app/cobranca")) return "cobranca";
  if (p.startsWith("/app/contratos")) return "contratos";
  if (p.startsWith("/app/modelos")) return "modelos";
  if (p.startsWith("/app/pagamentos")) return "pagamentos";
  if (p.startsWith("/app/leads")) return "leads";
  if (p.startsWith("/app/disparador")) return "disparador";
  if (p.startsWith("/app/orcamentos")) return "orcamentos";
  if (p.startsWith("/app/atendimento")) return "headset";
  if (p.startsWith("/app/chamados")) return "chamados";
  if (p.startsWith("/app/suporte")) return "suporte";
  if (p.startsWith("/app/platform")) return "platform";
  if (p.startsWith("/app/lojas") || p.startsWith("/app/usuarios") || p.startsWith("/app/permissoes") || p.startsWith("/app/integracoes")) return "config";
  if (p.startsWith("/c")) return "portal";
  return "default";
}

export function BackgroundArt() {
  const pathname = usePathname() ?? "/";
  const key = sceneFor(pathname);

  // re-anima a CADA mudança de rota (key = pathname): o ícone faz o
  // slide+escala em toda navegação, deixando a transição sempre visível.
  // config gira a engrenagem; demais cenas fazem o swap.
  const animKey = pathname;
  const animClass = key === "config" ? "bg-icon-spin" : "bg-icon-swap";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {/* ancorado a direita; translate-x-1/4 deixa ~75% do icone visivel */}
      <div className="bg-art absolute right-0 top-1/2 h-[82vmin] w-[82vmin] -translate-y-1/2 translate-x-1/4">
        <div key={animKey} className={`${animClass} h-full w-full`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="bg-icon h-full w-full"
          >
            {ICONS[key]}
          </svg>
        </div>
      </div>
    </div>
  );
}
