import { apiFetch } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface BackupJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  destination: string;
  status: string;
}

interface BackupStatus {
  jobs: BackupJob[];
  retention: {
    postgres_dumps_days: number;
    encryption: string;
  };
}

export default async function BackupPage() {
  const { data } = await apiFetch<BackupStatus>("/api/support/backup");
  const jobs = data?.jobs ?? [];

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte · Backup
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Política de backup</h1>
        <p className="mt-2 text-muted">
          Jobs agendados, retenção e criptografia em repouso.
        </p>
      </header>

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Jobs agendados</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-muted">Nenhum job configurado.</p>
        ) : (
          <div className="space-y-4">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="rounded-lg border border-line/70 bg-bg/40 p-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{j.name}</h3>
                  <StatusPill status={j.status} />
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <Field label="Agendamento" value={j.schedule} mono />
                  <Field
                    label="Habilitado"
                    value={j.enabled ? "Sim" : "Não"}
                  />
                  <Field
                    label="Última execução"
                    value={
                      j.last_run_at
                        ? new Date(j.last_run_at).toLocaleString("pt-BR")
                        : "—"
                    }
                  />
                  <Field label="Último status" value={j.last_status ?? "—"} />
                  <div className="sm:col-span-2">
                    <Field label="Destino" value={j.destination} mono />
                  </div>
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mb-8">
        <h2 className="mb-4 text-lg font-semibold">Retenção & criptografia</h2>
        <div className="space-y-2 text-sm">
          <Row
            label="Dumps Postgres mantidos por"
            value={`${data?.retention.postgres_dumps_days ?? 30} dias`}
          />
          <Row
            label="Criptografia em repouso"
            value={data?.retention.encryption ?? "—"}
          />
        </div>
      </section>

      <section className="card">
        <h2 className="mb-4 text-lg font-semibold">Restauração</h2>
        <p className="text-sm text-muted">
          Para restaurar um dump, abra um chamado em{" "}
          <span className="font-semibold text-fg">/app/suporte/ajuda</span> ou
          contate o time pelo e-mail{" "}
          <span className="font-mono text-xs">suporte@yugochat.com.br</span>.
          Restaurações em produção são executadas manualmente após validação do
          motivo e da janela de manutenção.
        </p>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ok: "bg-green-500/20 text-green-300",
    running: "bg-blue-500/20 text-blue-300",
    failed: "bg-red-500/20 text-red-300",
    not_configured: "bg-yellow-500/20 text-yellow-300",
  };
  const label: Record<string, string> = {
    ok: "ok",
    running: "rodando",
    failed: "falhou",
    not_configured: "não configurado",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
        styles[status] ?? "bg-line/30 text-muted"
      }`}
    >
      {label[status] ?? status}
    </span>
  );
}

function Field({
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
