// ============================================================================
// Conferência das tabelas: no painel, toda tabela vira cartão no celular.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/tableCards.check.mts
//
// Uma tabela sem a classe `table-cards` continua rolando na horizontal no
// telefone — que era exatamente o problema. As exceções estão listadas aqui,
// com o motivo, pra que sejam decisão e não esquecimento.
// ============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raiz = join(web, "app", "app");

/** Tabelas que NÃO devem virar cartão, e por quê. */
const ISENTAS: Record<string, string> = {
  "agenda/relatorio/page.tsx": "folha de relatório impresso — na tela também é 'papel'",
  "caixa/relatorio/page.tsx": "folha de relatório impresso — na tela também é 'papel'",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

const semClasse: string[] = [];
let comClasse = 0;
let isentas = 0;

for (const arquivo of walk(raiz)) {
  const src = readFileSync(arquivo, "utf8");
  const tabelas = src.match(/<table[^>]*>/g);
  if (!tabelas) continue;

  const rel = relative(raiz, arquivo).replace(/\\/g, "/");
  if (ISENTAS[rel]) {
    isentas += tabelas.length;
    continue;
  }
  for (const tag of tabelas) {
    if (tag.includes("table-cards")) comClasse++;
    else semClasse.push(`${rel}  ${tag}`);
  }
}

console.log(`tabelas que viram cartão no celular: ${comClasse}`);
console.log(`isentas (com motivo declarado):      ${isentas}`);

if (semClasse.length) {
  console.log(`\nFALHA — ${semClasse.length} tabela(s) sem a classe \`table-cards\`:`);
  semClasse.forEach((t) => console.log("  " + t));
  console.log("\nAdicione a classe, ou declare a exceção (com o motivo) neste arquivo.");
  process.exit(1);
}
console.log("\nTODAS AS TABELAS DO PAINEL VIRAM CARTÃO NO CELULAR");
