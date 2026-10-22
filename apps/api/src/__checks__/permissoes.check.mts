// ============================================================================
// Conferência das PERMISSÕES: a personalização por usuário tem que valer.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/permissoes.check.mts
//
// O QUE ACONTECIA — dois defeitos, e o segundo era pior
//
// (A) REVOGAR NUNCA FUNCIONOU. `sanitizePermissions` guardava só `v === true`.
//     O `false` que a tela manda ao DESMARCAR uma caixa era descartado, o
//     override ficava sem a chave, e `mergePermissions({...papel, ...usuario})`
//     deixava o `true` do papel ganhar. A tela dizia "Permissões personalizadas
//     salvas" e o acesso continuava idêntico. Conceder funcionava; revogar, que
//     é o que se quer de uma personalização, não.
//
// (B) PERSONALIZAR UMA PERMISSÃO CONGELAVA AS OUTRAS. A tela mandava o mapa
//     inteiro (papel + exceções), então todo `true` do papel virava exceção
//     própria do usuário. Depois disso, mudar o PAPEL não mexia mais nele
//     nessas chaves. Ninguém percebia, porque o efeito aparece semanas depois,
//     quando se edita o papel e um usuário não acompanha.
//
// A REGRA, agora escrita em um lugar só:
//
//     chave ausente do override  → herda o papel
//     true                       → concede, mesmo que o papel não dê
//     false                      → NEGA, mesmo que o papel dê
//
// ----------------------------------------------------------------------------
// Leitura por TEXTO, sem banco e sem Nest de pé — roda no `npm run check`.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(api, "src");
const web = join(api, "..", "web");

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules") arquivos(p, achados); }
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) achados.push(p);
  }
  return achados;
}

const users = readFileSync(join(src, "users", "users.service.ts"), "utf8");
const guard = readFileSync(join(src, "auth", "auth.guard.ts"), "utf8");
const tela = readFileSync(join(web, "app", "app", "usuarios", "UsersClient.tsx"), "utf8");
/**
 * Comentário fora ANTES de procurar decorator. É a terceira conferência desta
 * base a tropeçar nisso: `users.service.ts` tem, num JSDoc, o texto
 * `@RequirePermission("chave")` explicando como se usa o decorator — e o grep
 * cru acusava uma permissão chamada "chave" que não existe.
 *
 * Conferência que grita no lugar errado ensina a ignorar conferência, então
 * isto aqui não é zelo: é o que mantém as outras seis asserções confiáveis.
 */
const semComentario = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
const todoApi = arquivos(src).map((f) => semComentario(readFileSync(f, "utf8"))).join("\n");

const falhas: string[] = [];
const exige = (ok: boolean, msg: string) => { if (!ok) falhas.push(msg); };

// --- 1. o catálogo ----------------------------------------------------------
const bloco = users.slice(users.indexOf("export const PERMISSION_CATALOG"));
const catalogo = [...new Set([...bloco.slice(0, bloco.indexOf("\n];")).matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]!))];
exige(catalogo.length >= 80, `só ${catalogo.length} chaves lidas do PERMISSION_CATALOG — eram 82. A leitura cegou.`);

// --- 2. o `false` do override tem que ser GUARDADO --------------------------
exige(
  /sanitizeMembershipOverrides/.test(users) && /typeof v === "boolean"/.test(users),
  "o sanitizador do override do usuário voltou a filtrar por `v === true`: desmarcar " +
    "uma permissão que o papel concede para de ter efeito (defeito A)",
);
exige(
  /sanitizeRolePermissions/.test(users),
  "papel e override voltaram a usar o MESMO sanitizador — eles têm semânticas " +
    "diferentes (no papel, ausência é negação; no override, ausência é herança)",
);

// --- 3. o merge tem que deixar o override vencer ----------------------------
exige(
  /\{ \.\.\.norm\(rolePerms\), \.\.\.norm\(userPerms\) \}/.test(guard),
  "`mergePermissions` não dá mais a última palavra ao override do usuário",
);
exige(
  /permissions\[requirePermission\] !== true/.test(guard),
  "o guard não nega mais por `!== true` — com `=== false` ou truthy, chave ausente " +
    "ou valor estranho passaria a liberar",
);

// --- 4. a tela manda SÓ a diferença em relação ao papel ---------------------
exige(
  /excecoesParaSalvar/.test(tela) && /efetivo !== noPapel/.test(tela),
  "a tela de usuários voltou a mandar o mapa inteiro de permissões: personalizar " +
    "uma chave congela todas as outras no usuário e o papel perde efeito (defeito B)",
);
exige(
  !/body: JSON\.stringify\(\{ permissions: perms \}\)/.test(tela),
  "a tela manda `perms` cru (o mapa efetivo) em vez da diferença — é exatamente o defeito B",
);

// --- 5. toda chave exigida por rota tem que existir no catálogo -------------
// Senão não há caixa pra marcar: a permissão existe no código e é inalcançável.
const exigidas = [...new Set([
  ...[...todoApi.matchAll(/@RequirePermission\("([^"]+)"\)/g)].map((m) => m[1]!),
  ...[...todoApi.matchAll(/ctxCan\(ctx,\s*"([^"]+)"\)/g)].map((m) => m[1]!),
])];
const semCaixa = exigidas.filter((k) => !catalogo.includes(k));
exige(semCaixa.length === 0,
  `rota exige permissão que não está no catálogo (não há como conceder na tela): ${semCaixa.join(", ")}`);

/**
 * CHAVES DO CATÁLOGO QUE NENHUMA ROTA EXIGE — dívida conhecida, declarada aqui
 * pra não crescer calada. Cada uma é uma caixa que o admin marca e que o
 * servidor ignora: a tela promete um controle que não existe.
 *
 * Três delas (`roles.manage`, `users.manage`, `voip.admin`) escondem item do
 * menu via `nav.ts`, então fazem metade do trabalho — esconder sem barrar a
 * rota é conveniência, não controle de acesso.
 *
 * Tirar uma daqui = ou a rota passou a exigir a permissão, ou a chave saiu do
 * catálogo. Acrescentar uma = alguém criou uma caixa que não faz nada.
 */
const SEM_ROTA = new Set([
  "agenda.view_others", "chat.respond", "chat.view_all",
  "credit.write_off", "crm.pipeline_manage", "customers.export", "fiscal.nfe.cancel",
  "production.cancel", "production.update_status", "reports.production",
  "settings.org",
  "tickets.create", "tickets.view",
  "voip.call_external", "voip.call_internal",

  // --- as duas abaixo não são guarda faltando: é OPERAÇÃO que não existe ---
  //
  // "cashbox.adjust" ("Sangria/suprimento"): o módulo de caixa tem abrir e
  // fechar, e nada entre os dois. Não há retirada nem suprimento pra barrar.
  // Pendurar a chave no fechamento seria mentira diferente: desmarcar
  // "Sangria" passaria a bloquear "Fechar caixa", que tem caixa própria.
  //
  // "sales.refund" ("Estornar venda"): a única reversão de venda é
  // `PATCH /sales/:id/cancel`, que devolve o estoque e já é barrada por
  // `sales.cancel`. Devolução de dinheiro de venda não existe como operação —
  // o `POST /production/:id/estorno` é de pedido de produção, não de venda.
  //
  // Enquanto as operações não existirem, as duas caixas prometem um controle
  // sem objeto. O conserto é construir a operação, não ligar a permissão.
  "cashbox.adjust", "sales.refund",
]);
const orfas = catalogo.filter((k) => !exigidas.includes(k) && !SEM_ROTA.has(k));
exige(orfas.length === 0,
  `permissão nova no catálogo que NENHUMA rota exige — a caixa não faz nada: ${orfas.join(", ")}`);
const quitadas = [...SEM_ROTA].filter((k) => exigidas.includes(k));
if (quitadas.length) {
  console.log(`  (${quitadas.length} saíram da dívida — tire de SEM_ROTA: ${quitadas.join(", ")})`);
}

// --- 7. tela aberta por permissão tem que LER os dados -------------------
// O defeito: o porteiro do nav.ts abriu /app/usuarios pra quem tem
// `users.manage`, e `users.service.list()` continuou exigindo `isOrgAdmin`. A
// tela abria e o endpoint respondia 403 — lista vazia, sem explicação. Pior que
// a mensagem "Apenas administradores" que havia antes.
//
// A regra conta CHAMADAS do porteiro, não a presença do texto da chave. A
// primeira versão conferia `t.includes('"credit.approve"')` e passava verde com
// as 7 chamadas revertidas pra `requireAdmin` — porque a chave continuava no
// arquivo, na assinatura do helper. Conferência que não pega o defeito é pior
// que conferência nenhuma: ocupa o lugar de uma que pegaria.
//
// Os mínimos são o que existe hoje. Caírem = guarda virou admin-only de novo.
for (const [arq, padrao, minimo] of [
  ["users/users.service.ts", 'ctxCan(ctx, "users.manage")', 12],
  ["users/users.service.ts", 'ctxCan(ctx, "roles.manage")', 3],
  ["stores/stores.service.ts", 'ctxCan(ctx, "stores.manage")', 3],
  ["voip/voip-admin.service.ts", 'ctxCan(ctx, "voip.admin")', 1],
  ["optical/optical.service.ts", 'ctxCan(ctx, "lens.', 9],
  ["credit/credit.service.ts", "this.requireCredito(ctx", 7],

  // Ponto e RH: aqui o porteiro é `requireAdmin(ctx, chave)` — o MESMO nome de
  // antes, mas por dentro é `ctxCan` com a chave do catálogo, e o piso de cada
  // service vem no valor padrão do argumento. Contar as chamadas pega a
  // reversão: se alguém trocar o corpo do helper de volta pra `isOrgAdmin`, a
  // asserção do piso (abaixo) cai; se apagar as chamadas, estas caem.
  ["ponto/ponto.service.ts", "this.requireAdmin(ctx", 18],
  ["ponto/folha.service.ts", "this.requireAdmin(ctx", 18],
  ["ponto/jornada.service.ts", "this.requireAdmin(ctx", 9],
  ["ponto/allocation.service.ts", "this.requireAdmin(ctx", 9],
  ["ponto/ponto-pwa.service.ts", "this.requireAdmin(ctx", 7],
  ["ponto/escala-planilha.service.ts", "this.requireAdmin(ctx", 8],
  ["hr/hr.service.ts", "this.requireAdmin(ctx", 14],
  ["hr/hr.service.ts", 'ctxCan(ctx, "rh.manage")', 1],

  // 23 LEITURAS de RH não tinham porteiro NENHUM: um usuário de recepção, com
  // zero permissões, lia nome, CPF, holerite e empréstimo pela URL — medido
  // contra API de pé, 13 de 14 rotas de leitura respondendo 200. Passaram a
  // exigir `requireHrManager` (a mesma barra das AÇÕES de RH, que já admitia
  // gerente e supervisor). Se este número cair, a lista voltou a vazar.
  ["hr/hr.service.ts", "this.requireHrManager(ctx", 44],
] as const) {
  const t = semComentario(readFileSync(join(src, arq), "utf8"));
  const n = t.split(padrao).length - 1;
  exige(
    n >= minimo,
    `${arq}: só ${n} guarda(s) \`${padrao}\`, eram ${minimo}. Alguma voltou a exigir ` +
      "`isOrgAdmin`, e a tela que a permissão abre responde 403 — vazia e sem explicação",
  );
}

// ============================================================================
// 8. O RELÓGIO DE PAREDE NÃO TEM SESSÃO — e por isso não pode exigir permissão.
//
// Os terminais de ponto (Windows/Android) falam por QUATRO rotas, autenticadas
// pelo TOKEN DO DISPOSITIVO: não há cookie, não há membership, não há papel.
// Pendurar `@RequirePermission` numa delas — ou tirar o `@Public()` — não
// "protege": recusa TODA batida de TODO terminal da empresa, no instante do
// deploy, com o funcionário parado na frente da máquina. E o `tsc` passa, e o
// `nest build` passa, porque é decisão de runtime.
//
// Foi o pedido explícito de quem opera: "com cuidado para não perder as
// conexões dos terminais de ponto". Isto é esse cuidado, escrito.
// ============================================================================
const pwaBruto = readFileSync(join(src, "ponto", "ponto-pwa.controller.ts"), "utf8");
const pwa = semComentario(pwaBruto);
const TERMINAL = ["ponto-pwa/bootstrap", "ponto-pwa/identify", "ponto-pwa/punch", "ponto-pwa/face-punch"] as const;

for (const rota of TERMINAL) {
  // o decorator da rota e o que vem ANTES dele, até o decorator anterior
  const i = pwa.indexOf(`("${rota}")`);
  if (i < 0) { falhas.push(`a rota do terminal \`${rota}\` desapareceu do ponto-pwa.controller.ts`); continue; }
  const antes = pwa.slice(0, i);
  const cabeca = antes.slice(antes.lastIndexOf("\n\n"));
  if (!/@Public\(\)/.test(cabeca)) {
    falhas.push(
      `\`${rota}\` perdeu o @Public(): o terminal não tem sessão pra autenticar — ` +
        "toda batida da empresa passa a responder 401",
    );
  }
  if (/@RequirePermission/.test(cabeca)) {
    falhas.push(
      `\`${rota}\` ganhou @RequirePermission: o terminal não tem usuário nem papel, ` +
        "então a chave não pode ser concedida a ninguém — nenhum terminal bate ponto",
    );
  }
}
// e nenhum piso de CLASSE no controller do terminal
const cabecaClasse = pwa.slice(0, pwa.indexOf("export class PontoPwaController"));
exige(
  !/@RequirePermission/.test(cabecaClasse),
  "PontoPwaController ganhou @RequirePermission de CLASSE. O @Public() das 4 rotas do " +
    "terminal responde antes e as salva HOJE — mas é uma guarda a um descuido de distância " +
    "das batidas. A gestão dos terminais é decorada rota por rota, de propósito",
);

// --- 9. o piso de classe do ponto continua de pé -----------------------------
// 94 rotas: o `@RequirePermission` da classe é o que faz a rota NOVA nascer
// fechada. Sem ele, quem esquecer o decorator publica rota de ponto aberta a
// qualquer usuário logado da empresa.
const pontoCtrl = semComentario(readFileSync(join(src, "ponto", "ponto.controller.ts"), "utf8"));
exige(
  /@RequirePermission\("ponto\.view"\)\s*\nexport class PontoController/.test(pontoCtrl),
  "PontoController perdeu o @RequirePermission(\"ponto.view\") de classe — rota de ponto " +
    "sem decorator volta a abrir pra qualquer usuário logado",
);
const rotasPonto = (pontoCtrl.match(/@(?:Get|Post|Patch|Put|Delete)\(/g) ?? []).length;
exige(rotasPonto >= 90, `só ${rotasPonto} rotas lidas do ponto.controller.ts — eram 94. A leitura cegou.`);

// --- 10. o `wipe` das marcações NÃO pode virar permissão ---------------------
// `POST ponto/punches/wipe` apaga as marcações da empresa — o ponto FISCAL,
// irreversível. Nenhuma caixa do catálogo deve poder marcar isso.
const pontoSvc = semComentario(readFileSync(join(src, "ponto", "ponto.service.ts"), "utf8"));
exige(
  /async resetMarcacoes\([^)]*\)\s*\{\s*this\.requireAdminEstrito\(ctx\);/.test(pontoSvc),
  "`resetMarcacoes` (apaga as marcações da empresa) não exige mais `requireAdminEstrito` — " +
    "uma chave do catálogo passou a poder zerar o ponto fiscal",
);
exige(
  /private requireAdminEstrito\(ctx: RequestContext\) \{\s*\n[^\n]*\n\s*if \(!ctx\.isOrgAdmin && !ctx\.isPlatformAdmin\)/.test(pontoSvc),
  "`requireAdminEstrito` deixou de conferir `isOrgAdmin` — virou porteiro de mentira",
);

// ============================================================================
// 11. O CORPO do porteiro, não o nome dele.
//
// Os 11 services de ponto/RH mantiveram o nome `requireAdmin` — contar
// chamadas (regra 7) não pega quem reverte só o CORPO pra `isOrgAdmin`. E é
// esse o defeito que dá tela aberta respondendo 403: a mesma coisa que já
// aconteceu em `credit.service` e custou um deploy.
//
// Aqui confere a FORMA: piso declarado no argumento padrão + decisão por
// `ctxCan(ctx, chave)`. O piso de cada um é o que está escrito abaixo, e
// mudá-lo é mudança de política — tem que passar por aqui.
// ============================================================================
const PISOS = [
  ["ponto/aej.service.ts", "ponto.close"],
  ["ponto/allocation.service.ts", "rh.manage"],
  ["ponto/assiduidade.service.ts", "rh.manage"],
  ["ponto/employer.service.ts", "ponto.close"],
  ["ponto/folha.service.ts", "ponto.close"],
  ["ponto/jornada.service.ts", "ponto.adjust"],
  ["ponto/ponto-pwa.service.ts", "ponto.devices"],
  ["ponto/ponto.service.ts", "ponto.adjust"],
  ["ponto/escala-planilha.service.ts", "ponto.adjust"],
  ["ponto/reports.service.ts", "ponto.view"],
  ["ponto/sign.service.ts", "ponto.close"],
  ["hr/hr.service.ts", "rh.manage"],
] as const;
for (const [arq, piso] of PISOS) {
  const t2 = semComentario(readFileSync(join(src, arq), "utf8"));
  const m = t2.match(/private requireAdmin\(ctx: RequestContext,\s*chave: string = "([^"]+)"\)\s*\{([\s\S]*?)\n  \}/);
  if (!m) {
    falhas.push(
      `${arq}: \`requireAdmin\` não tem mais a forma \`(ctx, chave = "<piso>")\` — ou voltou a ` +
        "ser admin-only, ou perdeu o piso declarado, e a tela que a permissão abre responde 403",
    );
    continue;
  }
  if (m[1] !== piso) {
    falhas.push(`${arq}: o piso virou \`${m[1]}\`, estava \`${piso}\` — mudança de política sem passar por aqui`);
  }
  if (!/ctxCan\(ctx,\s*chave\)/.test(m[2]!)) {
    falhas.push(
      `${arq}: o corpo de \`requireAdmin\` não decide mais por \`ctxCan(ctx, chave)\` — ` +
        "o nome ficou, o porteiro voltou a ser `isOrgAdmin`",
    );
  }
}

console.log(`catálogo: ${catalogo.length} chaves · exigidas por rota: ${exigidas.length} · dívida declarada: ${SEM_ROTA.size}`);
console.log(`ponto: ${rotasPonto} rotas sob piso de classe · ${TERMINAL.length} rotas de terminal públicas e sem chave`);

if (falhas.length) {
  console.error(`\n✖ permissões: a personalização por usuário não vale\n`);
  for (const f of falhas) console.error(`  • ${f}`);
  console.error("");
  process.exit(1);
}
console.log("✔ permissões: negar, conceder e herdar do papel — os três estados valem");
