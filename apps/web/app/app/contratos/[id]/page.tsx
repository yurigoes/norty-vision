import Link from "next/link";
import { apiFetch } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface ContractDetail {
  id: string;
  status: string;
  organizationId: string | null;
  signerName: string | null;
  signerEmail: string | null;
  signerDocument: string | null;
  signerPhone: string | null;
  fieldValues: Record<string, unknown>;
  renderedBodyMarkdown: string | null;
  signerToken: string | null;
  sentAt: string | null;
  signedAt: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  signatureImageUrl: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  template: {
    id: string;
    title: string;
    description: string | null;
    bodyMarkdown: string;
    signatureMode: string;
    fieldsSchema: Array<{
      name: string;
      label: string;
      type: string;
      required: boolean;
      options?: string[];
    }>;
  };
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data } = await apiFetch<{ contract: ContractDetail | null }>(
    `/api/contracts/${id}`,
  );
  const c = data?.contract;

  if (!c) {
    return (
      <div className="max-w-3xl">
        <Link
          href="/app/contratos"
          className="text-sm text-brand hover:underline"
        >
          ← voltar
        </Link>
        <p className="mt-8 rounded-2xl border border-line bg-surface p-6 text-muted">
          Contrato não encontrado.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link
          href="/app/contratos"
          className="text-sm text-brand hover:underline"
        >
          ← Contratos
        </Link>
        <header className="mt-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">
              {c.template.title}
            </p>
            <h1 className="mt-1 text-3xl font-semibold">
              Status:{" "}
              <span
                className={
                  c.status === "signed"
                    ? "text-green-300"
                    : c.status === "cancelled"
                      ? "text-red-300"
                      : "text-blue-300"
                }
              >
                {c.status}
              </span>
            </h1>
          </div>
          <a
            href={`/api/contracts/${c.id}/html`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-grad shrink-0"
          >
            Imprimir / Baixar
          </a>
        </header>
      </div>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">Signatário</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Nome" value={c.signerName ?? "—"} />
          <Row label="Email" value={c.signerEmail ?? "—"} />
          <Row label="Documento" value={c.signerDocument ?? "—"} />
          <Row label="Telefone" value={c.signerPhone ?? "—"} />
          {c.signedAt && (
            <>
              <Row
                label="Assinado em"
                value={new Date(c.signedAt).toLocaleString("pt-BR")}
              />
              <Row label="IP" value={c.signerIp ?? "—"} mono />
            </>
          )}
        </dl>
        {c.signerUserAgent && (
          <p className="mt-3 text-[11px] text-muted">
            UA: <span className="font-mono">{c.signerUserAgent}</span>
          </p>
        )}
      </section>

      {Object.keys(c.fieldValues ?? {}).length > 0 && (
        <section className="card">
          <h2 className="mb-4 text-lg font-semibold">Campos preenchidos</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(c.fieldValues).map(([k, v]) => (
              <Row key={k} label={k} value={String(v ?? "—")} />
            ))}
          </dl>
        </section>
      )}

      <section className="card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Corpo do contrato</h2>
          <a
            href={`/api/contracts/${c.id}/html`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-brand hover:underline"
          >
            Abrir / imprimir ↗
          </a>
        </div>
        <iframe
          src={`/api/contracts/${c.id}/html`}
          title="Contrato"
          className="h-[800px] w-full rounded-lg border border-line bg-white"
        />
      </section>

      {c.signatureImageUrl && (
        <section className="card">
          <h2 className="mb-4 text-lg font-semibold">Rubrica</h2>
          <img
            src={c.signatureImageUrl}
            alt="assinatura"
            className="rounded-lg border border-line bg-white p-3"
          />
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd className={mono ? "mt-0.5 font-mono text-xs" : "mt-0.5"}>{value}</dd>
    </div>
  );
}
