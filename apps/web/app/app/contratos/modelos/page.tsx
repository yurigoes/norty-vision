import { apiFetch } from "../../../../lib/api";
import { getSession } from "../../../../lib/session";
import { TemplatesClient } from "./TemplatesClient";
import { PageHeader } from "../../../../components/PageHeader";

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
      <PageHeader
        eyebrow="Contratos · Modelos"
        title="Modelos de contrato"
        description={<>Cada modelo tem um corpo em Markdown com placeholders{" "} <code className="rounded bg-line px-1.5 py-0.5 text-xs"> {"{{nome_do_campo}}"} </code>{" "} e um esquema de campos que o signatário preenche. Sua{" "} <strong>logo e cor principal</strong> são aplicadas automaticamente ao imprimir/baixar o contrato.</>}
      />

      <TemplatesClient initialTemplates={items} isMaster={isMaster} />
    </div>
  );
}
