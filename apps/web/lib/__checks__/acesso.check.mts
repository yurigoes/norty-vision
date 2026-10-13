// ============================================================================
// Conferência do porteiro: esconder do menu tem que ser o MESMO que barrar.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/acesso.check.mts
//
// O menu escondia o que a empresa não contratou; a rota abria assim mesmo.
// Agora o `lib/acesso.ts` decide as duas coisas com a mesma tabela e os mesmos
// quatro filtros. Esta conferência garante que continuem sendo a mesma coisa:
//
//   1. toda tela do menu com `key`, `subMod` ou `perm` é barrável — se alguém
//      criar uma rota nova e esquecer de pendurar no `nav.ts`, ela passa livre
//      e o menu também não a mostra: o item vira invisível E aberto;
//   2. o casamento é por prefixo e pelo mais específico — a tela de detalhe
//      (`/app/crediario/<id>`) cai junto com o módulo, e as costureiras casam
//      com o item delas, não com `/app/producao`;
//   3. as telas de casca (painel, conta, suporte, a página que VENDE o módulo)
//      nunca podem ser barradas — senão o bloqueio vira armadilha sem saída;
//   4. o layout continua chamando o porteiro.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bloqueioDaRota, itemDaRota } from "../acesso.ts";
import { NAV_OPERACAO, NAV_ADMIN } from "../nav.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const falhas: string[] = [];

const todos = [...NAV_OPERACAO, ...NAV_ADMIN.flatMap((c) => c.items)];
const livre = {
  telas: todos,
  enabledModules: null,
  nicheHidden: [],
  submoduleFeatures: {},
  temPermissao: () => true,
  nichoPermite: () => true,
};

// 1. toda tela gateável do menu é encontrável pelo porteiro
let gateaveis = 0;
for (const it of todos) {
  if (!it.key && !it.subMod && !it.perm) continue;
  gateaveis++;
  const achado = itemDaRota(it.href, todos);
  if (!achado) { falhas.push(`${it.href} está no menu mas o porteiro não acha`); continue; }
  if (achado.href !== it.href) {
    falhas.push(`${it.href} casou com \`${achado.href}\` — o casamento tem que ser o mais específico`);
  }
}

// 2. telas de detalhe caem junto com o módulo
for (const [detalhe, esperado] of [
  ["/app/crediario/abc-123", "/app/crediario"],
  ["/app/producao/costureiras", "/app/producao/costureiras"],
  ["/app/producao/costureiras/xyz", "/app/producao/costureiras"],
  ["/app/producao/qualquer-coisa", "/app/producao"],
] as const) {
  const achado = itemDaRota(detalhe, todos);
  if (achado?.href !== esperado) {
    falhas.push(`${detalhe} devia cair em \`${esperado}\`, caiu em \`${achado?.href ?? "nada"}\``);
  }
}

// 3. a casca nunca é barrada — nem com TUDO desligado
const tudoFechado = {
  telas: todos,
  enabledModules: [] as string[],
  nicheHidden: todos.map((i) => i.key).filter(Boolean) as string[],
  submoduleFeatures: Object.fromEntries(todos.filter((i) => i.subMod).map((i) => [i.subMod!, false])),
  temPermissao: () => false,
  nichoPermite: () => false,
};
for (const rota of ["/app", "/app/conta", "/app/perfil/seguranca", "/app/suporte", "/app/modulos/crediario", "/app/billing"]) {
  const b = bloqueioDaRota(rota, tudoFechado);
  if (b) falhas.push(`${rota} é tela de casca e não pode ser barrada (motivo: ${b.motivo})`);
}

// 4. cada filtro barra de verdade, e só o seu caso
const casos: Array<[string, any, string | null]> = [
  ["/app/crediario", { ...livre, enabledModules: ["vendas"] }, "plano"],
  ["/app/crediario", { ...livre, enabledModules: ["crediario"] }, null],
  ["/app/producao/costureiras", { ...livre, submoduleFeatures: { "producao.costureiras": false } }, "submodulo"],
  ["/app/producao", { ...livre, submoduleFeatures: { "producao.costureiras": false } }, null],
  ["/app/crediario", { ...livre, nicheHidden: ["crediario"] }, "nicho"],
  ["/app/painel/otica", { ...livre, temPermissao: () => false }, "permissao"],
];
for (const [rota, ctx, esperado] of casos) {
  const b = bloqueioDaRota(rota, ctx);
  const motivo = b?.motivo ?? null;
  if (motivo !== esperado) {
    falhas.push(`${rota}: esperava ${esperado ?? "passar"}, veio ${motivo ?? "passou"}`);
  }
}

// 5. o layout continua usando o porteiro
const layout = readFileSync(join(web, "app", "app", "layout.tsx"), "utf8");
if (!/bloqueioDaRota\s*\(/.test(layout)) falhas.push("app/app/layout.tsx parou de chamar `bloqueioDaRota`");
// e tem que passar a MESMA lista do menu, não uma cópia
if (!/telas:\s*\[\.\.\.NAV_OPERACAO,\s*\.\.\.NAV_ADMIN/.test(layout)) {
  falhas.push("app/app/layout.tsx não passa a lista do menu (NAV_OPERACAO + NAV_ADMIN) pro porteiro");
}
if (!/x-nv-path/.test(layout)) falhas.push("app/app/layout.tsx não lê o caminho atual (`x-nv-path`)");
if (!/RotaBloqueada/.test(layout)) falhas.push("app/app/layout.tsx não mostra a tela de bloqueio");
const mw = readFileSync(join(web, "middleware.ts"), "utf8");
if (!/x-nv-path/.test(mw)) falhas.push("middleware.ts parou de publicar `x-nv-path` — o porteiro fica cego");

// ============================================================================
// 6. UM PORTEIRO SÓ POR TELA.
//
// O porteiro do `nav.ts` roda no LAYOUT. Uma página que, além dele, barra à mão
// por `isOrgAdmin` vence — ela roda depois. Quando a tela TEM `perm`, as duas
// travas se contradizem, e o resultado medido em produção foi: conceder a
// permissão fazia o item APARECER no menu e a tela responder "Apenas
// administradores". Permissão concedida que não abre nada — e nenhuma das duas
// travas parecia errada isolada.
//
// Tela sem `perm` e barrando por isOrgAdmin é coerente (é admin-only de fato),
// mas tem que ser DECLARADA aqui: senão "só admin" vira o padrão silencioso e
// o catálogo de 77 permissões deixa de poder abrir o que quer que seja.
// ============================================================================
const SO_ADMIN = new Set([
  // Configuração e dinheiro da própria empresa — permissão não deve abrir.
  "billing", "empresa-contrato", "pagamentos", "suporte-sistema",

  // Importação de vendas antigas: não há chave no catálogo que caiba
  // (`products.import` é de produto). Fica admin-only até existir uma.
  "vendas-historico",

  // Comissões: o catálogo só tem `reports.commission`, que é RELATÓRIO. A ação
  // principal da tela é PAGAR comissão — dinheiro saindo. Abrir a tela com uma
  // chave de leitura deixaria os botões de pagar dando 403, que é o defeito que
  // acabamos de consertar em outro lugar. Precisa de uma chave própria
  // (`commissions.pay`) antes de sair daqui.
  "comissoes",

  // RH e ponto: o catálogo não tem NENHUMA chave para esta área — foram 111
  // rotas de ponto portadas e nenhuma pode ser concedida a ninguém. Precisa de
  // chaves novas (ponto.view, ponto.adjust, ponto.close, rh.manage…) antes de
  // deixar de ser admin-only.
  "rh", "alocacoes", "assiduidade",
]);

// a tabela do menu já está importada aqui como `todos` — usar ela, e não um
// regex sobre o arquivo, é o que garante que esta regra olhe a MESMA lista que
// o porteiro recebe.
const telasComPerm = new Map<string, string>();
for (const it of todos) {
  const seg = it.href.startsWith("/app/") ? it.href.slice(5).split("/")[0] : null;
  if (seg && it.perm) telasComPerm.set(seg, it.perm);
}
const appDir = join(web, "app", "app");
for (const nome of readdirSync(appDir)) {
  const pagina = join(appDir, nome, "page.tsx");
  let src: string;
  try { src = readFileSync(pagina, "utf8"); } catch { continue; }
  // O GATE à mão, não qualquer menção a isOrgAdmin. A diferença importa:
  // `const isAdmin = !!session.master || !!session.user?.isOrgAdmin` é uma
  // CAPACIDADE passada pro cliente (a agenda usa pra decidir o que o botão faz),
  // e não barra nada. O que barra é a condição que impede a renderização —
  // `if (!session.user?.isOrgAdmin && !session.master)`. Procurar a menção em
  // vez da forma acusava a agenda sem motivo, e conferência que grita errado
  // ensina a ignorar conferência.
  const barraAMao = /if \(\s*!session\.user\?\.isOrgAdmin\s*&&\s*!session\.master\s*\)/.test(src);
  if (!barraAMao) continue;
  const perm = telasComPerm.get(nome);
  if (perm) {
    falhas.push(
      `/app/${nome} declara \`perm: "${perm}"\` no nav.ts E barra à mão por isOrgAdmin — ` +
        "a trava da página vence, então conceder a permissão mostra o item no menu e a tela recusa",
    );
  } else if (!SO_ADMIN.has(nome)) {
    falhas.push(
      `/app/${nome} barra à mão por isOrgAdmin e não tem \`perm\` no nav.ts — ` +
        "nenhuma permissão do catálogo abre essa tela. Dê um `perm` a ela, ou declare em SO_ADMIN com o motivo",
    );
  }
}

console.log(`telas do menu que o porteiro cobre: ${gateaveis} · admin-only declaradas: ${SO_ADMIN.size}`);
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nESCONDER DO MENU E BARRAR A ROTA SÃO A MESMA CONTA");
