import Link from "next/link";
import { PageHeader } from "./PageHeader";

/**
 * A tela que aparece no lugar de uma rota que a empresa não tem.
 *
 * Não é um 404: o endereço existe, e a pessoa provavelmente chegou aqui por um
 * link salvo ou pelo histórico. Então diz o que aconteceu e o que fazer, em vez
 * de fingir que a tela nunca existiu.
 */
export function RotaBloqueada({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Acesso" title={titulo} description={texto} />
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/app" className="btn-grad px-5 py-2.5 text-sm">
          Voltar ao painel
        </Link>
        <Link
          href="/app/suporte"
          className="rounded-xl border border-line px-5 py-2.5 text-sm text-muted transition hover:border-brand/60 hover:text-fg"
        >
          Falar com o suporte
        </Link>
      </div>
    </div>
  );
}
