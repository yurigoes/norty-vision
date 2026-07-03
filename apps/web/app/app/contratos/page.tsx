import { apiFetch } from "../../../lib/api";
import { ContractsClient } from "./ContractsClient";

export const dynamic = "force-dynamic";

interface TemplateBrief {
  id: string;
  slug: string;
  title: string;
  signatureMode: string;
  fieldsSchema: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
}

interface ContractRow {
  id: string;
  status: string;
  signerName: string | null;
  signerEmail: string | null;
  signerDocument: string | null;
  signerToken: string | null;
  sentAt: string | null;
  signedAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  template: { id: string; slug: string; title: string; signatureMode: string };
}

export default async function ContratosPage() {
  const [templatesRes, contractsRes] = await Promise.all([
    apiFetch<{ items: TemplateBrief[] }>("/api/contracts/templates"),
    apiFetch<{ items: ContractRow[] }>("/api/contracts"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Contratos · Enviados
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Contratos para assinar</h1>
        <p className="mt-2 text-muted">
          Gere um link público de assinatura escolhendo um modelo. O signatário
          recebe um link com token único; após assinar, o contrato fica
          registrado com IP, data e dispositivo.
        </p>
      </header>

      <ContractsClient
        templates={templatesRes.data?.items ?? []}
        contracts={contractsRes.data?.items ?? []}
      />
    </div>
  );
}
