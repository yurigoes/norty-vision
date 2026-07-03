import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { loadEnv } from "../config";
import type { EmployeeContext } from "./employee-context";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

@Injectable()
export class EmployeeAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
  ) {}

  /**
   * Resolve o id da org a partir do slug. Sem slug (apex yugochat.com.br),
   * escopa pra empresa dona do SaaS (PLATFORM_ORG_SLUG) — nunca puxa empresa
   * cliente. Assim o apex só acha funcionário da yugo.
   */
  private async resolveOrgId(orgSlug?: string | null): Promise<string | null> {
    const slug = (orgSlug ?? "").trim().toLowerCase() || loadEnv().PLATFORM_ORG_SLUG.toLowerCase();
    if (!slug) return null;
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1
      `,
    );
    return rows[0]?.id ?? null;
  }

  private async findByCpf(cpf: string, orgSlug?: string | null) {
    const doc = cpf.replace(/\D/g, "");
    if (!doc) return null;
    // O funcionário SEMPRE pertence a uma empresa. Sem o slug (entrando pelo
    // domínio genérico) não localizamos ninguém — evita "vazar" funcionário de
    // outra empresa. O acesso correto é pelo link da empresa (slug.dominio).
    const orgId = await this.resolveOrgId(orgSlug);
    if (!orgId) return null;
    const e = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employee.findFirst({
        where: { cpf: doc, organizationId: orgId, status: { in: ["active", "inactive"] } },
        orderBy: { createdAt: "asc" },
      }),
    );
    return e;
  }

  async loginPassword(cpf: string, password: string, ip?: string, ua?: string, orgSlug?: string | null) {
    const e = await this.findByCpf(cpf, orgSlug);
    if (!e) throw new AppError(ErrorCode.Unauthorized, "Credenciais inválidas", 401);

    let ok = false;
    let mustReset = e.mustResetPassword;
    // SENHA ÚNICA: se o funcionário está vinculado a um usuário do sistema
    // (employee.userId), a senha é a do User (fonte única) — assim trocar a
    // senha no portal admin OU no portal do funcionário reflete nos dois.
    const linkedUser = e.userId
      ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.user.findFirst({ where: { id: e.userId! }, select: { passwordHash: true, status: true } }))
      : null;
    if (linkedUser) {
      if (linkedUser.status !== "active") throw new AppError(ErrorCode.Unauthorized, "Conta bloqueada. Procure o RH/gestor.", 401);
      if (linkedUser.passwordHash) { ok = await this.argon.verify(linkedUser.passwordHash, password); mustReset = false; }
    } else if (e.passwordHash) {
      ok = await this.argon.verify(e.passwordHash, password);
    } else {
      // senha inicial = CPF (sem pontuação)
      ok = password.replace(/\D/g, "") === (e.cpf ?? "");
      mustReset = true;
    }
    if (!ok) throw new AppError(ErrorCode.Unauthorized, "Credenciais inválidas", 401);

    const session = await this.createSession(e.id, e.organizationId, ip, ua);
    return { ...session, mustReset };
  }

  async setPassword(ctx: EmployeeContext, password: string) {
    if (password.length < 8) {
      throw new AppError(ErrorCode.ValidationFailed, "Senha precisa de no mínimo 8 caracteres", 400);
    }
    if (password.replace(/\D/g, "") === ctx.cpf) {
      throw new AppError(ErrorCode.ValidationFailed, "A nova senha não pode ser o seu CPF", 400);
    }
    const hash = await this.argon.hash(password);
    // SENHA ÚNICA: se vinculado a um usuário do sistema, grava no User (a senha
    // do portal do funcionário e a do admin são a mesma). Senão, no Employee.
    const e = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employee.findFirst({ where: { id: ctx.employeeId }, select: { userId: true } }),
    );
    if (e?.userId) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.user.update({ where: { id: e.userId! }, data: { passwordHash: hash, mustResetPassword: false } }),
      );
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.employee.update({ where: { id: ctx.employeeId }, data: { mustResetPassword: false } }),
      );
    } else {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.employee.update({ where: { id: ctx.employeeId }, data: { passwordHash: hash, mustResetPassword: false } }),
      );
    }
    return { ok: true };
  }

  private async createSession(employeeId: string, organizationId: string, ip?: string, ua?: string) {
    const env = loadEnv();
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + env.EMPLOYEE_SESSION_DURATION_DAYS * 86400_000);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employeeSession.create({
        data: { organizationId, employeeId, tokenHash, ipAddress: ip ?? null, userAgent: ua ?? null, expiresAt },
      }),
    );
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employee.update({ where: { id: employeeId }, data: { portalLastLoginAt: new Date() } }),
    );
    return { rawToken, expiresAt };
  }

  async resolveSession(rawToken: string): Promise<EmployeeContext | null> {
    const tokenHash = sha256(rawToken);
    const sess = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employeeSession.findUnique({ where: { tokenHash } }),
    );
    if (!sess || sess.revokedAt || sess.expiresAt < new Date()) return null;
    const e = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employee.findFirst({ where: { id: sess.employeeId } }),
    );
    if (!e || e.status === "terminated") return null;
    return {
      employeeId: e.id,
      organizationId: e.organizationId,
      storeId: e.storeId,
      name: e.name,
      cpf: e.cpf ?? "",
    };
  }

  /** Se ainda precisa trocar senha no 1º acesso. */
  async mustReset(employeeId: string): Promise<boolean> {
    const e = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employee.findFirst({ where: { id: employeeId }, select: { mustResetPassword: true } }),
    );
    return e?.mustResetPassword ?? false;
  }

  async logout(rawToken: string) {
    const tokenHash = sha256(rawToken);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.employeeSession.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } }),
    );
  }
}
