// ============================================================================
// Conferência do TERMINAL DE PONTO: a batida não pode depender da foto.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/ponto-terminal.check.mts
//
// O QUE ACONTECEU
//
// As duas rotas de batida do terminal (`ponto-pwa/punch` e
// `ponto-pwa/face-punch`) subiam a selfie pro bucket privado com um
// `await this.storage.putPrivate(...)` SEM PROTEÇÃO. Com o storage
// inalcançável, isso estoura e leva a batida inteira:
//
//     Error: getaddrinfo ENOTFOUND minio
//     POST /api/ponto-pwa/punch -> 500
//
// Medido contra API de pé, com o MinIO fora do ar. Consequência real: um
// soluço de rede no bucket, disco cheio ou restart do MinIO, e TODO terminal
// da empresa para de bater ponto — com o funcionário na frente da máquina e
// sem o registro que a Portaria 671 exige. Perder a marcação é muito pior que
// perder a foto: a foto é PROVA, a marcação é o REGISTRO.
//
// A REGRA, agora escrita
//
//   1. o upload da selfie fica dentro de try/catch nas DUAS rotas de batida;
//   2. a falha é registrada na marcação (`selfie_nao_armazenada`) — foto que
//      não sobe não pode sumir calada, senão "a foto não existe" vira
//      alegação sem rastro;
//   3. o `punchCore` (que grava NSR + hash) roda DEPOIS, sempre.
//
// Fora daqui, de propósito: certificado A1, espelho assinado, recibo de
// assiduidade e troca de turno. Esses são atos administrativos — se o arquivo
// não guardou, falhar alto é o certo. Ninguém está esperando na frente de uma
// máquina.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const falhas: string[] = [];
const exige = (ok: boolean, msg: string) => { if (!ok) falhas.push(msg); };

const bruto = readFileSync(join(src, "ponto", "ponto-pwa.service.ts"), "utf8");
// comentário fora: este arquivo DESCREVE o defeito em prosa, e procurar o
// texto no comentário passaria verde com o código revertido. Já aconteceu
// três vezes nesta base.
const t = bruto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");

/** corpo de um método, do `async nome(` até o próximo método no mesmo nível */
function corpo(nome: string): string | null {
  const i = t.indexOf(`async ${nome}(`);
  if (i < 0) return null;
  const resto = t.slice(i + 1);
  const j = resto.search(/\n  (?:async |private |public )/);
  return j < 0 ? resto : resto.slice(0, j);
}

for (const metodo of ["punch", "facePunch"] as const) {
  const c = corpo(metodo);
  if (!c) { falhas.push(`método \`${metodo}\` desapareceu do ponto-pwa.service.ts`); continue; }

  const up = c.indexOf("putPrivate");
  if (up < 0) { falhas.push(`\`${metodo}\` não sobe mais a selfie — a prova da batida sumiu`); continue; }

  // 1. o upload está DENTRO de um try que abre antes dele e fecha depois
  const antes = c.slice(0, up);
  const tryAberto = antes.lastIndexOf("try {");
  const catchAntes = antes.lastIndexOf("catch");
  exige(
    tryAberto >= 0 && tryAberto > catchAntes,
    `\`${metodo}\`: o \`putPrivate\` da selfie NÃO está dentro de try/catch. ` +
      "Storage fora do ar = 500 na batida, e o terminal para de bater ponto",
  );

  // 2. o catch marca a marcação
  const depois = c.slice(up);
  const cat = depois.indexOf("catch");
  exige(
    cat >= 0 && /selfie_nao_armazenada/.test(depois.slice(cat, cat + 400)),
    `\`${metodo}\`: a falha da selfie não grava \`selfie_nao_armazenada\` na marcação — ` +
      "foto que não sobe some calada, e depois não há como provar que ela não existiu",
  );

  // 3. e a batida acontece DEPOIS do upload, não antes nem no lugar dele
  const core = c.indexOf("punchCore");
  exige(
    core > up,
    `\`${metodo}\`: o \`punchCore\` (NSR + hash) não vem depois do upload. ` +
      "A ordem importa: a marcação é o registro, e tem que ser gravada de qualquer forma",
  );
}

// ============================================================================
// 3b. "NÃO ENCONTREI" E "ESTÁ INATIVO" SÃO PROBLEMAS OPOSTOS.
//
// O `identify` devolvia a MESMA frase — "Não encontrei esse funcionário.
// Confira o código, CPF ou matrícula." — pra quem não existe E pra quem existe
// mas está com o cadastro desligado. Um é erro de digitação; o outro é decisão
// do RH. A frase mandava procurar o defeito no lugar errado.
//
// Custou dias: uma funcionária cadastrada e ativada continuava levando "não
// encontrei", e a investigação passou por rede, GRANT do Postgres e RLS por
// empresa antes de alguém suspeitar do `active`. A busca estava certa desde o
// começo — a MENSAGEM é que mentia.
//
// Medido depois do conserto: ativo → 200; inativo (por CPF e por código de
// barras) → 403 nomeando a pessoa e mandando pro RH; inexistente → 404.
// ============================================================================
const svc = readFileSync(join(src, "ponto", "ponto.service.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");

exige(
  /async resolveInactiveIdentifier\(/.test(svc) && /where:\s*\{\s*active:\s*false/.test(svc),
  "`resolveInactiveIdentifier` sumiu do ponto.service: o terminal volta a dizer " +
    "'não encontrei' pra quem só está com o cadastro inativo",
);
exige(
  /private identifierWhere\(/.test(svc),
  "a lista do que o terminal aceita (código/CPF/matrícula) voltou a ser duplicada — " +
    "em duas cópias ela diverge, e o sintoma é 'o leitor acha e o teclado não'",
);
{
  const i = t.indexOf("resolveInactiveIdentifier");
  const j = t.indexOf('"Não encontrei esse funcionário');
  exige(
    i >= 0 && j >= 0 && i < j,
    "`identify` não consulta mais os inativos ANTES de responder 'não encontrei' — " +
      "as duas situações voltaram a ter a mesma mensagem",
  );
  exige(
    /INATIVO/.test(t) && /Procure o RH/.test(t),
    "a mensagem do cadastro inativo não aponta mais pro RH",
  );
}

// 4. e as 4 rotas do terminal seguem sendo as únicas públicas do controller
const ctrl = readFileSync(join(src, "ponto", "ponto-pwa.controller.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
const publicas = (ctrl.match(/@Public\(\)/g) ?? []).length;
exige(publicas === 4, `o controller do terminal tem ${publicas} rotas @Public(), eram 4 (bootstrap, identify, punch, face-punch)`);

console.log(`terminal: 2 rotas de batida conferidas · ${publicas} rotas públicas`);
if (falhas.length) {
  console.error(`\n✖ terminal de ponto: a batida voltou a depender da foto\n`);
  for (const f of falhas) console.error(`  • ${f}`);
  console.error("");
  process.exit(1);
}
console.log("✔ terminal: storage fora do ar não impede a batida — a foto falta, o registro não");
