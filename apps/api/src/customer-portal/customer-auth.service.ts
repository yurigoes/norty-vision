import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { createHash, randomBytes, randomInt } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { NotificationService } from "../notifications/notification.service";
import { loadEnv } from "../config";
import type { CustomerContext } from "./customer-context";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length < 4) return "•••";
  return `•••••${d.slice(-4)}`;
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger("CustomerAuth");

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Resolve a identidade do portal por documento. Identidade = cliente
   * (qualquer cliente), comparando o documento normalizado (so digitos).
   * A conta de crediario, se existir, e anexada como enriquecimento opcional.
   */
  /**
   * Resolve o id da org a partir do slug. Sem slug (apex yugochat.com.br),
   * escopa pra empresa dona do SaaS (PLATFORM_ORG_SLUG) — o apex nunca puxa
   * cliente de empresa cliente. Cada empresa entra pelo seu /c/[slug]/login.
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

  private async findIdentity(document: string, orgSlug?: string | null) {
    const doc = document.replace(/\D/g, "");
    if (!doc) return null;
    // Se vier com slug, a busca é restrita àquela empresa — resolve o caso
    // do cliente que existe em mais de uma loja (portal por empresa).
    const orgId = await this.resolveOrgId(orgSlug);
    const custRows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<
        Array<{
          id: string; organization_id: string; store_id: string; name: string;
          email: string | null; whatsapp_phone: string | null; phone: string | null;
          portal_password_hash: string | null; portal_must_reset: boolean;
        }>
      >`
        SELECT id, organization_id, store_id, name, email, whatsapp_phone, phone,
               portal_password_hash, portal_must_reset
          FROM customers
         WHERE regexp_replace(coalesce(document,''), '[^0-9]', '', 'g') = ${doc}
           AND deleted_at IS NULL
           AND (${orgId}::uuid IS NULL OR organization_id = ${orgId}::uuid)
         ORDER BY created_at ASC
         LIMIT 1
      `,
    );
    const c = custRows[0];
    if (!c) return null;

    // conta de crediario do mesmo documento (opcional)
    const accRows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.findMany({
        where: { document: doc, organizationId: c.organization_id },
        orderBy: { createdAt: "asc" },
        take: 1,
      }),
    );
    return {
      customer: {
        id: c.id,
        organizationId: c.organization_id,
        storeId: c.store_id,
        name: c.name,
        email: c.email,
        phone: c.whatsapp_phone ?? c.phone,
        passwordHash: c.portal_password_hash,
        mustReset: c.portal_must_reset,
      },
      account: accRows[0] ?? null,
      document: doc,
    };
  }

  /** Acha cliente pelo TELEFONE (match por últimos 8 dígitos, igual o webhook
   *  do WhatsApp). Mais permissivo que CPF porque cliente nem sempre quer dar
   *  CPF — telefone basta pra mandar OTP via WhatsApp. */
  private async findIdentityByPhone(phone: string, orgSlug?: string | null) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return null;
    const tail = digits.slice(-8);
    const orgId = await this.resolveOrgId(orgSlug);
    const custRows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<
        Array<{
          id: string; organization_id: string; store_id: string; name: string;
          email: string | null; whatsapp_phone: string | null; phone: string | null;
          portal_password_hash: string | null; portal_must_reset: boolean;
          document: string | null;
        }>
      >`
        SELECT id, organization_id, store_id, name, email, whatsapp_phone, phone,
               portal_password_hash, portal_must_reset, document
          FROM customers
         WHERE (
                 right(regexp_replace(coalesce(whatsapp_phone,''), '[^0-9]', '', 'g'), 8) = ${tail}
              OR right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 8) = ${tail}
           )
           AND deleted_at IS NULL
           AND (${orgId}::uuid IS NULL OR organization_id = ${orgId}::uuid)
         ORDER BY (organization_id = ${orgId}::uuid) DESC, created_at ASC
         LIMIT 1
      `,
    );
    const c = custRows[0];
    if (!c) return null;
    const accRows = c.document ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.findMany({ where: { document: c.document!.replace(/\D/g, ""), organizationId: c.organization_id }, orderBy: { createdAt: "asc" }, take: 1 }),
    ) : [];
    return {
      customer: {
        id: c.id, organizationId: c.organization_id, storeId: c.store_id, name: c.name,
        email: c.email, phone: c.whatsapp_phone ?? c.phone ?? digits,
        passwordHash: c.portal_password_hash, mustReset: c.portal_must_reset,
      },
      account: accRows[0] ?? null,
      document: (c.document ?? "").replace(/\D/g, ""),
    };
  }

  /** Envia OTP via WhatsApp pelo TELEFONE (sem precisar de CPF). */
  async requestCodeByPhone(phone: string, orgSlug?: string | null) {
    const id = await this.findIdentityByPhone(phone, orgSlug);
    if (!id) return { sent: false, channel: null, masked: null }; // resposta neutra
    const dest = id.customer.phone.replace(/\D/g, "");
    const code = String(randomInt(100000, 1000000));
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`
        INSERT INTO otp_codes (destination, channel, purpose, code_hash, expires_at, max_attempts)
        VALUES (${dest}, 'whatsapp', 'customer_portal', ${codeHash}, ${expiresAt}, 5)
      `,
    );
    await this.notifications.notify({
      organizationId: id.customer.organizationId,
      storeId: id.customer.storeId,
      customerId: id.customer.id,
      whatsappPhone: dest,
      email: null,
      subject: "Seu código de acesso",
      text: `Seu código de acesso ao painel é ${code}. Vale por 10 minutos. Não compartilhe.`,
      templateCode: "portal_otp",
    });
    return { sent: true, channel: "whatsapp", masked: maskPhone(dest) };
  }

  /** Valida OTP enviado pelo telefone e cria sessão de uso único curto. */
  async verifyCodeByPhone(phone: string, code: string, ip?: string, ua?: string, orgSlug?: string | null) {
    const id = await this.findIdentityByPhone(phone, orgSlug);
    if (!id) throw new AppError(ErrorCode.Unauthorized, "Código inválido", 401);
    const dest = id.customer.phone.replace(/\D/g, "");
    const codeHash = sha256(code);
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM otp_codes
         WHERE destination = ${dest}
           AND purpose = 'customer_portal'
           AND code_hash = ${codeHash}
           AND used_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1
      `,
    );
    if (rows.length === 0) throw new AppError(ErrorCode.Unauthorized, "Código inválido ou expirado", 401);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`UPDATE otp_codes SET used_at = now() WHERE id = ${rows[0]!.id}::uuid`,
    );
    const session = await this.createSession(id as any, ip, ua);
    return { ...session, mustReset: id.customer.mustReset };
  }

  /** Envia código 6 dígitos via WhatsApp. */
  async requestCode(document: string, orgSlug?: string | null) {
    const id = await this.findIdentity(document, orgSlug);
    if (!id) {
      // resposta neutra (nao revela existencia)
      return { sent: false, channel: null, masked: null };
    }
    const phone = id.customer.phone;
    if (!phone) {
      throw new AppError(ErrorCode.ValidationFailed, "Sem WhatsApp cadastrado. Use senha ou contate a loja.", 400);
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60_000);

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`
        INSERT INTO otp_codes (destination, channel, purpose, code_hash, expires_at, max_attempts)
        VALUES (${phone.replace(/\D/g, "")}, 'whatsapp', 'customer_portal', ${codeHash}, ${expiresAt}, 5)
      `,
    );

    await this.notifications.notify({
      organizationId: id.customer.organizationId,
      storeId: id.customer.storeId,
      customerId: id.customer.id,
      whatsappPhone: phone,
      email: null,
      subject: "Seu código de acesso",
      text: `Seu código de acesso ao painel é ${code}. Vale por 10 minutos. Não compartilhe.`,
      templateCode: "portal_otp",
    });
    return { sent: true, channel: "whatsapp", masked: maskPhone(phone) };
  }

  async verifyCode(document: string, code: string, ip?: string, ua?: string, orgSlug?: string | null) {
    const id = await this.findIdentity(document, orgSlug);
    if (!id) throw new AppError(ErrorCode.Unauthorized, "Código inválido", 401);
    const phone = (id.customer.phone ?? "").replace(/\D/g, "");
    const codeHash = sha256(code);

    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM otp_codes
         WHERE destination = ${phone}
           AND purpose = 'customer_portal'
           AND code_hash = ${codeHash}
           AND used_at IS NULL
           AND expires_at > now()
         ORDER BY created_at DESC LIMIT 1
      `,
    );
    if (rows.length === 0) {
      throw new AppError(ErrorCode.Unauthorized, "Código inválido ou expirado", 401);
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$executeRaw`UPDATE otp_codes SET used_at = now() WHERE id = ${rows[0]!.id}::uuid`,
    );

    const session = await this.createSession(id, ip, ua);
    return { ...session, mustReset: id.customer.mustReset };
  }

  async loginPassword(document: string, password: string, ip?: string, ua?: string, orgSlug?: string | null) {
    const id = await this.findIdentity(document, orgSlug);
    if (!id) throw new AppError(ErrorCode.Unauthorized, "Credenciais inválidas", 401);

    let ok = false;
    let mustReset = id.customer.mustReset;
    if (id.customer.passwordHash) {
      ok = await this.argon.verify(id.customer.passwordHash, password);
    } else {
      // senha inicial = documento (CPF/CNPJ sem pontuacao)
      ok = !!id.document && password.replace(/\D/g, "") === id.document;
      mustReset = true;
    }
    if (!ok) throw new AppError(ErrorCode.Unauthorized, "Credenciais inválidas", 401);
    const session = await this.createSession(id, ip, ua);
    return { ...session, mustReset };
  }

  async setPassword(ctx: CustomerContext, password: string) {
    if (password.length < 8) {
      throw new AppError(ErrorCode.ValidationFailed, "Senha precisa de no mínimo 8 caracteres", 400);
    }
    const doc = (ctx.document ?? "").replace(/\D/g, "");
    if (doc && password.replace(/\D/g, "") === doc) {
      throw new AppError(ErrorCode.ValidationFailed, "A nova senha não pode ser o seu documento", 400);
    }
    const hash = await this.argon.hash(password);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.update({
        where: { id: ctx.customerId },
        data: { portalPasswordHash: hash, portalMustReset: false },
      }),
    );
    return { ok: true };
  }

  private async createSession(
    id: { customer: { id: string; organizationId: string }; account: { id: string } | null },
    ip?: string,
    ua?: string,
  ) {
    const env = loadEnv();
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + env.CUSTOMER_SESSION_DURATION_DAYS * 86400_000);

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerSession.create({
        data: {
          organizationId: id.customer.organizationId,
          customerId: id.customer.id,
          creditAccountId: id.account?.id ?? null,
          tokenHash,
          ipAddress: ip ?? null,
          userAgent: ua ?? null,
          expiresAt,
        },
      }),
    );
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.update({ where: { id: id.customer.id }, data: { portalLastLoginAt: new Date() } }),
    );
    return { rawToken, expiresAt, accountId: id.account?.id ?? null };
  }

  async resolveSession(rawToken: string): Promise<CustomerContext | null> {
    const tokenHash = sha256(rawToken);
    const sess = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerSession.findUnique({
        where: { tokenHash },
        include: { creditAccount: true, customer: true },
      }),
    );
    if (!sess || sess.revokedAt || sess.expiresAt < new Date()) return null;

    // sessao nova (customer-based) ou antiga (so credit account)
    const customerId = sess.customerId ?? sess.creditAccount?.primaryCustomerId ?? null;
    const document = sess.customer?.document ?? sess.creditAccount?.document ?? "";
    const holderName = sess.customer?.name ?? sess.creditAccount?.holderName ?? "Cliente";
    if (!customerId && !sess.creditAccountId) return null;

    return {
      customerId: customerId ?? "",
      creditAccountId: sess.creditAccountId,
      organizationId: sess.organizationId,
      document: (document ?? "").replace(/\D/g, ""),
      holderName,
      primaryCustomerId: customerId,
    };
  }

  async logout(rawToken: string) {
    const tokenHash = sha256(rawToken);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerSession.updateMany({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      }),
    );
  }
}
