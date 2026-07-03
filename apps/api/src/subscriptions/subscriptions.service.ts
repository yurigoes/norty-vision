import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { MercadoPagoAdapter } from "./mercadopago.adapter";
import { MercadoPagoOrgAdapter } from "../payments/mercadopago-org.adapter";
import { PlatformContractsService } from "../platform-contracts/platform-contracts.service";
import { SubscriptionInvoicesService } from "../subscription-invoices/subscription-invoices.service";
import type { RequestContext } from "../auth/session.middleware";

interface StartCheckoutInput {
  planId?: string;
  planSlug?: string;
  backUrl?: string;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger("Subscriptions");

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly platformContracts: PlatformContractsService,
    private readonly subscriptionInvoices: SubscriptionInvoicesService,
  ) {}

  /** Retorna assinatura da org atual (cria trial default se nao existir). */
  async current(ctx: RequestContext) {
    if (!ctx.orgId) {
      throw new AppError(ErrorCode.Forbidden, "Sem organizacao no contexto", 403);
    }
    let sub = await this.prisma.runWithContext(
      { orgId: ctx.orgId, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.subscription.findUnique({
          where: { organizationId: ctx.orgId! },
          include: { plan: true },
        }),
    );
    return sub;
  }

  /** Master: lista todas assinaturas. */
  async listAll() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscription.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          plan: { select: { slug: true, name: true, priceCents: true } },
          // organization relation not in our schema subset; deixar pra resolver via mapeamento se preciso
        },
      }),
    );
  }

  /** Atribui um plano a uma org (em trial). Usado em self-signup e troca de plano. */
  async assignPlan(opts: {
    organizationId: string;
    planSlug: string;
  }) {
    const plan = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.plan.findUnique({ where: { slug: opts.planSlug } }),
    );
    if (!plan) throw new AppError(ErrorCode.NotFound, "Plano nao existe", 404);

    const trialEndsAt = new Date(Date.now() + plan.trialDays * 86400_000);

    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const sub = await tx.subscription.upsert({
        where: { organizationId: opts.organizationId },
        update: {
          planId: plan.id,
          status: "trialing",
          trialEndsAt,
        },
        create: {
          organizationId: opts.organizationId,
          planId: plan.id,
          status: "trialing",
          trialEndsAt,
        },
      });
      // sincroniza o planCode da org → é o que dirige a liberação de módulos
      // (cadeado). Assim a empresa que assina recebe os módulos do plano sem
      // intervenção do master.
      await tx.organization.update({
        where: { id: opts.organizationId },
        data: { planCode: plan.slug },
      });
      return sub;
    });
  }

  /**
   * Cria checkout no MP pra ativar a assinatura. Retorna init_point pra
   * o front redirecionar. Apos pagamento aprovado, webhook ativa.
   */
  async startCheckout(ctx: RequestContext, input: StartCheckoutInput) {
    if (!ctx.orgId) {
      throw new AppError(ErrorCode.Forbidden, "Sem organizacao", 403);
    }
    if (!ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas owner/admin", 403);
    }

    // resolve plano
    const plan = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      async (tx) => {
        if (input.planId) {
          return tx.plan.findUnique({ where: { id: input.planId } });
        }
        if (input.planSlug) {
          return tx.plan.findUnique({ where: { slug: input.planSlug } });
        }
        return null;
      },
    );
    if (!plan) throw new AppError(ErrorCode.NotFound, "Plano nao informado/existe", 404);

    // resolve credenciais MP
    const mp = await this.integrations.getByProvider({
      isPlatformAdmin: true,
      provider: "mercadopago",
    });
    if (!mp || mp.status !== "active" || !mp.apiToken) {
      throw new AppError(
        ErrorCode.Internal,
        "Mercado Pago nao esta configurado pelo master",
        500,
      );
    }

    // resolve org pra pegar email do contato (payer)
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findUnique({ where: { id: ctx.orgId! } }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Org nao encontrada", 404);

    const payerEmail = org.contactEmail ?? (await this.firstOwnerEmail(ctx.orgId!));
    if (!payerEmail) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Cadastre um email de contato na organizacao antes",
        400,
      );
    }

    // garante subscription row
    const sub = await this.assignPlan({
      organizationId: ctx.orgId,
      planSlug: plan.slug,
    });

    // cria preapproval no MP
    const adapter = new MercadoPagoAdapter({ accessToken: mp.apiToken });
    const backUrl =
      input.backUrl ?? `https://${process.env.DOMAIN ?? "yugochat.com.br"}/app/billing?status=back`;

    const r = await adapter.createPreapproval({
      reason: `${plan.name} — ${org.name}`,
      payerEmail,
      externalReference: sub.id,
      backUrl,
      amountCents: plan.priceCents,
      frequencyDays: plan.interval === "yearly" ? 365 : 30,
      trialDays: plan.trialDays,
    });

    if (!r.ok) {
      throw new AppError(
        ErrorCode.Internal,
        `Falha ao criar checkout MP: ${r.error}`,
        500,
      );
    }

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscription.update({
        where: { id: sub.id },
        data: {
          mpSubscriptionId: r.preapprovalId,
          mpPayerEmail: payerEmail,
          mpInitPoint: r.initPoint,
        },
      }),
    );

    return { initPoint: r.initPoint, subscriptionId: sub.id };
  }

  /**
   * Cobrança AVULSA (sem recorrência): gera 1 Pix (QR) ou link de cartão pra
   * a empresa pagar 1 período. Quando o pagamento é aprovado, o webhook estende
   * o período da assinatura. Usa o MP do master (mesmo token).
   */
  async startOneTime(ctx: RequestContext, input: { planId?: string; planSlug?: string; method: "pix" | "card" }) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem organizacao", 403);
    if (!ctx.isOrgAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas owner/admin", 403);

    const plan = await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      if (input.planId) return tx.plan.findUnique({ where: { id: input.planId } });
      if (input.planSlug) return tx.plan.findUnique({ where: { slug: input.planSlug } });
      return null;
    });
    if (!plan) throw new AppError(ErrorCode.NotFound, "Plano nao informado/existe", 404);

    const mp = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "mercadopago" });
    if (!mp || mp.status !== "active" || !mp.apiToken) {
      throw new AppError(ErrorCode.Internal, "Mercado Pago nao esta configurado pelo master", 500);
    }

    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findUnique({ where: { id: ctx.orgId! } }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Org nao encontrada", 404);
    const payerEmail = org.contactEmail ?? (await this.firstOwnerEmail(ctx.orgId!));
    if (!payerEmail) throw new AppError(ErrorCode.ValidationFailed, "Cadastre um email de contato na organizacao antes", 400);

    const sub = await this.assignPlan({ organizationId: ctx.orgId, planSlug: plan.slug });
    const adapter = new MercadoPagoOrgAdapter(mp.apiToken);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const notificationUrl = `https://${domain}/api/subscriptions/webhooks/mercadopago`;

    if (input.method === "pix") {
      const r = await adapter.createPixPayment({
        amountCents: plan.priceCents,
        description: `${plan.name} — ${org.name}`,
        externalReference: sub.id,
        payerEmail,
        payerName: org.name,
        payerDocument: org.document ?? "",
        notificationUrl,
      });
      if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha ao gerar Pix: ${r.error}`, 500);
      const qr = r.body?.point_of_interaction?.transaction_data;
      return {
        method: "pix" as const,
        amountCents: plan.priceCents,
        qrCode: qr?.qr_code ?? null,
        qrCodeBase64: qr?.qr_code_base64 ?? null,
        ticketUrl: qr?.ticket_url ?? null,
        subscriptionId: sub.id,
      };
    }

    const r = await adapter.createCheckoutPreference({
      amountCents: plan.priceCents,
      title: `${plan.name} — ${org.name}`,
      externalReference: sub.id,
      payerEmail,
      backUrl: `https://${domain}/app/billing?status=back`,
      notificationUrl,
    });
    if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha no checkout cartão: ${r.error}`, 500);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscription.update({ where: { id: sub.id }, data: { mpInitPoint: r.body?.init_point ?? null, mpPayerEmail: payerEmail } }),
    );
    return { method: "card" as const, amountCents: plan.priceCents, initPoint: r.body?.init_point ?? null, subscriptionId: sub.id };
  }

  // ===== COMPRA DE MÓDULO À LA CARTE (empresa paga a Yugochat) =====
  /** Módulos à la carte que o master precificou pra esta empresa e ainda não
   *  foram pagos — a empresa pode comprar pra desbloquear. */
  async listMyModuleOffers(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem organizacao", 403);
    const grants = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.findMany({ where: { organizationId: ctx.orgId!, kind: "alacarte", paid: false }, orderBy: { createdAt: "desc" } }),
    );
    return grants
      .filter((g) => (g.priceCents ?? 0) > 0)
      .map((g) => ({ moduleKey: g.moduleKey, priceCents: g.priceCents ?? 0, blocked: g.blocked, expiresAt: g.expiresAt }));
  }

  /** Inicia o pagamento (Pix/cartão) de um módulo à la carte. Ao aprovar, o
   *  webhook marca o grant como pago e o módulo é desbloqueado. */
  async startModulePurchase(ctx: RequestContext, input: { moduleKey: string; method: "pix" | "card" }) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem organizacao", 403);
    if (!ctx.isOrgAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas owner/admin", 403);
    let grant = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.findFirst({ where: { organizationId: ctx.orgId!, moduleKey: input.moduleKey } }),
    );
    // self-service: sem grant ainda → cria um à la carte a partir do preço do master
    if (!grant) {
      const price = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.modulePrice.findUnique({ where: { moduleKey: input.moduleKey } }));
      if (!price || !price.active || price.priceCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Módulo não está disponível para compra avulsa", 400);
      grant = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.orgModuleGrant.create({ data: { organizationId: ctx.orgId!, moduleKey: input.moduleKey, kind: "alacarte", priceCents: price.priceCents, blocked: false, paid: false } }),
      );
    }
    if (grant.kind !== "alacarte") throw new AppError(ErrorCode.NotFound, "Módulo não está disponível para compra", 404);
    if (grant.paid) throw new AppError(ErrorCode.Conflict, "Módulo já está pago", 409);
    if (!grant.priceCents || grant.priceCents <= 0) throw new AppError(ErrorCode.ValidationFailed, "Módulo sem preço definido — fale com o suporte", 400);

    const mp = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "mercadopago" });
    if (!mp || mp.status !== "active" || !mp.apiToken) throw new AppError(ErrorCode.Internal, "Mercado Pago nao esta configurado pelo master", 500);

    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findUnique({ where: { id: ctx.orgId! } }));
    if (!org) throw new AppError(ErrorCode.NotFound, "Org nao encontrada", 404);
    const payerEmail = org.contactEmail ?? (await this.firstOwnerEmail(ctx.orgId!));
    if (!payerEmail) throw new AppError(ErrorCode.ValidationFailed, "Cadastre um email de contato na organizacao antes", 400);

    const adapter = new MercadoPagoOrgAdapter(mp.apiToken);
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const notificationUrl = `https://${domain}/api/subscriptions/webhooks/mercadopago`;
    const extRef = `mod:${grant.id}`;
    const label = `Módulo ${input.moduleKey} — ${org.name}`;

    if (input.method === "pix") {
      const r = await adapter.createPixPayment({ amountCents: grant.priceCents, description: label, externalReference: extRef, payerEmail, payerName: org.name, payerDocument: org.document ?? "", notificationUrl });
      if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha ao gerar Pix: ${r.error}`, 500);
      const qr = r.body?.point_of_interaction?.transaction_data;
      return { method: "pix" as const, amountCents: grant.priceCents, qrCode: qr?.qr_code ?? null, qrCodeBase64: qr?.qr_code_base64 ?? null, ticketUrl: qr?.ticket_url ?? null };
    }
    const r = await adapter.createCheckoutPreference({ amountCents: grant.priceCents, title: label, externalReference: extRef, payerEmail, backUrl: `https://${domain}/app/billing?status=back`, notificationUrl });
    if (!r.ok) throw new AppError(ErrorCode.Internal, `Falha no checkout cartão: ${r.error}`, 500);
    return { method: "card" as const, amountCents: grant.priceCents, initPoint: r.body?.init_point ?? null };
  }

  /** Webhook entry point (chamado pelo controller publico). */
  async handleWebhook(opts: {
    body: any;
    queryType?: string;
    queryId?: string;
    sig?: { xSignature: string | null; xRequestId: string | null; dataId: string | null };
  }) {
    const { body, queryType, queryId, sig } = opts;

    // MP manda diferentes formatos. Vamos logar tudo e correlacionar pelo
    // payment.id ou preapproval.id.
    const eventType = body?.type ?? queryType ?? "unknown";
    const mpEventId =
      body?.id?.toString() ?? body?.data?.id?.toString() ?? queryId ?? null;

    this.logger.log(
      `Webhook MP: type=${eventType} id=${mpEventId} action=${body?.action}`,
    );

    // ja processado?
    if (mpEventId) {
      const existing = await this.prisma.runWithContext(
        { isPlatformAdmin: true },
        (tx) => tx.subscriptionEvent.findUnique({ where: { mpEventId } }),
      );
      if (existing) {
        return { ok: true, deduped: true };
      }
    }

    // determina subscription via external_reference (preapproval) ou via payment.id
    let subscriptionId: string | null = null;
    let amountCents: number | null = null;
    let status: string | null = null;
    let oneTime = false; // pagamento avulso (Pix/cartão por período)
    let modGrantId: string | null = null; // compra de módulo à la carte (external_reference = "mod:<grantId>")
    let invoiceId: string | null = null; // mensalidade (external_reference = "inv:<id>")

    const mp = await this.integrations.getByProvider({
      isPlatformAdmin: true,
      provider: "mercadopago",
    });

    // valida a assinatura x-signature do MP (se a secret estiver configurada),
    // igual ao fluxo da empresa.
    const secret = (mp as any)?.password as string | undefined;
    if (secret) {
      if (!this.verifyMpSignature(secret, sig)) {
        this.logger.warn("Webhook MP master: assinatura inválida — descartado");
        return { ok: false, error: "assinatura invalida" };
      }
    }

    if (mp?.apiToken) {
      const adapter = new MercadoPagoAdapter({ accessToken: mp.apiToken });

      if (eventType === "preapproval" || eventType === "subscription_preapproval") {
        // body.data.id e o preapproval_id
        const pid = body?.data?.id ?? body?.id;
        if (pid) {
          const r = await adapter.getPreapproval(pid);
          if (r.ok) {
            const extRef = r.body?.external_reference;
            status = r.body?.status;
            if (extRef) {
              subscriptionId = extRef;
            }
          }
        }
      } else if (eventType === "payment") {
        const pid = body?.data?.id ?? body?.id;
        if (pid) {
          const r = await adapter.getPayment(pid);
          if (r.ok) {
            amountCents = Math.round((r.body?.transaction_amount ?? 0) * 100);
            status = r.body?.status;
            const preapprovalId =
              r.body?.metadata?.preapproval_id ?? r.body?.preapproval_id;
            if (preapprovalId) {
              const sub = await this.prisma.runWithContext(
                { isPlatformAdmin: true },
                (tx) =>
                  tx.subscription.findFirst({
                    where: { mpSubscriptionId: preapprovalId },
                  }),
              );
              if (sub) subscriptionId = sub.id;
            } else if (r.body?.external_reference) {
              const extRef = String(r.body.external_reference);
              if (extRef.startsWith("mod:")) {
                // compra de MÓDULO à la carte: external_reference = "mod:<grantId>"
                modGrantId = extRef.slice(4);
              } else if (extRef.startsWith("inv:")) {
                // pagamento de MENSALIDADE: external_reference = "inv:<invoiceId>"
                invoiceId = extRef.slice(4);
              } else {
                // pagamento AVULSO: external_reference = subscription.id
                const sub = await this.prisma.runWithContext(
                  { isPlatformAdmin: true },
                  (tx) => tx.subscription.findFirst({ where: { id: extRef } }),
                );
                if (sub) { subscriptionId = sub.id; oneTime = true; }
              }
            }
          }
        }
      }
    }

    // grava o evento
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscriptionEvent.create({
        data: {
          subscriptionId,
          eventType,
          mpEventId,
          mpPaymentId: body?.data?.id?.toString() ?? null,
          amountCents,
          status,
          rawPayload: body,
          processedAt: new Date(),
        },
      }),
    );

    // ajusta status da subscription com base no que veio
    if (subscriptionId && status) {
      const newStatus = this.translateStatus(status);
      if (newStatus) {
        // pagamento avulso aprovado → estende o período por 1 intervalo
        let periodEnd: Date | undefined;
        if (oneTime && newStatus === "active") {
          const sub = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.subscription.findUnique({ where: { id: subscriptionId! }, include: { plan: true } }),
          );
          const days = sub?.plan?.interval === "yearly" ? 365 : 30;
          const base = sub?.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
          periodEnd = new Date(base.getTime() + days * 86400_000);
        }
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.subscription.update({
            where: { id: subscriptionId! },
            data: {
              status: newStatus,
              currentPeriodStart: newStatus === "active" ? new Date() : undefined,
              ...(periodEnd ? { currentPeriodEnd: periodEnd, trialEndsAt: null } : {}),
            },
          }),
        );
      }
    }

    // compra de MÓDULO à la carte aprovada → marca o grant como pago (desbloqueia)
    if (modGrantId && status === "approved") {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.orgModuleGrant.updateMany({ where: { id: modGrantId! }, data: { paid: true, paidAt: new Date(), blocked: false } }),
      ).catch(() => undefined);
      // gera o aditivo contratual do módulo (best-effort) — puxa nome + preço
      try {
        const grant = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.orgModuleGrant.findUnique({ where: { id: modGrantId! }, select: { organizationId: true, moduleKey: true } }),
        );
        if (grant) await this.platformContracts.autoAssignModuleAddendum(grant.organizationId, grant.moduleKey);
      } catch { /* best-effort */ }
    }

    // pagamento de MENSALIDADE aprovado → baixa a fatura + reativa a empresa
    if (invoiceId && status === "approved") {
      await this.subscriptionInvoices.markPaidByWebhook(invoiceId, "mercadopago").catch(() => undefined);
    }

    return { ok: true };
  }

  async cancel(ctx: RequestContext) {
    if (!ctx.orgId) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    if (!ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas owner/admin", 403);
    }
    const sub = await this.current(ctx);
    if (!sub) throw new AppError(ErrorCode.NotFound, "Sem assinatura", 404);

    if (sub.mpSubscriptionId) {
      const mp = await this.integrations.getByProvider({
        isPlatformAdmin: true,
        provider: "mercadopago",
      });
      if (mp?.apiToken) {
        const adapter = new MercadoPagoAdapter({ accessToken: mp.apiToken });
        await adapter.cancelPreapproval(sub.mpSubscriptionId);
      }
    }

    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          endsAt: sub.currentPeriodEnd ?? new Date(),
        },
      }),
    );
  }

  /** Valida o x-signature do MP (mesmo algoritmo do fluxo da empresa). */
  private verifyMpSignature(
    secret: string,
    sig?: { xSignature: string | null; xRequestId: string | null; dataId: string | null },
  ): boolean {
    if (!sig?.xSignature || !sig.dataId) return false;
    const parts = Object.fromEntries(
      sig.xSignature.split(",").map((kv) => {
        const [k, v] = kv.split("=");
        return [k?.trim(), v?.trim()];
      }),
    );
    const ts = parts["ts"];
    const v1 = parts["v1"];
    if (!ts || !v1) return false;
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

  // -----------------------------------------------------------------------
  private async firstOwnerEmail(orgId: string): Promise<string | null> {
    const memberships = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.membership.findMany({
          where: { organizationId: orgId, status: "active", isPrimary: true },
          include: { user: true, role: true },
        }),
    );
    const owner = memberships.find((m) => m.role.slug === "owner");
    return owner?.user.email ?? memberships[0]?.user.email ?? null;
  }

  private translateStatus(mpStatus: string): string | null {
    switch (mpStatus) {
      case "authorized":
      case "approved":
      case "active":
        return "active";
      case "pending":
        return "trialing";
      case "paused":
        return "paused";
      case "cancelled":
      case "canceled":
        return "canceled";
      case "rejected":
        return "past_due";
      default:
        return null;
    }
  }
}
