// ============================================================================
// Conferência do cache de sessão: quem MUDA o que o cache guarda tem que
// APAGAR o que o cache guarda.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/cache.check.mts
//
// O TTL do cache é de minutos, não de segundos — e isso só é seguro porque
// toda mudança de papel, permissão ou vínculo derruba a sessão na hora. Um
// método novo que mexa em `memberships` ou `roles` e esqueça de apagar volta o
// sistema ao problema que o TTL curto escondia: permissão velha valendo.
//
// Quando a escrita de fato NÃO mexe no que o guard guarda (o apelido no inbox,
// a comissão do vendedor, um membership de usuário recém-criado), marque com
// `// cache-ok: <motivo>` na linha ou logo acima dela — a conferência aceita, e
// o motivo fica escrito ali para o próximo que passar.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..");

/** Escritas que mexem no contexto que o guard guarda em cache. */
const ESCRITAS = [
  /tx\.membership\.(update|create|updateMany|delete)\b/,
  /tx\.role\.(update|delete)\b/,
  /tx\.session\.updateMany\b/,
  /tx\.platformSession\.(update|updateMany)\b/,
  /tx\.platformUser\.update\b/,
];

/** O que conta como "apagou". */
const APAGA = /this\.cache\.(drop|dropByUser|dropByRole|dropMaster|dropMasterByUser)\b/;

/** Assinatura de método de classe (2 espaços de indentação). */
const METODO = /^ {2}(?:private |public |protected )?(?:readonly )?(?:async )?([a-zA-Z_]\w*)\s*[(<]/;

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "__checks__") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) out.push(...arquivos(caminho));
    else if (nome.endsWith(".ts") && !nome.endsWith(".d.ts")) out.push(caminho);
  }
  return out;
}

interface Metodo {
  nome: string;
  linhaInicio: number;
  linhas: string[];
  escritas: Array<{ linha: number; texto: string }>;
}

function metodos(texto: string): Metodo[] {
  const out: Metodo[] = [];
  let atual: Metodo | null = null;
  texto.split("\n").forEach((linha, i) => {
    const m = METODO.exec(linha);
    if (m) {
      atual = { nome: m[1], linhaInicio: i + 1, linhas: [], escritas: [] };
      out.push(atual);
    }
    if (!atual) return;
    atual.linhas.push(linha);
    if (ESCRITAS.some((re) => re.test(linha))) {
      atual.escritas.push({ linha: i + 1, texto: linha.trim() });
    }
  });
  return out;
}

const erros: string[] = [];
let escritas = 0;
let dispensadas = 0;

for (const caminho of arquivos(src)) {
  const texto = readFileSync(caminho, "utf8");
  if (!ESCRITAS.some((re) => re.test(texto))) continue;
  const linhas = texto.split("\n");
  const relativo = caminho.slice(src.length + 1);

  for (const metodo of metodos(texto)) {
    if (metodo.escritas.length === 0) continue;
    const apaga = metodo.linhas.some((l) => APAGA.test(l));

    for (const escrita of metodo.escritas) {
      escritas++;
      // dispensa explícita: na própria linha ou nas três de cima (dá pra
      // escrever o motivo em duas linhas, e às vezes há um `.runWithContext(`
      // no meio)
      const acima = linhas.slice(Math.max(0, escrita.linha - 4), escrita.linha - 1).join("\n");
      const dispensa = /\/\/ cache-ok:/.test(escrita.texto) || /\/\/ cache-ok:/.test(acima);
      if (dispensa) {
        dispensadas++;
        continue;
      }
      if (!apaga) {
        erros.push(
          `${relativo}:${escrita.linha} — \`${metodo.nome}()\` muda o contexto e não apaga o cache.\n` +
            `      ${escrita.texto}\n` +
            `      Chame \`this.cache.dropByUser(...)\` / \`dropByRole(...)\` — ou marque com ` +
            `\`// cache-ok: <motivo>\` se de fato não mexe no que o guard guarda.`,
        );
      }
    }
  }
}

if (erros.length) {
  console.error("Escrita que muda a sessão sem limpar o cache:\n");
  for (const e of erros) console.error(`  ✗ ${e}\n`);
  process.exit(1);
}
console.log(
  `Cache de sessão OK — ${escritas} escritas que mexem no contexto, ` +
    `${escritas - dispensadas} apagam o cache, ${dispensadas} dispensadas com motivo escrito.`,
);
