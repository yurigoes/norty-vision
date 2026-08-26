"use client";

import { useState } from "react";
import { useListaServidor } from "../lib/useListaServidor";

export interface ClienteEscolhido {
  id: string;
  name: string;
  document?: string | null;
  phone?: string | null;
}

/**
 * SELETOR DE CLIENTE QUE NÃO PERDE O FIO DA MEADA
 * ============================================================================
 * O seletor filtrava na memória os 300 clientes que a tela tinha baixado. Com
 * 3.000 no banco, atender alguém cadastrado e receber "nenhum cliente
 * encontrado" era rotina — e aí o atendente parava o que estava fazendo, ia
 * pra tela de Clientes, cadastrava (de novo, duplicado), e voltava.
 *
 * Aqui a busca vai ao banco inteiro. E quando o cliente REALMENTE não existe,
 * dá pra cadastrar ali mesmo, com o mínimo — nome, CPF e telefone — sem sair
 * do pedido que está sendo montado. O resto do cadastro o cliente completa no
 * portal, ou alguém completa depois na tela de Clientes.
 */
export function SeletorCliente({
  escolhido,
  aoEscolher,
  aoLimpar,
  permitirCadastro = false,
  storeId = null,
  placeholder = "Buscar por nome, CPF ou telefone",
  autoFoco = false,
}: {
  escolhido: ClienteEscolhido | null;
  aoEscolher: (c: ClienteEscolhido) => void;
  aoLimpar: () => void;
  /** mostra o "cadastrar agora" quando a busca não acha ninguém */
  permitirCadastro?: boolean;
  storeId?: string | null;
  placeholder?: string;
  autoFoco?: boolean;
}) {
  const lista = useListaServidor<ClienteEscolhido>({
    rota: "/api/customers",
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
          {escolhido.name}
          {escolhido.document ? <span className="text-xs text-muted"> · {escolhido.document}</span> : null}
        </span>
        <button type="button" onClick={aoLimpar} className="shrink-0 text-muted transition hover:text-red-400" aria-label="Trocar cliente">
          ×
        </button>
      </div>
    );
  }

  if (cadastrando) {
    return (
      <CadastroRapido
        termo={termo}
        storeId={storeId}
        aoCriar={(c) => { setCadastrando(false); setQ(""); aoEscolher(c); }}
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
        aria-label="Buscar cliente"
        autoFocus={autoFoco}
      />
      {buscando && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">buscando…</span>
      )}

      {achados.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-bg shadow-xl">
          {achados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { setQ(""); aoEscolher(c); }}
                className="block w-full px-3 py-2 text-left text-sm transition hover:bg-line"
              >
                <span className="font-medium">{c.name}</span>
                {c.document && <span className="text-xs text-muted"> · {c.document}</span>}
                {c.phone && <span className="block text-[11px] text-muted">{c.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {vazio && (
        <div className="mt-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px]">
          <p className="text-muted">
            Nenhum cliente com <b className="text-fg">{termo}</b> — procurado em todos, não só nos que a tela carregou.
          </p>
          {permitirCadastro && (
            <button type="button" onClick={() => setCadastrando(true)} className="mt-1 font-medium text-brand hover:underline">
              + Cadastrar agora e continuar
            </button>
          )}
        </div>
      )}

      {lista.erro && <p className="mt-1 text-[11px] text-red-400">{lista.erro}</p>}
    </div>
  );
}

/** só o que não dá pra adivinhar: nome, CPF e telefone. O resto vem depois. */
function CadastroRapido({
  termo,
  storeId,
  aoCriar,
  aoCancelar,
}: {
  termo: string;
  storeId: string | null;
  aoCriar: (c: ClienteEscolhido) => void;
  aoCancelar: () => void;
}) {
  const digitos = termo.replace(/\D/g, "");
  // quem digitou números estava procurando por CPF ou telefone; quem digitou
  // letras estava procurando pelo nome. Aproveita o que já foi digitado.
  const soDigitos = digitos.length >= 3 && digitos.length === termo.replace(/\s|\.|-|\(|\)/g, "").length;
  const [nome, setNome] = useState(soDigitos ? "" : termo);
  const [doc, setDoc] = useState(soDigitos && digitos.length <= 11 ? digitos : "");
  const [fone, setFone] = useState(soDigitos && digitos.length > 11 ? digitos : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (nome.trim().length < 2) { setErro("O nome precisa de pelo menos 2 letras."); return; }
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: nome.trim(),
          document: doc.trim() || null,
          documentType: doc.replace(/\D/g, "").length > 11 ? "cnpj" : doc.trim() ? "cpf" : null,
          phone: fone.trim() || null,
          whatsappPhone: fone.trim() || null,
          storeId: storeId || null,
          source: "cadastro_rapido",
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error?.message ?? "Falha ao cadastrar");
      const c = d?.customer;
      aoCriar({ id: c.id, name: c.name, document: c.document, phone: c.phone });
    } catch (e: any) {
      setErro(e?.message ?? "Falha ao cadastrar");
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand/40 bg-brand/5 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-brand">Cadastro rápido</p>
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Nome do cliente"
        className="input-base w-full py-1.5 text-sm"
        aria-label="Nome do cliente"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={doc}
          onChange={(e) => setDoc(e.target.value.replace(/\D/g, "").slice(0, 14))}
          placeholder="CPF/CNPJ (opcional)"
          inputMode="numeric"
          className="input-base w-full py-1.5 text-sm"
          aria-label="CPF ou CNPJ"
        />
        <input
          value={fone}
          onChange={(e) => setFone(e.target.value.replace(/\D/g, "").slice(0, 13))}
          placeholder="Telefone (opcional)"
          inputMode="numeric"
          className="input-base w-full py-1.5 text-sm"
          aria-label="Telefone"
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
        O resto do cadastro (endereço, nascimento, e-mail) o cliente completa no portal, ou alguém completa depois em Clientes.
      </p>
    </div>
  );
}
