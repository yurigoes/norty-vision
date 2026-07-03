import Link from "next/link";
import { AtendimentoClient } from "../app/atendimento/AtendimentoClient";

export const dynamic = "force-dynamic";

/**
 * Modo KIOSK do atendimento WhatsApp — ocupa a tela toda, sem sidebar.
 * Útil pro vendedor que precisa de espaço pra ver a lista de conversas,
 * a conversa atual e o painel lateral ao mesmo tempo.
 *
 * Abre em nova aba a partir do /app/atendimento via botão "Tela cheia".
 * Sessão herdada por cookies (mesma origem). Logout/expiração cai no
 * /login normal.
 */
export default function AtendimentoKioskPage() {
  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-surface/80 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white" style={{ background: "var(--grad-brand)" }}>Tela cheia</span>
          <h1 className="text-sm font-semibold">Atendimento</h1>
          <span className="text-xs text-muted">WhatsApp, e-mail e site</span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/atendimento"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-line px-3 py-1 text-xs text-muted transition hover:border-brand/60 hover:text-fg"
            title="Abrir versão normal (com menu lateral) em outra aba"
          >
            Voltar ao app
          </Link>
        </div>
      </header>
      <main className="flex-1 overflow-hidden px-3 pb-3 pt-2">
        <AtendimentoClient />
      </main>
    </>
  );
}
