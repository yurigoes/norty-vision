// ============================================================================
// Conferência do porteiro comercial: o que a empresa não contratou tem que
// bater na porta da API também, não só na da tela.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/modulo.check.mts
//
// A tela barrava os quatro casos — plano, nicho, sub-módulo e permissão. No
// servidor só existiam dois porteiros: `@RequirePermission` (o que a PESSOA
// pode) e, depois, `@RequireSubmodule` (o que o master desligou). Faltava o
// principal: o PLANO. Uma empresa sem Crediário via a tela redirecionar pra
// página que vende o módulo — e `GET /api/credit/accounts` respondia 200.
//
// Esta conferência exige que:
//   1. todo SUB-MÓDULO que a tela desliga tenha guarda na API;
//   2. todo MÓDULO do menu tenha guarda na API — ou esteja na lista de
//      COMPARTILHADOS, com o motivo escrito;
//   3. a guarda esteja registrada como APP_GUARD e deixe o master puro passar.
//
// A lista de compartilhados não é preguiça: `/api/customers` serve o PDV, a
// agenda, o crediário e o atendimento. Desligar o módulo "clientes" (a TELA de
// clientes) não pode cegar o PDV. Onde o compartilhamento é consumo DELIBERADO
// do módulo — o PDV oferecendo crediário — a guarda entra mesmo assim.
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(api, "..", "web");
const falhas: string[] = [];

const nav = readFileSync(join(web, "lib", "nav.ts"), "utf8");
const subChaves = [...new Set([...nav.matchAll(/subMod:\s*"([a-z_.]+)"/g)].map((m) => m[1]))];
const modChaves = [...new Set([...nav.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]))];

/** sub-módulo que fecha só a tela, e por quê */
const SO_NA_TELA: Record<string, string> = {};

/**
 * Módulos cuja API é COMPARTILHADA com outros módulos: guardar o controller
 * cegaria uma tela que a empresa contratou. O motivo tem que dizer QUEM mais
 * usa — é o que permite conferir se ainda é verdade.
 */
const COMPARTILHADOS: Record<string, string> = {
  clientes: "/api/customers serve PDV, agenda, crediário, atendimento, chamados e produção",
  produtos: "/api/products serve PDV, atendimento, pedidos de lente, produção e relatórios",
  fornecedores: "/api/suppliers serve pedidos de lente (laboratórios), produção (costureiras) e repasses",
  vendas: "/api/sales é lido por comissões; e /api/cash é do PDV e do Caixa",
  caixa: "/api/cash é aberto pelo Caixa e exigido pelo PDV — guardar um fecha o outro",
  fiscal: "/api/fiscal emite nota a partir do PDV, da produção e do catálogo",
  contratos: "/api/contracts é assinado no crediário e no RH",
  insights: "/api/insights dá as dicas de cadastro dentro de Produtos",
  catalogo: "/api/marketplace é a vitrine, editada também por Produtos",
  repasses: "/api/payouts também paga costureiras a partir da Produção",
  modelos: "/api/messaging serve cobrança e mala direta",
  atendimento_admin: "não tem API própria — macros e webhooks entram pelos sub-módulos",
  leads: "tela em construção (\"em breve\"), ainda sem API nenhuma",
  disparador: "tela em construção, dispara pelo /api/broadcast do mala_direta",
};

/**
 * Módulo guardado EM PARTE: a API exclusiva dele tem `@RequireModule`, mas uma
 * API compartilhada continua aberta — e dizer "guardado" sem essa ressalva
 * seria mentir na contagem. O valor nomeia o prefixo que fica aberto e por quê.
 */
const PARCIAIS: Record<string, string> = {
  agenda: "/api/appointments e /api/schedule ficam abertos: montam a agenda dentro do atendimento também",
  atendimento: "/api/inbox fica aberto: a produção usa pra avisar o cliente",
  pagamentos: "/api/payments fica aberto: é o meio de cobrança do PDV, do crediário e da produção",
  mala_direta: "/api/messaging fica aberto: os modelos servem cobrança também",
  crediario: "/api/contracts fica aberto: o RH também assina contrato",
  producao: "/api/payouts e /api/fiscal ficam abertos: repasses e nota fiscal são de outros módulos",
  crm: "nada aberto — prospector e crm são exclusivos",
};

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return controllers(p);
    return p.endsWith(".controller.ts") ? [p] : [];
  });
}
const fontes = controllers(join(api, "src")).map((f) => readFileSync(f, "utf8")).join("\n");

// 1. sub-módulos
for (const chave of subChaves) {
  if (new RegExp(`RequireSubmodule\\("${chave.replace(".", "\\.")}"\\)`).test(fontes)) continue;
  if (SO_NA_TELA[chave]) continue;
  falhas.push(
    `sub-módulo "${chave}" fecha a tela mas nenhum endpoint tem \`@RequireSubmodule\` — ` +
      "quem abrir o devtools continua usando",
  );
}

// 2. módulos
let guardados = 0;
for (const chave of modChaves) {
  if (new RegExp(`RequireModule\\("${chave}"\\)`).test(fontes)) { guardados++; continue; }
  if (COMPARTILHADOS[chave]) continue;
  falhas.push(
    `módulo "${chave}" está no menu (e o plano sabe desligar) mas nenhum controller tem ` +
      `\`@RequireModule("${chave}")\` — a promessa comercial fica sem porteiro no servidor. ` +
      "Guarde o controller, ou declare em COMPARTILHADOS quem mais usa aquela API.",
  );
}

// 2b. PARCIAIS tem que ter guarda de verdade (senão é COMPARTILHADO disfarçado)
for (const [k, motivo] of Object.entries(PARCIAIS)) {
  if (!modChaves.includes(k)) { falhas.push(`"${k}" está em PARCIAIS mas sumiu do menu`); continue; }
  if (!new RegExp(`RequireModule\\("${k}"\\)`).test(fontes)) {
    falhas.push(`"${k}" está em PARCIAIS mas não tem guarda nenhuma — é COMPARTILHADO, não parcial`);
  }
  // o prefixo que a linha diz estar aberto tem que estar aberto MESMO
  for (const pref of motivo.matchAll(/\/api\/([a-z-]+)/g)) {
    const ctrl = fontes.match(new RegExp(`@Controller\\("${pref[1]}[^"]*"\\)[\\s\\S]{0,120}`));
    if (ctrl && /RequireModule\(/.test(ctrl[0])) {
      falhas.push(`"${k}": a linha diz que /api/${pref[1]} fica aberto, mas ele já é guardado — atualize o motivo`);
    }
  }
}
if (Object.keys(PARCIAIS).some((k) => COMPARTILHADOS[k])) {
  falhas.push("um módulo está em PARCIAIS e em COMPARTILHADOS ao mesmo tempo");
}

// 3. a guarda existe, está registrada e deixa o master puro passar
const appModule = readFileSync(join(api, "src", "app.module.ts"), "utf8");
if (!/provide:\s*APP_GUARD,\s*useClass:\s*ModuloGuard/.test(appModule)) {
  falhas.push("app.module.ts não registra o ModuloGuard como APP_GUARD — os decoradores viram enfeite");
}
const gPath = join(api, "src", "common", "modulo.guard.ts");
if (!existsSync(gPath)) falhas.push("common/modulo.guard.ts sumiu");
else {
  const g = readFileSync(gPath, "utf8");
  if (!/ctx\.orgId/.test(g)) falhas.push("o guard não olha o contexto de empresa");
  if (!/enabledModules/.test(g)) falhas.push("o guard parou de cobrar o plano");
  if (!/nicheHiddenModules/.test(g)) falhas.push("o guard parou de cobrar o nicho");
  if (!/submoduleFeatures/.test(g)) falhas.push("o guard parou de cobrar os sub-módulos");
  // a conta tem que ser a mesma da tela, não uma cópia
  if (!/ShellLoader/.test(g)) falhas.push("o guard não usa o ShellLoader — virou uma segunda conta de módulos");
  if (!/getOrg/.test(g)) falhas.push("o guard não usa o cache por empresa: cobra uma ida ao banco por requisição");
}

// isenção que não vale mais é isenção esquecida
for (const k of Object.keys(COMPARTILHADOS)) {
  if (!modChaves.includes(k)) falhas.push(`"${k}" está em COMPARTILHADOS mas sumiu do menu — apague a linha`);
  else if (new RegExp(`RequireModule\\("${k}"\\)`).test(fontes)) {
    falhas.push(`"${k}" está em COMPARTILHADOS mas já é guardado — apague a linha`);
  }
}
for (const k of Object.keys(SO_NA_TELA)) {
  if (!subChaves.includes(k) || new RegExp(`RequireSubmodule\\("${k.replace(".", "\\.")}"\\)`).test(fontes)) {
    falhas.push(`"${k}" está em SO_NA_TELA mas já é guardado (ou sumiu do menu) — apague a linha`);
  }
}

console.log(`sub-módulos fechados dos dois lados: ${subChaves.length - Object.keys(SO_NA_TELA).length}/${subChaves.length}`);
const inteiros = guardados - Object.keys(PARCIAIS).filter((k) => new RegExp(`RequireModule\\("${k}"\\)`).test(fontes)).length;
console.log(`módulos fechados inteiros:           ${inteiros}`);
console.log(`módulos fechados em parte:           ${Object.keys(PARCIAIS).length} (o que fica aberto está escrito)`);
console.log(`módulos de API compartilhada:        ${Object.keys(COMPARTILHADOS).length} (idem)`);
console.log(`                                     ${inteiros + Object.keys(PARCIAIS).length + Object.keys(COMPARTILHADOS).length}/${modChaves.length} do menu`);
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nO QUE A EMPRESA NÃO CONTRATOU BATE NA PORTA DA API TAMBÉM");
