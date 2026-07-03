import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OrgIntegrationsService } from "../org-integrations/org-integrations.service";
import { NotificationService } from "../notifications/notification.service";
import { MercadoPagoOrgAdapter } from "./mercadopago-org.adapter";
import { InfinitePayAdapter } from "./infinitepay.adapter";
import { orgBaseUrl } from "../common/org-url";
import type { RequestContext } from "../auth/session.middleware";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger("Payments");

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgIntegrations: OrgIntegrationsService,
    private readonly notifications: NotificationService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  // ============================== PIX ==============================
  async generatePix(ctx: RequestContext, installmentId: string) {
    const { installment, account, customer, orgId } = await this.loadInstallment(ctx, installmentId);
    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) {
      throw new AppError(ErrorCode.Internal, "Mercado Pago da empresa nao configurado/ativo", 500);
    }
    const amount = this.amountWithAdjustments(installment);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
    const r = await adapter.createPixPayment({
      amountCents: amount.total,
      description: `Parcela ${installment.number} — ${account.holderName}`,
      externalReference: installment.id,
      payerEmail: customer?.email ?? "sememail@yugochat.com.br",
      payerName: account.holderName,
      payerDocument: account.document,
      notificationUrl: `https://${domain}/api/payments/webhooks/mercadopago/${orgId}`,
    });

    await this.recordAttempt(ctx, installment.id, orgId, "pix", amount.total, r.ok ? "pending" : "failed", {
      mpPaymentId: r.body?.id ? String(r.body.id) : null,
      error: r.error,
    });

    if (!r.ok) {
      throw new AppError(ErrorCode.Internal, `Falha ao gerar Pix: ${r.error}`, 500);
    }

    const qr = r.body?.point_of_interaction?.transaction_data;
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditInstallment.update({
        where: { id: installment.id },
        data: { mpPaymentId: String(r.body.id), paymentMethod: "pix" },
      }),
    );

    // notifica cliente
    await this.notifyCustomer({
      orgId, storeId: installment.storeId ?? account.organizationId,
      customer, account,
      subject: "Pix gerado para sua parcela",
      text: `Olá ${account.holderName}! Geramos um Pix de ${brl(amount.total)} para a parcela ${installment.number}. Pague pelo app do seu banco com o código copia-e-cola disponível no seu painel.`,
    });

    return {
      paymentId: String(r.body.id),
      amountCents: amount.total,
      qrCode: qr?.qr_code ?? null,
      qrCodeBase64: qr?.qr_code_base64 ?? null,
      ticketUrl: qr?.ticket_url ?? null,
      adjustments: amount,
    };
  }

  // ============================== CARTÃO AVULSO ==============================
  async generateCardLink(ctx: RequestContext, installmentId: string) {
    const { installment, account, customer, orgId } = await this.loadInstallment(ctx, installmentId);
    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) throw new AppError(ErrorCode.Internal, "MP nao configurado", 500);
    const amount = this.amountWithAdjustments(installment);
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const r = await adapter.createCheckoutPreference({
      amountCents: amount.total,
      title: `Parcela ${installment.number} — ${account.holderName}`,
      externalReference: installment.id,
      payerEmail: customer?.email ?? "sememail@yugochat.com.br",
      backUrl: `https://${domain}/c/parcelas`,
      notificationUrl: `https://${domain}/api/payments/webhooks/mercadopago/${orgId}`,
    });
    await this.recordAttempt(ctx, installment.id, orgId, "card_single", amount.total, r.ok ? "pending" : "failed", { error: r.error });
    if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha cartao: ${r.error}`, 500);

    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditInstallment.update({
        where: { id: installment.id },
        data: { mpInitPoint: r.body?.init_point ?? null, paymentMethod: "card_single" },
      }),
    );
    return { initPoint: r.body?.init_point, amountCents: amount.total };
  }

  // ============================== INFINITEPAY (LINK) ==============================
  /**
   * Gera um link de checkout InfinitePay (Pix/cartão até 12x) pra uma parcela e
   * envia ao cliente por WhatsApp + e-mail. O pagamento é confirmado depois pelo
   * webhook (com checagem em /payment_check). Usado em callcenter, IA e portal.
   */
  async generateInfinitepayLink(ctx: RequestContext, installmentId: string) {
    const { installment, account, customer, orgId } = await this.loadInstallment(ctx, installmentId);
    if (installment.status === "paid") throw new AppError(ErrorCode.Conflict, "Parcela ja paga", 409);
    const ip = await this.orgIntegrations.resolveInfinitepay(orgId);
    if (!ip) throw new AppError(ErrorCode.Internal, "InfinitePay da empresa nao configurado/ativo", 500);
    const amount = this.amountWithAdjustments(installment);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";

    // order_nsu = id do nosso registro de link (pra casar o webhook depois)
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.infinitepayLink.create({
        data: { organizationId: orgId, kind: "installment", refId: installment.id, amountCents: BigInt(amount.total), status: "pending" },
        select: { id: true },
      }),
    );

    const adapter = new InfinitePayAdapter(ip.handle);
    const r = await adapter.createLink({
      items: [{ quantity: 1, price: amount.total, description: `Parcela ${installment.number} — ${account.holderName}` }],
      orderNsu: rec.id,
      redirectUrl: `https://${domain}/c/parcelas`,
      webhookUrl: `https://${domain}/api/payments/webhooks/infinitepay/${orgId}`,
      customer: {
        name: account.holderName,
        email: customer?.email ?? undefined,
        phone_number: customer?.whatsappPhone ?? customer?.phone ?? undefined,
      },
    });

    const url = InfinitePayAdapter.extractUrl(r.body);
    const slug = r.body?.slug ?? r.body?.invoice_slug ?? null;
    if (!url) {
      // Loga a resposta crua pra diagnosticar quando o InfinitePay devolve OK
      // mas em formato inesperado (ou erro mascarado em campo diferente)
      this.logger.warn(`InfinitePay createLink sem URL — status=${r.status} ok=${r.ok} body=${JSON.stringify(r.body).slice(0, 500)}`);
    }

    await this.recordAttempt(ctx, installment.id, orgId, "infinitepay", amount.total, r.ok && url ? "pending" : "failed", { error: r.error });

    if (!r.ok || !url) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.infinitepayLink.update({ where: { id: rec.id }, data: { status: "failed" } }));
      throw new AppError(ErrorCode.Internal, `Falha ao gerar link InfinitePay: ${r.error ?? "sem URL"}`, 500);
    }

    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.infinitepayLink.update({ where: { id: rec.id }, data: { link: url, slug } }),
    );
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditInstallment.update({ where: { id: installment.id }, data: { paymentMethod: "infinitepay" } }),
    );

    await this.notifyCustomer({
      orgId, storeId: installment.storeId ?? account.organizationId,
      customer, account,
      subject: "Link de pagamento",
      text: `Olá ${account.holderName}! Para pagar a parcela ${installment.number} (${brl(amount.total)}), acesse o link e finalize por Pix ou cartão (até 12x): ${url}`,
    });

    return { link: url, amountCents: amount.total, adjustments: amount };
  }

  /** Gera link InfinitePay para um pagamento de VENDA (PDV) e envia ao cliente. */
  async generateInfinitepayLinkForSale(ctx: RequestContext, salePaymentId: string) {
    const sp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.salePayment.findFirst({ where: { id: salePaymentId }, select: { id: true, amountCents: true, saleId: true, organizationId: true, storeId: true, status: true } }),
    );
    if (!sp) throw new AppError(ErrorCode.NotFound, "Pagamento da venda nao encontrado", 404);
    const orgId = sp.organizationId;
    const ip = await this.orgIntegrations.resolveInfinitepay(orgId);
    if (!ip) throw new AppError(ErrorCode.Internal, "InfinitePay da empresa nao configurado/ativo", 500);
    const sale = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.sale.findFirst({ where: { id: sp.saleId }, select: { shortCode: true, customerId: true } }),
    );
    let customer: { id: string; name: string; email: string | null; whatsappPhone: string | null; phone: string | null } | null = null;
    if (sale?.customerId) {
      customer = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.customer.findFirst({ where: { id: sale.customerId! }, select: { id: true, name: true, email: true, whatsappPhone: true, phone: true } }),
      );
    }
    const amountCents = Number(sp.amountCents);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.infinitepayLink.create({ data: { organizationId: orgId, kind: "sale", refId: sp.id, amountCents: BigInt(amountCents), status: "pending" }, select: { id: true } }),
    );
    const adapter = new InfinitePayAdapter(ip.handle);
    const r = await adapter.createLink({
      items: [{ quantity: 1, price: amountCents, description: `Venda ${sale?.shortCode ?? sp.saleId}` }],
      orderNsu: rec.id,
      webhookUrl: `https://${domain}/api/payments/webhooks/infinitepay/${orgId}`,
      customer: customer ? { name: customer.name, email: customer.email ?? undefined, phone_number: customer.whatsappPhone ?? customer.phone ?? undefined } : undefined,
    });
    const url = InfinitePayAdapter.extractUrl(r.body);
    const slug = r.body?.slug ?? r.body?.invoice_slug ?? null;
    if (!url) {
      // Loga a resposta crua pra diagnosticar quando o InfinitePay devolve OK
      // mas em formato inesperado (ou erro mascarado em campo diferente)
      this.logger.warn(`InfinitePay createLink sem URL — status=${r.status} ok=${r.ok} body=${JSON.stringify(r.body).slice(0, 500)}`);
    }
    if (!r.ok || !url) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.infinitepayLink.update({ where: { id: rec.id }, data: { status: "failed" } }));
      throw new AppError(ErrorCode.Internal, `Falha ao gerar link InfinitePay: ${r.error ?? "sem URL"}`, 500);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.infinitepayLink.update({ where: { id: rec.id }, data: { link: url, slug } }));
    if (customer && (customer.whatsappPhone || customer.phone || customer.email)) {
      await this.notifications.notify({
        organizationId: orgId, storeId: sp.storeId ?? orgId, customerId: customer.id,
        whatsappPhone: customer.whatsappPhone ?? customer.phone, email: customer.email,
        subject: "Link de pagamento",
        text: `Olá ${customer.name}! Para pagar sua compra (${brl(amountCents)}), acesse o link e finalize por Pix ou cartão (até 12x): ${url}`,
        templateCode: "credit_payment",
      });
    }
    return { link: url, amountCents };
  }

  /** Webhook da InfinitePay (sem assinatura): confirma em /payment_check antes de liquidar. */
  async handleInfinitepayWebhook(orgId: string, body: any) {
    const orderNsu = body?.order_nsu ?? null;
    this.logger.log(`InfinitePay webhook org=${orgId} order_nsu=${orderNsu}`);
    if (!orderNsu) return { ok: true, ignored: true };
    return this.confirmInfinitepay(orgId, String(orderNsu), {
      transactionNsu: body?.transaction_nsu ?? null,
      slug: body?.invoice_slug ?? body?.slug ?? null,
      captureMethod: body?.capture_method ?? null,
      paidAmount: typeof body?.paid_amount === "number" ? body.paid_amount : null,
      receiptUrl: body?.receipt_url ?? null,
    });
  }

  /**
   * Confirma de fato o pagamento InfinitePay consultando /payment_check (a fonte
   * de verdade) e, se pago, liquida a parcela/venda. Idempotente. Reusado pelo
   * webhook e por uma reconsulta manual.
   */
  async confirmInfinitepay(
    orgId: string,
    orderNsu: string,
    hint?: { transactionNsu?: string | null; slug?: string | null; captureMethod?: string | null; paidAmount?: number | null; receiptUrl?: string | null },
  ) {
    const ip = await this.orgIntegrations.resolveInfinitepay(orgId);
    if (!ip) return { ok: false, error: "org sem InfinitePay" };
    const link = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.infinitepayLink.findFirst({ where: { id: orderNsu, organizationId: orgId } }),
    );
    if (!link) return { ok: true, ignored: true };
    if (link.status === "paid") return { ok: true, already: true };

    const adapter = new InfinitePayAdapter(ip.handle);
    const chk = await adapter.paymentCheck({ orderNsu, transactionNsu: hint?.transactionNsu, slug: hint?.slug ?? link.slug });
    const paid = chk.ok && chk.body?.paid === true;
    if (!paid) return { ok: true, paid: false };

    const captureMethod = hint?.captureMethod ?? chk.body?.capture_method ?? null;
    const paidAmount = hint?.paidAmount ?? (typeof chk.body?.paid_amount === "number" ? chk.body.paid_amount : null);

    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      await tx.infinitepayLink.update({
        where: { id: link.id },
        data: {
          status: "paid",
          transactionNsu: hint?.transactionNsu ?? null,
          captureMethod,
          paidAmountCents: paidAmount != null ? BigInt(paidAmount) : null,
          receiptUrl: hint?.receiptUrl ?? null,
        },
      });
      if (link.kind === "installment") {
        const inst = await tx.creditInstallment.findFirst({ where: { id: link.refId } });
        if (inst && inst.status !== "paid") {
          await tx.paymentAttempt.create({
            data: { organizationId: orgId, installmentId: inst.id, method: "infinitepay", amountCents: inst.amountCents, status: "approved" },
          });
          await this.settleInstallment(tx as any, inst, "infinitepay", hint?.receiptUrl ?? null);
        }
      } else if (link.kind === "sale") {
        const sp = await tx.salePayment.findFirst({ where: { id: link.refId } });
        if (sp && sp.status !== "paid") {
          await tx.salePayment.update({ where: { id: sp.id }, data: { status: "paid" } });
          await this.finalizeSaleIfPaid(tx as any, sp.saleId);
        }
      } else if (link.kind === "production") {
        const pp = await tx.productionPayment.findFirst({ where: { id: link.refId } });
        if (pp && pp.status !== "paid") {
          await tx.productionPayment.update({ where: { id: pp.id }, data: { status: "paid", paidAt: new Date(), proofUrl: hint?.receiptUrl ?? pp.proofUrl } });
          await this.recomputeOrderPayment(tx as any, pp.orderId);
        }
      }
    });

    if (link.kind === "installment") {
      const ctxLike = this.adminCtx(orgId);
      const data = await this.loadInstallment(ctxLike, link.refId).catch(() => null);
      if (data) {
        await this.notifyCustomer({
          orgId, storeId: data.installment.storeId ?? orgId,
          customer: data.customer, account: data.account,
          subject: "Pagamento confirmado",
          text: `Pagamento da parcela ${data.installment.number} (${brl(Number(data.installment.amountCents))}) confirmado! Obrigado, ${data.account.holderName}.`,
        });
      }
    }
    return { ok: true, paid: true };
  }

  /** Finaliza a venda quando todos os pagamentos estiverem pagos (sai de "pending"). */
  private async finalizeSaleIfPaid(tx: PrismaClient, saleId?: string | null) {
    if (!saleId) return;
    const sale = await tx.sale.findFirst({ where: { id: saleId }, select: { status: true } });
    if (!sale || sale.status !== "pending") return;
    const pend = await tx.salePayment.count({ where: { saleId, status: { not: "paid" } } });
    if (pend === 0) await tx.sale.update({ where: { id: saleId }, data: { status: "completed" } });
  }

  private adminCtx(orgId: string): RequestContext {
    return {
      userId: null, platformUserId: null, membershipId: null, orgId, storeId: null,
      role: null, isOrgAdmin: false, permissions: {}, isPlatformAdmin: true,
      platformRole: null, techSpecsCategories: [], impersonating: false,
      impersonatingOrgId: null, impersonatorPlatformUserId: null,
    };
  }

  // ============================== PEDIDO DE PRODUÇÃO (entrada/saldo) ==============================
  /**
   * Gera um pagamento da entrada/saldo de um pedido de produção.
   * method: card_machine | pix_machine | cash (manual, marca pago) | pix_infinity
   * (link InfinitePay) | pix_mp (Pix Mercado Pago inline, QR/copia-e-cola).
   */
  async generateProductionPayment(ctx: RequestContext, orderId: string, body: { kind?: string; method: string; amountCents?: number }): Promise<any> {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId!;
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionOrder.findFirst({ where: { id: orderId }, select: { id: true, shortCode: true, storeId: true, contactName: true, contactPhone: true, contactEmail: true, totalCents: true, downPaymentCents: true } }));
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    const kind = body.kind === "saldo" ? "saldo" : "entrada";
    const def = kind === "saldo" ? Number(order.totalCents) - Number(order.downPaymentCents) : Number(order.downPaymentCents);
    const amountCents = Math.max(0, Math.round(body.amountCents ?? def));
    if (amountCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Valor a cobrar inválido", 400);
    const method = body.method;
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const cod = order.shortCode ?? "";

    // maquininha / dinheiro: registra pago direto (passa na máquina física)
    if (method === "card_machine" || method === "pix_machine" || method === "cash") {
      const pp = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
        const rec = await tx.productionPayment.create({ data: { organizationId: orgId, orderId, kind, method, provider: "manual", amountCents: BigInt(amountCents), status: "paid", paidAt: new Date(), createdBy: ctx.userId ?? null }, select: { id: true } });
        await this.recomputeOrderPayment(tx as any, orderId);
        return rec;
      });
      return { id: pp.id, status: "paid", method };
    }

    if (method === "pix_infinity") {
      const ip = await this.orgIntegrations.resolveInfinitepay(orgId);
      if (!ip) throw new AppError(ErrorCode.Internal, "InfinitePay da empresa não configurado/ativo", 500);
      const pp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionPayment.create({ data: { organizationId: orgId, orderId, kind, method: "pix", provider: "infinitepay", amountCents: BigInt(amountCents), status: "pending", createdBy: ctx.userId ?? null }, select: { id: true } }));
      const linkRec = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.infinitepayLink.create({ data: { organizationId: orgId, kind: "production", refId: pp.id, amountCents: BigInt(amountCents), status: "pending" }, select: { id: true } }));
      const adapter = new InfinitePayAdapter(ip.handle);
      const r = await adapter.createLink({
        items: [{ quantity: 1, price: amountCents, description: `Pedido ${cod} — ${kind}` }],
        orderNsu: linkRec.id,
        redirectUrl: `https://${domain}`,
        webhookUrl: `https://${domain}/api/payments/webhooks/infinitepay/${orgId}`,
        customer: { name: order.contactName, email: order.contactEmail ?? undefined, phone_number: order.contactPhone ?? undefined },
      });
      const url = InfinitePayAdapter.extractUrl(r.body);
      const slug = r.body?.slug ?? r.body?.invoice_slug ?? null;
      if (!url) {
        this.logger.warn(`InfinitePay createLink sem URL — status=${r.status} ok=${r.ok} body=${JSON.stringify(r.body).slice(0, 500)}`);
      }
      if (!r.ok || !url) {
        await this.prisma.runWithContext(this.rls(ctx), async (tx) => { await tx.infinitepayLink.update({ where: { id: linkRec.id }, data: { status: "failed" } }); await tx.productionPayment.update({ where: { id: pp.id }, data: { status: "failed" } }); });
        throw new AppError(ErrorCode.Internal, `Falha ao gerar link InfinitePay: ${r.error ?? "sem URL"}`, 500);
      }
      await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
        await tx.infinitepayLink.update({ where: { id: linkRec.id }, data: { link: url, slug } });
        await tx.productionPayment.update({ where: { id: pp.id }, data: { infinitepayLinkId: linkRec.id, link: url } });
      });
      if (order.contactPhone || order.contactEmail) {
        await this.notifications.notify({ organizationId: orgId, storeId: order.storeId ?? orgId, whatsappPhone: order.contactPhone, email: order.contactEmail, subject: "Link de pagamento", text: `Olá ${order.contactName}! Para pagar o pedido ${cod} (${brl(amountCents)}), acesse e finalize por Pix ou cartão: ${url}`, templateCode: "payment_link" }).catch(() => null);
      }
      return { id: pp.id, status: "pending", method: "pix_infinity", link: url };
    }

    if (method === "pix_mp") {
      const mp = await this.orgIntegrations.resolveMp(orgId);
      if (!mp) throw new AppError(ErrorCode.Internal, "Mercado Pago da empresa não configurado/ativo", 500);
      const pp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionPayment.create({ data: { organizationId: orgId, orderId, kind, method: "pix", provider: "mp", amountCents: BigInt(amountCents), status: "pending", createdBy: ctx.userId ?? null }, select: { id: true } }));
      const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
      const r = await adapter.createPixPayment({
        amountCents,
        description: `Pedido ${cod} — ${kind}`,
        externalReference: pp.id,
        payerEmail: order.contactEmail ?? "sememail@yugochat.com.br",
        payerName: order.contactName,
        notificationUrl: `https://${domain}/api/payments/webhooks/mercadopago/${orgId}`,
      });
      if (!r.ok) {
        await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionPayment.update({ where: { id: pp.id }, data: { status: "failed" } }));
        throw new AppError(ErrorCode.Internal, `Falha ao gerar Pix: ${r.error}`, 500);
      }
      const qr = r.body?.point_of_interaction?.transaction_data;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.productionPayment.update({ where: { id: pp.id }, data: { mpPaymentId: r.body?.id ? String(r.body.id) : null } }));
      return { id: pp.id, status: "pending", method: "pix_mp", qrCode: qr?.qr_code ?? null, qrCodeBase64: qr?.qr_code_base64 ?? null, ticketUrl: qr?.ticket_url ?? null };
    }
    throw new AppError(ErrorCode.ValidationFailed, "Método de pagamento inválido", 400);
  }

  /** Recalcula paymentStatus + entrada do pedido a partir dos pagamentos pagos. */
  private async recomputeOrderPayment(tx: PrismaClient, orderId: string): Promise<void> {
    const order = await tx.productionOrder.findFirst({ where: { id: orderId }, select: { totalCents: true } });
    if (!order) return;
    const paid = await tx.productionPayment.findMany({ where: { orderId, status: "paid", kind: { in: ["entrada", "saldo"] } }, select: { amountCents: true } });
    const sum = paid.reduce((s, p) => s + Number(p.amountCents ?? 0), 0);
    const total = Number(order.totalCents ?? 0);
    const status = sum <= 0 ? "none" : sum >= total ? "paid" : "partial";
    await tx.productionOrder.update({ where: { id: orderId }, data: { paymentStatus: status, downPaymentCents: BigInt(Math.min(sum, total)) } });
  }

  // ============================== PRESENCIAL ==============================
  async markInPerson(
    ctx: RequestContext,
    installmentId: string,
    proofUrl?: string,
    opts?: { authRequestId?: string; authCode?: string },
  ) {
    // se veio pedido de desconto, valida o código do admin antes de liquidar
    let manualDiscountCents = 0;
    let discountAuthorizedBy: string | null = null;
    if (opts?.authRequestId && opts?.authCode) {
      const v = await this.verifyAuthCode(ctx, installmentId, opts.authRequestId, opts.authCode, "interest_discount");
      manualDiscountCents = v.amountCents;
      discountAuthorizedBy = v.adminMembershipId;
    }
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const inst = await tx.creditInstallment.findFirst({ where: { id: installmentId } });
      if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela nao encontrada", 404);
      if (inst.status === "paid") throw new AppError(ErrorCode.Conflict, "Parcela ja paga", 409);
      await this.settleInstallment(tx as any, inst, "in_person", proofUrl ?? null, { manualDiscountCents, discountAuthorizedBy });
      // pagamento atrasado vira ponto de atenção na ficha do cliente
      const wasLate = new Date(inst.dueDate).getTime() < Date.now() - 86400_000;
      if (wasLate || manualDiscountCents > 0) {
        await tx.creditAccountEvent.create({
          data: {
            organizationId: inst.organizationId,
            creditAccountId: inst.creditAccountId,
            eventType: "attention",
            payload: {
              kind: wasLate ? "late_payment" : "discount_granted",
              installment: inst.number,
              dueDate: inst.dueDate,
              manualDiscountCents,
              authorizedBy: discountAuthorizedBy,
            } as any,
            actorType: "staff",
          },
        });
      }
      return tx.creditInstallment.findFirst({ where: { id: installmentId } });
    }).then(async (updated) => {
      // notifica fora da tx
      const ctxData = await this.loadInstallment(ctx, installmentId).catch(() => null);
      if (ctxData) {
        await this.notifyCustomer({
          orgId: ctxData.orgId,
          storeId: ctxData.installment.storeId ?? ctxData.account.organizationId,
          customer: ctxData.customer,
          account: ctxData.account,
          subject: "Pagamento recebido",
          text: `Recebemos o pagamento presencial da parcela ${ctxData.installment.number} (${brl(Number(ctxData.installment.amountCents))}). Obrigado, ${ctxData.account.holderName}! O comprovante está no seu painel.`,
        });
      }
      return updated;
    });
  }

  // ============================== WEBHOOK ==============================
  async handleWebhook(
    orgId: string,
    body: any,
    queryType?: string,
    queryId?: string,
    sig?: { xSignature: string | null; xRequestId: string | null; dataId: string | null },
  ) {
    const type = body?.type ?? queryType ?? "";
    const mpId = body?.data?.id ?? queryId;
    this.logger.log(`MP webhook org=${orgId} type=${type} id=${mpId}`);
    if (type !== "payment" || !mpId) return { ok: true, ignored: true };

    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) return { ok: false, error: "org sem MP" };

    // valida assinatura x-signature do MP (se a empresa configurou a secret).
    if (mp.webhookSecret) {
      const valid = this.verifyMpSignature(mp.webhookSecret, sig);
      if (!valid) {
        this.logger.warn(`MP webhook org=${orgId} assinatura invalida — descartado`);
        return { ok: false, error: "assinatura invalida" };
      }
    } else {
      this.logger.warn(`MP webhook org=${orgId} sem secret configurada — sem validacao`);
    }

    return this.syncMpPayment(orgId, String(mpId));
  }

  /**
   * Consulta o pagamento no MP pelo id e sincroniza o status local (parcela de
   * crediário OU pagamento de venda PDV). Usado pelo webhook E pelo botão
   * "forçar" da tela de Transações. Sem validação de assinatura (uso interno).
   */
  async syncMpPayment(orgId: string, mpId: string) {
    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) return { ok: false, error: "org sem MP" };
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
    const r = await adapter.getPayment(String(mpId));
    if (!r.ok) return { ok: false, error: "payment nao encontrado" };

    const status = r.body?.status; // approved, pending, rejected
    const installmentId = r.body?.external_reference;
    const statusDetail = r.body?.status_detail;
    if (!installmentId) return { ok: true, ignored: true };

    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const inst = await tx.creditInstallment.findFirst({ where: { id: installmentId } });
      if (inst) {
        // grava attempt
        await tx.paymentAttempt.create({
          data: {
            organizationId: orgId,
            installmentId: inst.id,
            method: "pix",
            amountCents: inst.amountCents,
            status: status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending",
            mpPaymentId: String(mpId),
            mpStatusDetail: statusDetail,
          },
        });
        if (status === "approved" && inst.status !== "paid") {
          await this.settleInstallment(tx as any, inst, "pix", null);
        }
        return;
      }
      // senão, pode ser um pagamento de VENDA (PDV) via Pix MP
      const sp = await tx.salePayment.findFirst({ where: { id: installmentId } });
      if (sp) {
        if (status === "approved" && sp.status !== "paid") {
          await tx.salePayment.update({ where: { id: sp.id }, data: { status: "paid", mpPaymentId: String(mpId) } });
          await this.finalizeSaleIfPaid(tx as any, sp.saleId);
        } else if (status === "rejected") {
          await tx.salePayment.update({ where: { id: sp.id }, data: { status: "failed" } });
        }
        return;
      }
      // ou um pagamento de PEDIDO DE PRODUÇÃO (entrada/saldo) via Pix MP
      const pp = await tx.productionPayment.findFirst({ where: { id: installmentId } });
      if (pp) {
        if (status === "approved" && pp.status !== "paid") {
          await tx.productionPayment.update({ where: { id: pp.id }, data: { status: "paid", paidAt: new Date(), mpPaymentId: String(mpId) } });
          await this.recomputeOrderPayment(tx as any, pp.orderId);
        } else if (status === "rejected") {
          await tx.productionPayment.update({ where: { id: pp.id }, data: { status: "failed" } });
        }
      }
    });

    // notifica conforme status
    const ctxLike: RequestContext = {
      userId: null, platformUserId: null, membershipId: null,
      orgId, storeId: null, role: null, isOrgAdmin: false, permissions: {},
      isPlatformAdmin: true, platformRole: null, techSpecsCategories: [],
      impersonating: false, impersonatingOrgId: null, impersonatorPlatformUserId: null,
    };
    const data = await this.loadInstallment(ctxLike, installmentId).catch(() => null);
    if (data) {
      if (status === "approved") {
        await this.notifyCustomer({
          orgId, storeId: data.installment.storeId ?? orgId,
          customer: data.customer, account: data.account,
          subject: "Pagamento confirmado",
          text: `Pagamento da parcela ${data.installment.number} (${brl(Number(data.installment.amountCents))}) confirmado! Obrigado, ${data.account.holderName}.`,
        });
      } else if (status === "rejected") {
        await this.notifyCustomer({
          orgId, storeId: data.installment.storeId ?? orgId,
          customer: data.customer, account: data.account,
          subject: "Pagamento não aprovado",
          text: `O pagamento da parcela ${data.installment.number} não foi aprovado (${statusDetail ?? "tente novamente"}). Acesse seu painel para tentar de novo ou trocar a forma de pagamento.`,
        });
      }
    }

    return { ok: true };
  }

  /**
   * "Forçar" a verificação de uma transação MP (tela de Transações). Pega o
   * mpPaymentId guardado na venda/parcela e ressincroniza pelo MP.
   */
  async forceCheck(ctx: RequestContext, kind: "sale" | "installment", id: string) {
    const orgId = ctx.orgId;
    if (!orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    let mpId: string | null = null;
    if (kind === "sale") {
      const sp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.salePayment.findFirst({ where: { id }, select: { mpPaymentId: true, status: true } }),
      );
      mpId = sp?.mpPaymentId ?? null;
      if (!mpId) return { ok: false, status: sp?.status ?? "unknown", note: "sem mp_payment_id" };
    } else {
      const inst = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.creditInstallment.findFirst({ where: { id }, select: { mpPaymentId: true, status: true } }),
      );
      mpId = inst?.mpPaymentId ?? null;
      if (!mpId) return { ok: false, status: inst?.status ?? "unknown", note: "sem mp_payment_id" };
    }
    const r = await this.syncMpPayment(orgId, mpId);
    // devolve o status atualizado
    const cur =
      kind === "sale"
        ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.salePayment.findFirst({ where: { id }, select: { status: true } }))
        : await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.creditInstallment.findFirst({ where: { id }, select: { status: true } }));
    return { ok: (r as any).ok ?? true, status: cur?.status ?? "unknown" };
  }

  /**
   * Lista as transações MP (Pix/cartão) — do PDV (sale_payments provider=mp) e
   * do crediário (parcelas com mp_payment_id/mp_init_point). Ordenadas por data.
   */
  async listTransactions(ctx: RequestContext, opts?: { status?: string }) {
    const orgId = ctx.orgId;
    if (!orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const [sps, insts, ipLinks] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.salePayment.findMany({
          where: { provider: "mp", ...(opts?.status ? { status: opts.status } : {}) },
          orderBy: { createdAt: "desc" },
          take: 300,
          include: { sale: { select: { shortCode: true, customerId: true } } },
        }),
      ),
      this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.creditInstallment.findMany({
          where: { OR: [{ mpPaymentId: { not: null } }, { mpInitPoint: { not: null } }], ...(opts?.status ? { status: opts.status } : {}) },
          orderBy: { updatedAt: "desc" },
          take: 300,
          include: { creditAccount: { select: { holderName: true } } },
        }),
      ),
      this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.infinitepayLink.findMany({
          where: { ...(opts?.status ? { status: opts.status } : {}) },
          orderBy: { createdAt: "desc" },
          take: 300,
        }),
      ).catch(() => [] as any[]),
    ]);
    const items = [
      ...sps.map((s) => ({
        kind: "sale" as const, provider: "mp" as const,
        id: s.id, origin: "PDV",
        method: s.method + (s.cardType ? ` (${s.cardType})` : ""),
        amountCents: Number(s.amountCents),
        status: s.status, mpPaymentId: s.mpPaymentId,
        ref: s.sale?.shortCode ?? null, who: null as string | null, at: s.createdAt,
      })),
      ...insts.map((i) => ({
        kind: "installment" as const, provider: "mp" as const,
        id: i.id, origin: "Crediário",
        method: i.paymentMethod ?? "mp",
        amountCents: Number(i.amountCents),
        status: i.status, mpPaymentId: i.mpPaymentId,
        ref: `parcela ${i.number}`, who: i.creditAccount?.holderName ?? null, at: i.updatedAt,
      })),
      ...(ipLinks as any[]).map((l) => ({
        kind: l.kind === "installment" ? ("installment" as const) : ("sale" as const), provider: "infinitepay" as const,
        id: l.id, origin: "InfinitePay (link)",
        method: `InfinitePay${l.captureMethod ? ` (${l.captureMethod === "credit_card" ? "cartão" : l.captureMethod})` : ""}`,
        amountCents: Number(l.amountCents),
        status: l.status, mpPaymentId: null as string | null,
        ref: l.kind === "installment" ? "parcela" : "venda", who: null as string | null, at: l.updatedAt ?? l.createdAt,
      })),
    ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
    return items;
  }

  /** Verifica um pagamento InfinitePay (force /payment_check) — tela de Transações. */
  async checkInfinitepay(ctx: RequestContext, linkId: string): Promise<any> {
    const orgId = ctx.orgId;
    if (!orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const link = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.infinitepayLink.findFirst({ where: { id: linkId }, select: { id: true, status: true } }));
    if (!link) return { ok: false, status: "unknown", note: "link não encontrado" };
    await this.confirmInfinitepay(orgId, linkId).catch(() => undefined);
    const cur = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.infinitepayLink.findFirst({ where: { id: linkId }, select: { status: true } }));
    return { ok: true, status: cur?.status ?? link.status };
  }

  /**
   * Salva o cartão (token do MP.js) numa conta de crediário, criando/achando o
   * customer no MP. Guarda só os ids do MP + 4 últimos/bandeira (nunca o cartão).
   */
  async saveCardForAccount(
    orgId: string,
    accountId: string,
    opts: { cardToken: string; email: string; firstName?: string; document?: string; last4?: string; brand?: string; pmId?: string },
  ) {
    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) throw new AppError(ErrorCode.Internal, "Mercado Pago não configurado para esta empresa", 500);
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);

    let customerId: string | null = null;
    const search = await adapter.findCustomerByEmail(opts.email);
    if (search.ok && Array.isArray(search.body?.results) && search.body.results[0]?.id) {
      customerId = search.body.results[0].id;
    }
    if (!customerId) {
      const c = await adapter.createCustomer({ email: opts.email, firstName: opts.firstName, document: opts.document });
      if (!c.ok || !c.body?.id) throw new AppError(ErrorCode.Internal, `Falha ao criar cliente MP: ${c.error ?? ""}`, 502);
      customerId = String(c.body.id);
    }
    if (!customerId) throw new AppError(ErrorCode.Internal, "Não foi possível resolver o cliente no MP", 502);
    const card = await adapter.saveCard(customerId, opts.cardToken);
    if (!card.ok || !card.body?.id) throw new AppError(ErrorCode.Internal, `Falha ao salvar cartão: ${card.error ?? ""}`, 502);
    const last4 = opts.last4 ?? card.body?.last_four_digits ?? null;
    const brand = opts.brand ?? card.body?.payment_method?.name ?? null;
    const pmId = opts.pmId ?? card.body?.payment_method?.id ?? null;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.update({
        where: { id: accountId },
        data: {
          mpCustomerId: customerId, mpCardId: String(card.body.id),
          cardLast4: last4, cardBrand: brand, cardPmId: pmId,
          autoCharge: true, cardSavedAt: new Date(),
        },
      }),
    );
    return { last4, brand };
  }

  /** Remove o cartão salvo (desliga a cobrança automática). */
  async removeSavedCard(orgId: string, accountId: string) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.update({
        where: { id: accountId },
        data: { mpCardId: null, cardLast4: null, cardBrand: null, cardPmId: null, autoCharge: false },
      }),
    );
    return { ok: true };
  }

  /**
   * Cobra automaticamente UMA parcela no cartão salvo (cobrança avulsa).
   * Aprovado → quita a parcela. Recusado → conta tentativa, notifica o cliente
   * (trocar cartão ou pagar Pix no portal); após 3 tentativas marca "exhausted"
   * (a régua de cobrança/juros assume).  ⚠ chamadas MP a validar na conta real.
   */
  async chargeInstallmentAuto(orgId: string, installmentId: string) {
    const ctxLike: RequestContext = {
      userId: null, platformUserId: null, membershipId: null, orgId, storeId: null,
      role: null, isOrgAdmin: false, permissions: {}, isPlatformAdmin: true,
      platformRole: null, techSpecsCategories: [], impersonating: false,
      impersonatingOrgId: null, impersonatorPlatformUserId: null,
    };
    const data = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditInstallment.findFirst({
        where: { id: installmentId },
        include: { creditAccount: { select: { mpCustomerId: true, mpCardId: true, cardPmId: true, autoCharge: true, primaryCustomerId: true } } },
      }),
    );
    if (!data) return { ok: false, reason: "not_found" };
    if (data.status === "paid") return { ok: true, already: true };
    const acc = data.creditAccount;
    if (!acc.autoCharge || !acc.mpCardId || !acc.mpCustomerId) return { ok: false, reason: "no_card" };

    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) return { ok: false, reason: "no_mp" };
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);

    // e-mail do pagador (customer salvo no MP); fallback genérico
    let email = "sememail@yugochat.com.br";
    if (acc.primaryCustomerId) {
      const c = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.customer.findFirst({ where: { id: acc.primaryCustomerId! }, select: { email: true } }),
      );
      if (c?.email) email = c.email;
    }

    const tok = await adapter.cardTokenFromSaved(acc.mpCardId);
    let status: string | undefined;
    let mpPaymentId: string | null = null;
    if (tok.ok && tok.body?.id) {
      const totalCents = Number(data.amountCents) + Number(data.lateFeeCents ?? 0) + Number(data.interestCents ?? 0) - Number(data.discountCents ?? 0);
      const r = await adapter.chargeWithCard({
        token: String(tok.body.id),
        amountCents: Math.max(0, totalCents),
        description: `Crediário · parcela ${data.number}`,
        externalReference: installmentId,
        payerEmail: email,
        customerId: acc.mpCustomerId,
        paymentMethodId: acc.cardPmId ?? undefined,
        notificationUrl: `https://${process.env.DOMAIN ?? "yugochat.com.br"}/api/payments/webhooks/mercadopago/${orgId}`,
      });
      status = r.body?.status;
      mpPaymentId = r.body?.id ? String(r.body.id) : null;
      await this.recordAttempt(ctxLike, installmentId, orgId, "card_auto", Number(data.amountCents),
        status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending",
        { mpPaymentId, error: r.error });
    }

    if (status === "approved") {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
        const inst = await tx.creditInstallment.findFirst({ where: { id: installmentId } });
        if (inst && inst.status !== "paid") await this.settleInstallment(tx as any, inst, "card_auto", null);
        await tx.creditInstallment.update({
          where: { id: installmentId },
          data: { autoChargeStatus: "approved", autoChargeLastAt: new Date(), ...(mpPaymentId ? { mpPaymentId } : {}) },
        });
      });
      return { ok: true, status: "approved" };
    }

    // falhou (ou token falhou): conta tentativa + notifica
    const attempts = (data.autoChargeAttempts ?? 0) + 1;
    const exhausted = attempts >= 3;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditInstallment.update({
        where: { id: installmentId },
        data: { autoChargeAttempts: attempts, autoChargeLastAt: new Date(), autoChargeStatus: exhausted ? "exhausted" : "rejected" },
      }),
    );
    const info = await this.loadInstallment(ctxLike, installmentId).catch(() => null);
    if (info) {
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: orgId }, select: { slug: true } })).catch(() => null);
      const portal = `${orgBaseUrl(org?.slug)}/c`;
      await this.notifyCustomer({
        orgId, storeId: info.installment.storeId ?? orgId, customer: info.customer, account: info.account,
        subject: "Pagamento não aprovado",
        text:
          `${info.account.holderName}, o pagamento da parcela ${info.installment.number} (${brl(Number(info.installment.amountCents))}) ` +
          `não foi aprovado no cartão cadastrado.\n` +
          (exhausted
            ? `Tentamos 3 vezes e não conseguimos. Para evitar juros, regularize agora: troque o cartão ou pague via Pix no seu portal: ${portal}`
            : `Vamos tentar novamente em 1 dia. Se preferir, troque o cartão ou pague via Pix no seu portal: ${portal}`),
      });
    }
    return { ok: false, status: "rejected", attempts, exhausted };
  }

  /**
   * Valida a assinatura do webhook do Mercado Pago.
   * Manifesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
   * HMAC-SHA256 com a secret -> compara com o `v1` do header x-signature.
   * Ref: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
   */
  private verifyMpSignature(
    secret: string,
    sig?: { xSignature: string | null; xRequestId: string | null; dataId: string | null },
  ): boolean {
    if (!sig?.xSignature || !sig.dataId) return false;
    // x-signature: "ts=1700000000,v1=abcdef..."
    const parts = Object.fromEntries(
      sig.xSignature.split(",").map((kv) => {
        const [k, v] = kv.split("=");
        return [k?.trim(), v?.trim()];
      }),
    );
    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;

    // data.id alfanumerico deve ser minusculo no manifesto
    const id = /[a-zA-Z]/.test(sig.dataId) ? sig.dataId.toLowerCase() : sig.dataId;
    const manifest = `id:${id};request-id:${sig.xRequestId ?? ""};ts:${ts};`;
    const expected = createHmac("sha256", secret).update(manifest).digest("hex");
    try {
      const a = Buffer.from(expected, "hex");
      const b = Buffer.from(v1, "hex");
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ============================== HELPERS ==============================
  /** Calcula multa/juros (atraso) ou desconto (antecipacao) sobre a parcela. */
  private amountWithAdjustments(inst: any): {
    base: number; lateFee: number; interest: number; discount: number; total: number;
  } {
    const base = Number(inst.amountCents);
    const due = new Date(inst.dueDate);
    const today = new Date();
    const daysDiff = Math.floor((today.getTime() - due.getTime()) / 86400_000);

    let lateFee = 0, interest = 0, discount = 0;
    const cfg = inst._cfg ?? { lateFeePct: 2, monthlyInterestPct: 1, earlyPct: 0 };

    if (daysDiff > 0) {
      // atraso: multa fixa + juros mora proporcional aos dias
      lateFee = Math.round(base * (cfg.lateFeePct / 100));
      interest = Math.round(base * (cfg.monthlyInterestPct / 100) * (daysDiff / 30));
    } else if (daysDiff < 0 && cfg.earlyPct > 0) {
      // antecipacao: desconto
      discount = Math.round(base * (cfg.earlyPct / 100));
    }
    return { base, lateFee, interest, discount, total: base + lateFee + interest - discount };
  }

  /** Marca parcela como paga, aplica ajustes, atualiza conta e compra. */
  private async settleInstallment(
    tx: PrismaClient,
    inst: any,
    method: string,
    proofUrl: string | null,
    opts?: { manualDiscountCents?: number; discountAuthorizedBy?: string | null },
  ) {
    // pega config da org pra ajustes
    const cfg = await tx.orgCreditConfig.findUnique({ where: { organizationId: inst.organizationId } });
    const adj = this.amountWithAdjustments({
      ...inst,
      _cfg: {
        lateFeePct: cfg?.lateFeePct ?? 2,
        monthlyInterestPct: cfg?.monthlyInterestPct ?? 1,
        earlyPct: cfg?.defaultEarlyPaymentDiscountPct ?? 0,
      },
    });

    // desconto manual autorizado por admin (abate de juros/multa, sem passar do total)
    const manual = Math.max(0, Math.min(opts?.manualDiscountCents ?? 0, adj.lateFee + adj.interest));
    const totalDiscount = adj.discount + manual;
    const finalTotal = Math.max(adj.base, adj.base + adj.lateFee + adj.interest - totalDiscount);

    await tx.creditInstallment.update({
      where: { id: inst.id },
      data: {
        status: "paid",
        paidAt: new Date(),
        paidAmountCents: BigInt(finalTotal),
        lateFeeCents: BigInt(adj.lateFee),
        interestCents: BigInt(adj.interest),
        discountCents: BigInt(totalDiscount),
        // valor "cheio" (antes de qualquer desconto) p/ o portal mostrar
        originalAmountCents: BigInt(adj.base + adj.lateFee + adj.interest),
        ...(manual > 0
          ? { manualDiscountCents: BigInt(manual), discountAuthorizedBy: opts?.discountAuthorizedBy ?? null, discountAuthAt: new Date() }
          : {}),
        paymentMethod: method,
        proofUrl,
      },
    });

    // libera o valor base no limite (used_cents diminui)
    await tx.creditAccount.update({
      where: { id: inst.creditAccountId },
      data: { usedCents: { decrement: BigInt(adj.base) } },
    });

    // se todas as parcelas da compra pagas -> purchase paid
    const pending = await tx.creditInstallment.count({
      where: { creditPurchaseId: inst.creditPurchaseId, status: { not: "paid" } },
    });
    if (pending === 0) {
      await tx.creditPurchase.update({
        where: { id: inst.creditPurchaseId },
        data: { status: "paid" },
      });
    }

    await tx.creditAccountEvent.create({
      data: {
        organizationId: inst.organizationId,
        creditAccountId: inst.creditAccountId,
        eventType: "payment_received",
        payload: { installment: inst.number, total: adj.total, method } as any,
        actorType: method === "in_person" ? "staff" : "system",
      },
    });
  }

  private async recordAttempt(
    ctx: RequestContext,
    installmentId: string,
    orgId: string,
    method: string,
    amountCents: number,
    status: string,
    extra: { mpPaymentId?: string | null; error?: string },
  ) {
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.paymentAttempt.create({
        data: {
          organizationId: orgId,
          installmentId,
          method,
          amountCents: BigInt(amountCents),
          status,
          mpPaymentId: extra.mpPaymentId ?? null,
          errorMessage: extra.error ?? null,
        },
      }),
    );
  }

  private async loadInstallment(ctx: RequestContext, installmentId: string) {
    const rls = ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
    const inst = await this.prisma.runWithContext(rls, (tx) =>
      tx.creditInstallment.findFirst({
        where: { id: installmentId },
        include: {
          creditAccount: true,
          creditPurchase: { select: { storeId: true } },
        },
      }),
    );
    if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela nao encontrada", 404);
    const account = inst.creditAccount;
    let customer: { email: string | null; whatsappPhone: string | null; phone: string | null; id: string } | null = null;
    if (account.primaryCustomerId) {
      customer = await this.prisma.runWithContext(rls, (tx) =>
        tx.customer.findFirst({
          where: { id: account.primaryCustomerId! },
          select: { id: true, email: true, whatsappPhone: true, phone: true },
        }),
      );
    }
    return {
      installment: { ...inst, storeId: inst.creditPurchase?.storeId ?? null },
      account,
      customer,
      orgId: inst.organizationId,
    };
  }

  private async notifyCustomer(opts: {
    orgId: string;
    storeId: string;
    customer: { id: string; email: string | null; whatsappPhone: string | null; phone: string | null } | null;
    account: { holderName: string };
    subject: string;
    text: string;
  }) {
    if (!opts.customer) return;
    await this.notifications.notify({
      organizationId: opts.orgId,
      storeId: opts.storeId,
      customerId: opts.customer.id,
      whatsappPhone: opts.customer.whatsappPhone ?? opts.customer.phone,
      email: opts.customer.email,
      subject: opts.subject,
      text: opts.text,
      templateCode: "credit_payment",
    });
  }

  // ======================= AUTORIZAÇÃO DE DESCONTO =======================
  /** Lista admins/gerentes da org que podem autorizar desconto (com WhatsApp). */
  async listAuthAdmins(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId!;
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.membership.findMany({
        where: {
          organizationId: orgId,
          status: "active",
          role: { slug: { in: ["owner", "admin", "manager", "gerente"] } },
        },
        select: { id: true, user: { select: { name: true, phone: true } }, role: { select: { name: true, slug: true } } },
      }),
    );
    return rows.map((r) => ({
      membershipId: r.id,
      name: r.user?.name ?? "—",
      role: r.role?.name ?? r.role?.slug ?? "",
      hasWhatsapp: !!r.user?.phone,
    }));
  }

  /** Gera código 4 dígitos, salva o hash e envia no WhatsApp do admin escolhido. */
  async requestDiscountAuth(
    ctx: RequestContext,
    installmentId: string,
    body: { adminMembershipId: string; discountCents: number },
  ) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId!;
    const discountCents = Math.max(0, Math.round(Number(body.discountCents) || 0));
    if (discountCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Informe o valor do desconto", 400);

    const admin = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.membership.findFirst({
        where: { id: body.adminMembershipId, organizationId: orgId, status: "active" },
        select: { id: true, user: { select: { name: true, phone: true } }, storeId: true },
      }),
    );
    if (!admin) throw new AppError(ErrorCode.NotFound, "Admin não encontrado", 404);
    if (!admin.user?.phone) throw new AppError(ErrorCode.ValidationFailed, "Admin sem WhatsApp cadastrado", 400);

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60_000);

    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAuthCode.create({
        data: {
          organizationId: orgId,
          installmentId,
          adminMembershipId: admin.id,
          requestedBy: ctx.membershipId ?? null,
          purpose: "interest_discount",
          codeHash,
          amountCents: BigInt(discountCents),
          expiresAt,
        },
        select: { id: true },
      }),
    );

    // envia o código no WhatsApp do admin
    await this.notifications.notify({
      organizationId: orgId,
      storeId: admin.storeId ?? orgId,
      whatsappPhone: admin.user.phone,
      subject: "Autorização de desconto",
      text:
        `Código de autorização: ${code}\n` +
        `Desconto de ${brl(discountCents)} em juros/multa de uma parcela do crediário.\n` +
        `Informe este código ao atendente. Válido por 15 minutos.`,
      templateCode: "credit_payment",
    });

    return { ok: true, requestId: rec.id, adminName: admin.user.name, expiresAt };
  }

  /** Valida o código informado e devolve o desconto autorizado. */
  private async verifyAuthCode(
    ctx: RequestContext,
    installmentId: string,
    requestId: string,
    code: string,
    purpose: string,
  ): Promise<{ amountCents: number; adminMembershipId: string }> {
    const rec = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAuthCode.findFirst({ where: { id: requestId, installmentId, purpose } }),
    );
    if (!rec) throw new AppError(ErrorCode.NotFound, "Autorização não encontrada", 404);
    if (rec.usedAt) throw new AppError(ErrorCode.Conflict, "Código já utilizado", 409);
    if (rec.expiresAt.getTime() < Date.now()) throw new AppError(ErrorCode.ValidationFailed, "Código expirado", 400);
    if ((rec.attempts ?? 0) >= 5) throw new AppError(ErrorCode.ValidationFailed, "Tentativas esgotadas", 400);

    const codeHash = createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(String(code)).digest("hex");
    const ok = codeHash.length === rec.codeHash.length && timingSafeEqual(Buffer.from(codeHash), Buffer.from(rec.codeHash));
    if (!ok) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.creditAuthCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 } } }),
      );
      throw new AppError(ErrorCode.ValidationFailed, "Código incorreto", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAuthCode.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    );
    return { amountCents: Number(rec.amountCents ?? 0n), adminMembershipId: rec.adminMembershipId };
  }

  // ======================= AJUSTE DE VENCIMENTO =======================
  /** Admin/gerente remarca a data da parcela (nova data + tolerância + motivo). */
  async adjustDueDate(
    ctx: RequestContext,
    installmentId: string,
    body: { newDueDate: string; toleranceDays?: number; reason?: string },
  ) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/gerente", 403);
    }
    const newDue = new Date(body.newDueDate);
    if (isNaN(newDue.getTime())) throw new AppError(ErrorCode.ValidationFailed, "Data inválida", 400);
    const reason = (body.reason ?? "").trim();
    if (!reason) throw new AppError(ErrorCode.ValidationFailed, "Informe o motivo", 400);
    const tolerance = body.toleranceDays != null ? Math.max(0, Math.round(Number(body.toleranceDays))) : null;

    const updated = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const inst = await tx.creditInstallment.findFirst({ where: { id: installmentId } });
      if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela não encontrada", 404);
      if (inst.status === "paid") throw new AppError(ErrorCode.Conflict, "Parcela já paga", 409);
      const res = await tx.creditInstallment.update({
        where: { id: installmentId },
        data: {
          dueDateOriginal: inst.dueDateOriginal ?? inst.dueDate,
          dueDate: newDue,
          dueAdjustedAt: new Date(),
          dueAdjustedBy: ctx.membershipId ?? null,
          dueAdjustReason: reason,
          dueToleranceDays: tolerance,
        },
      });
      await tx.creditAccountEvent.create({
        data: {
          organizationId: inst.organizationId,
          creditAccountId: inst.creditAccountId,
          eventType: "attention",
          payload: {
            kind: "due_adjusted",
            installment: inst.number,
            from: inst.dueDate,
            to: newDue,
            toleranceDays: tolerance,
            reason,
          } as any,
          actorType: "staff",
        },
      });
      return res;
    });

    // avisa o cliente da nova data
    const info = await this.loadInstallment(ctx, installmentId).catch(() => null);
    if (info) {
      await this.notifyCustomer({
        orgId: info.orgId,
        storeId: info.installment.storeId ?? info.account.organizationId,
        customer: info.customer,
        account: info.account,
        subject: "Vencimento ajustado",
        text:
          `${info.account.holderName}, a parcela ${info.installment.number} teve o vencimento ajustado para ` +
          `${newDue.toLocaleDateString("pt-BR")}${tolerance ? ` (tolerância de ${tolerance} dia(s))` : ""}.`,
      });
    }
    return updated;
  }
}
