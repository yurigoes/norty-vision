import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

const ADMIN = { isPlatformAdmin: true as const };
function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }

function durationToExpiry(d: string): Date | null {
  const now = Date.now();
  if (d === "24h") return new Date(now + 24 * 3600_000);
  if (d === "30d") return new Date(now + 30 * 86400_000);
  if (d === "90d") return new Date(now + 90 * 86400_000);
  return null; // sempre
}

@Injectable()
export class SupportAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
  }
  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? ADMIN : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  async list(ctx: RequestContext, organizationId: string) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.supportAccessGrant.findMany({ where: { organizationId }, orderBy: { grantedAt: "desc" }, take: 100 }),
    );
  }

  /** Gera um acesso de suporte (chave exibida 1x). */
  async grant(ctx: RequestContext, organizationId: string, duration: "24h" | "30d" | "90d" | "sempre") {
    this.requireMaster(ctx);
    const rawKey = `sup_${randomBytes(18).toString("base64url")}`;
    const grant = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.supportAccessGrant.create({
        data: {
          organizationId, keyPrefix: rawKey.slice(0, 10), keyHash: sha256(rawKey),
          duration, expiresAt: durationToExpiry(duration),
          createdByPlatformUserId: ctx.platformUserId ?? null,
        },
      }),
    );
    return { grant, key: rawKey };
  }

  async revoke(ctx: RequestContext, id: string, reason?: string | null) {
    // master OU a própria empresa podem revogar
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) throw new AppError(ErrorCode.Forbidden, "Sem permissão", 403);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supportAccessGrant.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason ?? null } }),
    ).then(() => ({ ok: true }));
  }

  /** A empresa lista seus acessos de suporte ativos (pode revogar). */
  async listForOrg(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const now = new Date();
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supportAccessGrant.findMany({ where: { organizationId: ctx.orgId! }, orderBy: { grantedAt: "desc" }, take: 50 }),
    );
    return items.map((g) => ({
      id: g.id, duration: g.duration, grantedAt: g.grantedAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt,
      active: !g.revokedAt && (g.expiresAt == null || g.expiresAt > now),
    }));
  }

  /** Usado pela impersonação: existe acesso de suporte ativo p/ esta empresa? */
  async hasActiveGrant(organizationId: string): Promise<boolean> {
    const now = new Date();
    const g = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.supportAccessGrant.findFirst({
        where: { organizationId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        select: { id: true },
      }),
    );
    return !!g;
  }
}
