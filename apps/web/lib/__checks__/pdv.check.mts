// ============================================================================
// Conferência do PDV: venda não sai a R$ 0,00 sem alguém ver.
//
// Rodar:  node --experimental-strip-types apps/web/lib/__checks__/pdv.check.mts
//
// O QUE ACONTECIA
//
// `priceFor()` no PDV termina em `?? 0`: produto sem preço na forma de
// pagamento escolhida entrava no carrinho a R$ 0,00. O carrinho mostrava só o
// subtotal da linha (`0× nome ... R$ 0,00`), não havia como editar o valor, e
// a venda fechava de graça — sem aviso, sem rastro, e sem jeito de corrigir no
// balcão. No cadastro, só `Nome` é obrigatório, então chegar nessa situação
// custava três segundos.
//
// O `?? 0` não é o defeito: fallback pra zero é razoável quando a forma de
// pagamento não tem preço próprio (cai no à vista, e se nem esse existe, zero).
// O defeito era o zero ser INVISÍVEL e IRREPARÁVEL na tela.
//
// POR QUE ESTA CONFERÊNCIA É ESTREITA, de propósito
//
// Ela olha dois arquivos, não um padrão do sistema todo. É mais perto de um
// teste que das outras conferências daqui — e está aqui mesmo assim porque o
// que ela protege é dinheiro saindo errado, e porque as três peças (editar,
// avisar, não sobrescrever) são fáceis de remover uma por vez numa refatoração
// sem ninguém notar que as outras duas ficaram sem sentido.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pdv = readFileSync(join(web, "app", "app", "vendas", "SalesClient.tsx"), "utf8");
const prod = readFileSync(join(web, "app", "app", "produtos", "ProductsClient.tsx"), "utf8");

const falhas: string[] = [];
const exige = (ok: boolean, msg: string) => { if (!ok) falhas.push(msg); };

// --- 1. o carrinho deixa corrigir o preço unitário --------------------------
exige(
  /aria-label=\{`Preço unitário de/.test(pdv),
  "o carrinho do PDV não tem mais campo de preço unitário editável — item a R$ 0,00 " +
    "volta a ser impossível de corrigir no balcão",
);

// --- 2. e avisa quando há item a zero ---------------------------------------
exige(
  /unitPriceCents <= 0/.test(pdv) && /sem preço no carrinho/i.test(pdv),
  "o PDV não avisa mais sobre item sem preço no carrinho — a venda volta a poder " +
    "fechar a R$ 0,00 em silêncio",
);

// --- 3. trocar a forma de pagamento não apaga o preço digitado --------------
// Sem isto o recálculo de `updateMethod` sobrescreve o que a pessoa digitou, e
// o item volta a zero depois de ter sido corrigido — pior que nunca ter tido
// o campo, porque a pessoa já acha que resolveu.
exige(
  /precoManual/.test(pdv) && /if \(it\.precoManual\) return it;/.test(pdv),
  "`updateMethod` voltou a recalcular TODOS os itens: o preço digitado a mão é " +
    "apagado ao trocar a forma de pagamento",
);

// --- 4. o cadastro confirma antes de salvar produto sem preço ---------------
exige(
  /Sem preço à vista/.test(prod) && /Salvar sem preço/.test(prod),
  "o cadastro de produto não confirma mais antes de salvar sem preço à vista",
);

// --- 5. e a lista marca quem está sem preço --------------------------------
exige(
  /sem preço<\/span>/.test(prod),
  "a lista de produtos não marca mais os produtos sem preço — eles voltam a ser " +
    "indistinguíveis dos vendáveis",
);

// --- 6. as três travas usam a MESMA régua ----------------------------------
// `== null` deixaria passar o produto salvo com 0,00 explícito: sem marca na
// lista, mas vermelho no carrinho. Régua diferente nos dois lados é como o
// abono parcial do ponto divergiu — nome/condição diferente pro mesmo conceito.
exige(
  !/priceCashCents == null\s*$/m.test(prod.split("\n").filter((l) => l.includes("sem preço")).join("\n")),
  "a marca de 'sem preço' na lista usa `== null`, e o PDV usa `<= 0`: produto " +
    "salvo com 0,00 explícito fica sem marca e vermelho no carrinho",
);

if (falhas.length) {
  console.error(`\n✖ PDV: a proteção contra venda a R$ 0,00 foi removida\n`);
  for (const f of falhas) console.error(`  • ${f}`);
  console.error("");
  process.exit(1);
}
console.log("✔ PDV: item sem preço é visível, editável, e sobrevive à troca de forma de pagamento");
