// ============================================================================
// Conferência da paginação de verdade: as rotas de listagem dizem quantos são.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/pagina.check.mts
//
// As oito rotas medidas devolviam `{ items: [...] }` com um `take` fixo — 500
// vendas, 1.000 parcelas — e ninguém tinha como saber se aquilo era tudo. Agora
// devolvem `{ items, total, limit, offset, hasMore }`, montado por `paginar()`,
// que também é quem garante a ORDEM ESTÁVEL (sem desempate por `id`, a página 2
// repete linhas da 1 — aconteceu com os orçamentos).
//
// Esta conferência reprova:
//   - rota da lista que parou de usar `paginar()`;
//   - `take:` solto no método de listagem (é o teto silencioso voltando);
//   - controller que não aceita `limit`/`offset` pelos ajudantes;
//   - `paginar()` sem o desempate por `id`.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

/** rota -> [arquivo do service, nome do método, arquivo do controller] */
const ROTAS: Record<string, [string, string, string]> = {
  "/api/customers": ["customers/customers.service.ts", "list", "customers/customers.controller.ts"],
  "/api/products": ["products/products.service.ts", "list", "products/products.controller.ts"],
  "/api/sales": ["sales/sales.service.ts", "list", "sales/sales.controller.ts"],
  "/api/credit/accounts": ["credit/credit.service.ts", "listAccounts", "credit/credit.controller.ts"],
  "/api/quotes": ["quotes/quotes.service.ts", "list", "quotes/quotes.controller.ts"],
  "/api/production": ["production/production.service.ts", "list", "production/production.controller.ts"],
  "/api/payables": ["payables/payables.service.ts", "list", "payables/payables.controller.ts"],
  "/api/receivables": ["receivables/receivables.service.ts", "list", "receivables/receivables.controller.ts"],
};

/** o corpo do método, do `async nome(` até a chave que o fecha */
function corpo(texto: string, metodo: string): string | null {
  const i = texto.indexOf(`async ${metodo}(`);
  if (i === -1) return null;
  // o primeiro `{` depois do nome pode ser do TIPO de um parâmetro
  // (`opts?: { status?: string }`) — o corpo começa depois do `)` que fecha a
  // lista de parâmetros
  let par = 0;
  let j = texto.indexOf("(", i);
  let fimParams = -1;
  for (; j < texto.length; j++) {
    if (texto[j] === "(") par++;
    else if (texto[j] === ")") {
      par--;
      if (par === 0) { fimParams = j; break; }
    }
  }
  if (fimParams === -1) return null;
  const abre = texto.indexOf("{", fimParams);
  let nivel = 0;
  for (let j = abre; j < texto.length; j++) {
    if (texto[j] === "{") nivel++;
    else if (texto[j] === "}") {
      nivel--;
      if (nivel === 0) return texto.slice(i, j + 1);
    }
  }
  return null;
}

const falhas: string[] = [];
let ok = 0;

for (const [rota, [svcRel, metodo, ctrlRel]] of Object.entries(ROTAS)) {
  const svcPath = join(src, svcRel);
  const ctrlPath = join(src, ctrlRel);
  if (!existsSync(svcPath) || !existsSync(ctrlPath)) {
    falhas.push(`${rota} — arquivo sumiu; atualize esta conferência`);
    continue;
  }
  const c = corpo(readFileSync(svcPath, "utf8"), metodo);
  if (!c) {
    falhas.push(`${rota} — não achei \`async ${metodo}(\` em ${svcRel}`);
    continue;
  }
  if (!/\bpaginar\s*\(/.test(c)) falhas.push(`${rota} — ${svcRel}#${metodo} não usa \`paginar()\``);
  if (/\btake\s*:/.test(c)) falhas.push(`${rota} — ${svcRel}#${metodo} tem \`take:\` solto: é o teto silencioso voltando`);
  if (/\.findMany\(/.test(c) && !/paginar/.test(c)) falhas.push(`${rota} — ${svcRel}#${metodo} lê direto com findMany`);

  const ctrl = readFileSync(ctrlPath, "utf8");
  if (!/limitePedido\s*\(/.test(ctrl)) falhas.push(`${rota} — ${ctrlRel} não aceita \`?limit=\` (limitePedido)`);
  if (!/offsetPedido\s*\(/.test(ctrl)) falhas.push(`${rota} — ${ctrlRel} não aceita \`?offset=\` (offsetPedido)`);
  ok++;
}

// o desempate: sem ele, `offset` mente
const helper = readFileSync(join(src, "common/pagina.ts"), "utf8");
if (!/comDesempate/.test(helper) || !/\{ id: "asc" \}/.test(helper)) {
  falhas.push("common/pagina.ts — `paginar()` perdeu o desempate por `id`: a página 2 volta a repetir linhas da 1");
}
if (!/orderBy: comDesempate\(args\.orderBy\)/.test(helper)) {
  falhas.push("common/pagina.ts — o desempate existe mas não está sendo aplicado no findMany");
}

console.log(`rotas de listagem paginadas: ${ok}/${Object.keys(ROTAS).length}`);
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nAS OITO ROTAS DIZEM QUANTOS SÃO, E PAGINAM NA MESMA ORDEM");
