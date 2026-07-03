import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface Row {
  customerId: string; name: string; phone: string | null;
  lastExam: string; daysSince: number; daysUntilRecall: number; recalled: boolean;
}

export default async function RecallExamesPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return <div className="max-w-3xl"><p className="card p-6 text-muted">Apenas administradores.</p></div>;
  }

  const res = await apiFetch<{ items: Row[] }>("/api/appointments/reports/exam-recall");
  const items = res.data?.items ?? [];
  const vencidos = items.filter((i) => i.daysUntilRecall <= 0);
  const proximos = items.filter((i) => i.daysUntilRecall > 0 && i.daysUntilRecall <= 60);

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <Link href="/app/agenda" className="text-sm text-brand hover:underline">← Agenda</Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand">Agenda · Recall</p>
        <h1 className="mt-1 text-3xl font-semibold">Recall de exame de vista</h1>
        <p className="mt-2 text-muted">
          Quantos dias faltam pra cada paciente ser notificado (1 ano após o exame). O lembrete é
          enviado automaticamente no WhatsApp/e-mail quando vence. Vale só pra quem fez exame com o médico.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card label="Vencidos (recall devido)" value={String(vencidos.length)} tone="red" />
        <Card label="Vencem em ≤60 dias" value={String(proximos.length)} tone="orange" />
        <Card label="Pacientes com exame" value={String(items.length)} />
      </div>

      {items.length === 0 ? (
        <p className="card p-6 text-sm text-muted">Nenhum exame atendido ainda.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Paciente</th><th className="px-4 py-3">Último exame</th><th className="px-4 py-3">Dias p/ notificar</th><th className="px-4 py-3">Status</th>
            </tr></thead>
            <tbody>
              {items.map((r) => {
                const due = r.daysUntilRecall <= 0;
                const soon = r.daysUntilRecall > 0 && r.daysUntilRecall <= 60;
                return (
                  <tr key={r.customerId} className="border-t border-line/50 transition hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      {r.phone && <div className="text-xs text-muted">{r.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">{new Date(r.lastExam).toLocaleDateString("pt-BR")} <span className="text-muted">({r.daysSince}d atrás)</span></td>
                    <td className={`px-4 py-3 font-semibold ${due ? "text-red-300" : soon ? "text-orange-300" : "text-muted"}`}>
                      {due ? `venceu há ${Math.abs(r.daysUntilRecall)}d` : `${r.daysUntilRecall} dias`}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.recalled ? <span className="text-green-300">✓ avisado</span> : due ? <span className="text-red-300">aguardando envio</span> : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "red" | "orange" }) {
  const c = tone === "red" ? "text-danger" : tone === "orange" ? "text-warn" : "text-fg";
  return (
    <div className="card">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${c}`}>{value}</p>
    </div>
  );
}
