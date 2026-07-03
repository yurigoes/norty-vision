import Link from "next/link";
import { AtendimentoClient } from "./AtendimentoClient";

export const dynamic = "force-dynamic";

export default function AtendimentoPage() {
  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Atendimento</h1>
          <p className="text-sm text-muted">Conversas de WhatsApp, e-mail e site num só lugar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/atendimento-tela-cheia"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            title="Abre o atendimento em uma nova aba, ocupando a tela inteira (sem o menu lateral)"
          >
            ⛶ Tela cheia
          </Link>
          <Link href="/app/atendimento/duvidas" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Maiores dúvidas</Link>
          <Link href="/app/atendimento/ajuda" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Central de ajuda</Link>
          <Link href="/app/atendimento/config" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Configurações</Link>
          <Link href="/app/atendimento/botoes" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Botões</Link>
          <Link href="/app/atendimento/ia-aprendizado" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">IA</Link>
          <Link href="/app/atendimento/supervisor" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Supervisão</Link>
          <Link href="/app/atendimento/relatorios" className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Relatórios</Link>
        </div>
      </header>
      <AtendimentoClient />
    </div>
  );
}
