/**
 * Catálogo canônico de módulos do sistema. As CHAVES batem com as usadas no
 * cadeado da sidebar (app/layout.tsx → locked(key)). Um plano libera os módulos
 * marcados aqui via `features` (a empresa que assina recebe acesso automático).
 *
 * Lojas/Usuários/Permissões/Integrações/Assinatura são CORE (sempre liberados),
 * por isso não entram no catálogo de seleção.
 */
export interface ModuleDef {
  key: string;
  label: string;
}

export const MODULE_GROUPS: Array<{ group: string; modules: ModuleDef[] }> = [
  {
    group: "Operação",
    modules: [
      { key: "agenda", label: "Agenda" },
      { key: "leads", label: "Leads" },
      { key: "disparador", label: "Disparador" },
      { key: "vendas", label: "Vendas (PDV)" },
      { key: "caixa", label: "Caixa" },
      { key: "producao", label: "Produção / Pedidos" },
    ],
  },
  {
    group: "Comercial",
    modules: [
      { key: "orcamentos", label: "Orçamentos" },
      { key: "clientes", label: "Clientes" },
      { key: "mala_direta", label: "Mala direta" },
      { key: "produtos", label: "Produtos" },
      { key: "catalogo", label: "Catálogo online" },
      { key: "comissoes", label: "Comissões" },
      { key: "pesquisas", label: "Pesquisas (NPS)" },
      { key: "vendas_historico", label: "Vendas (histórico/importação)" },
    ],
  },
  {
    group: "Inteligência (BI/IA)",
    modules: [
      { key: "bi", label: "Painel BI (acompanhamento)" },
      { key: "insights", label: "Insights (IA proativa)" },
    ],
  },
  {
    group: "Atendimento",
    modules: [
      { key: "atendimento", label: "Call Center / Atendimento (IA)" },
      { key: "crm", label: "Central de Atendimento (CRM/Leads)" },
      { key: "voip", label: "Telefone interno (ramal/VoIP)" },
      { key: "chamados", label: "Chamados / Ordens de serviço" },
    ],
  },
  {
    group: "Ótica",
    modules: [
      { key: "fornecedores", label: "Fornecedores" },
      { key: "pedidos_lente", label: "Pedidos de lente" },
      { key: "repasses", label: "Repasses" },
    ],
  },
  {
    group: "Financeiro",
    modules: [
      { key: "crediario", label: "Crediário" },
      { key: "pagamentos", label: "Pagamentos" },
      { key: "financeiro", label: "Financeiro (contas a pagar/receber)" },
      { key: "cobranca", label: "Cobrança" },
      { key: "relatorios", label: "Relatórios" },
    ],
  },
  {
    group: "Documentos",
    modules: [
      { key: "contratos", label: "Contratos" },
      { key: "modelos", label: "Mensagens" },
      { key: "fiscal", label: "Nota fiscal (NFC-e/NF-e)" },
    ],
  },
  {
    group: "Pessoas",
    modules: [
      { key: "rh", label: "RH & Funcionários" },
      { key: "ponto", label: "Ponto eletrônico" },
    ],
  },
];

export const ALL_MODULES: ModuleDef[] = MODULE_GROUPS.flatMap((g) => g.modules);

export function moduleLabel(key: string): string {
  return ALL_MODULES.find((m) => m.key === key)?.label ?? key;
}

/**
 * Visibilidade de módulo por NICHO (declarativo). A chave é a do módulo; o valor
 * é a lista de nichos onde ele aparece. "*" = qualquer nicho.
 *
 * Antes essa regra ficava chumbada no layout.tsx (`if (isOtica)`). Agora é dado:
 * pra liberar um módulo num nicho novo, basta editar este mapa (e, na fase
 * seguinte, virar tabela editável no master). Módulo SEM entrada aqui = "*"
 * (aparece em todo nicho) — assim nada some por engano ao adicionar um módulo.
 *
 * Convenção dos nichos atuais: "otica", "grafica", "generico" (ou null no banco).
 */
export const MODULE_NICHES: Record<string, string[]> = {
  // Exclusivos de ÓTICA (exames/lentes/laboratório)
  fornecedores: ["otica"],
  pedidos_lente: ["otica"],
  repasses: ["otica"],
  bi: ["otica"], // Painel BI de acompanhamento de exames é específico de ótica
  // Demais módulos: "*" implícito (todos os nichos)
};

/** Lista de nichos onde um módulo aparece. Default "*" (todos). */
export function moduleNiches(key: string): string[] {
  return MODULE_NICHES[key] ?? ["*"];
}

/** O módulo `key` deve aparecer pra uma empresa do nicho `niche`?
 *  niche null/desconhecido = trata como "generico" (vê só os módulos "*"). */
export function moduleAllowedForNiche(key: string, niche: string | null | undefined): boolean {
  const niches = moduleNiches(key);
  if (niches.includes("*")) return true;
  const n = (niche ?? "generico").toLowerCase();
  return niches.includes(n);
}

/** Descrição curta de cada módulo — usada na página de venda do módulo bloqueado. */
export const MODULE_INFO: Record<string, string> = {
  agenda: "Agendamentos com confirmação por WhatsApp, calendário, exames e lembretes automáticos.",
  leads: "Capte e organize contatos interessados, com funil e acompanhamento.",
  disparador: "Envios em massa por WhatsApp com fila e proteção anti-ban.",
  vendas: "PDV completo: venda com múltiplos meios de pagamento, Pix e cartão.",
  caixa: "Abertura/fechamento de caixa por turno com totais por meio de pagamento.",
  producao: "Pedidos de produção (uniformes, OS): status, kanban, aprovação de arte, lote e ficha técnica.",
  orcamentos: "Crie orçamentos, gere PDF e envie por WhatsApp e e-mail com sua marca.",
  clientes: "Cadastro de clientes com histórico, fotos e portal próprio.",
  atendimento: "Call center omnichannel com IA, filas, tabulação e relatórios.",
  crm: "CRM de atendimento: leads, pipeline, linha do tempo, tabulação e follow-ups — lead novo entra sozinho do WhatsApp.",
  voip: "Telefone interno (ramal WebRTC) entre operadores — ligue pelo nome, grátis. Conferência e registro na timeline do lead.",
  chamados: "Chamados e ordens de serviço com acompanhamento e SLA.",
  mala_direta: "Campanhas e comunicados segmentados para sua base.",
  produtos: "Catálogo de produtos com fotos, preços e controle de estoque por loja.",
  catalogo: "Vitrine online pública com a sua marca; o cliente monta o pedido.",
  comissoes: "Comissão por vendedor e painel de desempenho de vendas.",
  pesquisas: "Pesquisa de satisfação (NPS) por etapa, com nota do vendedor.",
  vendas_historico: "Importação de vendas antigas (item a item) do sistema anterior, só para controle/relatório.",
  bi: "Painel de BI: faturamento, tendência, top produtos e projeção (com leitura da IA).",
  insights: "Insights proativos da IA: dicas inline e análise de gargalos da operação.",
  fornecedores: "Cadastro de fornecedores/laboratórios e portal do fornecedor.",
  pedidos_lente: "Pedidos de lente com acompanhamento, NF e portal do cliente.",
  repasses: "Repasse médico/laboratório com comprovantes e fechamento.",
  crediario: "Crediário próprio: contas, parcelas, contratos e análise de limite.",
  pagamentos: "Pagamentos online (Mercado Pago e InfinitePay): Pix, cartão e baixa automática.",
  financeiro: "Financeiro: contas a pagar e a receber, recorrentes e fluxo de caixa.",
  cobranca: "Régua de cobrança automática (dunning) e retentativa de cartão.",
  relatorios: "Relatórios gerenciais detalhados do crediário e da operação.",
  contratos: "Modelos de contrato com variáveis, assinatura e portal do cliente.",
  modelos: "Modelos de mensagem (WhatsApp/e-mail) por empresa.",
  fiscal: "Emissão de nota fiscal (NFC-e/NF-e) direto na SEFAZ com certificado A1.",
  rh: "RH & funcionários: holerite, atestado, exames, advertências e portal do funcionário.",
  ponto: "Ponto eletrônico (REP-A): marcação, escalas, espelho, banco de horas e AFD/AEJ.",
};

export function moduleDescription(key: string): string {
  return MODULE_INFO[key] ?? "Módulo do sistema.";
}

/**
 * SUB-MÓDULOS por módulo (Fase 2 + extensão). Cada um é uma aba/tela DENTRO de
 * um módulo que o master pode esconder por empresa. A chave de armazenamento é
 * "<modulo>.<sub>" (ex.: "producao.nf", "financeiro.contas_pagar"). O item CORE
 * de cada módulo (ex.: lista de pedidos, inbox) é sempre visível.
 *
 * Semântica DEFAULT-ON: o master grava só o que DESLIGOU (override). Ausência da
 * chave em submoduleFeatures = ligado. Assim sub-módulo novo aparece sozinho e
 * empresa sem config vê tudo. Use `submoduleEnabled(features, modulo, sub)`.
 */
export interface SubmoduleDef {
  key: string;
  label: string;
  hint?: string;
}
export const MODULE_SUBMODULES: Record<string, SubmoduleDef[]> = {
  producao: [
    { key: "kanban", label: "Design / Kanban", hint: "Quadro de arte com aprovação e calendário" },
    { key: "lotes", label: "Lotes de produção", hint: "Agrupar pedidos em lotes e avançar em bloco" },
    { key: "tabelas", label: "Tabela de preços e medidas", hint: "Catálogo de preços por quantidade e grade de tamanhos (gráfica)" },
    { key: "costureiras", label: "Costureiras / terceiros", hint: "Atribuir OS a costureiras, portal e pagamento" },
    { key: "import", label: "Importar planilha (.xlsx)", hint: "Importação de pedidos em massa de planilha" },
    { key: "nf", label: "Notas fiscais (NFS-e)", hint: "Aba de NF pendentes e geradas" },
    { key: "cancel", label: "Cancelamentos / estorno", hint: "Cancelar pedido com estorno e cancelamento da NFS-e" },
    { key: "financeiro", label: "Painel financeiro da produção", hint: "Dashboard de recebíveis e custos da produção" },
  ],
  atendimento: [
    { key: "macros", label: "Macros do atendimento", hint: "Respostas/ações automatizadas (atalhos do operador)" },
    { key: "webhooks", label: "Webhooks (n8n/Zapier)", hint: "Integrações de saída por evento do inbox" },
  ],
  financeiro: [
    { key: "contas_pagar", label: "Contas a pagar", hint: "Lançamentos e baixa de despesas" },
    { key: "contas_receber", label: "Contas a receber", hint: "Recebíveis e baixa de receitas" },
  ],
  crm: [
    { key: "prospector", label: "Prospecção (leads)", hint: "Busca de empresas (OSM/CNPJ) que alimenta o funil" },
  ],
};

/** Lista de sub-módulos de um módulo (vazio se não tem). */
export function moduleSubmodules(moduleKey: string): SubmoduleDef[] {
  return MODULE_SUBMODULES[moduleKey] ?? [];
}

/** Um sub-módulo está LIGADO a menos que "<modulo>.<sub>" esteja como false no
 *  mapa de overrides (default-on). `features` vem de org.submoduleFeatures. */
export function submoduleEnabled(features: unknown, moduleKey: string, subKey: string): boolean {
  if (features && typeof features === "object" && !Array.isArray(features)) {
    return (features as Record<string, unknown>)[`${moduleKey}.${subKey}`] !== false;
  }
  return true; // sem config = tudo ligado
}

// ---- back-compat (Fase 2 só-Produção): mantém os imports antigos vivos ----
export const PRODUCTION_SUBMODULES: SubmoduleDef[] = MODULE_SUBMODULES.producao!;
/** @deprecated use submoduleEnabled(features, "producao", key). Aceita o mapa
 *  derivado productionFeatures (chaves "soltas") OU o genérico ("producao.x"). */
export function productionSubEnabled(features: unknown, key: string): boolean {
  if (features && typeof features === "object" && !Array.isArray(features)) {
    const f = features as Record<string, unknown>;
    return f[key] !== false && f[`producao.${key}`] !== false;
  }
  return true;
}

/** Linhas de limite formatadas pra exibição do plano. */
export function planLimitLines(p: { maxStores: number | null; maxUsers: number | null; maxMessagesMonth: number | null }): string[] {
  const out: string[] = [];
  out.push(p.maxStores != null ? `Até ${p.maxStores} ${p.maxStores === 1 ? "loja" : "lojas"}` : "Lojas ilimitadas");
  out.push(p.maxUsers != null ? `${p.maxUsers} ${p.maxUsers === 1 ? "usuário" : "usuários"}` : "Usuários ilimitados");
  if (p.maxMessagesMonth != null) out.push(`${p.maxMessagesMonth.toLocaleString("pt-BR")} mensagens/mês`);
  return out;
}
