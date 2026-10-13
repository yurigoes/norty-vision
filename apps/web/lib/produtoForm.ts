/**
 * O FORMULÁRIO DE PRODUTO, A PARTE QUE DÁ PRA CONFERIR
 * ============================================================================
 * Ler o preço que a pessoa digitou, validar contra os limites da API e traduzir
 * o 400 — três coisas que estavam dentro do componente e por isso não dava pra
 * testar sem subir o Next. Aqui são funções puras, e
 * `lib/__checks__/produtoForm.check.mts` roda em cima delas no `npm run check`.
 *
 * Mesma razão do `lib/acesso.ts`: quem decide uma regra de negócio não devia
 * morar dentro de um `.tsx` de 900 linhas.
 */

/**
 * PREÇO DIGITADO COMO BRASILEIRO.
 * ============================================================================
 * O parser antigo era `.replace(",", ".")` — UMA vírgula, e só. Medido:
 *
 *   "1.299,90"  -> null   (a tela dizia SEM PREÇO pra um preço preenchido)
 *   "1.000,00"  -> null   (idem)
 *   "R$ 199,00" -> null   (idem)
 *   "1.299"     -> 130    ← R$ 1,30. UM PRODUTO DE R$ 1.299 VENDIDO A R$ 1,30.
 *
 * O último é o grave: não dá erro, não avisa, e o PDV vende. Era exatamente o
 * defeito que o "fim da venda a R$ 0,00" veio evitar, entrando por outra porta.
 *
 * Agora: tira tudo que não é dígito/vírgula/ponto/menos e decide o separador.
 *   ponto E vírgula   -> ponto é milhar       ("1.299,90" -> 1299.90)
 *   só vírgula        -> vírgula é decimal    ("1299,90"  -> 1299.90)
 *   só ponto, 3 casas -> ponto é milhar       ("1.299"    -> 1299)
 *   só ponto, outras  -> ponto é decimal      ("19.90"    -> 19.90)
 *
 * A regra das 3 casas é a convenção que o brasileiro usa ao digitar, e é o que
 * desfaz o R$ 1,30. `NaN` = digitou algo que não é número: quem valida acusa,
 * em vez de virar `null` silencioso.
 */
export function numeroBr(v: FormDataEntryValue | null): number | null {
  const bruto = String(v ?? "").replace(/[^\d.,-]/g, "");
  if (!bruto) return null;
  const temPonto = bruto.includes(".");
  const temVirgula = bruto.includes(",");
  let s: string;
  if (temPonto && temVirgula) s = bruto.replace(/\./g, "").replace(",", ".");
  else if (temVirgula) s = bruto.replace(/\./g, "").replace(",", ".");
  else if (temPonto && /\.\d{3}$/.test(bruto)) s = bruto.replace(/\./g, "");
  else s = bruto;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
export function toCents(v: FormDataEntryValue | null): number | null {
  const n = numeroBr(v);
  if (n === null) return null;
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
/** inteiro (estoque, parcelas) ou percentual — mesma leitura, sem os centavos */
export function toNum(v: FormDataEntryValue | null): number | null {
  return numeroBr(v);
}

/** Link de imagem tolerante: "www.x.com/a.jpg" e "x.com/a.jpg" ganham https://. */
export function normalizaLink(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  // sem esquema: só vira URL se parecer domínio (tem ponto e nada de espaço)
  if (/^[^\s/]+\.[^\s/]{2,}/.test(s)) return `https://${s}`;
  return s; // deixa como está — o validador abaixo acusa em português
}

/**
 * OS MESMOS LIMITES DO ZOD DA API, CONFERIDOS AQUI.
 * ============================================================================
 * O `Field` é um `<input>` de texto puro: todo campo numérico desta tela aceita
 * qualquer coisa, a API recusa com 400, e a mensagem chegava em inglês com o
 * nome INTERNO do campo ("costCents: Number must be greater than or equal
 * to 0"). Quem está cadastrando não tem como saber que "costCents" é a caixa
 * escrita "Custo (R$)" — então o 400 virava ruído e a pessoa clicava Salvar
 * de novo. (Seis vezes, no relato que chegou.)
 *
 * Aqui os limites são os do `UpsertSchema` em
 * `apps/api/src/products/products.controller.ts`. Se um mudar lá, muda aqui —
 * `pdv.check.mts` confere que os dois lados continuem casando.
 */
export const LIMITES: Array<{ k: string; label: string; min?: number; max?: number; inteiro?: boolean }> = [
  { k: "priceCashCents", label: "Preço à vista (R$)", min: 0 },
  { k: "costCents", label: "Custo (R$)", min: 0 },
  { k: "priceCardFullCents", label: "Cartão à vista", min: 0 },
  { k: "priceCardInstallmentsCents", label: "Cartão parcelado", min: 0 },
  { k: "priceCreditCents", label: "Crediário", min: 0 },
  { k: "creditInterestPct", label: "Juros crediário %", min: 0, max: 1000 },
  { k: "earlyPaymentDiscountPct", label: "Desc. antecipação %", min: 0, max: 100 },
  { k: "maxInstallments", label: "Máx parcelas", min: 1, max: 120, inteiro: true },
  { k: "stockQty", label: "Estoque inicial", min: 0, inteiro: true },
  { k: "minStockQty", label: "Estoque mínimo", min: 0, inteiro: true },
];
export function validar(p: Record<string, any>): string | null {
  for (const { k, label, min, max, inteiro } of LIMITES) {
    const v = p[k];
    if (v == null) continue;
    if (!Number.isFinite(v)) return `${label}: não entendi esse número. Escreva assim: 1299,90`;
    const mostra = (n: number) => (k.endsWith("Cents") ? (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : String(n));
    if (min != null && v < min) {
      return min === 0
        ? `${label} não aceita valor negativo.`
        : `${label}: o mínimo é ${mostra(min)}.`;
    }
    if (max != null && v > max) return `${label}: o máximo é ${mostra(max)}.`;
    if (inteiro && !Number.isInteger(v)) return `${label} tem que ser um número inteiro.`;
  }
  if (p.imageUrl && !/^https?:\/\/[^\s]+$/i.test(String(p.imageUrl))) {
    return "Link da imagem: precisa ser um endereço completo, começando com https://";
  }
  return null;
}

/** Tradutor do 400 da API, pro caso de algo passar pelo validador acima. */
const ROTULO: Record<string, string> = {
  name: "Nome", sku: "SKU", category: "Categoria", description: "Descrição",
  imageUrl: "Link da imagem", laboratorySupplierId: "Laboratório",
  ncm: "NCM", cfop: "CFOP", cest: "CEST", cst: "CST (Normal)",
  csosn: "CSOSN (Simples)", origem: "Origem", unidade: "Unidade",
  ...Object.fromEntries(LIMITES.map((l) => [l.k, l.label])),
};
export function erroAmigavel(msg: string): string {
  const corpo = msg.includes("—") ? msg.slice(msg.indexOf("—") + 1).trim() : msg;
  const i = corpo.indexOf(":");
  if (i < 0) return msg;
  const campo = corpo.slice(0, i).trim();
  const label = ROTULO[campo];
  if (!label) return msg;
  const razao = corpo.slice(i + 1).trim();
  const pt =
    /Invalid url/i.test(razao) ? "precisa ser um endereço completo, começando com https://"
    : /Invalid uuid/i.test(razao) ? "escolha uma opção da lista"
    : /at least 1 character/i.test(razao) ? "não pode ficar vazio"
    : /at most (\d+) character/i.exec(razao) ? `cabe no máximo ${/at most (\d+)/.exec(razao)![1]} caracteres`
    : /greater than or equal to 0\b/i.test(razao) ? "não aceita valor negativo"
    : /greater than or equal to (\d+)/i.exec(razao) ? `o mínimo é ${/greater than or equal to (\d+)/.exec(razao)![1]}`
    : /less than or equal to (\d+)/i.exec(razao) ? `o máximo é ${/less than or equal to (\d+)/.exec(razao)![1]}`
    : /Expected number/i.test(razao) ? "tem que ser um número"
    : razao;
  return `${label}: ${pt}`;
}
