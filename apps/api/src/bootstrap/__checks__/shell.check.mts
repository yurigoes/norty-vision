// ============================================================================
// Conferência da consulta única da casca (`shell.sql.ts`).
//
// Rodar:  node --experimental-strip-types apps/api/src/bootstrap/__checks__/shell.check.mts
//
// A consulta é SQL escrito à mão: ela não passa pelo Prisma, então nada avisa
// quando alguém renomeia uma coluna no schema ou muda a ordem dos CTEs. Estas
// três conferências cobrem exatamente o que dói:
//
//   1. Nome de coluna e apelido batem com o `schema.prisma` (senão a casca
//      volta com campo faltando, ou a consulta quebra em produção).
//   2. Toda tabela com RLS é lida pendurada em `ctx` — é o que garante que os
//      GUCs foram setados ANTES da leitura. Um `FROM tabela` solto voltaria
//      vazio.
//   3. A elevação pra platform admin acontece uma vez só, no CTE `adm`, e
//      depois dela só se lê o que já era lido elevado antes.
//
// Tudo por leitura de TEXTO, de propósito: assim roda sem banco, sem Prisma
// Client gerado e sem compilar o Nest.
// ============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "..", "..");
const sql = readFileSync(join(api, "src", "bootstrap", "shell.sql.ts"), "utf8");
const schema = readFileSync(join(api, "prisma", "schema.prisma"), "utf8");

const erros: string[] = [];

// ---------------------------------------------------------------------------
// 1. colunas × schema.prisma
// ---------------------------------------------------------------------------

/** { campoDoPrisma: colunaDoBanco } de um model. */
function modelo(nome: string): Record<string, string> {
  const m = schema.match(new RegExp(`^model ${nome} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!m) throw new Error(`model ${nome} não encontrado em schema.prisma`);
  const cols: Record<string, string> = {};
  for (const linha of m[1].split("\n")) {
    const t = linha.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const [campo, tipo] = t.split(/\s+/);
    if (!campo || !tipo) continue;
    const base = tipo.replace(/[?[\]]/g, "");
    if (!["String", "Int", "Boolean", "DateTime", "Json", "Float", "Decimal", "BigInt"].includes(base)) continue;
    if (tipo.endsWith("[]")) continue;
    const map = t.match(/@map\("([^"]+)"\)/);
    cols[campo] = map ? map[1] : campo;
  }
  return cols;
}

/**
 * Pares (coluna, apelido) do SQL. Pega tanto `col AS "apelido"` quanto
 * `${iso("col")} AS "apelido"` e `'apelido', p.col` do jsonb_build_object.
 */
function paresDoSql(trecho: string): Array<[string, string]> {
  const pares: Array<[string, string]> = [];
  const alias = /(?:\$\{iso\("([\w.]+)"\)\}|([\w.]+))\s+AS\s+"(\w+)"/g;
  for (const m of trecho.matchAll(alias)) pares.push([(m[1] ?? m[2]).split(".").pop()!, m[3]]);
  const build = /'(\w+)',\s*(?:\$\{iso\("([\w.]+)"\)\}|([\w.]+))/g;
  for (const m of trecho.matchAll(build)) pares.push([(m[2] ?? m[3]).split(".").pop()!, m[1]]);
  return pares;
}

/** Colunas sem apelido (`s0.slug, s0.name`) — nome do campo = nome da coluna. */
function simplesDoSql(trecho: string): string[] {
  const out: string[] = [];
  for (const linha of trecho.split("\n")) {
    const semAlias = linha.replace(/\$\{[^}]*\}/g, "").replace(/\S+\s+AS\s+"\w+"/g, "");
    for (const m of semAlias.matchAll(/(?:^|[\s(,])(?:\w+\.)?(\w+)\s*(?=,|$)/g)) out.push(m[1]);
  }
  return out;
}

function confereBloco(nomeConst: string, model: string, ignorar: string[] = []) {
  const bloco = sql.match(new RegExp(`const ${nomeConst} = \`([\\s\\S]*?)\`;`));
  if (!bloco) {
    erros.push(`bloco ${nomeConst} não encontrado em shell.sql.ts`);
    return;
  }
  const cols = modelo(model);
  const trecho = bloco[1];
  for (const [coluna, campo] of paresDoSql(trecho)) {
    if (ignorar.includes(campo)) continue;
    const esperada = cols[campo];
    if (!esperada) erros.push(`${nomeConst}: campo "${campo}" não existe no model ${model}`);
    else if (esperada !== coluna) {
      erros.push(`${nomeConst}: "${campo}" lê a coluna \`${coluna}\`, mas no ${model} é \`${esperada}\``);
    }
  }
  // blocos que são `jsonb_build_object` só têm pares explícitos — a varredura
  // de "coluna solta" não se aplica a eles
  const soPares = trecho.includes("jsonb_build_object");
  for (const campo of soPares ? [] : simplesDoSql(trecho)) {
    if (ignorar.includes(campo)) continue;
    if (!(campo in cols)) {
      erros.push(`${nomeConst}: coluna solta "${campo}" não existe no model ${model}`);
    } else if (cols[campo] !== campo) {
      erros.push(`${nomeConst}: "${campo}" precisa de apelido — no banco a coluna é \`${cols[campo]}\``);
    }
  }
}

confereBloco("ORG_COLS", "Organization");
confereBloco("STORE_COLS", "Store", ["organization"]);
confereBloco("SUB_COLS", "Subscription", ["plan"]);
confereBloco("PLAN_JSON", "Plan");

// ---------------------------------------------------------------------------
// 2. toda leitura com RLS pendurada em `ctx`
// ---------------------------------------------------------------------------

const corpo = sql.match(/export const SHELL_SQL = `([\s\S]*?)`;/)?.[1] ?? "";
if (!corpo) erros.push("SHELL_SQL não encontrado");

/** CTEs na ordem em que aparecem, com o corpo de cada um. */
const ctes: Array<{ nome: string; corpo: string }> = [];
{
  const re = /(?:^|,)\s*(\w+) AS MATERIALIZED \(/gm;
  const marcos = [...corpo.matchAll(re)];
  marcos.forEach((m, i) => {
    const ini = m.index! + m[0].length;
    const fim = i + 1 < marcos.length ? marcos[i + 1].index! : corpo.length;
    ctes.push({ nome: m[1], corpo: corpo.slice(ini, fim) });
  });
}

const semRls = new Set(["niches"]); // niches não tem RLS; entra por `org` mesmo assim
for (const cte of ctes) {
  if (cte.nome === "ctx") continue;
  const tabelas = [...cte.corpo.matchAll(/\bFROM\s+(\w+)/g)].map((m) => m[1]);
  const lidas = tabelas.filter((t) => !ctes.some((c) => c.nome === t) && !semRls.has(t));
  if (lidas.length === 0) continue;
  const dependeDeCtx = /FROM ctx, LATERAL/.test(cte.corpo);
  const dependeDeOutroCte = ctes.some((c) => c.nome !== cte.nome && new RegExp(`FROM ${c.nome}\\b`).test(cte.corpo));
  if (!dependeDeCtx && !dependeDeOutroCte) {
    erros.push(
      `CTE "${cte.nome}" lê ${lidas.join(", ")} sem depender de ctx — ` +
        `os GUCs do RLS podem não ter rodado ainda, e a consulta volta vazia`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. a elevação acontece uma vez, no lugar certo
// ---------------------------------------------------------------------------

const elevacoes = [...corpo.matchAll(/set_config\('app\.is_platform_admin',\s*'true'/g)];
if (elevacoes.length !== 1) {
  erros.push(`esperava 1 elevação a platform admin, achei ${elevacoes.length}`);
}
const adm = ctes.find((c) => c.nome === "adm");
if (!adm || !/set_config\('app\.is_platform_admin',\s*'true'/.test(adm.corpo)) {
  erros.push("a elevação precisa ficar no CTE `adm` (é o que garante que ela vem depois das leituras do usuário)");
}

/** Depois de `adm`, só estas tabelas — as mesmas que o código antigo já lia elevado. */
const permitidasDepois = new Set(["plans", "platform_integrations", "organizations"]);
const iAdm = ctes.findIndex((c) => c.nome === "adm");
for (const cte of ctes.slice(iAdm + 1)) {
  for (const m of cte.corpo.matchAll(/\bFROM\s+(\w+)/g)) {
    const t = m[1];
    if (ctes.some((c) => c.nome === t)) continue;
    if (!permitidasDepois.has(t)) {
      erros.push(`CTE "${cte.nome}" lê \`${t}\` depois da elevação — só ${[...permitidasDepois].join(", ")} podem`);
    }
  }
}

// ---------------------------------------------------------------------------

if (erros.length) {
  console.error("Consulta da casca com problema:\n");
  for (const e of erros) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(
  `Consulta da casca OK — ${ctes.length} CTEs, colunas conferidas contra o schema.prisma, ` +
    `RLS pendurado em ctx e elevação só no fim.`,
);
