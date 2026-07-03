import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

@Injectable()
export class SupportService {
  private readonly bootTime = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // --------------------------------------------------------------------------
  // AJUDA
  // --------------------------------------------------------------------------
  async listHelp(opts: { isMaster: boolean }) {
    return this.prisma.runWithContext(
      { isPlatformAdmin: opts.isMaster },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT id, slug, category, title, summary, display_order, tags
            FROM help_articles
           WHERE is_published = true
             AND (organization_id IS NULL OR organization_id = app.current_org_id())
           ORDER BY category, display_order
        `,
    );
  }

  async getHelpBySlug(slug: string, opts: { isMaster: boolean }) {
    const rows = await this.prisma.runWithContext(
      { isPlatformAdmin: opts.isMaster },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT * FROM help_articles
           WHERE slug = ${slug}
             AND is_published = true
             AND (organization_id IS NULL OR organization_id = app.current_org_id())
           LIMIT 1
        `,
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // GUIA DO SISTEMA
  // --------------------------------------------------------------------------
  async listGuideSections(opts: { isMaster: boolean }) {
    return this.prisma.runWithContext(
      { isPlatformAdmin: opts.isMaster },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT id, parent_id, depth, path, slug, title, module, display_order
            FROM system_guide_sections
           WHERE is_published = true
           ORDER BY module, depth, display_order
        `,
    );
  }

  async getGuideByPath(path: string, opts: { isMaster: boolean }) {
    const rows = await this.prisma.runWithContext(
      { isPlatformAdmin: opts.isMaster },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT * FROM system_guide_sections
           WHERE path = ${path}
             AND is_published = true
           LIMIT 1
        `,
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // SPECS (com unlock)
  // --------------------------------------------------------------------------
  async listSpecs(opts: { isMaster: boolean }) {
    return this.prisma.runWithContext(
      {
        isPlatformAdmin: opts.isMaster,
        techSpecsCategories: opts.isMaster ? ["*"] : [],
      } as any,
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT id, slug, category, title, summary, display_order
            FROM tech_spec_documents
           WHERE is_published = true
             AND ${opts.isMaster}
           ORDER BY category, display_order
        `,
    );
  }

  async getSpecBySlug(slug: string, opts: { isMaster: boolean }) {
    if (!opts.isMaster) return null;
    const rows = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT * FROM tech_spec_documents WHERE slug = ${slug} LIMIT 1
        `,
    );
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // SAÚDE DO SISTEMA
  // --------------------------------------------------------------------------
  async getHealth() {
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    // checa Postgres
    let postgres: "ok" | "down" = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      postgres = "ok";
    } catch {}

    // checa Redis
    let redis: "ok" | "down" = "down";
    try {
      await this.redis.client.ping();
      redis = "ok";
    } catch {}

    return {
      service: "yugo-api",
      version: "0.0.0",
      uptime_seconds: Math.floor((Date.now() - this.bootTime) / 1000),
      node_version: process.version,
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      os: {
        total_mem_gb: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        free_mem_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2),
        load_avg_1m: os.loadavg()[0]?.toFixed(2),
        platform: os.platform(),
        arch: os.arch(),
      },
      dependencies: {
        postgres,
        redis,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async getContainersStatus(opts: { isMaster: boolean }) {
    if (!opts.isMaster) {
      return { containers: [], note: "Apenas master pode ver containers" };
    }
    // chama docker via socket - precisa /var/run/docker.sock montado.
    // Sem isso, retorna placeholder com info estatica.
    try {
      const { stdout } = await execAsync(
        "docker ps --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>&1",
        { timeout: 5000 },
      );
      const containers = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, status, image] = line.split("|");
          return { name, status, image };
        });
      return { containers };
    } catch (e: any) {
      return {
        containers: [],
        note: "docker.sock nao acessivel - ver via SSH",
        error: e?.message ?? "",
      };
    }
  }

  // --------------------------------------------------------------------------
  // BACKUP
  // --------------------------------------------------------------------------
  async getBackupStatus() {
    // por enquanto: info estatica + ultima entrada (quando implementarmos jobs)
    return {
      jobs: [
        {
          id: "postgres-daily",
          name: "Postgres dump diario",
          schedule: "0 3 * * *",
          enabled: false,
          last_run_at: null,
          last_status: null,
          destination: "minio://yugo-platform/backups/postgres/",
          status: "not_configured",
        },
        {
          id: "minio-rsync-weekly",
          name: "MinIO snapshot semanal",
          schedule: "0 4 * * 0",
          enabled: false,
          last_run_at: null,
          last_status: null,
          destination: "external (a configurar)",
          status: "not_configured",
        },
      ],
      retention: {
        postgres_dumps_days: 30,
        encryption: "age (X25519)",
      },
      docs_url: "/app/suporte/backup",
    };
  }

  // --------------------------------------------------------------------------
  // PRIVACIDADE / LGPD
  // --------------------------------------------------------------------------
  async getRecentDataAccess(opts: { isMaster: boolean; limit?: number }) {
    const limit = Math.min(opts.limit ?? 50, 500);
    return this.prisma.runWithContext(
      { isPlatformAdmin: opts.isMaster },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT id, created_at, organization_id, store_id, actor_user_id,
                 subject_type, subject_id, purpose, ip_address
            FROM data_access_log
           ORDER BY created_at DESC
           LIMIT ${limit}
        `,
    );
  }

  async getPrivacityOverview(opts: { isMaster: boolean }) {
    if (!opts.isMaster) {
      return {
        retention_days: 365,
        encryption: "TLS 1.3 + Argon2id",
        dpo_contact: "privacidade@yugochat.com.br",
      };
    }

    const counts = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.$queryRaw<Array<any>>`
          SELECT
            (SELECT count(*) FROM customers WHERE deleted_at IS NULL) as customers,
            (SELECT count(*) FROM users WHERE status = 'active') as users,
            (SELECT count(*) FROM data_access_log WHERE created_at > now() - interval '7 days') as access_last_7d,
            (SELECT count(*) FROM data_access_log WHERE created_at > now() - interval '30 days') as access_last_30d
        `,
    );

    return {
      ...counts[0],
      retention_days: 365,
      encryption: {
        in_transit: "TLS 1.3",
        at_rest_passwords: "Argon2id (PHC)",
        at_rest_tokens: "SHA-256",
      },
      compliance: {
        lgpd: true,
        gdpr: "partial (sem DPO formal)",
      },
      dpo_contact: "privacidade@yugochat.com.br",
    };
  }
}
