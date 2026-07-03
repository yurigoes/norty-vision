#!/usr/bin/env node
/**
 * Auditoria de sincronia de permissões.
 *
 * Cruza o PERMISSION_CATALOG (users.service.ts) com o uso real no código:
 *  - @RequirePermission("x")  (decorator de rota)
 *  - ctxCan(ctx, "x")         (check no service)
 *  - can("x") / hasPermission("x")  (front)
 *
 * Reporta 2 categorias que causam o bug "ligo a permissão e não faz nada"
 * ou "não tem opção pra bloquear":
 *  1) USADA mas AUSENTE do catálogo → o master não vê toggle pra ela.
 *  2) NO catálogo mas CHECADA EM LUGAR NENHUM → toggle existe mas não faz nada.
 *
 * Uso:
 *   node scripts/audit-permissions.mjs          # só reporta
 *   node scripts/audit-permissions.mjs --strict # sai 1 se houver categoria (1) — pra CI
 *
 * NOTA: categoria (2) é informativa (algumas permissões são "reservadas" pra
 * features futuras). O --strict só falha na (1), que é bug certo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

function readCatalog() {
  const src = fs.readFileSync(path.join(ROOT, "apps/api/src/users/users.service.ts"), "utf8");
  const start = src.indexOf("PERMISSION_CATALOG");
  const seg = src.slice(start, src.indexOf("];", start));
  // ignora ocorrências em comentário (linhas com // ou *)
  const keys = [];
  for (const line of seg.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    const m = trimmed.match(/key:\s*"([^"]+)"/);
    if (m) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

function collectChecked() {
  const checked = new Set();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const t = fs.readFileSync(p, "utf8");
      for (const line of t.split("\n")) {
        // ignora comentários pra não pegar exemplos
        const tr = line.trim();
        if (tr.startsWith("//") || tr.startsWith("*")) continue;
        for (const m of line.matchAll(/@RequirePermission\("([^"]+)"\)/g)) checked.add(m[1]);
        for (const m of line.matchAll(/ctxCan\([^,]+,\s*"([^"]+)"/g)) checked.add(m[1]);
        for (const m of line.matchAll(/\bcan\(\s*"([^"]+)"/g)) checked.add(m[1]);
        for (const m of line.matchAll(/hasPermission\(\s*"([^"]+)"/g)) checked.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, "apps/api/src"));
  walk(path.join(ROOT, "apps/web"));
  return checked;
}

const catalog = readCatalog();
const checked = collectChecked();

const usedNotInCatalog = [...checked].filter((k) => !catalog.includes(k) && /\./.test(k)).sort();
const catalogNotChecked = catalog.filter((k) => !checked.has(k)).sort();

console.log(`Catálogo: ${catalog.length} permissões  ·  Checadas no código: ${[...checked].filter((k) => catalog.includes(k)).length}`);

console.log("\n[1] USADAS mas AUSENTES do catálogo (master não consegue ligar/desligar) — BUG:");
console.log(usedNotInCatalog.length ? usedNotInCatalog.map((k) => "  - " + k).join("\n") : "  (nenhuma ✅)");

console.log("\n[2] NO catálogo mas checadas em LUGAR NENHUM (toggle não faz nada) — revisar:");
console.log(catalogNotChecked.length ? catalogNotChecked.map((k) => "  - " + k).join("\n") : "  (nenhuma ✅)");

if (strict && usedNotInCatalog.length) {
  console.error(`\n✗ FALHA: ${usedNotInCatalog.length} permissão(ões) usada(s) sem entrada no catálogo.`);
  process.exit(1);
}
console.log("\n✓ Auditoria concluída.");
