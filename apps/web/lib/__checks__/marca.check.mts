// ============================================================================
// Conferência da marca: o nome do produto anterior não pode reaparecer no que
// o usuário lê.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/marca.check.mts
//
// O sistema é white-label — nome, logo e cores vêm de `platform_settings`, que
// o master edita. Quando um nome fica cravado no código, ele vaza por cima
// dessa configuração: era o que fazia o mesmo sistema se apresentar com três
// nomes diferentes dependendo da tela (e mandar e-mail assinado por um quarto).
//
// A varredura cobre o web E a API, porque a API é quem manda e-mail, gera o
// PDF da fatura e nomeia o app autenticador no 2FA.
// ============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raiz = join(web, "..", "..");

const ALVOS = [
  join(web, "app"),
  join(web, "components"),
  join(web, "lib"),
  join(raiz, "apps", "api", "src"),
];

const PROIBIDO = /yugochat|yugo-platform|yugo-ponto/i;

/**
 * Identificadores TÉCNICOS que continuam válidos e não são lidos por ninguém
 * de fora: nome de pacote, classe de CSS, chave de localStorage, bucket, papel
 * do banco. Renomear estes quebraria coisa em produção sem melhorar nada.
 */
const PERMITIDO = [
  /@yugo\//,                    // nome dos pacotes do monorepo
  /MINIO_BUCKET_PRIVATE/,       // bucket que já existe com dados dentro
  /yugo-internal/,              // rede docker compartilhada, real
];

function walk(dir: string): string[] {
  let saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (nome === "node_modules" || nome === ".next" || nome === "dist") continue;
    if (statSync(p).isDirectory()) saida = saida.concat(walk(p));
    else if (/\.tsx?$/.test(p)) saida.push(p);
  }
  return saida;
}

const achados: string[] = [];
let arquivos = 0;

for (const alvo of ALVOS) {
  for (const arquivo of walk(alvo)) {
    arquivos++;
    const linhas = readFileSync(arquivo, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (!PROIBIDO.test(linha)) return;
      if (PERMITIDO.some((re) => re.test(linha))) return;
      achados.push(`${relative(raiz, arquivo)}:${i + 1}  ${linha.trim().slice(0, 100)}`);
    });
  }
}

console.log(`arquivos varridos: ${arquivos}`);
if (achados.length) {
  console.log(`\nFALHA — ${achados.length} ocorrência(s) do nome antigo:`);
  achados.forEach((a) => console.log("  " + a));
  console.log("\nUse PRODUCT_NAME (web) ou NORTY_SYSTEM_NAME (API). Se for identificador");
  console.log("técnico que precisa continuar, declare em PERMITIDO com o motivo.");
  process.exit(1);
}
console.log("\nUMA MARCA SÓ EM TODO O SISTEMA");
