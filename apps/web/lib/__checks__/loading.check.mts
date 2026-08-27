// ============================================================================
// Conferência do estado de carregamento: toda tela do painel precisa do seu
// `loading.tsx`.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/loading.check.mts
//
// Sem um arquivo próprio a tela NÃO fica sem esqueleto — ela herda o do
// segmento pai, e é aí que dói: `/app/agenda/pacientes`, que é uma tabela,
// herdaria o calendário da Agenda e mostraria a forma errada do que está por
// vir. Por isso a régua aqui é "uma por tela", não "existe pelo menos um".
// ============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raiz = join(web, "app", "app");

function dirsComPagina(dir: string): string[] {
  const filhos = readdirSync(dir).map((n) => join(dir, n));
  const aqui = filhos.some((p) => p.endsWith("page.tsx")) ? [dir] : [];
  return [...aqui, ...filhos.filter((p) => statSync(p).isDirectory()).flatMap(dirsComPagina)];
}

const VARIANTES = new Set([
  "page", "table", "dashboard", "board", "form", "calendar", "split", "home", "doc",
]);

const semLoading: string[] = [];
const varianteInvalida: string[] = [];
let ok = 0;

for (const dir of dirsComPagina(raiz)) {
  const rota = ("/app/" + relative(raiz, dir)).replace(/\/$/, "") || "/app";
  let src: string;
  try {
    src = readFileSync(join(dir, "loading.tsx"), "utf8");
  } catch {
    semLoading.push(rota);
    continue;
  }
  const m = src.match(/variant="(\w+)"/);
  if (!m || !VARIANTES.has(m[1])) varianteInvalida.push(`${rota} → ${m?.[1] ?? "(sem variant)"}`);
  else ok++;
}

console.log(`telas com esqueleto próprio: ${ok}`);
if (semLoading.length) {
  console.log(`\nFALHA — ${semLoading.length} tela(s) sem loading.tsx (herdariam a forma errada):`);
  semLoading.forEach((r) => console.log("  " + r));
}
if (varianteInvalida.length) {
  console.log(`\nFALHA — variante desconhecida (ver components/Skeleton.tsx):`);
  varianteInvalida.forEach((r) => console.log("  " + r));
}

const tudoOk = semLoading.length === 0 && varianteInvalida.length === 0;
if (tudoOk) console.log("\nTODAS AS TELAS TÊM ESQUELETO PRÓPRIO");
process.exit(tudoOk ? 0 : 1);
