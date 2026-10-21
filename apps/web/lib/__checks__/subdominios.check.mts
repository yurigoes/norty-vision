// ============================================================================
// Conferência dos subdomínios reservados: UMA lista, não duas.
//
// Rodar: node --experimental-strip-types apps/web/lib/__checks__/subdominios.check.mts
//
// O DEFEITO
//
// `lib/orgSlug.ts` (cliente) e `lib/orgBranding.ts` (servidor) tinham cada um
// a SUA cópia da lista de subdomínios que não são empresa. Elas divergiram: a
// do cliente ganhou "vision", "norty", "sorva", "license"; a do servidor não.
//
// Medido em produção: `GET /api/organizations/public/by-slug/vision` → 404
// "Empresa não encontrada", a cada render de página, porque o lado SERVIDOR
// extraía `vision` como slug de empresa. A empresa real tem slug
// `zito-oticas` — `vision` é o nome do produto no domínio.
//
// E pior que o 404: o `getOrgBrandingFromHost` devolvia `slug: "vision"`
// mesmo sem achar nada, então o resto do app passava a tratar um tenant
// inexistente como se fosse o atual.
// ============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUBDOMINIOS_RESERVADOS } from "../subdominios.ts";

const lib = join(dirname(fileURLToPath(import.meta.url)), "..");
const falhas: string[] = [];

// 1. a lista tem o que precisa ter
for (const nome of ["www", "api", "app", "vision", "norty", "sorva", "license", "localhost"]) {
  if (!SUBDOMINIOS_RESERVADOS.has(nome)) {
    falhas.push(`"${nome}" saiu da lista de reservados — vira slug de empresa e a busca 404`);
  }
}

// 2. e NINGUÉM mais declara a sua própria cópia
// É a regra que importa: a lista voltar a ser duplicada é o defeito, não o
// conteúdo dela. Procura `RESERVED = new Set` / `RESERVADOS = new Set` em
// qualquer arquivo de lib que não seja o dono da lista.
const dono = "subdominios.ts";
for (const nome of readdirSync(lib)) {
  if (!nome.endsWith(".ts") || nome === dono) continue;
  const src = readFileSync(join(lib, nome), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  if (/(RESERVED|RESERVADOS)\s*(:[^=]*)?=\s*new Set/.test(src)) {
    falhas.push(
      `lib/${nome} declarou a SUA cópia da lista de reservados — era exatamente assim que ` +
        `"vision" entrou num lado e não no outro. Importe de lib/${dono}`,
    );
  }
}

// 3. os dois consumidores importam do dono
for (const arq of ["orgSlug.ts", "orgBranding.ts"] as const) {
  const src = readFileSync(join(lib, arq), "utf8");
  if (!/from "\.\/subdominios"/.test(src)) {
    falhas.push(`lib/${arq} não importa mais a lista de lib/${dono}`);
  }
}

// 4. 404 do by-slug não pode devolver slug
// Se devolver, o app passa a acreditar num tenant que não existe — foi o que
// aconteceu com `vision`.
{
  const src = readFileSync(join(lib, "orgBranding.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  if (!/res\.status === 404/.test(src) || !/slug: null/.test(src)) {
    falhas.push(
      "`getOrgBrandingFromHost` voltou a devolver o slug quando a empresa NÃO EXISTE (404) — " +
        "o app passa a tratar um tenant inexistente como o atual",
    );
  }
}

console.log(`subdomínios reservados: ${SUBDOMINIOS_RESERVADOS.size}, numa lista só`);
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("UMA LISTA DE RESERVADOS, E O 404 NÃO INVENTA TENANT");
