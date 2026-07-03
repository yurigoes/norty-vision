import { apiFetch } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface PrivacyOverview {
  customers?: number;
  users?: number;
  access_last_7d?: number;
  access_last_30d?: number;
  retention_days: number;
  encryption:
    | string
    | {
        in_transit: string;
        at_rest_passwords: string;
        at_rest_tokens: string;
      };
  compliance?: {
    lgpd: boolean;
    gdpr: string;
  };
  dpo_contact: string;
}

interface AccessLogItem {
  id: string;
  created_at: string;
  organization_id: string | null;
  store_id: string | null;
  actor_user_id: string | null;
  subject_type: string;
  subject_id: string;
  purpose: string | null;
  ip_address: string | null;
}

export default async function PrivacidadePage() {
  const [overviewRes, accessRes] = await Promise.all([
    apiFetch<PrivacyOverview>("/api/support/privacy/overview"),
    apiFetch<{ items: AccessLogItem[] }>(
      "/api/support/privacy/recent-access?limit=25",
    ),
  ]);
  const overview = overviewRes.data;
  const accesses = accessRes.data?.items ?? [];

  const encryptionObj =
    typeof overview?.encryption === "object" ? overview.encryption : null;

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte · Privacidade & LGPD
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Como tratamos seus dados</h1>
        <p className="mt-2 text-muted">
          Retenção, criptografia, e trilha de auditoria de acessos.
        </p>
      </header>

      {(overview?.customers !== undefined ||
        overview?.users !== undefined) && (
        <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {overview?.customers !== undefined && (
            <StatCard label="Clientes ativos" value={overview.customers} />
          )}
          {overview?.users !== undefined && (
            <StatCard label="Usuários ativos" value={overview.users} />
          )}
          {overview?.access_last_7d !== undefined && (
            <StatCard
              label="Acessos (7d)"
              value={overview.access_last_7d}
            />
          )}
          {overview?.access_last_30d !== undefined && (
            <StatCard
              label="Acessos (30d)"
              value={overview.access_last_30d}
            />
          )}
        </section>
      )}

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Retenção & criptografia</h2>
        <div className="space-y-2 text-sm">
          <Row
            label="Retenção padrão"
            value={`${overview?.retention_days ?? 365} dias`}
          />
          {encryptionObj ? (
            <>
              <Row
                label="Em trânsito"
                value={encryptionObj.in_transit}
              />
              <Row
                label="Senhas (em repouso)"
                value={encryptionObj.at_rest_passwords}
              />
              <Row
                label="Tokens (em repouso)"
                value={encryptionObj.at_rest_tokens}
              />
            </>
          ) : (
            <Row label="Criptografia" value={String(overview?.encryption ?? "—")} />
          )}
          {overview?.compliance && (
            <>
              <Row
                label="LGPD"
                value={overview.compliance.lgpd ? "Conformidade ativa" : "Não"}
              />
              <Row label="GDPR" value={overview.compliance.gdpr} />
            </>
          )}
          <Row label="DPO" value={overview?.dpo_contact ?? "—"} />
        </div>
      </section>

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Direitos do titular</h2>
        <ul className="space-y-2 text-sm text-muted">
          <li>
            <strong className="text-fg">Acesso:</strong> você pode requisitar
            uma cópia dos seus dados a qualquer momento.
          </li>
          <li>
            <strong className="text-fg">Correção:</strong> dados incorretos
            podem ser atualizados pelo painel ou via suporte.
          </li>
          <li>
            <strong className="text-fg">Exclusão:</strong> mediante solicitação
            ao DPO, com exceções para dados de obrigação legal (fiscais, p.ex.).
          </li>
          <li>
            <strong className="text-fg">Portabilidade:</strong> exportação em
            formato aberto (CSV/JSON) sob demanda.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">
          Acessos recentes a dados pessoais
        </h2>
        {accesses.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhum acesso registrado nas últimas entradas, ou trilha ainda não
            ativa para sua conta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3">Quando</th>
                  <th className="pb-2 pr-3">Tipo</th>
                  <th className="pb-2 pr-3">Finalidade</th>
                  <th className="pb-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {accesses.map((a) => (
                  <tr key={a.id} className="border-t border-line/50">
                    <td className="py-2 pr-3 font-mono text-[11px]">
                      {new Date(a.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-2 pr-3">{a.subject_type}</td>
                    <td className="py-2 pr-3 text-muted">
                      {a.purpose ?? "—"}
                    </td>
                    <td className="py-2 font-mono text-[11px] text-muted">
                      {a.ip_address ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{Number(value).toLocaleString("pt-BR")}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
