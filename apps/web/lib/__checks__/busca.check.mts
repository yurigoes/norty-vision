// ============================================================================
// Conferência da busca: quem procura no navegador só acha o que já baixou.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/busca.check.mts
//
// A tela de Clientes trazia 300 de 3.000 e filtrava esses 300 na memória; a de
// Produtos trazia 500 de 2.000. Digitar o nome de alguém fora do pedaço devolvia
// "nenhum resultado" — uma resposta ERRADA, não vazia. O conserto é perguntar ao
// servidor (`lib/useListaServidor.ts`), que procura no banco inteiro.
//
// Esta conferência acha todo filtro de TEXTO feito na memória (um `.filter(`
// cujo corpo compara com `toLowerCase()` + `includes(`) e exige que a tela ou
// use o hook, ou esteja declarada aqui embaixo COM O MOTIVO — pra que continuar
// filtrando na memória seja decisão registrada, não esquecimento.
// ============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raiz = join(web, "app", "app");

/** Telas que PODEM filtrar texto na memória, e por quê. */
const ISENTAS: Record<string, string> = {
  "ponto/page.tsx":
    "lista de funcionários da empresa, vem inteira de /api/ponto/employees — não há pedaço pra ficar de fora",
  "voip/VoipClient.tsx":
    "ramais do PABX, uma dúzia de linhas carregadas inteiras",
  "vendas/SalesClient.tsx":
    "fila do PDV: produtos e clientes (limit=300) ainda são filtrados na memória — dívida conhecida, entra na paginação de verdade",
  "atendimento/AtendimentoClient.tsx":
    "mesmo caso do PDV: o seletor de produtos filtra o que a tela já baixou — dívida conhecida",
  "pedidos-lente/LensOrdersClient.tsx":
    "mesmo caso do PDV: clientes (limit=300) filtrados na memória — dívida conhecida",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/** Do `.filter(` até o parêntese que o fecha — o corpo do filtro, e só ele. */
function corpoDoFilter(src: string, i: number): string {
  let nivel = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "(") nivel++;
    else if (c === ")") {
      nivel--;
      if (nivel === 0) return src.slice(i, j + 1);
    }
  }
  return src.slice(i, i + 1500); // não fechou: olha um pedaço generoso
}

const naMemoria: string[] = [];
const usadas = new Set<string>();
let comHook = 0;
let isentas = 0;

for (const arquivo of walk(raiz)) {
  const src = readFileSync(arquivo, "utf8");
  const rel = relative(raiz, arquivo).replace(/\\/g, "/");

  const achados: string[] = [];
  for (let i = src.indexOf(".filter("); i !== -1; i = src.indexOf(".filter(", i + 1)) {
    const corpo = corpoDoFilter(src, i + ".filter".length);
    if (corpo.includes("toLowerCase()") && corpo.includes("includes(")) {
      achados.push(`linha ${src.slice(0, i).split("\n").length}`);
    }
  }
  if (!achados.length) continue;

  // a isenção vem primeiro de propósito: uma tela pode ter a busca principal no
  // servidor E ainda filtrar outra lista na memória (o PDV faz isso com o
  // seletor de produtos) — usar o hook não dá perdão pro resto do arquivo
  if (ISENTAS[rel]) {
    isentas += achados.length;
    usadas.add(rel);
    continue;
  }
  if (src.includes("useListaServidor")) continue; // a busca já é do servidor
  naMemoria.push(`${rel}  (${achados.join(", ")})`);
}

// A outra metade: quem usa o hook tem que usar de verdade — o resultado da
// busca precisa ir pra tela, não ficar num canto enquanto a lista antiga rende.
const semUsar: string[] = [];
for (const arquivo of walk(raiz)) {
  const src = readFileSync(arquivo, "utf8");
  if (!/useListaServidor\s*[<(]/.test(src)) continue;
  const rel = relative(raiz, arquivo).replace(/\\/g, "/");
  const comBusca = !/buscavel:\s*false/.test(src);
  if (!/\.itens\b/.test(src)) {
    semUsar.push(`${rel} — chama o hook mas nunca lê \`.itens\``);
  } else if (comBusca && !/doServidor/.test(src)) {
    semUsar.push(`${rel} — busca no servidor mas não avisa na tela de onde veio o resultado`);
  } else if (!/<CarregarMais\b/.test(src)) {
    // sem isto o usuário continua sem saber que existe mais do que está vendo:
    // era exatamente o teto silencioso
    semUsar.push(`${rel} — carrega do servidor mas não mostra o total nem o "carregar mais"`);
  } else {
    comHook++;
  }
}

// Isenção que não vale mais é isenção esquecida: some com ela.
const sobrando = Object.keys(ISENTAS).filter((k) => !usadas.has(k));

console.log(`telas que perguntam ao servidor:      ${comHook}`);
console.log(`filtros na memória isentos (com motivo): ${isentas}`);

if (sobrando.length) {
  console.log(`\nFALHA — ${sobrando.length} isenção(ões) que não valem mais (a tela não filtra mais texto na memória):`);
  sobrando.forEach((t) => console.log("  " + t));
  console.log("\nApague a linha correspondente neste arquivo.");
  process.exit(1);
}

if (naMemoria.length || semUsar.length) {
  if (naMemoria.length) {
    console.log(`\nFALHA — ${naMemoria.length} tela(s) filtrando texto na memória, sem motivo declarado:`);
    naMemoria.forEach((t) => console.log("  " + t));
    console.log("\nUse `useListaServidor` (lib/useListaServidor.ts), ou declare a exceção com o motivo neste arquivo.");
  }
  if (semUsar.length) {
    console.log(`\nFALHA — ${semUsar.length} tela(s) usando o hook pela metade:`);
    semUsar.forEach((t) => console.log("  " + t));
  }
  process.exit(1);
}
console.log("\nNENHUMA TELA PROCURA SÓ NO PEDAÇO QUE BAIXOU — SEM MOTIVO ESCRITO");
