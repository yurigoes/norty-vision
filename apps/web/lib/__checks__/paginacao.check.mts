// ============================================================================
// Conferência da paginação: nenhuma tela grande monta tudo de uma vez.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/paginacao.check.mts
//
// Crediário, Orçamentos e Transações montavam TODAS as linhas que o servidor
// mandava. Com algumas centenas de contas isso é meio segundo de layout num
// celular — antes de a primeira linha aparecer. Produtos já cortava em páginas;
// virou uma peça só (`components/Paginacao.tsx`), usada pelas quatro.
//
// A conferência tem duas metades:
//   1. as telas listadas aqui PRECISAM paginar, e não podem voltar a varrer a
//      lista inteira no lugar da fatia;
//   2. quem usa o hook tem que usar de verdade — `usePaginacao` sem renderizar
//      `.pagina` é decoração.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, statSync } from "node:fs";
import { relative } from "node:path";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raiz = join(web, "app", "app");

/**
 * Telas que precisam paginar, e a lista que NÃO pode ser renderizada inteira.
 * O valor é o nome da variável/prop com a lista completa.
 */
const OBRIGATORIAS: Record<string, string[]> = {
  "produtos/ProductsClient.tsx": ["initialProducts"],
  "crediario/CreditClient.tsx": ["initialAccounts", "initialRequests", "initialApplications"],
  "orcamentos/OrcamentosClient.tsx": ["initial"],
  "transacoes/TransacoesClient.tsx": ["rows"],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

const falhas: string[] = [];
let telas = 0;

for (const [rel, fontes] of Object.entries(OBRIGATORIAS)) {
  const arquivo = join(raiz, rel);
  if (!existsSync(arquivo)) {
    falhas.push(`${rel} — a tela sumiu; atualize esta conferência`);
    continue;
  }
  const src = readFileSync(arquivo, "utf8");
  if (!/usePaginacao\s*\(/.test(src)) {
    falhas.push(`${rel} — não usa \`usePaginacao\``);
    continue;
  }
  if (!/<Paginacao\b/.test(src)) {
    falhas.push(`${rel} — pagina mas não mostra os controles (\`<Paginacao />\`)`);
  }
  for (const fonte of fontes) {
    // `fonte.map(` na tela = a lista inteira virando linhas
    const re = new RegExp(`\\b${fonte}\\s*\\.map\\(`);
    if (re.test(src)) {
      falhas.push(`${rel} — renderiza \`${fonte}.map(\`, a lista inteira, em vez da fatia da página`);
    }
  }
  telas++;
}

// segunda metade: hook usado pela metade, em qualquer tela
let usam = 0;
for (const arquivo of walk(raiz)) {
  const src = readFileSync(arquivo, "utf8");
  if (!/usePaginacao\s*\(/.test(src)) continue;
  usam++;
  const rel = relative(raiz, arquivo).replace(/\\/g, "/");
  if (!/\.pagina\b/.test(src)) {
    falhas.push(`${rel} — chama \`usePaginacao\` e nunca renderiza \`.pagina\``);
  }
}

console.log(`telas obrigadas a paginar, conferidas: ${telas}/${Object.keys(OBRIGATORIAS).length}`);
console.log(`telas que usam a paginação:            ${usam}`);

if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nNENHUMA TELA GRANDE MONTA A LISTA INTEIRA DE UMA VEZ");
