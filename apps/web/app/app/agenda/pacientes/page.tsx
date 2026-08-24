import { apiFetch } from "../../../../lib/api";
import { CustomersClient } from "./CustomersClient";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

interface Customer {
  id: string;
  storeId: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  prefersChannel: string | null;
  optOutMarketing: boolean;
  city: string | null;
  state: string | null;
  birthDate: string | null;
  tags: string[];
}

interface Store {
  id: string;
  name: string;
}

export default async function PacientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const [custRes, storesRes] = await Promise.all([
    apiFetch<{ items: Customer[] }>(
      `/api/customers${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`,
    ),
    apiFetch<{ items: Store[] }>("/api/stores"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Agenda · Pacientes"
        title="Pacientes / clientes"
        description="Cadastro central. WhatsApp obrigatório pra receber lembretes."
      />

      <CustomersClient
        initialCustomers={custRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
        initialQuery={sp.q ?? ""}
      />
    </div>
  );
}
