import { apiFetch } from "../../../../lib/api";
import { ProfessionalsClient } from "./ProfessionalsClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

interface Professional {
  id: string;
  storeId: string;
  name: string;
  displayName: string | null;
  specialty: string | null;
  email: string | null;
  phone: string | null;
  colorHex: string | null;
  defaultAppointmentDurationMin: number;
  defaultAppointmentCapacity: number;
  status: string;
  displayOrder: number;
}

interface Store {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
  professionalId: string;
  professional: { id: string; name: string; colorHex: string | null };
  weeklyBlocks: any;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
}

export default async function ProfissionaisPage() {
  const [profRes, storesRes, tplRes] = await Promise.all([
    apiFetch<{ items: Professional[] }>("/api/professionals"),
    apiFetch<{ items: Store[] }>("/api/stores"),
    apiFetch<{ items: Template[] }>("/api/schedule/templates"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Agenda · Profissionais"
        title="Profissionais e jornadas"
        description="Cadastre quem atende, configure a jornada semanal e gere slots para o calendário."
      />

      <ProfessionalsClient
        initialProfessionals={profRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
        templates={tplRes.data?.items ?? []}
      />
    </div>
  );
}
