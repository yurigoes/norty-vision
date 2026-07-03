import Link from "next/link";
import {
  CalendarDays,
  Users,
  Send,
  LifeBuoy,
  BookOpen,
  Settings,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { getSession } from "../../lib/session";
import { Card } from "../../components/ui";
import { OverviewMetrics } from "./OverviewMetrics";

export default async function DashboardPage() {
  const session = await getSession();
  const isOrgUser = !!session.user?.orgId || !!session.impersonating;

  const shortcuts: Array<{
    title: string;
    body: string;
    href: string;
    icon: LucideIcon;
    tone: string;
  }> = [
    { title: "Agenda", body: "Marcar, confirmar, ver fila do dia.", href: "/app/agenda", icon: CalendarDays, tone: "text-brand bg-brand/10" },
    { title: "Leads", body: "Kanban de oportunidades comerciais.", href: "/app/leads", icon: Users, tone: "text-brand-2 bg-brand-2/10" },
    { title: "Disparador", body: "Campanhas WhatsApp/SMS/email.", href: "/app/disparador", icon: Send, tone: "text-success bg-success/10" },
    { title: "Ajuda", body: "Passo a passo de cada ação.", href: "/app/ajuda", icon: LifeBuoy, tone: "text-warn bg-warn/10" },
    { title: "Guia do sistema", body: "O que cada módulo faz, em detalhes.", href: "/app/guia", icon: BookOpen, tone: "text-brand bg-brand/10" },
  ];

  return (
    <div className="animate-fade-in-up">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Bem-vindo
          {session.master ? ", master" : session.user ? "!" : ""}
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          {session.master
            ? "Você está logado como dono da plataforma. Use o menu lateral para configurar a marca, gerenciar acessos às specs técnicas e ver métricas globais."
            : "Selecione um módulo no menu lateral para começar."}
        </p>
      </header>

      {isOrgUser && <OverviewMetrics />}

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Atalhos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.href} href={s.href} className="group block">
                <Card className="h-full p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md">
                  <div className="flex items-start justify-between">
                    <span className={`grid h-10 w-10 place-items-center rounded-xl ${s.tone}`}>
                      <Icon size={20} />
                    </span>
                    <ArrowUpRight
                      size={18}
                      className="text-text-3 transition-colors group-hover:text-brand"
                    />
                  </div>
                  <h3 className="mt-4 text-base font-bold tracking-tight">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted">{s.body}</p>
                </Card>
              </Link>
            );
          })}

          {session.master && (
            <Link href="/app/platform/settings" className="group block">
              <Card className="h-full p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-md">
                <div className="flex items-start justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
                    <Settings size={20} />
                  </span>
                  <ArrowUpRight
                    size={18}
                    className="text-text-3 transition-colors group-hover:text-brand"
                  />
                </div>
                <h3 className="mt-4 text-base font-bold tracking-tight">Configurações</h3>
                <p className="mt-1 text-sm text-muted">Editar logo, CNPJ, endereço, cores.</p>
              </Card>
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
