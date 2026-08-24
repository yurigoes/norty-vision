// ============================================================================
// Conferência dos ícones do menu: toda rota que aparece na sidebar precisa ter
// ícone próprio em `lib/navIcons.ts`.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/navIcons.check.mts
//
// Lê os dois arquivos como TEXTO de propósito — assim a conferência não depende
// de resolver `lucide-react` nem de bundler, e roda em qualquer lugar. Sem isso,
// uma tela nova entraria no menu com o ícone genérico sem ninguém perceber.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..");

// o mapa do menu vive em lib/nav.ts; o layout só o renderiza
const nav = readFileSync(join(web, "lib", "nav.ts"), "utf8");
const layout = readFileSync(join(web, "app", "app", "layout.tsx"), "utf8");
const icons = readFileSync(join(web, "lib", "navIcons.ts"), "utf8");

// rotas do menu: `href: "/app/..."` (arrays de nav) e `href="/app/..."` (JSX)
const menuHrefs = new Set(
  [...(nav + layout).matchAll(/href[:=]\s*"(\/app[^"${]*)"/g)].map((m) => m[1]),
);
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
