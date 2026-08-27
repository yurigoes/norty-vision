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
          <Link
            href="/atendimento-tela-cheia"
            target="_blank"
            rel="noreferrer"
            className="btn-grad"
            title="Abre o atendimento em uma nova aba, ocupando a tela inteira (sem o menu lateral)"
          >
            ⛶ Tela cheia
          </Link>
        }
      />
      <AtendimentoClient />
    </div>
  );
}
