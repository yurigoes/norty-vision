"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

function gb(bytes: number): string { return (bytes / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " GB"; }
function gbFromKb(kb: number): string { return (kb / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " GB"; }
function dur(sec: number): string { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return [d ? `${d}d` : "", h ? `${h}h` : "", `${m}min`].filter(Boolean).join(" "); }

const CMDS: Array<{ label: string; cmd: string; hint: string }> = [
  { label: "Espaço em disco", cmd: "df -h", hint: "Quanto resta no HD." },
  { label: "Uso de RAM", cmd: "free -h", hint: "Memória usada/livre." },
  { label: "Maiores pastas", cmd: "du -h --max-depth=1 /opt 2>/dev/null | sort -rh | head", hint: "Onde o disco está sendo gasto." },
  { label: "Limpar imagens/containers não usados", cmd: "docker system prune -af", hint: "Remove imagens e containers parados (NÃO apaga volumes/dados)." },
  { label: "Limpar tudo, inclusive volumes órfãos", cmd: "docker system prune -af --volumes", hint: "⚠ Cuidado: remove volumes não usados. Confirme antes." },
  { label: "Limpar logs antigos do journald", cmd: "journalctl --vacuum-time=7d", hint: "Mantém só 7 dias de log do sistema." },
  { label: "Containers rodando", cmd: "docker ps", hint: "O que está no ar." },
  { label: "Atualizar e subir a plataforma", cmd: "bash infra/scripts/atualizar.sh", hint: "Puxa a dev e rebuilda (rodar em /opt/yugo-platform)." },
];

export function SistemaClient() {
  const dialog = useDialog();
  const [stats, setStats] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [backing, setBacking] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/system/stats", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setStats(d)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  async function backup() {
    setBacking(true);
    try {
      const res = await fetch("/api/system/backup", { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha no backup", "error"); return; }
      dialog.toast(`Backup gerado: ${d.filename} (${(d.sizeBytes / 1024 / 1024).toFixed(1)} MB)`, "success");
    } finally { setBacking(false); }
  }
  function copy(cmd: string) { navigator.clipboard?.writeText(cmd).then(() => dialog.toast("Comando copiado ✅", "success")).catch(() => {}); }

  const mem = stats?.mem; const cpu = stats?.cpu; const disks = stats?.disks ?? []; const docker = stats?.docker;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">{loading ? "Atualizando…" : stats ? `Host ${stats.host} · atualiza a cada 30s` : "Sem dados"}</p>
        <button onClick={load} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-brand">↻ Atualizar</button>
      </div>

      {/* RAM + CPU */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <p className="text-[10px] uppercase tracking-wider text-muted">Memória RAM</p>
          {mem ? (<>
            <p className="mt-1 text-xl font-semibold">{gb(mem.usedBytes)} <span className="text-sm text-muted">/ {gb(mem.totalBytes)}</span></p>
            <div className="mt-2 h-2 rounded-full bg-line"><div className={`h-2 rounded-full ${mem.usedPct > 85 ? "bg-red-500" : mem.usedPct > 70 ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${mem.usedPct}%` }} /></div>
            <p className="mt-1 text-[11px] text-muted">{mem.usedPct}% em uso · {gb(mem.freeBytes)} livre</p>
          </>) : <p className="mt-1 text-sm text-muted">—</p>}
        </div>
        <div className="card">
          <p className="text-[10px] uppercase tracking-wider text-muted">CPU / carga</p>
          {cpu ? (<>
            <p className="mt-1 text-xl font-semibold">{cpu.loadavg?.[0] ?? "—"} <span className="text-sm text-muted">load (1min)</span></p>
            <p className="mt-1 text-[11px] text-muted">{cpu.cores} núcleo(s) · 5min {cpu.loadavg?.[1]} · 15min {cpu.loadavg?.[2]}</p>
          </>) : <p className="mt-1 text-sm text-muted">—</p>}
        </div>
        <div className="card">
          <p className="text-[10px] uppercase tracking-wider text-muted">Uptime</p>
          <p className="mt-1 text-xl font-semibold">{cpu ? dur(cpu.uptimeSec) : "—"}</p>
          {stats?.node && <p className="mt-1 text-[11px] text-muted">API: {gb(stats.node.rssBytes)} RAM · Node {stats.node.version}</p>}
        </div>
      </div>

      {/* Disco */}
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold">Disco (HD)</h2>
        {disks.length === 0 ? <p className="text-xs text-muted">Sem dados de disco.</p> : disks.map((d: any) => (
          <div key={d.mount} className="mb-2">
            <div className="flex items-center justify-between text-xs"><span className="font-mono">{d.mount}</span><span className="text-muted">{gbFromKb(d.usedKb)} / {gbFromKb(d.sizeKb)} ({d.usedPct}%)</span></div>
            <div className="mt-1 h-2 rounded-full bg-line"><div className={`h-2 rounded-full ${d.usedPct > 85 ? "bg-red-500" : d.usedPct > 70 ? "bg-amber-400" : "bg-green-500"}`} style={{ width: `${d.usedPct}%` }} /></div>
          </div>
        ))}
      </section>

      {/* Backup */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Backup do banco</h2>
            <p className="mt-1 text-[11px] text-muted">Gera um dump completo do PostgreSQL (pg_dump) compactado e guarda no MinIO privado (backups/postgres/).</p>
          </div>
          <button disabled={backing} onClick={backup} className="btn-grad">{backing ? "Gerando…" : "Fazer backup agora"}</button>
        </div>
      </section>

      {/* Docker */}
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold">Containers</h2>
        {docker?.available ? (
          <>
            <div className="space-y-1">
              {(docker.containers ?? []).map((c: any) => (
                <div key={c.name} className="flex items-center justify-between rounded-lg border border-line/50 bg-bg/40 px-3 py-1.5 text-xs">
                  <span className="font-mono">{c.name}</span>
                  <span className={`${/up/i.test(c.status) ? "text-green-300" : "text-amber-200"}`}>{c.status}</span>
                </div>
              ))}
            </div>
            {docker.df && <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-bg/40 p-3 font-mono text-[11px]">{docker.df}</pre>}
          </>
        ) : (
          <p className="text-xs text-muted">Leitura do Docker indisponível de dentro do container (esperado, por segurança). Use os comandos abaixo via SSH/RustDesk no servidor.</p>
        )}
      </section>

      {/* Manutenção (comandos do servidor) */}
      <section className="card">
        <h2 className="mb-1 text-sm font-semibold">Manutenção do servidor</h2>
        <p className="mb-3 text-[11px] text-muted">Rode no terminal da VPS (SSH ou RustDesk), na pasta <code>/opt/yugo-platform</code>. Clique pra copiar.</p>
        <div className="space-y-2">
          {CMDS.map((c) => (
            <div key={c.cmd} className="rounded-lg border border-line/60 bg-bg/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{c.label}</span>
                <button onClick={() => copy(c.cmd)} className="rounded-md border border-line px-2 py-1 text-[11px] hover:border-brand">copiar</button>
              </div>
              <code className="mt-1 block overflow-x-auto whitespace-pre font-mono text-[11px] text-sky-300">{c.cmd}</code>
              <p className="mt-1 text-[10px] text-muted">{c.hint}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
