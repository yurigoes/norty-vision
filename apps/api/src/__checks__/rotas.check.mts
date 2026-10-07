// ============================================================================
// Conferência de ROTA DUPLICADA: duas declarações do mesmo método+caminho
// derrubam a API no boot, não na requisição.
//
// Rodar:  node --experimental-strip-types apps/api/src/__checks__/rotas.check.mts
//
// O QUE ACONTECEU, medido em produção
//
// O porte do ponto trouxe do RH um `@Controller()` na raiz que declarava
// `@Get("stores")`, `@Post("stores")` e `@Post("stores/:id")`. No RH isso fazia
// sentido: não havia módulo de lojas. No Vision há — `@Controller("stores")`,
// com permissão e validação. Resultado no deploy:
//
//     bootstrap failed FastifyError: Method 'GET' already declared
//     for route '/api/stores'            code: FST_ERR_DUPLICATED_ROUTE
//
// E o detalhe que faz esta conferência valer: `tsc --noEmit`, `nest build` e
// `next build` passaram todos. Rota duplicada não é erro de tipo nem de
// compilação — o Fastify só descobre quando REGISTRA a rota, no boot. Então
// passou por todo o portão de qualidade, subiu, e a API entrou em laço de
// reinício com o site fora do ar. O healthcheck só sabia dizer "unhealthy".
//
// A duplicata some do código, mas o jeito de reintroduzi-la não: é só alguém
// portar outro controller de raiz. Daí o arquivo.
//
// COMO ELE LÊ AS ROTAS
//
// Por texto, não por reflexão: carregar o AppModule exigiria banco e Redis de
// pé, e uma conferência que precisa de infraestrutura não roda no `npm run
// check`. Lê-se `@Controller(...)` e os `@Get/@Post/@Patch/@Put/@Delete/@All`
// de cada arquivo e monta-se o caminho como o Nest monta.
//
// Parâmetro é normalizado: pro Fastify, `/stores/:id` e `/stores/:slug` são a
// MESMA rota (ele casa por posição, não por nome) — e colidem igual.
// ============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = join(api, "src");

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (nome === "node_modules" || nome === "__checks__") continue;
      arquivos(p, achados);
    } else if (nome.endsWith(".ts")) achados.push(p);
  }
  return achados;
}

const METODOS = ["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"] as const;

type Rota = { metodo: string; caminho: string; arquivo: string; linha: number; cru: string };

/** Junta prefixo e sufixo como o Nest junta, e normaliza pro olhar do Fastify. */
function monta(prefixo: string, sufixo: string): string {
  const partes = [prefixo, sufixo]
    .flatMap((s) => s.split("/"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return "/" + partes.join("/");
}
/** `:id` e `:slug` são a mesma rota pro Fastify — ele casa por posição. */
function normaliza(caminho: string): string {
  return caminho.replace(/:[A-Za-z0-9_]+/g, ":p").replace(/\/+$/, "") || "/";
}

const rotas: Rota[] = [];

for (const arquivo of arquivos(src)) {
  const texto = readFileSync(arquivo, "utf8");
  if (!/@Controller\s*\(/.test(texto)) continue;
  // Comentário fora, ANTES de ler decorator. A primeira versão desta
  // conferência acusou `GET /organizations/:id` duas vezes porque o JSDoc de
  // `publicBySlug` diz, em texto, "não colide com @Get(\":id\")". Conferência
  // que grita no lugar errado é pior que conferência nenhuma: ensina a ignorar.
  // As linhas não são removidas, são esvaziadas, pra o número da linha no
  // relatório continuar apontando pro lugar certo do arquivo.
  const linhas = texto
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? "" : l));

  // Um arquivo pode ter mais de um @Controller. O prefixo vigente é o do
  // último @Controller visto acima da linha atual.
  let prefixo: string | null = null;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;

    const ctrl = l.match(/@Controller\s*\(\s*(?:["'`]([^"'`]*)["'`])?/);
    if (ctrl) { prefixo = ctrl[1] ?? ""; continue; }
    if (prefixo === null) continue;

    for (const m of METODOS) {
      // pega @Get(), @Get("x"), @Get("x/:id") — e ignora @Get dentro de string
      const re = new RegExp(`@${m}\\s*\\(\\s*(?:["'\`]([^"'\`]*)["'\`])?\\s*\\)`);
      const hit = l.match(re);
      if (!hit) continue;
      const caminho = monta(prefixo, hit[1] ?? "");
      rotas.push({
        metodo: m.toUpperCase(),
        caminho: normaliza(caminho),
        arquivo: relative(api, arquivo),
        linha: i + 1,
        cru: caminho,
      });
      break;
    }
  }
}

const falhas: string[] = [];

if (rotas.length < 300) {
  falhas.push(
    `só achei ${rotas.length} rotas lendo os controllers — eram 400+ quando esta ` +
      "conferência foi escrita. Se o jeito de declarar rota mudou, esta leitura " +
      "cegou e para de pegar duplicata: conserte o parser, não baixe o número.",
  );
}

// --- o que derruba o boot: mesmo método, mesmo caminho ----------------------
const porChave = new Map<string, Rota[]>();
for (const r of rotas) {
  const chave = `${r.metodo} ${r.caminho}`;
  (porChave.get(chave) ?? porChave.set(chave, []).get(chave)!).push(r);
}
for (const [chave, lista] of porChave) {
  if (lista.length < 2) continue;
  falhas.push(
    `${chave} declarada ${lista.length}x — o Fastify derruba a API no boot ` +
      `(FST_ERR_DUPLICATED_ROUTE), sem subir nada:\n` +
      lista.map((r) => `        ${r.arquivo}:${r.linha}  (${r.cru})`).join("\n"),
  );
}

// --- @All colide com TODOS os métodos do mesmo caminho ----------------------
// Só o caminho é igual; o método não precisa casar.
for (const a of rotas.filter((r) => r.metodo === "ALL")) {
  for (const outra of rotas) {
    if (outra === a || outra.caminho !== a.caminho) continue;
    falhas.push(
      `@All em ${a.caminho} (${a.arquivo}:${a.linha}) colide com ` +
        `${outra.metodo} no mesmo caminho (${outra.arquivo}:${outra.linha}) — ` +
        "@All registra todos os métodos, inclusive esse",
    );
  }
}

if (falhas.length) {
  console.error(`\n✖ rota duplicada — a API NÃO SOBE assim (${rotas.length} rotas lidas)\n`);
  for (const f of falhas) console.error(`  • ${f}`);
  console.error(
    "\n  Isto não aparece em tsc, nest build nem next build: o Fastify só\n" +
      "  descobre quando registra a rota, no boot. Em produção o sintoma é a\n" +
      "  API em laço de reinício e o container 'unhealthy'.\n",
  );
  process.exit(1);
}

console.log(`✔ rotas: ${rotas.length} lidas, nenhuma duplicada`);
