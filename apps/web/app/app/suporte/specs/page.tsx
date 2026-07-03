import { getSession } from "../../../../lib/session";
import { redirect } from "next/navigation";
import { apiFetch } from "../../../../lib/api";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SpecsPage() {
  const session = await getSession();
  if (!session.master) {
    return (
      <div className="max-w-3xl">
        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">
            Suporte · Specs técnicas
          </p>
          <h1 className="mt-1 text-3xl font-semibold">Acesso restrito</h1>
        </header>
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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte · Specs técnicas
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Arquitetura completa</h1>
        <p className="mt-2 text-muted">
          Documentação técnica da plataforma. {docs.length} documentos.
        </p>
      </header>

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
