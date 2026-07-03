import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { PaymentsService } from "../payments/payments.service";
import { OrgIntegrationsService } from "../org-integrations/org-integrations.service";
import { MercadoPagoOrgAdapter } from "../payments/mercadopago-org.adapter";
import type { RequestContext } from "../auth/session.middleware";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Line = { method: "cash" | "pix" | "card"; provider?: string; cardType?: string; amountCents: number };

/**
 * ExamsService — recebimento de exames (consulta) no check-in.
 * Caixa de exames separado do de vendas; aceita split (dinheiro/pix/cartão),
 * NUNCA crediário; desconto só com código de 4 dígitos de um admin (WhatsApp).
 */
@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly payments: PaymentsService,
    private readonly orgIntegrations: OrgIntegrationsService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, storeId: ctx.storeId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private orgId(ctx: RequestContext): string {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId!;
  }

  /** Lista admins/gerentes que podem autorizar desconto (reusa o de pagamentos). */
  listAuthAdmins(ctx: RequestContext) {
    return this.payments.listAuthAdmins(ctx);
  }

  /** Gera código 4 dígitos e envia no WhatsApp do admin pra autorizar desconto. */
  async requestDiscountAuth(ctx: RequestContext, body: { adminMembershipId: string; discountCents: number }) {
    const orgId = this.orgId(ctx);
    const discountCents = Math.max(0, Math.round(Number(body.discountCents) || 0));
    if (discountCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Informe o valor do desconto", 400);

    const admin = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.membership.findFirst({
        where: { id: body.adminMembershipId, organizationId: orgId, status: "active" },
        select: { id: true, storeId: true, user: { select: { name: true, phone: true } } },
      }),
    );
    if (!admin) throw new AppError(ErrorCode.NotFound, "Admin não encontrado", 404);
    if (!admin.user?.phone) throw new AppError(ErrorCode.ValidationFailed, "Admin sem WhatsApp cadastrado", 400);

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(code).digest("hex");
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAuthCode.create({
        data: {
          organizationId: orgId, installmentId: null, adminMembershipId: admin.id,
          requestedBy: ctx.membershipId ?? null, purpose: "exam_discount",
          codeHash, amountCents: BigInt(discountCents), expiresAt: new Date(Date.now() + 15 * 60_000),
        },
        select: { id: true },
      }),
    );
    await this.notifications.notify({
      organizationId: orgId, storeId: admin.storeId ?? orgId, whatsappPhone: admin.user.phone,
      subject: "Autorização de desconto (exame)",
      text: `Código de autorização: ${code}\nDesconto de ${brl(discountCents)} no recebimento de um exame.\nInforme ao atendente. Válido por 15 min.`,
      templateCode: "exam_discount",
    } as any);
    return { ok: true, requestId: rec.id, adminName: admin.user.name };
  }

  private async verifyAuthCode(ctx: RequestContext, requestId: string, code: string): Promise<{ amountCents: number; adminMembershipId: string }> {
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAuthCode.findFirst({ where: { id: requestId, purpose: "exam_discount" } }),
    );
    if (!rec) throw new AppError(ErrorCode.NotFound, "Autorização não encontrada", 404);
    if (rec.usedAt) throw new AppError(ErrorCode.Conflict, "Código já utilizado", 409);
    if (rec.expiresAt.getTime() < Date.now()) throw new AppError(ErrorCode.ValidationFailed, "Código expirado", 400);
    if ((rec.attempts ?? 0) >= 5) throw new AppError(ErrorCode.ValidationFailed, "Tentativas esgotadas", 400);
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(String(code)).digest("hex");
    const ok = codeHash.length === rec.codeHash.length && timingSafeEqual(Buffer.from(codeHash), Buffer.from(rec.codeHash));
    if (!ok) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } }));
      throw new AppError(ErrorCode.ValidationFailed, "Código incorreto", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } }));
    return { amountCents: Number(rec.amountCents ?? 0n), adminMembershipId: rec.adminMembershipId };
  }

  /** Registra o recebimento do exame (split, sem crediário). */
  async recordExamPayment(ctx: RequestContext, input: {
    storeId?: string; appointmentId?: string; customerId?: string; professionalId?: string;
    lines: Line[]; discountCents?: number; authRequestId?: string; authCode?: string;
    notes?: string; markAttended?: boolean;
  }) {
    const orgId = this.orgId(ctx);
    const storeId = input.storeId ?? ctx.storeId ?? null;
    if (!storeId) throw new AppError(ErrorCode.ValidationFailed, "storeId obrigatório", 400);
    const lines = (input.lines ?? []).filter((l) => l && l.amountCents > 0);
    if (lines.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Informe ao menos um pagamento", 400);
    if (lines.some((l) => (l.method as string) === "credit")) {
      throw new AppError(ErrorCode.ValidationFailed, "Crediário não é aceito em exames", 400);
    }

    // desconto: admin/gerente/dono passam direto; usuário comum precisa do código
    let discountCents = 0;
    let discountAuthorizedBy: string | null = null;
    if ((input.discountCents ?? 0) > 0) {
      if (ctx.isOrgAdmin || ctx.isPlatformAdmin) {
        // admin autoriza o próprio desconto, sem 2FA
        discountCents = Math.max(0, Math.round(input.discountCents ?? 0));
        discountAuthorizedBy = ctx.membershipId ?? null;
      } else if (input.authRequestId && input.authCode) {
        const v = await this.verifyAuthCode(ctx, input.authRequestId, input.authCode);
        discountCents = v.amountCents;
        discountAuthorizedBy = v.adminMembershipId;
      } else {
        throw new AppError(ErrorCode.Forbidden, "Desconto exige autorização de admin", 403);
      }
    }

    const amount = lines.reduce((s, l) => s + Math.round(l.amountCents), 0);
    const original = amount + discountCents;
    const hasPixMp = lines.some((l) => l.method === "pix" && l.provider === "mp");

    // cria primeiro (linhas pix+mp nascem pendentes; demais já pagas)
    const created = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      return tx.examPayment.create({
        data: {
          organizationId: orgId, storeId,
          appointmentId: input.appointmentId ?? null,
          customerId: input.customerId ?? null,
          professionalId: input.professionalId ?? null,
          amountCents: BigInt(amount), originalCents: BigInt(original), discountCents: BigInt(discountCents),
          discountAuthorizedBy, discountAuthAt: discountAuthorizedBy ? new Date() : null,
          status: hasPixMp ? "pending" : "paid", notes: input.notes ?? null, createdBy: ctx.membershipId ?? null,
          lines: {
            create: lines.map((l) => ({
              organizationId: orgId, method: l.method, provider: l.provider ?? null,
              cardType: l.cardType ?? null, amountCents: BigInt(Math.round(l.amountCents)),
              status: l.method === "pix" && l.provider === "mp" ? "pending" : "paid",
            })),
          },
        },
        include: { lines: true },
      });
    });

    // gera o QR do MP pra cada linha pix+mp pendente
    if (hasPixMp) {
      const mp = await this.orgIntegrations.resolveMp(orgId);
      if (!mp) throw new AppError(ErrorCode.ValidationFailed, "Mercado Pago não configurado nesta empresa", 400);
      const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
      let email = "sememail@yugochat.com.br";
      if (input.customerId) {
        const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findFirst({ where: { id: input.customerId! }, select: { email: true } }));
        if (c?.email) email = c.email;
      }
      const notifUrl = `https://${process.env.DOMAIN ?? "yugochat.com.br"}/api/payments/webhooks/mercadopago/${orgId}`;
      for (const line of created.lines) {
        if (line.method === "pix" && line.provider === "mp" && line.status === "pending") {
          const r = await adapter.createPixPayment({
            amountCents: Number(line.amountCents), description: "Exame / consulta",
            externalReference: line.id, payerEmail: email, notificationUrl: notifUrl,
          });
          const qr = r.body?.point_of_interaction?.transaction_data;
          await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.examPaymentLine.update({
              where: { id: line.id },
              data: { mpPaymentId: r.body?.id ? String(r.body.id) : null, mpQrCode: qr?.qr_code ?? null, mpQrBase64: qr?.qr_code_base64 ?? null },
            }),
          );
        }
      }
      return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.examPayment.findFirst({ where: { id: created.id }, include: { lines: true } }));
    }

    // sem pix MP → já está pago; marca atendido
    if (input.markAttended && input.appointmentId) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.appointment.update({ where: { id: input.appointmentId! }, data: { status: "attended", endedAt: new Date() } }),
      ).catch(() => undefined);
    }
    return created;
  }

  /** Reconsulta o MP das linhas pix+mp pendentes e confirma se aprovou. */
  async checkExamPayment(ctx: RequestContext, examPaymentId: string) {
    const orgId = this.orgId(ctx);
    const ep = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.examPayment.findFirst({ where: { id: examPaymentId }, include: { lines: true } }),
    );
    if (!ep) throw new AppError(ErrorCode.NotFound, "Recebimento não encontrado", 404);
    const pendingMp = ep.lines.filter((l) => l.method === "pix" && l.provider === "mp" && l.status === "pending" && l.mpPaymentId);
    if (pendingMp.length) {
      const mp = await this.orgIntegrations.resolveMp(orgId);
      if (mp) {
        const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
        for (const line of pendingMp) {
          const r = await adapter.getPayment(String(line.mpPaymentId)).catch(() => null);
          if (r?.body?.status === "approved") {
            await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.examPaymentLine.update({ where: { id: line.id }, data: { status: "paid" } }));
          }
        }
      }
    }
    // recarrega e fecha o recebimento se não há mais pendência
    const fresh = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.examPayment.findFirst({ where: { id: examPaymentId }, include: { lines: true } }),
    );
    const stillPending = (fresh?.lines ?? []).some((l) => l.status === "pending");
    if (fresh && !stillPending && fresh.status !== "paid") {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.examPayment.update({ where: { id: examPaymentId }, data: { status: "paid" } }));
      if (fresh.appointmentId) {
        await this.prisma.runWithContext(this.rls(ctx), (tx) =>
          tx.appointment.update({ where: { id: fresh.appointmentId! }, data: { status: "attended", endedAt: new Date() } }),
        ).catch(() => undefined);
      }
    }
    return { status: stillPending ? "pending" : "paid", examPaymentId };
  }

  /** Lista recebimentos de exame da loja num período (relatório). */
  async listExamPayments(ctx: RequestContext, opts: { storeId?: string; from?: string; to?: string }) {
    const storeId = opts.storeId ?? ctx.storeId ?? undefined;
    if (!storeId) throw new AppError(ErrorCode.ValidationFailed, "storeId obrigatório", 400);
    const where: any = { storeId, status: "paid" };
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to) where.createdAt.lte = new Date(opts.to);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.examPayment.findMany({ where, include: { lines: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    );
  }
}
