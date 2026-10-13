// ============================================================================
// Conferência do formulário de produto: o que a pessoa DIGITA é o que SALVA.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/produtoForm.check.mts
//
// DOIS DEFEITOS, E O SEGUNDO ERA PIOR QUE O PRIMEIRO
//
// (A) O 400 MUDO. Todo campo numérico desta tela é um `<input>` de texto puro.
//     Quem digitasse um valor fora dos limites do zod da API levava
//     `400 Validacao falhou — costCents: Number must be greater than or equal
//     to 0` — em inglês, com o nome INTERNO do campo. "costCents" não está
//     escrito em lugar nenhum da tela (a caixa diz "Custo (R$)"), então a
//     mensagem virava ruído e a pessoa clicava Salvar de novo. Chegou um relato
//     com SEIS 400 seguidos em /api/products.
//
// (B) O PREÇO QUE VIRAVA OUTRO. O parser era `.replace(",", ".")` — UMA
//     vírgula. Medido no parser antigo:
//
//       "1.299,90"  -> null  → a tela dizia SEM PREÇO pra um preço preenchido
//       "1.000,00"  -> null  → idem
//       "R$ 199,00" -> null  → idem
//       "1.299"     -> 130   → R$ 1,30. Produto de R$ 1.299 vendido a R$ 1,30.
//
//     O último não dá erro nenhum: salva, aparece na lista, e o PDV vende. É o
//     mesmo buraco que o "fim da venda a R$ 0,00" veio fechar, entrando por
//     outra porta — e por isso esta conferência fica ao lado da `pdv.check`.
// ============================================================================

import { toCents, toNum, normalizaLink, validar, erroAmigavel, LIMITES } from "../produtoForm.ts";

const falhas: string[] = [];
const eq = (real: unknown, esperado: unknown, oque: string) => {
  const a = Number.isNaN(real as number) ? "NaN" : JSON.stringify(real);
  const b = Number.isNaN(esperado as number) ? "NaN" : JSON.stringify(esperado);
  if (a !== b) falhas.push(`${oque}: veio ${a}, esperava ${b}`);
};

// --- 1. o preço brasileiro ---------------------------------------------------
for (const [digitado, centavos] of [
  ["1299,90", 129990],        // vírgula decimal, o jeito mais comum
  ["1.299,90", 129990],       // com separador de milhar — devolvia null
  ["1.000,00", 100000],       // idem
  ["R$ 199,00", 19900],       // com o símbolo colado — devolvia null
  ["1.234.567,89", 123456789],// dois separadores de milhar
  ["1.299", 129900],          // SÓ milhar: era 130 (R$ 1,30)
  ["19.90", 1990],            // ponto decimal (quem digita em teclado numérico)
  ["1299.90", 129990],
  ["0", 0],                   // zero é um preço, não "vazio"
  ["", null],                 // vazio é vazio
  ["   ", null],
  ["abc", null],              // sem dígito nenhum: vazio
  ["1,2,3", NaN],             // lixo COM dígito: NaN, pro validador acusar
] as const) {
  eq(toCents(digitado), centavos, `toCents(${JSON.stringify(digitado)})`);
}
// o zero tem que sobreviver: `0` é falsy, e um `|| null` no caminho o mataria
eq(toCents("0"), 0, "toCents do zero (0 é preço, não ausência)");
eq(toNum("12"), 12, "toNum inteiro");
eq(toNum("1,5"), 1.5, "toNum percentual com vírgula");

// --- 2. o validador recusa o que a API recusaria -----------------------------
// Cada caso abaixo DEVE virar mensagem; se um passar, volta a ser 400 em inglês.
for (const [payload, oque] of [
  [{ priceCashCents: -500 }, "preço negativo"],
  [{ costCents: -100 }, "custo negativo"],
  [{ maxInstallments: 999 }, "parcelas acima de 120"],
  [{ maxInstallments: 0 }, "parcelas zero"],
  [{ earlyPaymentDiscountPct: 150 }, "desconto acima de 100%"],
  [{ creditInterestPct: 2000 }, "juros acima de 1000%"],
  [{ priceCashCents: NaN }, "texto que não é número"],
  [{ minStockQty: 2.5 }, "estoque fracionário"],
  [{ imageUrl: "foto.jpg" }, "link sem domínio"],
] as const) {
  const m = validar(payload as any);
  if (!m) falhas.push(`validar deixou passar: ${oque}`);
  else if (/[A-Z]/.test(m) && /must be|Invalid|character\(s\)/.test(m)) {
    falhas.push(`a mensagem de "${oque}" voltou em inglês: ${m}`);
  }
}
// e DEIXA passar o que é válido
for (const [payload, oque] of [
  [{ priceCashCents: 19900, costCents: 8000 }, "preço e custo normais"],
  [{ imageUrl: "https://x.com/a.jpg" }, "link completo"],
  [{ priceCashCents: 0 }, "preço zero (a tela já pergunta, não barra)"],
  [{ maxInstallments: 120 }, "parcelas no limite"],
  [{ earlyPaymentDiscountPct: 100 }, "desconto no limite"],
  [{}, "produto só com nome"],
] as const) {
  const m = validar(payload as any);
  if (m) falhas.push(`validar barrou o que é válido (${oque}): ${m}`);
}

// --- 3. o link tolerante -----------------------------------------------------
eq(normalizaLink("www.x.com/a.jpg"), "https://www.x.com/a.jpg", "link sem esquema");
eq(normalizaLink("x.com.br/foto.png"), "https://x.com.br/foto.png", "domínio .br sem esquema");
eq(normalizaLink("https://y.com/a.jpg"), "https://y.com/a.jpg", "link já completo");
eq(normalizaLink(""), null, "link vazio");
if (validar({ imageUrl: normalizaLink("www.x.com/a.jpg") } as any)) {
  falhas.push("link normalizado ainda é recusado pelo validador");
}

// --- 4. o 400 que escapar vira português ------------------------------------
for (const [cru, deveConter] of [
  ["Validacao falhou — costCents: Number must be greater than or equal to 0", "Custo (R$)"],
  ["Validacao falhou — imageUrl: Invalid url", "Link da imagem"],
  ["Validacao falhou — maxInstallments: Number must be less than or equal to 120", "Máx parcelas"],
  ["Validacao falhou — sku: String must contain at most 60 character(s)", "SKU"],
  ["Validacao falhou — laboratorySupplierId: Invalid uuid", "Laboratório"],
  ["Validacao falhou — name: String must contain at least 1 character(s)", "Nome"],
] as const) {
  const t = erroAmigavel(cru);
  if (!t.includes(deveConter)) falhas.push(`erroAmigavel não nomeou a caixa "${deveConter}": ${t}`);
  if (/must be|Invalid |character\(s\)/.test(t)) falhas.push(`erroAmigavel deixou inglês: ${t}`);
}

// --- 5. os limites daqui são os do zod da API -------------------------------
// Se alguém afrouxar ou apertar o `UpsertSchema` lá e esquecer daqui, a tela
// recusa o que a API aceita (ou manda o que ela recusa) — e o 400 volta.
const api = new URL("../../../api/src/products/products.controller.ts", import.meta.url);
const schema = (await import("node:fs")).readFileSync(api, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
const corpo = schema.slice(schema.indexOf("const UpsertSchema"), schema.indexOf("@Controller"));
for (const { k, label, min, max } of LIMITES) {
  const linha = new RegExp(`${k}:\\s*z\\.number\\(\\)([^,\\n]*)`).exec(corpo);
  if (!linha) { falhas.push(`${k} (${label}) não está mais no UpsertSchema da API`); continue; }
  const def = linha[1]!;
  const apiMin = /\.min\((\d+)\)/.exec(def);
  const apiMax = /\.max\((\d+)\)/.exec(def);
  if (min != null && (!apiMin || Number(apiMin[1]) !== min)) {
    falhas.push(`${k}: mínimo ${min} aqui, ${apiMin?.[1] ?? "nenhum"} na API`);
  }
  if (max != null && (!apiMax || Number(apiMax[1]) !== max)) {
    falhas.push(`${k}: máximo ${max} aqui, ${apiMax?.[1] ?? "nenhum"} na API`);
  }
}

console.log(`preços lidos: 13 formatos · limites casados com a API: ${LIMITES.length}`);
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nO PREÇO QUE A PESSOA DIGITA É O PREÇO QUE SALVA, E O ERRO FALA PORTUGUÊS");
