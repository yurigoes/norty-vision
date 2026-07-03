import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { loadEnv } from "../config";

export interface SessionContext {
  sessionId: string;
  userId: string;
  activeMembershipId: string | null;
  orgId: string | null;
  storeId: string | null;
  role: string | null;
  isOrgAdmin: boolean;
  isPlatformAdmin: boolean;
}

/**
 * Sessoes httpOnly:
 *  - Token raw = 32 bytes base64url (~43 chars). Vai no cookie httpOnly+Secure+SameSite=Strict.
 *  - Armazenamos APENAS sha256(token) na DB e como key em Redis (cache).
 *  - Redis acelera lookups (TTL = session_duration); DB e fonte da verdade.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  generateRawToken(): string {
    return randomBytes(32).toString("base64url");
  }

  hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  async create(opts: {
    userId: string;
    membershipId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ raw: string; expiresAt: Date }> {
    const env = loadEnv();
    const raw = this.generateRawToken();
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(Date.now() + env.SESSION_DURATION_DAYS * 86400_000);

    await this.prisma.runWithContext({ userId: opts.userId }, (tx) =>
      tx.session.create({
        data: {
          userId: opts.userId,
          activeMembershipId: opts.membershipId ?? null,
          tokenHash,
          ipAddress: opts.ipAddress ?? null,
          userAgent: opts.userAgent ?? null,
          expiresAt,
        },
      }),
    );

    return { raw, expiresAt };
  }

  async revoke(rawToken: string, reason: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async lookup(rawToken: string): Promise<SessionContext | null> {
    const tokenHash = this.hashToken(rawToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        activeMembership: {
          include: { role: true, organization: true, store: true },
        },
      },
    });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt < new Date()) return null;

    // bump last_seen_at (best-effort, async)
    this.prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => undefined);

    const m = session.activeMembership;
    const roleSlug = m?.role.slug ?? null;
    const isOrgAdmin = roleSlug === "owner" || roleSlug === "admin";

    return {
      sessionId: session.id,
      userId: session.userId,
      activeMembershipId: m?.id ?? null,
      orgId: m?.organizationId ?? null,
      storeId: m?.storeId ?? null,
      role: roleSlug,
      isOrgAdmin,
      isPlatformAdmin: false, // platform_users tem sessao separada (futuro)
    };
  }
}
