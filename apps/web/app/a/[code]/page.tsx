import { apiFetch } from "../../../lib/api";
import { hexToRgbTriplet } from "../../../lib/color";
import { AppointmentActions } from "./AppointmentActions";

export const dynamic = "force-dynamic";

interface ApptInfo {
  shortCode: string;
  status: string;
  startsAt: string;
  byArrival: boolean;
  arrivalLabel?: string | null;
  serviceName: string | null;
  professionalName: string | null;
  customerName: string | null;
  store: {
    name: string | null;
    examPriceCents: number;
    examPaymentNote: string;
    logoUrl: string | null;
    primaryColor: string | null;
  };
  outcome: "confirmed" | "canceled" | "reschedule" | null;
  canAct: boolean;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando confirmação", confirmed: "Confirmado", rescheduled: "Reagendado",
  canceled: "Cancelado", attended: "Atendido", in_progress: "Em atendimento", no_show: "Não compareceu",
};

export default async function AppointmentPortal({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // renderizado no servidor → primeira pintura já vem com conteúdo (corrige
  // a "página em branco" no navegador interno do WhatsApp, sem precisar recarregar).
  const res = await apiFetch<ApptInfo>(`/api/public/appointments/${code}`);
  const info = res.ok ? res.data : null;

  if (!info) {
    return <div className="flex min-h-screen items-center justify-center px-4 text-center text-sm text-muted">Agendamento não encontrado.</div>;
  }

  const brandTriplet = info.store.primaryColor ? hexToRgbTriplet(info.store.primaryColor) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      {brandTriplet && <style dangerouslySetInnerHTML={{ __html: `:root{--brand:${brandTriplet};}` }} />}
      <header className="mb-6 text-center">
        {info.store.logoUrl ? (
          <img src={info.store.logoUrl} alt="" className="mx-auto h-14 w-auto max-w-[180px] object-contain" />
        ) : (
          <h1 className="text-xl font-bold" style={{ color: "rgb(var(--brand))" }}>{info.store.name}</h1>
        )}
      </header>

      <div className="glass rounded-2xl p-6">
        <p className="text-sm text-muted">Olá {info.customerName?.split(" ")[0] ?? "cliente"} 👋</p>
        <h2 className="mt-1 text-lg font-semibold">Seu {info.serviceName || "exame de vista"}</h2>

        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Data">{fmtDate(info.startsAt)}</Row>
          <Row label="Horário">a partir das {info.arrivalLabel ?? fmtTime(info.startsAt)} (por ordem de chegada)</Row>
          {info.professionalName && <Row label="Profissional">{info.professionalName}</Row>}
          {info.store.name && <Row label="Local">{info.store.name}</Row>}
          <Row label="Valor do exame">{brl(info.store.examPriceCents)} {info.store.examPaymentNote}</Row>
          <Row label="Situação"><strong>{STATUS_LABEL[info.status] ?? info.status}</strong></Row>
        </dl>

        <AppointmentActions code={code} initialStatus={info.status} initialOutcome={info.outcome} canAct={info.canAct} />
      </div>

      <p className="mt-6 text-center text-[11px] text-muted">Sistema de Confirmação YUGO+</p>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
