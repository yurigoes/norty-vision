import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";

/** snake_case -> camelCase nas chaves de um objeto raso. */
function toCamelCase(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z0-9])/g, (_m, c) => String(c).toUpperCase());
    out[camel] = v;
  }
  return out;
}

/**
 * Singleton: PlatformSettings (id = 1).
 * - getPublic: campos visiveis na landing (sem auth).
 * - getFull: TUDO; so master.
 * - update: master only.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
  ) {}

  private genPassword(): string {
    return Math.random().toString(36).slice(-6) + Math.floor(1000 + Math.random() * 9000);
  }

  /** Cria um novo membro da equipe master com senha provisória (owner-only). */
  async createMember(input: { name: string; email: string; role: "owner" | "support" }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.findUnique({ where: { email } }),
    );
    if (existing) throw new AppError(ErrorCode.Conflict, "Já existe um master com esse e-mail", 409);
    const tempPassword = this.genPassword();
    const passwordHash = await this.argon.hash(tempPassword);
    const member = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.create({
        data: { name: input.name.trim(), email, role: input.role, passwordHash, status: "active", mfaEnabled: false },
        select: { id: true, email: true, name: true, role: true, status: true },
      }),
    );
    return { member, tempPassword };
  }

  /** Gera nova senha provisória pra um master (owner-only). Retorna a senha. */
  async resetMemberPassword(targetId: string) {
    const tempPassword = this.genPassword();
    const passwordHash = await this.argon.hash(tempPassword);
    const member = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.update({
        where: { id: targetId },
        data: { passwordHash, mfaEnabled: false, mfaSecret: null },
        select: { id: true, email: true, name: true },
      }),
    );
    // revoga sessões ativas
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformSession.updateMany({ where: { platformUserId: targetId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ).catch(() => undefined);
    return { member, tempPassword };
  }

  /** Ativa/inativa um master (owner-only). Impede inativar o último owner ativo. */
  async setMemberStatus(targetId: string, status: "active" | "inactive") {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const target = await tx.platformUser.findUnique({ where: { id: targetId } });
      if (!target) throw new AppError(ErrorCode.NotFound, "Master não encontrado", 404);
      if (status === "inactive" && target.role === "owner") {
        const owners = await tx.platformUser.count({ where: { role: "owner", status: "active" } });
        if (owners <= 1) throw new AppError(ErrorCode.ValidationFailed, "Não é possível inativar o último owner", 400);
      }
      if (status === "inactive") {
        await tx.platformSession.updateMany({ where: { platformUserId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return tx.platformUser.update({ where: { id: targetId }, data: { status }, select: { id: true, email: true, name: true, status: true } });
    });
  }

  async getPublic() {
    // tabela esta com RLS aberto pra SELECT (id=1 sempre);
    // ainda assim usamos view publica que filtra colunas sensiveis.
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM v_platform_public
    `;
    const row = rows[0];
    if (!row) {
      throw new AppError(ErrorCode.NotFound, "Platform settings not initialized", 404);
    }
    // a view retorna snake_case; o front consome camelCase (logoUrl, etc).
    // sem este mapeamento a logo/branding nunca aparece na landing/sistema.
    return toCamelCase(row);
  }

  async getFull(opts: { isPlatformAdmin: boolean }) {
    if (!opts.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas o master da plataforma pode ver as configuracoes completas", 403);
    }
    return this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.platformSettings.findUnique({ where: { id: 1 } }),
    );
  }

  async update(
    opts: { isPlatformAdmin: boolean; platformUserId?: string | null },
    patch: Record<string, unknown>,
  ) {
    if (!opts.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas o master pode editar", 403);
    }
    return this.prisma.runWithContext(
      { isPlatformAdmin: true },
      async (tx) => {
        // marca configured_at no primeiro update real
        const current = await tx.platformSettings.findUnique({ where: { id: 1 } });
        const data: Record<string, unknown> = {
          ...patch,
          updatedByPlatformUserId: opts.platformUserId ?? null,
        };
        if (!current?.configuredAt) {
          data.configuredAt = new Date();
        }
        return tx.platformSettings.update({ where: { id: 1 }, data });
      },
    );
  }

  /** Lista os masters da plataforma (owner-only). */
  async listTeam() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          techSpecsCategories: true,
          createdAt: true,
        },
      }),
    );
  }

  /** Categorias de Specs Técnicas disponíveis (das specs publicadas). */
  async specCategories(): Promise<string[]> {
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.$queryRaw<Array<{ category: string }>>`
      SELECT DISTINCT category FROM tech_spec_documents WHERE category IS NOT NULL AND category <> '' ORDER BY category`).catch(() => [] as any[]);
    return rows.map((r) => r.category);
  }

  /** Define quais categorias de Specs um master pode ver ("*" = todas). Owner-only. */
  async setSpecsAccess(targetId: string, categories: string[]) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const target = await tx.platformUser.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
      if (!target) throw new AppError(ErrorCode.NotFound, "Master não encontrado", 404);
      const cats = Array.from(new Set((categories ?? []).map((c) => String(c).trim()).filter(Boolean)));
      return tx.platformUser.update({ where: { id: targetId }, data: { techSpecsCategories: cats }, select: { id: true, name: true, techSpecsCategories: true } });
    });
  }

  /**
   * Define o papel de um master: 'owner' (dono, acesso total) ou 'support'
   * (suporte master, qualquer empresa exceto config do dono). Owner-only.
   * Impede rebaixar o ultimo owner ativo.
   */
  async setMemberRole(targetId: string, role: "owner" | "support") {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const target = await tx.platformUser.findUnique({ where: { id: targetId } });
      if (!target) throw new AppError(ErrorCode.NotFound, "Master nao encontrado", 404);
      if (target.role === "owner" && role === "support") {
        const owners = await tx.platformUser.count({
          where: { role: "owner", status: "active" },
        });
        if (owners <= 1) {
          throw new AppError(
            ErrorCode.ValidationFailed,
            "Nao e possivel rebaixar o ultimo owner",
            400,
          );
        }
      }
      return tx.platformUser.update({
        where: { id: targetId },
        data: { role },
        select: { id: true, email: true, name: true, role: true },
      });
    });
  }

  /** Log de auditoria (impersonação e ações sensíveis). Owner-only. */
  async listAudit(opts: { action?: string; organizationId?: string; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT a.created_at, a.action, a.severity, a.organization_id,
                a.actor_platform_user_id, a.actor_user_id, a.as_platform_admin,
                a.resource_type, a.resource_id, a.ip_address,
                o.name AS org_name, pu.name AS actor_name
           FROM audit_log a
           LEFT JOIN organizations o  ON o.id  = a.organization_id
           LEFT JOIN platform_users pu ON pu.id = a.actor_platform_user_id
          WHERE ($1::text IS NULL OR a.action = $1)
            AND ($2::uuid IS NULL OR a.organization_id = $2::uuid)
          ORDER BY a.created_at DESC
          LIMIT ${limit}`,
        opts.action ?? null,
        opts.organizationId ?? null,
      ),
    );
  }
}
