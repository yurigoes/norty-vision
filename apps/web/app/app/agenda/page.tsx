import { apiFetch } from "../../../lib/api";
import { getSession } from "../../../lib/session";
import { AgendaClient } from "./AgendaClient";

export const dynamic = "force-dynamic";

interface Professional {
  id: string;
  name: string;
  colorHex: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  whatsappPhone: string | null;
}

interface Slot {
  id: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  used: number;
  isBlocked: boolean;
  professional: { id: string; name: string; colorHex: string | null };
}

interface Appointment {
  id: string;
  status: string;
  serviceName: string | null;
  startsAt: string;
  endsAt: string;
  shortCode: string | null;
  professional: { id: string; name: string; colorHex: string | null };
  customer: { id: string; name: string; phone: string | null; whatsappPhone: string | null };
  examPriceCents?: number | null;
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; professionalId?: string }>;
}) {
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = sp.date ?? today;

  const startDate = date;
  const endDate = date;

  const [profsRes, appsRes, slotsRes, custRes] = await Promise.all([
    apiFetch<{ items: Professional[] }>("/api/professionals"),
    apiFetch<{ items: Appointment[] }>(
      `/api/appointments?startDate=${startDate}&endDate=${endDate}${
        sp.professionalId ? `&professionalId=${sp.professionalId}` : ""
      }`,
    ),
    apiFetch<{ items: Slot[] }>(
      `/api/schedule/slots?startDate=${startDate}&endDate=${endDate}${
        sp.professionalId ? `&professionalId=${sp.professionalId}` : ""
      }`,
    ),
    apiFetch<{ items: Customer[] }>("/api/customers?limit=200"),
  ]);
  const session = await getSession();
  const isAdmin = !!session.master || !!session.user?.isOrgAdmin;

  return (
    <div className="max-w-6xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Agenda
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Calendário do dia</h1>
        <p className="mt-2 text-muted">
          Slots disponíveis, agendamentos confirmados e ações rápidas.
        </p>
      </header>

      <AgendaClient
        date={date}
        professionals={profsRes.data?.items ?? []}
        customers={custRes.data?.items ?? []}
        appointments={appsRes.data?.items ?? []}
        slots={slotsRes.data?.items ?? []}
        selectedProfessionalId={sp.professionalId ?? null}
        isAdmin={isAdmin}
      />
    </div>
  );
}
