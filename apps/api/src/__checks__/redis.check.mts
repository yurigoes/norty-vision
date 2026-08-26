// ============================================================================
// Conferência do Redis: cair não pode virar "ficar lento pra sempre".
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/redis.check.mts
//
// O combinado é que o Redis é ATALHO, não fonte da verdade: se cair, o sistema
// segue direto no banco. Medido com ele derrubado, o que acontecia era:
//
//   com Redis de pé:   24ms · 21ms · 37ms
//   com Redis fora:  7533ms · 15326ms · 22220ms · 24034ms   ← crescendo
//
// Respondia 200 — em 24 segundos. A culpa era do `enableOfflineQueue`, ligado
// por padrão no ioredis: comando enviado com a conexão caída não falha, entra
// numa fila esperando reconexão, e o `retryStrategy` padrão espera cada vez
// mais. Cada requisição esperava mais que a anterior.
//
// E tem uma exceção que precisa continuar sendo exceção: o COFRE. Lá, "não
// consegui falar com o Redis" tem que significar TRANCADO, não destravado.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(api, "src");
const falhas: string[] = [];

// 1. o cliente falha rápido
const cliente = readFileSync(join(src, "redis", "redis.service.ts"), "utf8");
if (!/enableOfflineQueue:\s*false/.test(cliente)) {
  falhas.push(
    "redis.service.ts sem `enableOfflineQueue: false` — comando com a conexão caída volta a " +
      "ficar na fila, e a requisição espera a reconexão (foram 24s medidos)",
  );
}
if (!/commandTimeout:\s*\d+/.test(cliente)) {
  falhas.push("redis.service.ts sem `commandTimeout` — conexão pendurada segura a requisição");
}
if (!/maxRetriesPerRequest:\s*[01]\b/.test(cliente)) {
  falhas.push("redis.service.ts com retentativas demais por comando: cache é atalho, não fonte da verdade");
}
if (!/retryStrategy/.test(cliente)) {
  falhas.push("redis.service.ts sem `retryStrategy` — o cliente para de tentar voltar");
}
if (!/\.on\("error"/.test(cliente)) {
  falhas.push("redis.service.ts sem ouvinte de `error` — no ioredis isso derruba o processo");
}

// 2. todo uso do cliente tolera a queda... menos o cofre, que tranca
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return p.endsWith(".ts") && !p.endsWith(".check.mts") ? [p] : [];
  });
}

for (const f of arquivos(src)) {
  if (f.includes("redis.service") || f.includes("__checks__")) continue;
  const s = readFileSync(f, "utf8");
  const rel = relative(src, f).replace(/\\/g, "/");
  for (const m of s.matchAll(/redis\.client\.(\w+)\(/g)) {
    const antes = s.slice(Math.max(0, m.index! - 600), m.index!);
    const depois = s.slice(m.index!, m.index! + 400);
    const protegido =
      /try\s*\{/.test(antes.split(/\basync\s|\bfunction\s/).pop() ?? "") ||
      /\.catch\(/.test(depois) ||
      /allSettled/.test(antes.slice(-200));
    if (!protegido) {
      falhas.push(
        `${rel}: \`redis.client.${m[1]}()\` sem tratamento — com o Redis fora isto agora ESTOURA ` +
          "(o cliente falha rápido de propósito). Trate indo ao banco, ou trancando, conforme o caso.",
      );
    }
  }
}

// 3. o cofre falha FECHADO — a direção contrária ao resto
const cofre = readFileSync(join(src, "vault", "vault.service.ts"), "utf8");
const corpoIsUnlocked = cofre.match(/async isUnlocked[\s\S]*?\n  \}/)?.[0] ?? "";
if (!/catch/.test(corpoIsUnlocked) || !/return false/.test(corpoIsUnlocked)) {
  falhas.push(
    "vault.service.ts: `isUnlocked` precisa devolver FALSE quando o Redis falha. " +
      "Falhar aberto aqui entrega senha de integração toda vez que o cache piscar.",
  );
}
if (/async isUnlocked[\s\S]*?return true/.test(corpoIsUnlocked)) {
  falhas.push("vault.service.ts: `isUnlocked` devolve true em algum caminho de erro — é o cofre destrancando sozinho");
}

console.log("cliente do Redis e seus usos conferidos");
if (falhas.length) {
  console.log(`\nFALHA — ${falhas.length} problema(s):`);
  falhas.forEach((f) => console.log("  " + f));
  process.exit(1);
}
console.log("\nREDIS FORA DO AR = VAI AO BANCO NA HORA (E O COFRE CONTINUA TRANCADO)");
