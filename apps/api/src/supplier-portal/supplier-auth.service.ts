import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { createHash, randomBytes, randomInt } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { EvolutionAdapter } from "../integrations/adapters/evolution.adapter";
import { loadEnv } from "../config";
import type { SupplierContext } from "./supplier-context";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

@Injectable()
export class SupplierAuthService {
  private readonly logger = new Logger("SupplierAuth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * 2FA por WhatsApp: gera um código de 6 dígitos, guarda o hash em otp_codes
   * (purpose=supplier_portal) e envia pelo WhatsApp da empresa (instância = slug).
   */
  async requestLoginOtp(identifier: string, orgSlug?: string | null) {
    const sup = await this.findSupplier(identifier, orgSlug);
    if (!sup) throw new AppError(ErrorCode.Unauthorized, "Fornecedor não encontrado", 401);
    const phone = (sup.phone ?? "").replace(/\D/g, "");
    if (!phone) throw new AppError(ErrorCode.ValidationFailed, "Fornecedor sem telefone cadastrado para 2FA", 400);

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`
        INSERT INTO otp_codes (destination, channel, purpose, code_hash, expires_at)
        VALUES (${phone}, 'whatsapp', 'supplier_portal', ${sha256(code)}, ${expiresAt})
      `,
    );

    // envia pelo WhatsApp da empresa (instância Evolution = slug da org)
    try {
      const orgRows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$queryRaw<Array<{ slug: string }>>`SELECT slug FROM organizations WHERE id = ${sup.organizationId}::uuid LIMIT 1`,
      );
      const instanceName = orgRows[0]?.slug;
      const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "evolution" });
      if (instanceName && cfg?.baseUrl && cfg.apiKey) {
        const adapter = new EvolutionAdapter({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
        await adapter.sendText({
          instanceName,
          number: phone,
          text: `Seu código de acesso ao portal é ${code}. Válido por 10 minutos.`,
        });
      }
    } catch (e: any) {
      this.logger.warn(`falha ao enviar OTP fornecedor: ${e?.message}`);
    }
    // telefone mascarado pra UI
    const masked = phone.length >= 4 ? `••••${phone.slice(-4)}` : "••••";
    return { sent: true, phoneMasked: masked };
  }

  /** Valida o código e cria a sessão. */
  async verifyLoginOtp(identifier: string, code: string, ip?: string, ua?: string, orgSlug?: string | null) {
    const sup = await this.findSupplier(identifier, orgSlug);
    if (!sup) throw new AppError(ErrorCode.Unauthorized, "Fornecedor não encontrado", 401);
    const phone = (sup.phone ?? "").replace(/\D/g, "");
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string; code_hash: string; attempts: number; max_attempts: number }>>`
        SELECT id, code_hash, attempts, max_attempts FROM otp_codes
         WHERE destination = ${phone} AND purpose = 'supplier_portal'
           AND used_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1
      `,
    );
    const otp = rows[0];
    if (!otp) throw new AppError(ErrorCode.Unauthorized, "Código expirado. Peça um novo.", 401);
    if (otp.attempts >= otp.max_attempts) {
      throw new AppError(ErrorCode.Unauthorized, "Muitas tentativas. Peça um novo código.", 401);
    }
    if (otp.code_hash !== sha256(code.replace(/\D/g, ""))) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRaw`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}::uuid`,
      );
      throw new AppError(ErrorCode.Unauthorized, "Código inválido", 401);
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`UPDATE otp_codes SET used_at = now() WHERE id = ${otp.id}::uuid`,
    );
    const session = await this.createSession(sup, ip, ua);
    return { ...session, mustReset: sup.mustResetPassword };
  }

  /** Resolve o id da org a partir do slug; sem slug (apex) escopa pra empresa do SaaS. */
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

  /** Acha fornecedor por documento OU telefone, restrito à empresa (slug). */
  private async findSupplier(identifier: string, orgSlug?: string | null) {
    const d = identifier.replace(/\D/g, "");
    if (!d) return null;
    // fornecedor pertence a uma empresa: sem slug não localiza (evita conflito
    // de fornecedor que atende mais de uma empresa).
    const orgId = await this.resolveOrgId(orgSlug);
    if (!orgId) return null;
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplier.findMany({
        where: {
          deletedAt: null,
          status: "active",
          organizationId: orgId,
          OR: [{ document: d }, { phone: { contains: d } }],
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      }),
    );
    return rows[0] ?? null;
  }

  /**
   * Login. Senha inicial = documento (digitos). Se ainda nao definiu senha
   * propria, aceita o documento e marca mustReset. Caso ja tenha hash, verifica.
   */
  async login(identifier: string, password: string, ip?: string, ua?: string, orgSlug?: string | null) {
    const sup = await this.findSupplier(identifier, orgSlug);
    if (!sup) throw new AppError(ErrorCode.Unauthorized, "Credenciais inválidas", 401);

    const doc = (sup.document ?? "").replace(/\D/g, "");
    let ok = false;
    let mustReset = sup.mustResetPassword;

    if (sup.passwordHash) {
      ok = await this.argon.verify(sup.passwordHash, password);
    } else {
      // senha inicial = documento
      ok = !!doc && password.replace(/\D/g, "") === doc;
      mustReset = true;
    }
    if (!ok) throw new AppError(ErrorCode.Unauthorized, "Credenciais inválidas", 401);

    const session = await this.createSession(sup, ip, ua);
    return { ...session, mustReset };
  }

  async setPassword(ctx: SupplierContext, password: string) {
    if (password.length < 8) {
      throw new AppError(ErrorCode.ValidationFailed, "Senha precisa de no mínimo 8 caracteres", 400);
    }
    const doc = (ctx.document ?? "").replace(/\D/g, "");
    if (doc && password.replace(/\D/g, "") === doc) {
      throw new AppError(ErrorCode.ValidationFailed, "A nova senha não pode ser o seu documento", 400);
    }
    const hash = await this.argon.hash(password);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplier.update({
        where: { id: ctx.supplierId },
        data: { passwordHash: hash, mustResetPassword: false },
      }),
    );
    return { ok: true };
  }

  private async createSession(sup: any, ip?: string, ua?: string) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 86400_000);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplierSession.create({
        data: {
          organizationId: sup.organizationId,
          supplierId: sup.id,
          tokenHash,
          ipAddress: ip ?? null,
          userAgent: ua ?? null,
          expiresAt,
        },
      }),
    );
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplier.update({ where: { id: sup.id }, data: { portalLastLoginAt: new Date() } }),
    ).catch(() => undefined);
    return { rawToken, expiresAt };
  }

  async resolveSession(rawToken: string): Promise<SupplierContext | null> {
    const tokenHash = sha256(rawToken);
    const sess = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplierSession.findUnique({ where: { tokenHash }, include: { supplier: true } }),
    );
    if (!sess || sess.revokedAt || sess.expiresAt < new Date()) return null;
    return {
      supplierId: sess.supplierId,
      organizationId: sess.organizationId,
      name: sess.supplier.name,
      type: sess.supplier.type,
      document: sess.supplier.document,
      mustReset: sess.supplier.mustResetPassword,
    };
  }

  async logout(rawToken: string) {
    const tokenHash = sha256(rawToken);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplierSession.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } }),
    );
  }
}
