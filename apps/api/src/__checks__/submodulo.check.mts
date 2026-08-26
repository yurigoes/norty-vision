// ============================================================================
// Conferência do sub-módulo: fechar a tela sem fechar a API é meia porta.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/submodulo.check.mts
//
// O menu escondia, a rota abria. Consertada a rota, sobrou a API: desligar
// `producao.costureiras` fechava a tela e deixava
// `/api/production/by-supplier/x/report` aberto pra quem abrisse o devtools.
//
// Esta conferência exige que TODO sub-módulo que a tela sabe desligar tenha
// pelo menos um endpoint com `@RequireSubmodule` — ou esteja declarado aqui
// com o motivo de não ter.
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(api, "..", "web");
const falhas: string[] = [];

// as chaves que o menu sabe desligar, lidas do próprio nav.ts
const nav = readFileSync(join(web, "lib", "nav.ts"), "utf8");
const chaves = [...new Set([...nav.matchAll(/subMod:\s*"([a-z_.]+)"/g)].map((m) => m[1]))];

/** sub-módulo que fecha só a tela, e por quê */
const SO_NA_TELA: Record<string, string> = {};

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return controllers(p);
    return p.endsWith(".controller.ts") ? [p] : [];
  });
}
const fontes = controllers(join(api, "src")).map((f) => readFileSync(f, "utf8")).join("\n");

for (const chave of chaves) {
  const guardado = new RegExp(`RequireSubmodule\\("${chave.replace(".", "\\.")}"\\)`).test(fontes);
  if (guardado) continue;
  if (SO_NA_TELA[chave]) continue;
  falhas.push(
    `"${chave}" fecha a tela mas nenhum endpoint tem \`@RequireSubmodule("${chave}")\` — ` +
      `quem abrir o devtools continua usando. Guarde o endpoint, ou declare o motivo em SO_NA_TELA.`,
  );
}

// a guarda tem que estar registrada, senão o decorador é enfeite
const appModule = readFileSync(join(api, "src", "app.module.ts"), "utf8");
// o import não basta: tem que estar REGISTRADO como APP_GUARD
if (!/provide:\s*APP_GUARD,\s*useClass:\s*SubmoduloGuard/.test(appModule)) {
  falhas.push("app.module.ts não registra o SubmoduloGuard como APP_GUARD — os decoradores viram enfeite");
}
if (!existsSync(join(api, "src", "common", "submodulo.guard.ts"))) {
  falhas.push("common/submodulo.guard.ts sumiu");
} else {
  const g = readFileSync(join(api, "src", "common", "submodulo.guard.ts"), "utf8");
  // master puro e quem não tem empresa passam; quem tem, é conferido
  if (!/isPlatformAdmin/.test(g)) falhas.push("o guard não deixa o master puro passar");
  if (!/productionFeatures/.test(g)) falhas.push("o guard perdeu o fallback do legado da Produção");
}

// isenção que não vale mais é isenção esquecida
const sobrando = Object.keys(SO_NA_TELA).filter(
  (k) => !chaves.includes(k) || new RegExp(`RequireSubmodule\\("${k.replace(".", "\\.")}"\\)`).test(fontes),
);
for (const k of sobrando) falhas.push(`"${k}" está em SO_NA_TELA mas já é guardado (ou sumiu do menu) — apague a linha`);

console.log(`sub-módulos que a tela desliga: ${chaves.length}`);
console.log(`guardados também na API:        ${chaves.length - Object.keys(SO_NA_TELA).length}`);
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nFECHAR A TELA FECHA A API JUNTO");
