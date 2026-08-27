// ============================================================================
// Conferência do porteiro da EMPRESA: rota de empresa exige empresa.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/empresa.check.mts
//
// O que estava acontecendo, medido: o master logado no painel do SaaS, SEM ter
// entrado em empresa nenhuma, chamava `GET /api/customers` e recebia
//
//     121 clientes de 2 empresas — Acme e Zito — na mesma lista
//
// O RLS abre tudo pro platform admin (é o que faz o painel funcionar), então
// sem `orgId` a consulta simplesmente não tinha por onde filtrar. Efeito
// colateral: a IMPERSONAÇÃO, que é o caminho auditado no `platform_audit`,
// virava opcional — dava pra ler dado de cliente sem deixar rastro.
//
// Hoje o padrão é o contrário: sem empresa, rota de empresa responde 403. As
// telas do painel do SaaS que realmente precisam são marcadas uma a uma com
// `@SemEmpresa()` — 113 rotas deixaram de responder, 29 seguiram respondendo.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(api, "src");
const falhas: string[] = [];

// 1. o porteiro existe no guard, e nega por padrão
const guard = readFileSync(join(src, "auth", "auth.guard.ts"), "utf8");
if (!/isPlatformAdmin\s*&&\s*!req\.yugo\.orgId/.test(guard)) {
  falhas.push(
    "auth.guard.ts não barra mais o master SEM empresa numa rota de empresa — " +
      "`GET /api/customers` volta a misturar clientes de empresas diferentes numa lista só",
  );
}
if (!/ALLOW_SEM_EMPRESA_KEY/.test(guard)) {
  falhas.push("auth.guard.ts não lê mais o `@SemEmpresa()` — ou o porteiro some, ou o painel do SaaS quebra inteiro");
}
// a ordem importa: o porteiro tem que vir DEPOIS das saídas de plataforma
// (`@Public`, `@RequirePlatformOwner`, `@RequirePlatformAdmin`), senão ele
// barra o próprio painel do master.
const iPorteiro = guard.indexOf("isPlatformAdmin && !req.yugo.orgId");
for (const [chave, nome] of [
  ["IS_PUBLIC_KEY", "@Public()"],
  ["REQUIRE_PLATFORM_OWNER_KEY", "@RequirePlatformOwner()"],
  ["REQUIRE_PLATFORM_ADMIN_KEY", "@RequirePlatformAdmin()"],
] as const) {
  const i = guard.indexOf(`getAllAndOverride<boolean>(\n      ${chave}`);
  const j = guard.indexOf(chave, guard.indexOf("canActivate"));
  const pos = i > -1 ? i : j;
  if (pos > -1 && iPorteiro > -1 && pos > iPorteiro) {
    falhas.push(`o porteiro da empresa vem ANTES de ${nome} — ele barraria o próprio painel do master`);
  }
}

// 2. o decorador existe e diz pra que serve
const dec = readFileSync(join(src, "auth", "decorators.ts"), "utf8");
if (!/export const SemEmpresa\b/.test(dec)) {
  falhas.push("decorators.ts perdeu o `@SemEmpresa()` — as telas do painel do SaaS não têm como se declarar");
}

// 3. `@SemEmpresa()` é exceção, não regra: se virar rotina, o porteiro morreu
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return p.endsWith(".controller.ts") ? [p] : [];
  });
}
const controllers = arquivos(src);
const marcados: string[] = [];
for (const f of controllers) {
  const s = readFileSync(f, "utf8");
  const n = (s.match(/@SemEmpresa\(\)/g) ?? []).length;
  if (n) marcados.push(`${relative(src, f).replace(/\\/g, "/")} (${n})`);
}
const total = marcados.reduce((a, m) => a + Number(m.match(/\((\d+)\)$/)![1]), 0);
const TETO = 40;
if (total > TETO) {
  falhas.push(
    `${total} rotas marcadas com @SemEmpresa() (teto ${TETO}). Marcar por reflexo desfaz o porteiro: ` +
      "cada marca é uma rota que o master lê SEM entrar na empresa e SEM deixar rastro. " +
      "Rota exclusiva do master é `@RequirePlatformAdmin()`, não `@SemEmpresa()`.",
  );
}

// 4. as rotas de dado de cliente NÃO podem estar marcadas
const PROIBIDOS = ["customers", "sales", "quotes", "credit", "production", "payables", "receivables", "payments", "optical"];
for (const f of controllers) {
  const rel = relative(src, f).replace(/\\/g, "/");
  if (!PROIBIDOS.some((p) => rel.startsWith(p + "/"))) continue;
  if (/@SemEmpresa\(\)/.test(readFileSync(f, "utf8"))) {
    falhas.push(`${rel} está marcado com @SemEmpresa() — é exatamente o dado que vazava entre empresas`);
  }
}

console.log(`porteiro da empresa conferido — ${total} rota(s) marcadas com @SemEmpresa():`);
marcados.sort().forEach((m) => console.log("  " + m));
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nSEM EMPRESA, ROTA DE EMPRESA NÃO RESPONDE (E O PAINEL DO SAAS SEGUE DE PÉ)");
