// ============================================================================
// Conferência da busca de módulos (Ctrl+K) — lógica de `lib/paletteSearch.ts`
// exercitada com os rótulos REAIS do menu do Vision.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/paletteSearch.check.mts
//
// Sem dependência nova: é o Node executando o TypeScript direto. Sai com
// código 1 se algum caso falhar, então serve em CI.
// ============================================================================

import { searchPalette, fold, type PaletteItem } from "../paletteSearch.ts";

// rótulos reais do menu do Vision (app/app/layout.tsx)
const LABELS: Array<[string, string, string]> = [
  ["Painel (BI)", "/app/painel/otica", "Operação"],
  ["Insights (IA)", "/app/insights", "Operação"],
  ["Agenda", "/app/agenda", "Operação"],
  ["Leads", "/app/leads", "Operação"],
  ["Disparador", "/app/disparador", "Operação"],
  ["Vendas (PDV)", "/app/vendas", "Operação"],
  ["Caixa", "/app/caixa", "Operação"],
  ["Produção / Pedidos", "/app/producao", "Operação"],
  ["Costureiras (atribuir / pagar)", "/app/producao/costureiras", "Operação"],
  ["Central de Atendimento", "/app/crm", "Operação"],
  ["Telefone (ramal)", "/app/voip", "Operação"],
  ["Orçamentos", "/app/orcamentos", "Comercial"],
  ["Clientes", "/app/clientes", "Comercial"],
  ["Produtos", "/app/produtos", "Comercial"],
  ["Catálogo online", "/app/catalogo", "Comercial"],
  ["Comissões", "/app/comissoes", "Comercial"],
  ["Pesquisas (NPS)", "/app/pesquisas", "Comercial"],
  ["Fornecedores", "/app/fornecedores", "Ótica"],
  ["Pedidos de lente", "/app/pedidos-lente", "Ótica"],
  ["Repasses", "/app/repasses", "Ótica"],
  ["Crediário", "/app/crediario", "Financeiro"],
  ["Pagamentos", "/app/pagamentos", "Financeiro"],
  ["Transações", "/app/transacoes", "Financeiro"],
  ["Cobrança", "/app/cobranca", "Financeiro"],
  ["Relatórios", "/app/relatorios", "Financeiro"],
  ["Contas a pagar", "/app/financeiro/contas-a-pagar", "Financeiro"],
  ["Contas a receber", "/app/financeiro/contas-a-receber", "Financeiro"],
  ["Nota fiscal (config)", "/app/fiscal", "Financeiro"],
  ["Contratos", "/app/contratos", "Documentos"],
  ["Mensagens", "/app/modelos", "Documentos"],
  ["RH & Funcionários", "/app/rh", "Pessoas"],
  ["Ponto eletrônico", "/app/ponto", "Pessoas"],
  ["Lojas", "/app/lojas", "Configuração"],
  ["Usuários", "/app/usuarios", "Configuração"],
  ["Permissões", "/app/permissoes", "Configuração"],
  ["Telefonia (call center)", "/app/voip-admin", "Configuração"],
  ["Portal do cliente", "/app/portal-cliente", "Configuração"],
  ["Integrações", "/app/integracoes", "Configuração"],
  ["Assinatura", "/app/billing", "Configuração"],
];

const items: PaletteItem[] = [
  { label: "Painel", href: "/app", group: "Geral", keywords: "inicio home visao geral dashboard" },
  ...LABELS.map(([label, href, group]) => ({ label, href, group })),
  { label: "Minha segurança (2FA)", href: "/app/perfil/seguranca", group: "Conta", keywords: "2fa mfa autenticacao codigo" },
];

let falhas = 0;
function primeiro(query: string, esperado: string) {
  const r = searchPalette(items, query);
  const got = r[0]?.label ?? "(nada)";
  const ok = got === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"}  "${query}" → ${got}${ok ? "" : `   (esperado: ${esperado})`}`);
}
function contem(query: string, esperado: string) {
  const r = searchPalette(items, query).map((i) => i.label);
  const ok = r.includes(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"}  "${query}" contém ${esperado}${ok ? "" : `   (veio: ${r.slice(0,3).join(", ")})`}`);
}
function vazio(query: string) {
  const r = searchPalette(items, query);
  const ok = r.length === 0;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"}  "${query}" → sem resultados${ok ? "" : `   (veio: ${r[0]?.label})`}`);
}

console.log("— sem acento, caixa livre —");
primeiro("cred", "Crediário");
primeiro("CREDIARIO", "Crediário");
primeiro("comissoes", "Comissões");
primeiro("orcamento", "Orçamentos");
primeiro("permissoes", "Permissões");

console.log("\n— palavra do meio do rótulo —");
primeiro("lente", "Pedidos de lente");
primeiro("pdv", "Vendas (PDV)");
primeiro("bi", "Painel (BI)");
primeiro("nps", "Pesquisas (NPS)");
primeiro("ramal", "Telefone (ramal)");

console.log("\n— dois termos, todos precisam casar —");
primeiro("nota fiscal", "Nota fiscal (config)");
primeiro("contas pagar", "Contas a pagar");
primeiro("contas receber", "Contas a receber");
primeiro("call center", "Telefonia (call center)");

console.log("\n— sinônimo e categoria —");
contem("2fa", "Minha segurança (2FA)");
contem("dashboard", "Painel");
contem("financeiro", "Crediário");

console.log("\n— prefixo ganha de quem só contém —");
primeiro("cont", "Contas a pagar");
primeiro("pag", "Pagamentos");

console.log("\n— não inventa resultado —");
vazio("xyzabc");
vazio("nota xyz");

console.log("\n— normalização —");
console.log(fold("Crediário") === "crediario" ? "ok    fold(Crediário) = crediario" : "FALHA fold");

console.log(falhas === 0 ? "\nTODOS OS CASOS PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
