import { apiFetch } from "../../../../lib/api";
import { CustomersClient } from "./CustomersClient";

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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Agenda · Pacientes
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Pacientes / clientes</h1>
        <p className="mt-2 text-muted">
          Cadastro central. WhatsApp obrigatório pra receber lembretes.
        </p>
      </header>

      <CustomersClient
        initialCustomers={custRes.data?.items ?? []}
        stores={storesRes.data?.items ?? []}
        initialQuery={sp.q ?? ""}
      />
    </div>
  );
}
