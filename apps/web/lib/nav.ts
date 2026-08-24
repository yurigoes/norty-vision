/**
 * MAPA DO MENU DO PAINEL
 * ============================================================================
 * Uma fonte só para tudo que precisa saber quais telas existem e como elas se
 * chamam: a sidebar, a busca (Ctrl+K), os favoritos e o cabeçalho de página —
 * que usa a categoria daqui para dizer onde a pessoa está.
 *
 * Estava tudo dentro do `app/app/layout.tsx`. Cada novo consumidor copiava um
 * pedaço, e as cópias iam divergir na primeira tela nova.
 */

// `perm` = permissão fina (catálogo) exigida pra ver o item. Quando presente,
// o item só aparece se o usuário tem a permissão (org admin e master sempre têm,
// via can()). Sem `perm`: item de operação aparece pra todos; item admin só pro
// admin. Isso conserta "libero permissão e não aparece" e "BI aparece a todos".
export type NavItem = { key?: string; href: string; label: string; perm?: string; subMod?: string };
// Operação só aparece com contexto de empresa (não pro master puro).
export const NAV_OPERACAO: NavItem[] = [
  { key: "bi", href: "/app/painel/otica", label: "Painel (BI)", perm: "reports.bi_panel" },
  { key: "insights", href: "/app/insights", label: "Insights (IA)" },
  { key: "agenda", href: "/app/agenda", label: "Agenda" },
  { key: "leads", href: "/app/leads", label: "Leads" },
  // o Disparador existia como rota e como módulo de plano, mas não tinha item
  // no menu — só dava pra chegar por um atalho do painel ou digitando a URL.
  { key: "disparador", href: "/app/disparador", label: "Disparador" },
  { key: "vendas", href: "/app/vendas", label: "Vendas (PDV)" },
  { key: "caixa", href: "/app/caixa", label: "Caixa" },
  { key: "producao", href: "/app/producao", label: "Produção / Pedidos" },
  { key: "producao", href: "/app/producao/costureiras", label: "Costureiras (atribuir / pagar)", subMod: "producao.costureiras" },
  { key: "producao", href: "/app/producao/import", label: "Importar planilha (.xlsx)", subMod: "producao.import" },
  { key: "atendimento_admin", href: "/app/atendimento/macros", label: "Macros do atendimento", subMod: "atendimento.macros" },
  { key: "atendimento_admin", href: "/app/atendimento/webhooks", label: "Webhooks (n8n/Zapier)", subMod: "atendimento.webhooks" },
  { key: "crm", href: "/app/crm", label: "Central de Atendimento" },
  { key: "crm", href: "/app/prospector", label: "Prospecção (leads)", subMod: "crm.prospector" },
  { key: "voip", href: "/app/voip", label: "Telefone (ramal)" },
  { href: "/app/suporte-sistema", label: "Suporte ao sistema" },
];
// Menu do MASTER. Vira dado (e não JSX solto) porque a mesma lista alimenta a
// sidebar e a busca Ctrl+K — em duas cópias elas iam divergir na primeira
// tela nova.
export const NAV_MASTER_TOP: NavItem[] = [
  { href: "/app/platform", label: "Visão geral" },
  { href: "/app/platform/organizations", label: "Organizações" },
  { href: "/app/platform/contatos", label: "Leads do site" },
  { href: "/app/platform/suporte", label: "Suporte (chamados)" },
];
// só o DONO do SaaS (platformRole !== "support") enxerga estes
export const NAV_MASTER_OWNER: NavItem[] = [
  { href: "/app/platform/settings", label: "Identidade & Branding" },
  { href: "/app/platform/plans", label: "Planos" },
  { href: "/app/platform/niches", label: "Nichos de mercado" },
  { href: "/app/platform/modulos", label: "Preços de módulos" },
  { href: "/app/platform/financeiro", label: "Financeiro (assinaturas)" },
  { href: "/app/platform/ia", label: "Aprendizado de IA" },
  { href: "/app/platform/contratos", label: "Contratos (empresas)" },
  { href: "/app/platform/integrations", label: "Integrações" },
  { href: "/app/platform/fiscal-ref", label: "Tabelas fiscais (NCM/CEST)" },
  { href: "/app/platform/credentials", label: "🔒 Credenciais" },
  { href: "/app/platform/team", label: "Equipe master" },
  { href: "/app/platform/audit", label: "Auditoria" },
];
export const NAV_MASTER_BOTTOM: NavItem[] = [
  { href: "/app/platform/grants", label: "Acessos às Specs" },
];

// Categorias visíveis pro admin da empresa.
export const NAV_ADMIN: Array<{ title: string; items: NavItem[] }> = [
  { title: "Comercial", items: [
    { key: "orcamentos", href: "/app/orcamentos", label: "Orçamentos" },
    { key: "clientes", href: "/app/clientes", label: "Clientes" },
    { key: "atendimento", href: "/app/atendimento", label: "Atendimento" },
    { key: "chamados", href: "/app/chamados", label: "Chamados" },
    { key: "mala_direta", href: "/app/mala-direta", label: "Mala direta" },
    { key: "produtos", href: "/app/produtos", label: "Produtos" },
    { key: "catalogo", href: "/app/catalogo", label: "Catálogo online" },
    { key: "comissoes", href: "/app/comissoes", label: "Comissões" },
    { key: "pesquisas", href: "/app/pesquisas", label: "Pesquisas (NPS)" },
  ] },
  { title: "Ótica", items: [
    { key: "fornecedores", href: "/app/fornecedores", label: "Fornecedores" },
    { key: "pedidos_lente", href: "/app/pedidos-lente", label: "Pedidos de lente" },
    { key: "repasses", href: "/app/repasses", label: "Repasses" },
  ] },
  { title: "Financeiro", items: [
    { key: "crediario", href: "/app/crediario", label: "Crediário" },
    { key: "pagamentos", href: "/app/pagamentos", label: "Pagamentos" },
    { key: "pagamentos", href: "/app/transacoes", label: "Transações" },
    { key: "cobranca", href: "/app/cobranca", label: "Cobrança" },
    { key: "relatorios", href: "/app/relatorios", label: "Relatórios" },
    { key: "vendas_historico", href: "/app/vendas-historico", label: "Vendas (histórico)" },
    { key: "financeiro", href: "/app/financeiro/contas-a-pagar", label: "Contas a pagar", subMod: "financeiro.contas_pagar" },
    { key: "financeiro", href: "/app/financeiro/contas-a-receber", label: "Contas a receber", subMod: "financeiro.contas_receber" },
    { key: "fiscal", href: "/app/fiscal", label: "Nota fiscal (config)", perm: "fiscal.config" },
  ] },
  { title: "Documentos", items: [
    { key: "contratos", href: "/app/contratos", label: "Contratos" },
    { key: "modelos", href: "/app/modelos", label: "Mensagens" },
    { href: "/app/empresa-contrato", label: "Contrato da plataforma" },
  ] },
  { title: "Pessoas", items: [
    { key: "rh", href: "/app/rh", label: "RH & Funcionários" },
    { href: "/app/ponto", label: "Ponto eletrônico" },
  ] },
  { title: "Configuração", items: [
    { href: "/app/lojas", label: "Lojas", perm: "stores.manage" },
    { href: "/app/usuarios", label: "Usuários", perm: "users.manage" },
    { href: "/app/permissoes", label: "Permissões", perm: "roles.manage" },
    { key: "voip", href: "/app/voip-admin", label: "Telefonia (call center)", perm: "voip.admin" },
    { href: "/app/portal-cliente", label: "Portal do cliente" },
    { href: "/app/integracoes", label: "Integrações", perm: "integrations.manage" },
    { href: "/app/billing", label: "Assinatura" },
  ] },
];


// Itens fixos do rodapé do menu (fora das categorias). Ficavam escritos direto
// no JSX do layout — e por isso não existiam para a busca nem para o cabeçalho.
export const NAV_CONTA: Array<NavItem & { soUsuario?: boolean }> = [
  { href: "/app/suporte", label: "Suporte" },
  { href: "/app/conta", label: "Minha conta", soUsuario: true },
  { href: "/app/perfil/seguranca", label: "Minha segurança (2FA)", soUsuario: true },
];

// Telas que existem mas não são item de menu (chega-se nelas por dentro de
// outra). Entram só no índice, pra que o cabeçalho saiba onde elas ficam.
const ROTAS_INTERNAS: Array<RouteMeta> = [
  { href: "/app/modulos", label: "Módulos", group: "Assinatura" },
];

// ---------------------------------------------------------------------------
// ÍNDICE POR ROTA — de onde o cabeçalho de página tira o "você está em...".
// ---------------------------------------------------------------------------

export interface RouteMeta {
  /** nome da tela, igual ao do menu */
  label: string;
  /** categoria do menu ("Financeiro", "Operação", "Master"...) */
  group: string;
  /** rota do item de menu que casou — pode ser um pai da rota atual */
  href: string;
}

function buildIndex(): Record<string, RouteMeta> {
  const index: Record<string, RouteMeta> = {
    "/app": { label: "Painel", group: "Geral", href: "/app" },
  };
  for (const it of NAV_OPERACAO) index[it.href] = { label: it.label, group: "Operação", href: it.href };
  for (const cat of NAV_ADMIN) {
    for (const it of cat.items) index[it.href] = { label: it.label, group: cat.title, href: it.href };
  }
  for (const it of [...NAV_MASTER_TOP, ...NAV_MASTER_OWNER, ...NAV_MASTER_BOTTOM]) {
    index[it.href] = { label: it.label, group: "Master", href: it.href };
  }
  for (const it of NAV_CONTA) index[it.href] = { label: it.label, group: "Conta", href: it.href };
  for (const it of ROTAS_INTERNAS) index[it.href] = it;
  return index;
}

export const ROUTE_META: Record<string, RouteMeta> = buildIndex();

/**
 * Metadados da rota atual. Sub-página (`/app/agenda/pacientes`) herda do
 * módulo pai quando não tem entrada própria — é o que faz o cabeçalho de uma
 * tela interna ainda dizer "Agenda".
 */
export function routeMeta(pathname: string): RouteMeta | null {
  const clean = pathname.split("?")[0].replace(/\/+$/, "") || "/app";
  if (ROUTE_META[clean]) return ROUTE_META[clean];
  // do mais específico pro mais genérico: /app/a/b/c → /app/a/b → /app/a
  const parts = clean.split("/");
  for (let i = parts.length - 1; i > 1; i--) {
    const parent = parts.slice(0, i).join("/");
    if (ROUTE_META[parent]) return ROUTE_META[parent];
  }
  return null;
}
