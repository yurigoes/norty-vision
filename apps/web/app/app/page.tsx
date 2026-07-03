import { getSession } from "../../lib/session";
import { OverviewMetrics } from "./OverviewMetrics";

export default async function DashboardPage() {
  const session = await getSession();
  const isOrgUser = !!session.user?.orgId || !!session.impersonating;
  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-semibold">
        Bem-vindo
        {session.master ? ", master" : session.user ? "!" : ""}
      </h1>
      <p className="mt-3 text-muted">
        {session.master
          ? "Você está logado como dono da plataforma. Use o menu lateral para configurar a marca, gerenciar acessos às specs técnicas e ver métricas globais."
          : "Selecione um módulo no menu lateral para começar."}
      </p>

      {isOrgUser && <OverviewMetrics />}

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Agenda" body="Marcar, confirmar, ver fila do dia." href="/app/agenda" />
        <Card title="Leads" body="Kanban de oportunidades comerciais." href="/app/leads" />
        <Card title="Disparador" body="Campanhas WhatsApp/SMS/email." href="/app/disparador" />
        <Card title="Ajuda" body="Passo a passo de cada ação." href="/app/ajuda" />
        <Card title="Guia do sistema" body="O que cada módulo faz, em detalhes." href="/app/guia" />
        {session.master && (
          <Card
            title="Configurações"
            body="Editar logo, CNPJ, endereço, cores."
            href="/app/platform/settings"
          />
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  body,
  href,
}: {
  title: string;
  body: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="block rounded-xl border border-line p-5 transition hover:border-brand/60"
    >
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </a>
  );
}
