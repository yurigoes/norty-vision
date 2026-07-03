import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { ArgonService } from "./argon.service";
import { SessionService } from "./session.service";
import { MfaService } from "./mfa.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProvisioningService } from "../integrations/provisioning.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly session: SessionService,
    private readonly mfa: MfaService,
    private readonly provisioning: ProvisioningService,
  ) {}

  /** Troca a própria senha (autenticado). Limpa a flag must_reset. */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 8) {
      throw new AppError(ErrorCode.ValidationFailed, "A nova senha precisa ter ao menos 8 caracteres", 400);
    }
    const user = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.findUnique({ where: { id: userId } }),
    );
    if (!user) throw new AppError(ErrorCode.NotFound, "Usuário não encontrado", 404);
    const ok = await this.argon.verify(user.passwordHash, currentPassword);
    if (!ok) throw new AppError(ErrorCode.Unauthorized, "Senha atual incorreta", 401);
    const passwordHash = await this.argon.hash(newPassword);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.update({ where: { id: userId }, data: { passwordHash, mustResetPassword: false } }),
    );
    // propaga a senha pro Chatwoot + GLPI (best-effort, não bloqueia)
    await this.provisioning.syncUserPassword(userId, newPassword).catch(() => undefined);
    return { ok: true };
  }

  async login(opts: {
    email: string;
    password: string;
    mfaCode?: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    // quando o login vem pelo slug da empresa (ex.: zito-oticas.dominio/e/zito-oticas/login),
    // o usuário PRECISA ter membership ativo naquela empresa — senão 'credenciais inválidas',
    // mesmo sendo admin de outra. Isola o acesso por slug.
    orgSlug?: string | null;
  }): Promise<{
    rawToken: string;
    expiresAt: Date;
    userId: string;
  }> {
    const email = opts.email.toLowerCase().trim();

    // lookup bypassa RLS porque ainda nao temos contexto setado
    const user = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.user.findUnique({
          where: { email },
          include: {
            memberships: {
              where: { status: "active" },
              include: { role: true, organization: true, store: true },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
          },
        }),
    );

    if (!user) {
      // timing-attack safe: ainda assim roda argon
      await this.argon
        .verify(
          "$argon2id$v=19$m=19456,t=2,p=1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000",
          opts.password,
        )
        .catch(() => false);
      throw new AppError(ErrorCode.Unauthorized, "Credenciais invalidas", 401);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(
        ErrorCode.AccountLocked,
        "Conta temporariamente bloqueada apos tentativas mal-sucedidas",
        423,
      );
    }

    if (user.status !== "active") {
      throw new AppError(ErrorCode.Forbidden, "Conta nao esta ativa", 403);
    }

    const ok = await this.argon.verify(user.passwordHash, opts.password);
    if (!ok) {
      const updated = await this.prisma.runWithContext(
        { isPlatformAdmin: true },
        (tx) =>
          tx.user.update({
            where: { id: user.id },
            data: { failedLoginCount: { increment: 1 } },
          }),
      );
      const failed = updated.failedLoginCount;
      let lockMinutes = 0;
      if (failed >= 15) lockMinutes = 60 * 24;
      else if (failed >= 10) lockMinutes = 60;
      else if (failed >= 5) lockMinutes = 15;
      if (lockMinutes > 0) {
        await this.prisma.runWithContext(
          { isPlatformAdmin: true },
          (tx) =>
            tx.user.update({
              where: { id: user.id },
              data: { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) },
            }),
        );
      }
      throw new AppError(ErrorCode.Unauthorized, "Credenciais invalidas", 401);
    }

    // MFA: se ativo, exige codigo
    if (user.mfaEnabled && user.mfaSecret) {
      if (!opts.mfaCode) {
        throw new AppError(
          ErrorCode.MfaRequired,
          "Codigo de 2FA obrigatorio",
          401,
        );
      }
      if (!this.mfa.verifyCode(user.mfaSecret, opts.mfaCode)) {
        throw new AppError(ErrorCode.MfaInvalid, "Codigo 2FA invalido", 401);
      }
    }

    // rehash se parametros mudaram
    if (this.argon.needsRehash(user.passwordHash)) {
      const newHash = await this.argon.hash(opts.password);
      await this.prisma.runWithContext(
        { isPlatformAdmin: true },
        (tx) =>
          tx.user.update({
            where: { id: user.id },
            data: { passwordHash: newHash },
          }),
      );
    }

    // reset bloqueios + last_login
    await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
            lastLoginIp: opts.ipAddress ?? null,
          },
        }),
    );

    // isolamento por slug: o login SEMPRE é escopado a uma empresa.
    //  - pelo endereço de uma empresa (subdomínio/rota): escopa àquele slug.
    //  - no apex (yugochat.com.br, sem slug): escopa à empresa dona do SaaS
    //    (PLATFORM_ORG_SLUG = "yugo"). Assim só a equipe da yugo loga no apex;
    //    cada empresa cliente entra pelo endereço do seu próprio slug.
    // Quem não tem membership ativo na empresa escopada recebe "Credenciais
    // invalidas" (mesma mensagem genérica, não revela em qual empresa o e-mail existe).
    const platformSlug = (process.env.PLATFORM_ORG_SLUG ?? "yugo").toLowerCase();
    const wantSlug = (opts.orgSlug ?? "").trim().toLowerCase() || platformSlug;
    const scoped = user.memberships.find((m) => (m.organization?.slug ?? "").toLowerCase() === wantSlug);
    if (!scoped) {
      throw new AppError(ErrorCode.Unauthorized, "Credenciais invalidas", 401);
    }
    const defaultMembership = scoped;

    const { raw, expiresAt } = await this.session.create({
      userId: user.id,
      membershipId: defaultMembership?.id ?? null,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    });

    return { rawToken: raw, expiresAt, userId: user.id };
  }
}
