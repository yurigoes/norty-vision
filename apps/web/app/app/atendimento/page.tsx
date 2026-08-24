import Link from "next/link";
import { AtendimentoClient } from "./AtendimentoClient";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default function AtendimentoPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Atendimento"
        title="Central de atendimento"
        description="Conversas de WhatsApp, e-mail e site num só lugar."
        actions={
          <>
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
          </>
        }
      />
      <AtendimentoClient />
    </div>
  );
}
