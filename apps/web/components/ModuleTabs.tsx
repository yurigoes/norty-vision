"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabsFor } from "../lib/nav";
import { useViewer } from "./Viewer";

/**
 * ABAS DE MÓDULO
 * ============================================================================
 * A navegação dentro de um módulo (Agenda → Calendário, Pendências,
 * Pacientes…). Antes eram três trilhos laterais quase iguais — Agenda,
 * Contratos e Suporte, cada um com o seu `SubLink` e seu conjunto de classes —
 * e mais duas improvisações com botões no cabeçalho (Atendimento, Produção).
 *
 * Dois problemas que nenhuma das cinco resolvia:
 *
 *  - **nenhuma marcava a aba atual.** Dentro do módulo, a pessoa não sabia em
 *    qual sub-tela estava;
 *  - **o trilho era `hidden lg:block`.** No celular a navegação do módulo
 *    simplesmente não existia: quem abrisse a Agenda no telefone não tinha
 *    como chegar em Pacientes.
 *
 * Agora é uma faixa que rola na horizontal — funciona em qualquer largura, e é
 * o mesmo gesto do portal do funcionário. A lista vem de `lib/nav.ts`; o
 * `PageHeader` renderiza isto sozinho a partir da rota, então nenhuma tela
 * precisa lembrar de incluir.
 */
export function ModuleTabs() {
  const pathname = usePathname() ?? "";
  const { isMaster, submoduleFeatures, productionFeatures } = useViewer();
  const todas = tabsFor(pathname);
  if (!todas) return null;

  // a aba some pelos mesmos motivos que o item do menu: é master-only, ou o
  // master desligou o sub-módulo pra esta empresa
  const tabs = todas.filter(
    (t) =>
      (!t.master || isMaster) &&
      (!t.subMod || submoduleFeatures[t.subMod] !== false) &&
      (!t.prodFeature || productionFeatures[t.prodFeature] !== false),
  );
  if (tabs.length < 2) return null; // uma aba só não é navegação

  const clean = pathname.split("?")[0].replace(/\/+$/, "");

  return (
    <nav
      aria-label="Seções do módulo"
      className="-mx-4 mt-5 overflow-x-auto border-b border-line px-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max gap-1">
        {tabs.map((tab) => {
          // a aba raiz do módulo só casa exato; as outras pegam suas sub-rotas
          const raiz = tabs[0]?.href === tab.href;
          const ativa = raiz
            ? clean === tab.href
            : clean === tab.href || clean.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href as never}
              aria-current={ativa ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
                ativa
                  ? "border-brand font-semibold text-brand"
                  : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
