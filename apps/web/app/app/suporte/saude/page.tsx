import { apiFetch } from "../../../../lib/api";

export const dynamic = "force-dynamic";

interface Health {
  service: string;
  uptime_seconds: number;
  node_version: string;
  memory: { rss_mb: number; heap_used_mb: number; heap_total_mb: number };
  os: {
    total_mem_gb: string;
    free_mem_gb: string;
    load_avg_1m: string;
    platform: string;
    arch: string;
  };
  dependencies: { postgres: string; redis: string };
  timestamp: string;
}

interface Container {
  name: string;
  status: string;
  image: string;
}

export default async function SaudePage() {
  const [healthRes, containersRes] = await Promise.all([
    apiFetch<Health>("/api/support/health"),
    apiFetch<{ containers: Container[]; note?: string }>("/api/support/containers"),
  ]);
  const health = healthRes.data;
  const containers = containersRes.data?.containers ?? [];

  return (
    <div className="max-w-4xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Suporte · Saúde do sistema
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Status em tempo real</h1>
        <p className="mt-2 text-muted">
          Snapshot capturado em{" "}
          {health?.timestamp
            ? new Date(health.timestamp).toLocaleString("pt-BR")
            : "—"}.
        </p>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <DependencyCard
          label="API"
          status="up"
          detail={`up ${formatUptime(health?.uptime_seconds ?? 0)}`}
        />
        <DependencyCard
          label="PostgreSQL"
          status={health?.dependencies.postgres === "ok" ? "up" : "down"}
        />
        <DependencyCard
          label="Redis"
          status={health?.dependencies.redis === "ok" ? "up" : "down"}
        />
      </section>

      <section className="mb-8 rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Memória da API</h2>
        <div className="space-y-2 text-sm">
          <Row label="RSS" value={`${health?.memory.rss_mb ?? 0} MB`} />
          <Row label="Heap em uso" value={`${health?.memory.heap_used_mb ?? 0} MB`} />
          <Row label="Heap total" value={`${health?.memory.heap_total_mb ?? 0} MB`} />
          <Row
            label="Node"
            value={health?.node_version ?? "?"}
          />
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Host (VPS)</h2>
        <div className="space-y-2 text-sm">
          <Row label="Memória total" value={`${health?.os.total_mem_gb ?? "?"} GB`} />
          <Row label="Memória livre" value={`${health?.os.free_mem_gb ?? "?"} GB`} />
          <Row label="Load average (1m)" value={health?.os.load_avg_1m ?? "?"} />
          <Row label="Plataforma" value={`${health?.os.platform ?? "?"} ${health?.os.arch ?? ""}`} />
        </div>
      </section>

      <section className="rounded-xl border border-line bg-bg/60 p-6">
        <h2 className="mb-4 text-lg font-semibold">Containers</h2>
        {containers.length === 0 ? (
          <p className="text-sm text-muted">
            {containersRes.data?.note ??
              "Visualização de containers requer master e docker.sock montado."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-3">Nome</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Imagem</th>
                </tr>
              </thead>
              <tbody>
                {containers.map((c) => (
                  <tr key={c.name} className="border-t border-line/50">
                    <td className="py-2 pr-3 font-mono text-xs">{c.name}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-2 font-mono text-[11px] text-muted">{c.image}</td>
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

function DependencyCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: "up" | "down";
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
            status === "up"
              ? "bg-green-500/20 text-green-300"
              : "bg-red-500/20 text-red-300"
          }`}
        >
          {status}
        </span>
      </div>
      {detail && <p className="mt-2 text-xs text-muted">{detail}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = status.toLowerCase().includes("healthy");
  const restarting = status.toLowerCase().includes("restart");
  return (
    <span
      className={`text-[11px] ${
        ok ? "text-green-300" : restarting ? "text-yellow-300" : "text-muted"
      }`}
    >
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
