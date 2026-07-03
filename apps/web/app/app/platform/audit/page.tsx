import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface AuditRow {
  created_at: string;
  action: string;
  severity: string;
  organization_id: string | null;
  org_name: string | null;
  actor_name: string | null;
  as_platform_admin: boolean;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  "impersonation.start": "Entrou como empresa",
  "impersonation.stop": "Saiu da empresa",
};

export default async function AuditPage() {
  const session = await getSession();
  if (!session.master || session.master.platformRole === "support") redirect("/app");

  const res = await apiFetch<{ items: AuditRow[] }>("/api/platform/audit");
  const rows = res.data?.items ?? [];

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master</p>
        <h1 className="mt-1 text-3xl font-semibold">Auditoria</h1>
        <p className="mt-2 text-muted">Ações sensíveis (impersonação e operações de plataforma).</p>
      </header>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Quando</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Quem</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">Nenhum registro ainda.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="border-t border-line/60 transition hover:bg-surface-2">
                <td className="px-4 py-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.severity === "warn" ? "bg-warn/15 text-warn" : "bg-surface-2 text-muted"}`}>
                    {ACTION_LABEL[r.action] ?? r.action}
                  </span>
                </td>
                <td className="px-4 py-3">{r.actor_name ?? (r.as_platform_admin ? "master" : "—")}</td>
                <td className="px-4 py-3">{r.org_name ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{r.ip_address ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
