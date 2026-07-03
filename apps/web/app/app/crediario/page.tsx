import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { CreditClient } from "./CreditClient";

export const dynamic = "force-dynamic";

interface Account {
  id: string;
  document: string;
  holderName: string;
  limitCents: string;
  usedCents: string;
  status: string;
  score: number;
  blockedReason: string | null;
}

interface LimitRequest {
  id: string;
  currentLimitCents: string;
  requestedLimitCents: string;
  reason: string | null;
  status: string;
  createdAt: string;
  creditAccount: { id: string; holderName: string; document: string; limitCents: string };
}

export default async function CrediarioPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!session.user?.isOrgAdmin && !session.master) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-2xl border border-line bg-surface p-6 text-muted">
          Apenas administradores/gerentes podem gerenciar crediário.
        </p>
      </div>
    );
  }

  const [accRes, reqRes, appRes] = await Promise.all([
    apiFetch<{ items: Account[] }>("/api/credit/accounts"),
    apiFetch<{ items: LimitRequest[] }>("/api/credit/limit-requests?status=pending"),
    apiFetch<{ items: any[] }>("/api/credit/applications?status=pending"),
  ]);

  return (
    <div className="max-w-5xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configuração · Crediário
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Contas de crediário</h1>
        <p className="mt-2 text-muted">
          Limite por organização (vale em qualquer loja). Verde = em dia,
          laranja = perto do vencimento, vermelho = vencido, gradiente animado
          = inadimplente.
        </p>
      </header>

      <CreditClient
        initialAccounts={accRes.data?.items ?? []}
        initialRequests={reqRes.data?.items ?? []}
        initialApplications={appRes.data?.items ?? []}
      />
    </div>
  );
}
