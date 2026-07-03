import { apiFetch } from "../../../../lib/api";
import { getSession } from "../../../../lib/session";
import { TemplatesClient } from "./TemplatesClient";

export const dynamic = "force-dynamic";

interface Template {
  id: string;
  organizationId: string | null;
  slug: string;
  title: string;
  description: string | null;
  bodyMarkdown: string;
  fieldsSchema: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
  signatureMode: string;
  isActive: boolean;
  createdAt: string;
}

export default async function TemplatesPage() {
  const session = await getSession();
  const isMaster = session.master !== null;
  const { data } = await apiFetch<{ items: Template[] }>(
    "/api/contracts/templates",
  );
  const items = data?.items ?? [];

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Contratos · Modelos
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Modelos de contrato</h1>
        <p className="mt-2 text-muted">
          Cada modelo tem um corpo em Markdown com placeholders{" "}
          <code className="rounded bg-line px-1.5 py-0.5 text-xs">
            {"{{nome_do_campo}}"}
          </code>{" "}
          e um esquema de campos que o signatário preenche. Sua{" "}
          <strong>logo e cor principal</strong> são aplicadas automaticamente
          ao imprimir/baixar o contrato.
        </p>
      </header>

      <TemplatesClient initialTemplates={items} isMaster={isMaster} />
    </div>
  );
}
