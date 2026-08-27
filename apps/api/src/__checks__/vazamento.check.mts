// ============================================================================
// Conferência do filtro de erros: a resposta não pode contar a intimidade.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/vazamento.check.mts
//
// Rodando o roteiro manual, um id inválido na URL
// (`/api/credit/accounts/uma-conta-qualquer`) devolvia 500 com isto no corpo:
//
//   Invalid `tx.creditAccount.findFirst()` invocation in
//   /home/user/norty-vision/apps/api/dist/credit/credit.service.js:79:94
//
// Caminho do arquivo, nome do método e trecho da consulta, pra qualquer um que
// digitasse um id torto. A causa era uma linha só no filtro global:
// `message = exception.message` pra qualquer Error inesperado.
//
// Esta conferência segura as duas pontas.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const filtro = readFileSync(join(api, "src", "common", "all-exceptions.filter.ts"), "utf8");
const falhas: string[] = [];

// 1. erro inesperado não repassa a própria mensagem
const ramoErro = filtro.match(/exception instanceof Error\)\s*\{([\s\S]*?)\n    \}/);
if (!ramoErro) {
  falhas.push("não achei o ramo `exception instanceof Error` no filtro");
} else if (/message\s*=\s*exception\.message/.test(ramoErro[1])) {
  falhas.push(
    "o filtro repassa `exception.message` de um erro inesperado — é assim que o caminho do " +
      "arquivo e a consulta chegam no navegador de quem digitou um id torto",
  );
}

// 2. o erro inteiro continua indo pro log (senão o conserto vira cegueira)
if (!/logger\.error\(\s*\{\s*err: exception/.test(filtro)) {
  falhas.push("o filtro parou de mandar o erro inteiro pro log — esconder do cliente não é esconder de você");
}

// 2b. e o erro que NÓS traduzimos também deixa rastro (senão o conserto vira
// cegueira: um `ehIdMalFormado` que erre o alvo some sem deixar trilha)
if (!/traduzido\s*\?\s*\{\s*err: exception\s*\}/.test(filtro)) {
  falhas.push("um erro inesperado traduzido pra 4xx não leva o original pro log");
}

// 3. id mal formado é pedido malfeito, não erro do servidor
if (!/ehIdMalFormado/.test(filtro)) {
  falhas.push("o filtro não trata id mal formado: volta a dar 500 em `/api/x/uma-coisa-qualquer`");
}
const fn = filtro.match(/function ehIdMalFormado[\s\S]*?\n\}/)?.[0] ?? "";
if (!/P2023/.test(fn) || !/uuid/i.test(fn)) {
  falhas.push("`ehIdMalFormado` perdeu o reconhecimento do P2023 / do erro de uuid do Postgres");
}
if (!/ehIdMalFormado\(exception\)/.test(filtro)) {
  falhas.push("`ehIdMalFormado` existe mas não é usada");
}
// e tem que vir ANTES do ramo genérico, senão nunca roda
const iId = filtro.indexOf("ehIdMalFormado(exception)");
const iErro = filtro.indexOf("exception instanceof Error");
if (iId > -1 && iErro > -1 && iId > iErro) {
  falhas.push("o teste de id mal formado vem DEPOIS do ramo genérico — nunca vai rodar");
}

// 4. pedido que o Fastify recusa antes da rota sai com o status DELE, não 500.
// Achado medindo o cofre: `POST /api/platform/vault/lock` com corpo vazio e
// `content-type: application/json` devolvia 500 "Erro interno" — o Fastify já
// tinha carimbado 400 e o filtro apagava.
if (!/ehPedidoMalFormado/.test(filtro)) {
  falhas.push(
    "o filtro não respeita o status dos erros do Fastify: corpo vazio, JSON quebrado e corpo " +
      "grande demais voltam a virar 500 \"Erro interno\"",
  );
}
const fnFst = filtro.match(/function ehPedidoMalFormado[\s\S]*?\n\}/)?.[0] ?? "";
if (!/FST_ERR_/.test(fnFst) || !/statusCode/.test(fnFst)) {
  falhas.push("`ehPedidoMalFormado` perdeu o reconhecimento do `FST_ERR_` / do `statusCode` do Fastify");
}
if (/status\s*>=\s*400\s*&&/.test(fnFst) === false || /status\s*<\s*500/.test(fnFst) === false) {
  falhas.push(
    "`ehPedidoMalFormado` não está limitada a 4xx — assim um 5xx do próprio framework passaria " +
      "a mensagem interna adiante",
  );
}
const iFst = filtro.indexOf("ehPedidoMalFormado(exception)");
if (iFst > -1 && iErro > -1 && iFst > iErro) {
  falhas.push("o teste de pedido mal formado vem DEPOIS do ramo genérico — nunca vai rodar");
}

console.log("filtro de erros conferido");
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nA RESPOSTA DE ERRO NÃO CONTA A INTIMIDADE DO SERVIDOR");
