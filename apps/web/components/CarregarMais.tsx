"use client";

/**
 * "Mostrando 50 de 3.184" + o botão que traz o próximo pedaço.
 *
 * O número da direita é o do SERVIDOR, com os filtros atuais — é o que a tela
 * não tinha antes: ela dizia "50 clientes" quando eram 3.184, e o teto era
 * invisível.
 */
export function CarregarMais({
  mostrando,
  total,
  temMais,
  carregando,
  aoCarregar,
  substantivo,
}: {
  mostrando: number;
  total: number;
  temMais: boolean;
  carregando: boolean;
  aoCarregar: () => void;
  /** ex.: "cliente" — vira "cliente(s)" no texto */
  substantivo: string;
}) {
  const n = (x: number) => x.toLocaleString("pt-BR");
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <p className="text-[11px] text-muted">
        {temMais || mostrando < total
          ? `Mostrando ${n(mostrando)} de ${n(total)} ${substantivo}(s)`
          : `${n(total)} ${substantivo}(s) — é tudo`}
      </p>
      {temMais && (
        <button
          onClick={aoCarregar}
          disabled={carregando}
          className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 disabled:opacity-40"
        >
          {carregando ? "carregando…" : `Carregar mais ${n(Math.min(50, total - mostrando))}`}
        </button>
      )}
    </div>
  );
}
