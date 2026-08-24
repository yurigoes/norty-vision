// ============================================================================
// Conferência dos ícones do menu: toda rota que aparece na sidebar precisa ter
// ícone próprio em `lib/navIcons.ts`.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/navIcons.check.mts
//
// O mapa de ícones é lido como TEXTO de propósito — assim a conferência não
// depende de resolver `lucide-react` nem de bundler, e roda em qualquer lugar.
// Sem isso, uma tela nova entraria no menu com o ícone genérico sem ninguém
// perceber.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ROUTE_META } from "../nav.ts";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..");

const icons = readFileSync(join(web, "lib", "navIcons.ts"), "utf8");

// As rotas que precisam de ícone são as do MENU — que é exatamente o que o
// `ROUTE_META` indexa. As abas de módulo (MODULE_TABS) ficam de fora de
// propósito: a faixa de abas é só texto, como no resto do mercado.
const menuHrefs = new Set(Object.keys(ROUTE_META));
// chaves do mapa de ícones
const mapped = new Set([...icons.matchAll(/^\s*"(\/app[^"]*)":/gm)].map((m) => m[1]));

const semIcone = [...menuHrefs].filter((h) => !mapped.has(h)).sort();
const sobrando = [...mapped].filter((h) => !menuHrefs.has(h)).sort();

console.log(`rotas no menu: ${menuHrefs.size}`);
console.log(`rotas com ícone: ${mapped.size}`);

if (semIcone.length) {
  console.log(`\nFALHA — ${semIcone.length} rota(s) do menu sem ícone (cairiam no genérico):`);
  for (const h of semIcone) console.log("  " + h);
}
if (sobrando.length) {
  // não é erro: itens de conta/atalho podem estar no mapa sem estar no layout
  console.log(`\naviso — ${sobrando.length} ícone(s) sem item correspondente no menu:`);
  for (const h of sobrando) console.log("  " + h);
}

if (semIcone.length === 0) console.log("\nTODAS AS ROTAS DO MENU TÊM ÍCONE");
process.exit(semIcone.length === 0 ? 0 : 1);
