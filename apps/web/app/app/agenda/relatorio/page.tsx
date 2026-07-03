import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

interface Appointment {
  id: string;
  status: string;
  serviceName: string | null;
  startsAt: string;
  endsAt: string;
  professional: { id: string; name: string };
  customer: { id: string; name: string; phone: string | null };
}

const STATUS: Record<string, string> = {
  pending: "Pendente", confirmed: "Confirmado", in_progress: "Atendendo",
  attended: "Atendido", canceled: "Cancelado", rescheduled: "Remarcado", no_show: "Faltou",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
}

export default async function RelatorioAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; professionalId?: string }>;
}) {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  const sp = await searchParams;
  const date = sp.date ?? new Date().toISOString().slice(0, 10);

  const [appsRes, orgRes] = await Promise.all([
    apiFetch<{ items: Appointment[] }>(
      `/api/appointments?startDate=${date}&endDate=${date}${sp.professionalId ? `&professionalId=${sp.professionalId}` : ""}`,
    ),
    apiFetch<{ organization: { name: string; logoUrl: string | null } }>("/api/organizations/me"),
  ]);

  const appts = (appsRes.data?.items ?? []).filter((a) => a.status !== "canceled" && a.status !== "rescheduled");
  const org = orgRes.data?.organization;
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-3xl">
      {/* Remove cabeçalho/rodapé do navegador (data/hora/url) na impressão */}
      <style
        dangerouslySetInnerHTML={{
          __html: "@media print { @page { margin: 0; } html, body { background:#fff !important; } .report-card { padding: 14mm !important; } }",
        }}
      />
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="/app/agenda" className="text-sm text-muted hover:text-fg">← voltar</a>
        <PrintButton />
      </div>

      <div className="report-card rounded-xl border border-line bg-white p-8 text-black print:border-0">
        <header className="mb-6 flex items-center justify-between border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl font-bold">{org?.name ?? "Agenda"}</h1>
            <p className="text-sm text-gray-600">Relatório de agendamentos</p>
            <p className="text-sm font-medium capitalize">{dateLabel}</p>
          </div>
          {org?.logoUrl && <img src={org.logoUrl} alt="" className="h-14 w-auto max-w-[160px] object-contain" />}
        </header>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-2 pr-2">Horário</th>
              <th className="py-2 pr-2">Paciente</th>
              <th className="py-2 pr-2">Telefone</th>
              <th className="py-2 pr-2">Profissional</th>
              <th className="py-2 pr-2">Serviço</th>
              <th className="py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {appts.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-gray-500">Nenhum agendamento para o dia.</td></tr>
            ) : (
              appts.map((a) => (
                <tr key={a.id} className="border-b border-gray-200">
                  <td className="py-2 pr-2 font-mono">{fmtTime(a.startsAt)}</td>
                  <td className="py-2 pr-2 font-medium">{a.customer.name}</td>
                  <td className="py-2 pr-2">{a.customer.phone ?? "—"}</td>
                  <td className="py-2 pr-2">{a.professional.name}</td>
                  <td className="py-2 pr-2">{a.serviceName ?? "—"}</td>
                  <td className="py-2">{STATUS[a.status] ?? a.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <p className="mt-6 text-right text-xs text-gray-500">Total: {appts.length} agendamento(s)</p>
      </div>
    </div>
  );
}
