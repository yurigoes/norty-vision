// ============================================================================
// Conferência das abas de módulo.
//
// Duas garantias:
//   1. toda aba aponta pra uma tela que existe — aba quebrada é pior que aba
//      faltando, porque a pessoa clica e cai num 404;
//   2. nenhum módulo voltou a inventar a própria navegação (o `SubLink` que
//      existia em três layouts, cada um com o seu conjunto de classes e nenhum
//      marcando a tela atual).
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/moduleTabs.check.mts
// ============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_TABS } from "../nav.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appDir = join(web, "app");

const quebradas: string[] = [];
let total = 0;

for (const grupo of MODULE_TABS) {
  for (const tab of grupo.tabs) {
    total++;
    const dir = join(appDir, tab.href.replace(/^\//, ""));
    if (!existsSync(join(dir, "page.tsx"))) quebradas.push(`${tab.href}  ("${tab.label}")`);
  }
}

// nenhum layout de módulo deve montar a própria navegação
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith("layout.tsx") ? [p] : [];
  });
}
const caseiras: string[] = [];
for (const arquivo of walk(join(appDir, "app"))) {
  const src = readFileSync(arquivo, "utf8");
  if (/function SubLink\b/.test(src)) caseiras.push(relative(appDir, arquivo));
}

console.log(`abas declaradas: ${total} em ${MODULE_TABS.length} módulos`);

if (quebradas.length) {
  console.log(`\nFALHA — ${quebradas.length} aba(s) apontando pra tela inexistente:`);
  quebradas.forEach((q) => console.log("  " + q));
}
if (caseiras.length) {
  console.log(`\nFALHA — layout com navegação própria (use MODULE_TABS em lib/nav.ts):`);
  caseiras.forEach((c) => console.log("  " + c));
}

const ok = quebradas.length === 0 && caseiras.length === 0;
if (ok) console.log("\nTODAS AS ABAS APONTAM PRA UMA TELA QUE EXISTE");
process.exit(ok ? 0 : 1);
