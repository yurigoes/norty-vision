// ============================================================================
// Conferência do "mais vendidos": o número tem que ser o número.
//
// Rodar: node --experimental-strip-types apps/web/lib/__checks__/relatorioVendas.check.mts
//
// TRÊS DEFEITOS, todos no mesmo relatório, e todos mudavam um número que
// alguém ia mostrar pra outra pessoa.
//
// (A) ARMAÇÃO DE PEDIDO DE LENTE NÃO ERA CONTADA. Numa ótica a armação sai por
//     dois caminhos: o PDV (vira `sale_item`) e o pedido de lente sem venda
//     vinculada, que baixa o estoque direto e grava um `stock_movement` com
//     `referenceType: "lens_order"`. O relatório lia só `sale_items`. Medido
//     com 3 saídas por PDV e 2 por pedido: dizia 3, o certo é 5 — 40% a menos.
//
// (B) TETO DE 5.000 ITENS, CALADO. `take: 5000` num `findMany`: período maior
//     vinha truncado sem avisar. Virou `groupBy`, que soma no banco.
//
// (C) A TELA NÃO DEIXAVA ESCOLHER O PERÍODO. Chamava a rota sem `from`/`to`,
//     então era sempre "últimos 30 dias" — e não havia como perguntar "quantas
//     armações vendemos em setembro", que foi exatamente a pergunta que
//     revelou os outros dois.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const api = join(web, "..", "api");
const falhas: string[] = [];
const semCom = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");

// --- servidor ---------------------------------------------------------------
const svc = semCom(readFileSync(join(api, "src", "products", "products.service.ts"), "utf8"));
const i = svc.indexOf("async bestSellersReport");
if (i < 0) {
  falhas.push("`bestSellersReport` desapareceu do products.service");
} else {
  // o corpo vai até o PRÓXIMO método, não um tanto fixo de caracteres: hoje
  // `bestSellersReport` é o último do arquivo, e um pedaço fixo passaria a ler
  // o método seguinte no dia em que alguém escrever um depois dele.
  const fim = svc.slice(i + 10).search(/\n  (async |private |public )?[A-Za-z_]+[(<]/);
  const corpo = fim < 0 ? svc.slice(i) : svc.slice(i, i + 10 + fim);
  if (!/referenceType:\s*"lens_order"/.test(corpo)) {
    falhas.push(
      "o relatório voltou a contar só `sale_items`: a armação que sai por PEDIDO DE LENTE " +
        "deixa de ser contada, e numa ótica isso é grande parte das armações",
    );
  }
  if (!/qtyLens/.test(corpo) || !/qtyPdv/.test(corpo)) {
    falhas.push("a resposta não separa mais `qtyPdv` e `qtyLens` — a soma esconde de onde veio cada unidade");
  }
  if (/take:\s*\d+/.test(corpo)) {
    falhas.push(
      "voltou um `take` no relatório: período grande vem truncado e a resposta não avisa. " +
        "Some no banco com `groupBy`",
    );
  }
  if (!/groupBy/.test(corpo)) {
    falhas.push("`bestSellersReport` parou de somar no banco (`groupBy`) — voltou a trazer linha por linha");
  }
}

// --- tela -------------------------------------------------------------------
const tela = readFileSync(join(web, "app", "app", "relatorios", "ReportsClient.tsx"), "utf8");
const telaSem = semCom(tela);
if (!/best-sellers\?from=\$\{/.test(telaSem)) {
  falhas.push(
    "a tela voltou a chamar `best-sellers` sem `from`/`to` — mostra sempre os últimos 30 dias, " +
      "e não há como consultar um período",
  );
}
for (const [o_que, re] of [
  ["os campos de data", /type="date"/],
  ["o botão Aplicar", /carregaSellers\(de, ate\)/],
  ["os atalhos de período", /atalho\("mesPassado"\)|atalho\(k\)/],
  ["a exportação CSV do período da tela", /function baixaCsv/],
] as const) {
  if (!re.test(telaSem)) falhas.push(`a tela de relatórios perdeu ${o_que}`);
}
// o CSV tem que sair com o período no nome: arquivo sem período na planilha é
// número sem contexto, e é assim que se compara mês errado com mês errado.
if (!/mais-vendidos-\$\{/.test(telaSem)) {
  falhas.push("o CSV não leva mais o período no nome do arquivo");
}
// BOM no CSV: sem ele o Excel pt-BR abre "Armações" como "ArmaÃ§Ãµes"
if (!/\\uFEFF/.test(telaSem)) {
  falhas.push("o CSV perdeu o BOM — o Excel em português abre os acentos errados");
}
// E a tela tem que DIZER que o faturado é só do PDV, senão alguém divide
// faturado por total e acha um preço médio que não existe. Conferido no texto
// SEM comentário: um comentário explicando a regra não avisa ninguém.
if (!/não no faturado|nao no faturado/.test(telaSem)) {
  falhas.push("a tela não avisa mais que o faturado é só do PDV — dá pra calcular preço médio errado sem perceber");
}

console.log("mais vendidos: dois caminhos de saída somados, sem teto, com período na tela");
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("O NUMERO DO RELATORIO E O NUMERO QUE SAIU DA PRATELEIRA");
