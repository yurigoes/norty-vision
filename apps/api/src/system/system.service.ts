import { Injectable, Logger } from "@nestjs/common";
import * as os from "os";
import { execFile, spawn } from "child_process";
import { gzipSync } from "zlib";
import { AppError, ErrorCode } from "@yugo/shared";
import { StorageService } from "../storage/storage.service";
import { loadEnv } from "../config";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Operações de servidor (somente master da plataforma): métricas de RAM/disco,
 * backup do banco (pg_dump → MinIO) e leitura best-effort do docker. Comandos
 * que mexem no host (prune/limpeza) ficam como receitas prontas pra rodar via
 * SSH/RustDesk — o container roda não-root e endurecido, então não executamos
 * docker prune de dentro dele.
 */
@Injectable()
export class SystemService {
  private readonly logger = new Logger("System");
  private readonly env = loadEnv();
  constructor(private readonly storage: StorageService) {}

  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas o master da plataforma", 403);
  }

  private run(cmd: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(cmd, args, { timeout: opts.timeoutMs ?? 15000, maxBuffer: 64 * 1024 * 1024, env: opts.env ?? process.env }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? (err as any)?.message ?? "") });
      });
    });
  }

  async stats(ctx: RequestContext) {
    this.requireMaster(ctx);
    const totalMem = os.totalmem(), freeMem = os.freemem();
    const mem = { totalBytes: totalMem, freeBytes: freeMem, usedBytes: totalMem - freeMem, usedPct: Math.round(((totalMem - freeMem) / totalMem) * 100) };
    const proc = process.memoryUsage();
    const cpu = { cores: os.cpus().length, loadavg: os.loadavg().map((n) => Math.round(n * 100) / 100), uptimeSec: Math.round(os.uptime()) };

    // disco (df -hP) — best-effort; mostra os pontos de montagem relevantes
    let disks: Array<{ mount: string; sizeKb: number; usedKb: number; availKb: number; usedPct: number }> = [];
    const df = await this.run("df", ["-kP"]).catch(() => ({ ok: false, stdout: "", stderr: "" }));
    if (df.ok) {
      disks = df.stdout.trim().split("\n").slice(1).map((l) => {
        const p = l.trim().split(/\s+/);
        // Filesystem 1024-blocks Used Available Capacity Mounted
        const sizeKb = Number(p[1] ?? 0), usedKb = Number(p[2] ?? 0), availKb = Number(p[3] ?? 0);
        return { mount: p[5] ?? p[p.length - 1] ?? "?", sizeKb, usedKb, availKb, usedPct: sizeKb > 0 ? Math.round((usedKb / sizeKb) * 100) : 0 };
      }).filter((d) => /^\/(app|data|$)|^\/$|^\/data|^\/app/.test(d.mount) || d.sizeKb > 0).slice(0, 8);
    }

    // docker (best-effort: só funciona se o socket estiver montado e acessível)
    let docker: { available: boolean; df?: string; containers?: Array<{ name: string; status: string; image: string }> } = { available: false };
    const dps = await this.run("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"]).catch(() => ({ ok: false, stdout: "", stderr: "" }));
    if (dps.ok) {
      const containers = dps.stdout.trim().split("\n").filter(Boolean).map((l) => { const [name, status, image] = l.split("\t"); return { name: name ?? "", status: status ?? "", image: image ?? "" }; });
      const ddf = await this.run("docker", ["system", "df"]).catch(() => ({ ok: false, stdout: "", stderr: "" }));
      docker = { available: true, df: ddf.ok ? ddf.stdout.trim() : undefined, containers };
    }

    return {
      now: new Date().toISOString(),
      host: os.hostname(),
      mem, cpu,
      node: { rssBytes: proc.rss, heapUsedBytes: proc.heapUsed, version: process.version },
      disks,
      docker,
    };
  }

  /** Backup do banco: pg_dump → gzip → MinIO privado. Requer postgresql-client na imagem. */
  async backupDatabase(ctx: RequestContext) {
    this.requireMaster(ctx);
    let u: URL;
    try { u = new URL(this.env.DATABASE_URL); } catch { throw new AppError(ErrorCode.Internal, "DATABASE_URL inválida", 500); }
    const db = u.pathname.replace(/^\//, "") || "yugo";
    const args = ["-h", u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username), "-d", db, "--no-owner", "--no-privileges", "-Fp"];
    const res = await new Promise<{ ok: boolean; out: Buffer; err: string }>((resolve) => {
      const chunks: Buffer[] = []; const errs: string[] = [];
      const cp = spawn("pg_dump", args, { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
      cp.stdout.on("data", (c: Buffer) => chunks.push(c));
      cp.stderr.on("data", (c: Buffer) => errs.push(c.toString()));
      cp.on("error", (e: Error) => resolve({ ok: false, out: Buffer.alloc(0), err: e.message }));
      cp.on("close", (code: number) => resolve({ ok: code === 0, out: Buffer.concat(chunks), err: errs.join("") }));
    });
    if (!res.ok || res.out.length === 0) {
      throw new AppError(ErrorCode.Internal, `Falha no pg_dump (postgresql-client instalado na imagem?): ${res.err.slice(0, 300)}`, 500);
    }
    const gz = gzipSync(res.out);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const { key } = await this.storage.putPrivate({ keyPrefix: "backups/postgres", contentType: "application/gzip", body: gz, originalName: `${db}-${stamp}.sql.gz` });
    this.logger.log(`backup do banco gerado: ${key} (${gz.length} bytes)`);
    return { ok: true, key, sizeBytes: gz.length, rawBytes: res.out.length, filename: `${db}-${stamp}.sql.gz`, createdAt: new Date().toISOString() };
  }
}
