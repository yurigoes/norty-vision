import { apiFetch } from "../../../lib/api";
import { SignClient } from "./SignClient";

export const dynamic = "force-dynamic";

interface PublicContract {
  id: string;
  status: string;
  signerName: string | null;
  signerEmail: string | null;
  signerDocument: string | null;
  fieldValues: Record<string, unknown>;
  signedAt: string | null;
  tokenExpiresAt: string | null;
  template: {
    id: string;
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
  };
}

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { data, status } = await apiFetch<{ contract: PublicContract }>(
    `/api/contracts/by-token/${encodeURIComponent(token)}`,
  );

  if (status === 404 || !data?.contract) {
    return (
      <NotFound message="Link inválido ou contrato não encontrado." />
    );
  }
  if (status === 403) {
    return <NotFound message="Este link expirou. Solicite um novo." />;
  }

  const c = data.contract;

  if (c.status === "signed") {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">
          ✓ Contrato já foi assinado
        </h1>
        <p className="mt-2 text-sm text-muted">
          {c.signedAt && (
            <>
              Em{" "}
              {new Date(c.signedAt).toLocaleString("pt-BR")}
              .
            </>
          )}{" "}
          Não é necessário fazer nada.
        </p>
      </Centered>
    );
  }
  if (c.status === "cancelled" || c.status === "expired") {
    return (
      <NotFound message={`Este contrato está ${c.status}. Solicite um novo link.`} />
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Assinatura digital
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{c.template.title}</h1>
        {c.template.description && (
          <p className="mt-2 text-muted">{c.template.description}</p>
        )}
      </header>

      <SignClient token={token} contract={c} />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">{children}</div>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <Centered>
      <h1 className="text-2xl font-semibold">Ops</h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
    </Centered>
  );
}
