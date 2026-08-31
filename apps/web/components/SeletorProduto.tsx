"use client";

import { useState } from "react";
import { useListaServidor } from "../lib/useListaServidor";

export interface ProdutoEscolhido {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  priceCashCents?: number | null;
  costCents?: number | null;
}

/**
 * SELETOR DE PRODUTO QUE ACHA PELO CÓDIGO — E CADASTRA NA HORA
 * ============================================================================
 * No pedido de lente, armação e lente eram dois `<select>` com a lista inteira
 * de produtos que a tela tinha baixado. Três problemas, todos do mesmo tipo:
 *
 *   1. o `<select>` não busca. Com centenas de produtos, achar a lente certa
 *      era rolar a lista inteira procurando com o olho;
 *   2. o CÓDIGO não aparecia em lugar nenhum, e é por ele que quem atende
 *      procura — a caixa da lente tem o código impresso, não o nome completo;
 *   3. a lista era a que a página baixou. Produto fora do pedaço não existia.
 *
 * Aqui digita-se qualquer pedaço do código (ou do nome, ou da categoria) e a
 * busca vai ao banco inteiro — `/api/products?q=` já procura em `sku`, `name`
 * e `category`. E quando o produto REALMENTE não existe, dá pra cadastrar dali
 * mesmo, sem sair do pedido que está sendo montado.
 *
 * É o mesmo desenho do `SeletorCliente`, de propósito: quem aprendeu a buscar
 * cliente já sabe buscar produto.
 */
export function SeletorProduto({
  escolhido,
  aoEscolher,
  aoLimpar,
  permitirCadastro = false,
  categoriaSugerida = null,
  placeholder = "Buscar por código ou nome",
  rotulo = "produto",
}: {
  escolhido: ProdutoEscolhido | null;
  aoEscolher: (p: ProdutoEscolhido) => void;
  aoLimpar: () => void;
  /** mostra o "cadastrar agora" quando a busca não acha nada */
  permitirCadastro?: boolean;
  /** pré-preenche a categoria no cadastro rápido ("Lente", "Armação") */
  categoriaSugerida?: string | null;
  placeholder?: string;
  /** aparece nas mensagens: "Nenhuma lente com ABC123" */
  rotulo?: string;
}) {
  const lista = useListaServidor<ProdutoEscolhido>({
    rota: "/api/products?activeOnly=true",
    inicial: [],
    totalInicial: 0,
    passo: 8,
  });
  const { q, setQ, buscando, doServidor } = lista;
  const achados = lista.itens.slice(0, 8);
  const termo = q.trim();

  const [cadastrando, setCadastrando] = useState(false);

  if (escolhido) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          {escolhido.sku ? <span className="font-mono text-xs text-brand">{escolhido.sku}</span> : null}
          {escolhido.sku ? " · " : null}
          {escolhido.name}
        </span>
        <button
          type="button"
          onClick={aoLimpar}
          className="shrink-0 text-muted transition hover:text-red-400"
          aria-label={`Trocar ${rotulo}`}
        >
          ×
        </button>
      </div>
    );
  }

  if (cadastrando) {
    return (
      <CadastroRapidoProduto
        termo={termo}
        categoriaSugerida={categoriaSugerida}
        aoCriar={(p) => { setCadastrando(false); setQ(""); aoEscolher(p); }}
        aoCancelar={() => setCadastrando(false)}
      />
    );
  }

  const vazio = doServidor && achados.length === 0 && !buscando;

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="input-base w-full"
        aria-label={`Buscar ${rotulo} por código ou nome`}
      />
      {buscando && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">
          buscando…
        </span>
      )}

      {achados.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-bg shadow-xl">
          {achados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { setQ(""); aoEscolher(p); }}
                className="block w-full px-3 py-2 text-left text-sm transition hover:bg-line"
              >
                {/* o código primeiro: é por ele que se procura */}
                {p.sku && <span className="font-mono text-xs text-brand">{p.sku}</span>}
                {p.sku && " · "}
                <span className="font-medium">{p.name}</span>
                <span className="block text-[11px] text-muted">
                  {p.category ?? "sem categoria"}
                  {p.priceCashCents != null && ` · R$ ${(p.priceCashCents / 100).toFixed(2)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {vazio && (
        <div className="mt-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px]">
          <p className="text-muted">
            Nenhum {rotulo} com <b className="text-fg">{termo}</b> — procurado em código, nome e categoria de
            todos, não só nos que a tela carregou.
          </p>
          {permitirCadastro && (
            <button
              type="button"
              onClick={() => setCadastrando(true)}
              className="mt-1 font-medium text-brand hover:underline"
            >
              + Cadastrar este produto agora e continuar
            </button>
          )}
        </div>
      )}

      {lista.erro && <p className="mt-1 text-[11px] text-red-400">{lista.erro}</p>}
    </div>
  );
}

/**
 * Só o que o pedido precisa: código, nome, e os dois valores que a tela puxa
 * do produto (preço cobrado e custo do laboratório). Estoque, NCM, imagem e o
 * resto ficam pra tela de Produtos — aqui a pressa é não perder o pedido.
 */
function CadastroRapidoProduto({
  termo,
  categoriaSugerida,
  aoCriar,
  aoCancelar,
}: {
  termo: string;
  categoriaSugerida: string | null;
  aoCriar: (p: ProdutoEscolhido) => void;
  aoCancelar: () => void;
}) {
  // Quem digitou algo curto e com número estava procurando pelo CÓDIGO; quem
  // digitou uma frase estava procurando pelo nome. Aproveita o que já foi
  // digitado em vez de fazer a pessoa repetir.
  const pareceCodigo = termo.length <= 20 && /\d/.test(termo) && !/\s/.test(termo);
  const [sku, setSku] = useState(pareceCodigo ? termo.toUpperCase() : "");
  const [nome, setNome] = useState(pareceCodigo ? "" : termo);
  const [categoria, setCategoria] = useState(categoriaSugerida ?? "");
  const [preco, setPreco] = useState("");
  const [custo, setCusto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const emCentavos = (v: string): number | null => {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return v.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  };

  async function salvar() {
    if (nome.trim().length < 2) { setErro("O nome precisa de pelo menos 2 letras."); return; }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          // sem código, a API gera um a partir do nome — melhor isso do que
          // travar o pedido por causa de um campo
          sku: sku.trim() || null,
          name: nome.trim(),
          category: categoria.trim() || null,
          priceCashCents: emCentavos(preco),
          costCents: emCentavos(custo),
          trackStock: false,
          isActive: true,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error?.message ?? "Falha ao cadastrar o produto");
      const p = d?.product;
      aoCriar({
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        priceCashCents: p.priceCashCents,
        costCents: p.costCents,
      });
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao cadastrar o produto");
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand/40 bg-brand/5 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-brand">Cadastro rápido de produto</p>
      <div className="grid grid-cols-3 gap-2">
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value.slice(0, 60))}
          placeholder="Código"
          className="input-base w-full py-1.5 font-mono text-sm"
          aria-label="Código do produto"
          autoFocus={!pareceCodigo ? false : true}
        />
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value.slice(0, 200))}
          placeholder="Nome do produto"
          className="input-base col-span-2 w-full py-1.5 text-sm"
          aria-label="Nome do produto"
          autoFocus={pareceCodigo}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          value={categoria}
          onChange={(e) => setCategoria(e.target.value.slice(0, 80))}
          placeholder="Categoria"
          className="input-base w-full py-1.5 text-sm"
          aria-label="Categoria"
        />
        <input
          value={preco}
          onChange={(e) => setPreco(e.target.value)}
          placeholder="Preço (R$)"
          inputMode="decimal"
          className="input-base w-full py-1.5 text-sm"
          aria-label="Preço cobrado"
        />
        <input
          value={custo}
          onChange={(e) => setCusto(e.target.value)}
          placeholder="Custo lab (R$)"
          inputMode="decimal"
          className="input-base w-full py-1.5 text-sm"
          aria-label="Custo do laboratório"
        />
      </div>
      {erro && <p className="text-[11px] text-red-400">{erro}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="btn-grad px-4 py-1.5 text-xs disabled:opacity-50"
        >
          {salvando ? "cadastrando…" : "Cadastrar e usar"}
        </button>
        <button type="button" onClick={aoCancelar} className="text-[11px] text-muted transition hover:text-fg">
          ← voltar pra busca
        </button>
      </div>
      <p className="text-[10px] text-muted">
        Sem código, o sistema gera um. Estoque, NCM e imagem ficam pra tela de Produtos — aqui o que importa é
        não perder o pedido.
      </p>
    </div>
  );
}
