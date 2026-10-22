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

// ============================================================================
// 3c. PDF DE EMPRESA NÃO LEVA A MARCA DO PRODUTO.
//
// `dayPresencePdf` veio do Norty RH, onde o rodapé estampava "norty RH" com o
// logo buscado em `rh.norty.com.br`. Aqui cada empresa é a própria marca — é o
// que `loadBrand(ctx)` faz — e o resto desta base é explícito sobre isso:
// "NUNCA mistura branding da plataforma numa página que pertence a uma
// empresa". Um copiar-e-colar entregaria PDFs da ótica assinados "norty RH".
//
// Medido: PDF gerado contra API de pé, texto extraído com `pdftotext` —
// 0 ocorrências de "norty", nome da empresa 2x (cabeçalho e rodapé).
// ============================================================================
{
  const j = readFileSync(join(src, "ponto", "jornada.service.ts"), "utf8");
  const semCom = j.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const i = semCom.indexOf("async dayPresencePdf");
  if (i < 0) {
    falhas.push("`dayPresencePdf` desapareceu do jornada.service — o PDF de presença do dia era do RH e foi portado");
  } else {
    const corpo = semCom.slice(i, i + 14000);
    if (/norty/i.test(corpo)) {
      falhas.push(
        "o PDF de presença do dia voltou a carregar a marca do PRODUTO (\"norty\"). " +
          "Documento de empresa leva a marca DA EMPRESA — use `loadBrand(ctx)`",
      );
    }
    if (!/loadBrand\(ctx\)/.test(corpo)) {
      falhas.push("`dayPresencePdf` não usa mais `loadBrand(ctx)` — perdeu a marca da empresa");
    }
    if (!/requireAdmin\(ctx, "ponto\.view"\)/.test(corpo)) {
      falhas.push("`dayPresencePdf` não exige mais `ponto.view` — relatório com o nome de todo mundo ficou aberto");
    }
  }
}

// ============================================================================
// 3d. EXTRA NÃO ENTRA NO PONTO OFICIAL — e a consulta dele não pode barrar batida.
//
// Diarista/hora extra avulsa tem tabela PRÓPRIA (`ponto_extra_punch`), e a
// separação é física de propósito: extra em `ponto_punch` entraria no AFD e no
// eSocial como jornada da escala oficial, o que é errado perante a Portaria 671.
// Um filtro numa tabela compartilhada alguém esquece; uma tabela separada, não.
//
// E a consulta tem que ser À PROVA DE FALHA. O `findTodayShift` roda em TODA
// batida do terminal: se ele estourar (tabela ausente numa réplica, erro de
// conexão), o relógio de parede da empresa para. Por isso ele tem
// `.catch(() => null)` por dentro — erro vira "não tem extra" e a batida segue
// o caminho normal.
//
// Medido contra API de pé:
//   sem extra escalado  -> ponto_punch 15->16 · ponto_extra_punch 0->0 · nsr numérico
//   com extra escalado  -> ponto_punch 15->15 · ponto_extra_punch 0->1 · nsr "EXTRA"
// ============================================================================
{
  const ex = readFileSync(join(src, "ponto", "extras.service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const i = ex.indexOf("async findTodayShift");
  if (i < 0) {
    falhas.push("`findTodayShift` sumiu do extras.service — o terminal não sabe mais quem está escalado como extra");
  } else if (!/\.catch\(\(\)\s*=>\s*null\)/.test(ex.slice(i, i + 700))) {
    falhas.push(
      "`findTodayShift` perdeu o `.catch(() => null)`. Ele roda em TODA batida: " +
        "um erro ali (tabela ausente, conexão) para o ponto da empresa inteira",
    );
  }
  // a batida do extra NÃO pode ir pra tabela oficial
  if (/pontoPunch\.create|punchCore/.test(ex)) {
    falhas.push(
      "`extras.service` passou a escrever em `ponto_punch`/`punchCore` — extra entraria no " +
        "AFD/eSocial como jornada oficial. A tabela separada é a garantia, não um detalhe",
    );
  }
  if (!/pontoExtraPunch\.create/.test(ex)) {
    falhas.push("`extras.service` não grava mais em `ponto_extra_punch` — a batida do extra se perde");
  }
  // O desvio vem ANTES do `punchCore`, nas DUAS rotas de batida.
  //
  // A primeira versão desta regra comparava `indexOf` no ARQUIVO inteiro — e
  // acusou falsamente, porque o `punchCore` do `facePunch` aparece antes do
  // `findTodayShift` do `punch`. Posição no arquivo não é ordem de execução.
  // Consertando isso apareceu o defeito DE VERDADE: o port tinha ligado o
  // desvio só no `punch`, e quem batesse por reconhecimento facial caía no
  // ponto oficial mesmo escalado como extra.
  for (const metodo of ["punch", "facePunch"] as const) {
    const c = corpo(metodo);
    if (!c) continue; // a ausência do método já é acusada acima
    const iExtra = c.indexOf("findTodayShift");
    const iCore = c.indexOf("punchCore");
    if (iExtra < 0) {
      falhas.push(`\`${metodo}\`: não consulta o extra — quem está escalado como extra cai no ponto OFICIAL e entra no AFD`);
    } else if (iCore >= 0 && iExtra > iCore) {
      falhas.push(`\`${metodo}\`: o desvio do extra ficou DEPOIS do \`punchCore\` — a batida já entrou no ponto oficial`);
    }
  }
}

// ============================================================================
// 3e. TRANSFERIDO BATE NA LOJA DESTINO — e a consulta não pode barrar batida.
//
// Enquanto a transferência vale, o terminal da loja de origem recusa com o nome
// da loja destino e a data. Igual ao extra, a consulta roda em TODA batida:
// `.catch(() => null)` é o que impede que um erro ali pare o relógio de parede.
//
// Medido: sem transferência -> ponto_punch 16->17 · com transferência ativa ->
// 403 "Você está transferido para a loja Filial Centro até 26/10/2026. Bata o
// ponto lá." e ponto_punch 17->17 · cancelada -> 17->18.
// ============================================================================
{
  const i = t.indexOf("private async activeStoreTransfer");
  if (i < 0) {
    falhas.push("`activeStoreTransfer` sumiu — transferido volta a bater na loja errada");
  } else if (!/\.catch\(\(\)\s*=>\s*null\)/.test(t.slice(i, i + 700))) {
    falhas.push(
      "`activeStoreTransfer` perdeu o `.catch(() => null)`. Roda em TODA batida: " +
        "erro ali (tabela ausente, conexão) para o ponto da empresa inteira",
    );
  }
  for (const metodo of ["punch", "facePunch"] as const) {
    const c = corpo(metodo);
    if (!c) continue;
    const iT = c.indexOf("activeStoreTransfer");
    const iCore = c.indexOf("punchCore");
    if (iT < 0) {
      falhas.push(`\`${metodo}\`: não confere transferência de loja — quem está transferido bate na loja errada e a batida fica no lugar errado`);
    } else if (iCore >= 0 && iT > iCore) {
      falhas.push(`\`${metodo}\`: a conferência da transferência ficou DEPOIS do \`punchCore\` — a batida já foi gravada`);
    }
  }
  // a mensagem tem que DIZER onde bater: "não autorizado" manda a pessoa
  // procurar o RH pra descobrir algo que o sistema já sabe.
  if (!/transferido para a loja \$\{nome\}/.test(t)) {
    falhas.push("a recusa da transferência não nomeia mais a loja destino — a pessoa não sabe onde bater");
  }
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
