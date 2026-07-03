import Link from "next/link";
import { AtendimentoClient } from "./AtendimentoClient";

export const dynamic = "force-dynamic";

export default function AtendimentoPage() {
  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
          <h1 className="mt-1 text-3xl font-semibold">Central de atendimento</h1>
          <p className="mt-2 text-muted">Conversas de WhatsApp, e-mail e site num só lugar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/atendimento-tela-cheia"
            target="_blank"
            rel="noreferrer"
            className="btn-grad"
            title="Abre o atendimento em uma nova aba, ocupando a tela inteira (sem o menu lateral)"
          >
            ⛶ Tela cheia
          </Link>
          <Link href="/app/atendimento/duvidas" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">Maiores dúvidas</Link>
          <Link href="/app/atendimento/ajuda" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">Central de ajuda</Link>
          <Link href="/app/atendimento/config" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">Configurações</Link>
          <Link href="/app/atendimento/botoes" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">Botões</Link>
          <Link href="/app/atendimento/ia-aprendizado" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">IA</Link>
          <Link href="/app/atendimento/supervisor" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">Supervisão</Link>
          <Link href="/app/atendimento/relatorios" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:border-brand/60 hover:text-brand">Relatórios</Link>
        </div>
      </header>
      <AtendimentoClient />
    </div>
  );
}
