// ============================================================================
// Conferência do cabeçalho de página.
//
// Duas garantias:
//   1. Toda tela do painel tem lugar no mapa do menu (`lib/nav.ts`) — é dele
//      que o cabeçalho tira o "você está em...". Tela que só resolve para a
//      raiz `/app` é órfã: existe, mas o sistema não sabe dizer onde ela fica.
//   2. Toda tela usa o `PageHeader`, e não um topo montado à mão.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/pageHeader.check.mts
// Sai com código 1 se alguma das duas falhar.
// ============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routeMeta } from "../nav.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raiz = join(web, "app", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith("page.tsx") ? [p] : [];
  });
}

const orfas: string[] = [];
const semPageHeader: string[] = [];
let comPageHeader = 0;

for (const arquivo of walk(raiz)) {
  const rota =
    ("/app/" + relative(raiz, arquivo).replace(/\/?page\.tsx$/, "")).replace(/\/$/, "") || "/app";

  if (rota !== "/app") {
    const meta = routeMeta(rota);
    if (!meta || meta.href === "/app") orfas.push(rota);
  }

  const src = readFileSync(arquivo, "utf8");
  if (src.includes("<PageHeader")) comPageHeader++;
  // Topo montado à mão. O sinal é a linha de categoria do padrão antigo — não
  // basta procurar <h1>: cartão de impressão e crachá também têm um, e esses
  // NÃO devem virar cabeçalho de página.
  // (o `text-xs` importa: `text-[10px]` com as mesmas classes é etiqueta
  // dentro de cartão, não cabeçalho de tela)
  if (src.includes('"text-xs font-semibold uppercase tracking-wider text-brand"')) semPageHeader.push(rota);
}

console.log(`telas do painel:        ${walk(raiz).length}`);
console.log(`  com PageHeader:       ${comPageHeader}`);
console.log(`  com topo à mão:       ${semPageHeader.length}`);
console.log(`telas sem lugar no menu: ${orfas.length}`);

if (orfas.length) {
  console.log("\nFALHA — telas órfãs (adicione ao menu em lib/nav.ts, ou a ROTAS_INTERNAS):");
  orfas.forEach((o) => console.log("  " + o));
}
if (semPageHeader.length) {
  console.log("\nFALHA — telas com cabeçalho montado à mão (use <PageHeader>):");
  semPageHeader.forEach((o) => console.log("  " + o));
}

const ok = orfas.length === 0 && semPageHeader.length === 0;
console.log(ok ? "\nTODAS AS TELAS TÊM CABEÇALHO PADRÃO E LUGAR NO MENU" : "");
process.exit(ok ? 0 : 1);
