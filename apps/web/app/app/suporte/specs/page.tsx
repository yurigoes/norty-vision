import { getSession } from "../../../../lib/session";
import { redirect } from "next/navigation";
import { apiFetch } from "../../../../lib/api";
import Link from "next/link";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SpecsPage() {
  const session = await getSession();
  if (!session.master) {
    return (
      <div className="max-w-3xl">
        <PageHeader
          eyebrow="Suporte · Specs técnicas"
          title="Acesso restrito"
        />
        <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">
          Esta área detalha a arquitetura técnica completa (stack, segurança,
          infra). Apenas o master da plataforma e usuários explicitamente
          liberados têm acesso.
        </p>
      </div>
    );
  }

  const { data } = await apiFetch<{ docs: any[] }>("/api/support/specs");
  const docs = data?.docs ?? [];

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Suporte · Specs técnicas"
        title="Arquitetura completa"
        description={<>Documentação técnica da plataforma. {docs.length} documentos.</>}
      />

      <div className="space-y-2">
        {docs.map((doc: any) => (
          <Link
            key={doc.id}
            href={`/app/suporte/specs/${doc.slug}`}
            className="card block"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {doc.category}
            </p>
            <h3 className="mt-1 font-semibold">{doc.title}</h3>
            {doc.summary && (
              <p className="mt-1 text-sm text-muted">{doc.summary}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
