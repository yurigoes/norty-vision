import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "../payments/payments.service";
import { SurveysService } from "../surveys/surveys.service";
import { HelpdeskService } from "../helpdesk/helpdesk.service";
import type { RequestContext } from "../auth/session.middleware";
import type { CustomerContext } from "./customer-context";

interface ProfileInput {
  email?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  addressLine?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  avatarUrl?: string | null;
}

interface ApplicationInput {
  incomeCents: number;
  requestedLimitCents: number;
  documents: Array<{ docType: string; fileUrl: string }>;
}

@Injectable()
export class CustomerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly surveys: SurveysService,
    private readonly helpdesk: HelpdeskService,
  ) {}

  /** Contexto "de org" (platform-admin escopado) p/ chamar serviços internos. */
  private orgCtx(ctx: CustomerContext): RequestContext {
    return {
      userId: null, platformUserId: null, membershipId: null, orgId: ctx.organizationId,
      storeId: null, role: null, isOrgAdmin: false, permissions: {}, isPlatformAdmin: true,
      platformRole: null, techSpecsCategories: [], impersonating: false,
      impersonatingOrgId: null, impersonatorPlatformUserId: null,
    };
  }

  // ============================== CHAMADOS (portal) ==============================
  async listMyTickets(ctx: CustomerContext) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.ticket.findMany({
        where: { organizationId: ctx.organizationId, requesterCustomerId: ctx.customerId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true, code: true, subject: true, status: true, priority: true,
          createdAt: true, resolvedAt: true, closedAt: true,
        },
      }),
    );
  }

  // ===== CENTRAL DE AJUDA (FAQ publicada da empresa) =====
  async listMyHelp(ctx: CustomerContext) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.kbEntry.findMany({
        where: { organizationId: ctx.organizationId, status: "published" },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }], take: 200,
        select: { id: true, topic: true, question: true, answer: true },
      }),
    );
  }

  // ===== ORDENS DE SERVIÇO (portal do cliente, tempo real) =====
  async listMyServiceOrders(ctx: CustomerContext) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.serviceOrder.findMany({
        where: { organizationId: ctx.organizationId, customerId: ctx.customerId },
        orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, code: true, title: true, equipment: true, type: true, urgency: true, status: true, totalCents: true, openedAt: true, readyAt: true, deliveredAt: true, dueAt: true, rating: true },
      }),
    );
  }
  async getMyServiceOrder(ctx: CustomerContext, id: string) {
    const so = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.serviceOrder.findFirst({
        where: { id, organizationId: ctx.organizationId, customerId: ctx.customerId },
        include: { items: true, events: { where: { eventType: { in: ["created", "status", "rated"] } }, orderBy: { createdAt: "asc" } } },
      }),
    );
    if (!so) throw new AppError(ErrorCode.NotFound, "Ordem de serviço não encontrada", 404);
    return so;
  }
  async rateMyServiceOrder(ctx: CustomerContext, id: string, rating: number, comment?: string) {
    const so = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.serviceOrder.findFirst({ where: { id, organizationId: ctx.organizationId, customerId: ctx.customerId } }));
    if (!so) throw new AppError(ErrorCode.NotFound, "Ordem de serviço não encontrada", 404);
    if (so.status !== "delivered") throw new AppError(ErrorCode.ValidationFailed, "Só é possível avaliar depois da entrega.", 400);
    const r = Math.max(1, Math.min(5, Math.round(rating)));
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.serviceOrder.update({ where: { id }, data: { rating: r, ratingComment: comment?.trim() || null, ratedAt: new Date() } }));
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.serviceOrderEvent.create({ data: { organizationId: ctx.organizationId, serviceOrderId: id, eventType: "rated", payload: { rating: r } as any, actorType: "customer" } })).catch(() => undefined);
    return { ok: true };
  }

  async getMyTicket(ctx: CustomerContext, id: string) {
    const t = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.ticket.findFirst({
        where: { id, organizationId: ctx.organizationId, requesterCustomerId: ctx.customerId },
        include: {
          // cliente NÃO vê notas internas
          messages: { where: { isInternal: false }, orderBy: { createdAt: "asc" } },
          serviceOrders: { include: { items: true }, orderBy: { createdAt: "desc" } },
        },
      }),
    );
    if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
    return t;
  }

  async openTicket(ctx: CustomerContext, input: { subject: string; description: string; priority?: string }) {
    if (!input?.subject?.trim() || !input?.description?.trim()) {
      throw new AppError(ErrorCode.ValidationFailed, "Informe assunto e descrição", 400);
    }
    return this.helpdesk.createTicket(this.orgCtx(ctx), {
      subject: input.subject.trim(),
      description: input.description.trim(),
      priority: input.priority,
      channel: "portal",
      requesterCustomerId: ctx.customerId,
      requesterName: ctx.holderName,
    });
  }

  async replyMyTicket(ctx: CustomerContext, id: string, body: string) {
    if (!body?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Mensagem vazia", 400);
    await this.assertTicketOwner(ctx, id);
    const orgId = ctx.organizationId;
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const msg = await tx.ticketMessage.create({
        data: { organizationId: orgId, ticketId: id, authorType: "customer", authorName: ctx.holderName, body: body.trim(), isInternal: false },
      });
      // cliente respondeu → volta pra fila (a menos que já fechado)
      const t = await tx.ticket.findFirst({ where: { id }, select: { status: true } });
      if (t && t.status !== "closed") {
        await tx.ticket.update({ where: { id }, data: { status: "open", updatedAt: new Date() } });
      }
      await tx.ticketEvent.create({ data: { organizationId: orgId, ticketId: id, eventType: "reply", actorType: "customer" } });
      return msg;
    });
  }

  async confirmCloseMyTicket(ctx: CustomerContext, id: string, input: { satisfied: boolean; rating?: number; comment?: string }) {
    await this.assertTicketOwner(ctx, id);
    return this.helpdesk.confirmClose(this.orgCtx(ctx), id, input);
  }

  private async assertTicketOwner(ctx: CustomerContext, id: string) {
    const t = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.ticket.findFirst({
        where: { id, organizationId: ctx.organizationId, requesterCustomerId: ctx.customerId },
        select: { id: true },
      }),
    );
    if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
  }

  /** NPS espontâneo do cliente no portal (sempre disponível). */
  async submitNps(ctx: CustomerContext, input: { npsScore: number; comment?: string | null }) {
    const customer = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.findFirst({ where: { id: ctx.customerId }, select: { storeId: true } }),
    );
    await this.surveys.submitPortalNps({
      organizationId: ctx.organizationId,
      customerId: ctx.customerId,
      storeId: customer?.storeId ?? null,
      npsScore: input.npsScore,
      comment: input.comment ?? null,
    });
    return { ok: true };
  }

  /**
   * Cliente clica em "pagar" numa parcela no portal → gera cobrança no
   * Mercado Pago da empresa (Pix com QR ou link de cartão). A baixa é
   * automática pelo webhook (external_reference = installment.id).
   */
  /** Status do cartão salvo da conta (pra UI do portal). */
  async getCardStatus(ctx: CustomerContext) {
    if (!ctx.creditAccountId) return { hasCard: false, autoCharge: false, last4: null, brand: null, publicKey: null };
    const acc = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.findFirst({ where: { id: ctx.creditAccountId! }, select: { mpCardId: true, cardLast4: true, cardBrand: true, autoCharge: true, organizationId: true } }),
    );
    // chave pública do MP da empresa → habilita tokenização no navegador (MP.js)
    let publicKey: string | null = null;
    if (acc?.organizationId) {
      const mp = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organizationIntegration.findFirst({
          where: { organizationId: acc.organizationId, provider: "mercadopago", status: "active" },
          select: { publicKey: true },
        }),
      );
      publicKey = mp?.publicKey ?? null;
    }
    return { hasCard: !!acc?.mpCardId, autoCharge: !!acc?.autoCharge, last4: acc?.cardLast4 ?? null, brand: acc?.cardBrand ?? null, publicKey };
  }

  /** Salva o cartão (token MP.js) na conta do cliente → liga a cobrança automática. */
  async saveCreditCard(ctx: CustomerContext, input: { cardToken: string; last4?: string; brand?: string; pmId?: string }) {
    if (!ctx.creditAccountId) throw new AppError(ErrorCode.ValidationFailed, "Sem conta de crediário", 400);
    const acc = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.findFirst({ where: { id: ctx.creditAccountId! }, select: { id: true, organizationId: true, holderName: true, document: true, primaryCustomerId: true } }),
    );
    if (!acc) throw new AppError(ErrorCode.NotFound, "Conta não encontrada", 404);
    let email = "sememail@yugochat.com.br";
    if (acc.primaryCustomerId) {
      const c = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.customer.findFirst({ where: { id: acc.primaryCustomerId! }, select: { email: true } }),
      );
      if (c?.email) email = c.email;
    }
    const r = await this.payments.saveCardForAccount(acc.organizationId, acc.id, {
      cardToken: input.cardToken, email, firstName: acc.holderName, document: acc.document,
      last4: input.last4, brand: input.brand, pmId: input.pmId,
    });
    return { ok: true, ...r };
  }

  async removeCreditCard(ctx: CustomerContext) {
    if (!ctx.creditAccountId) return { ok: true };
    const acc = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditAccount.findFirst({ where: { id: ctx.creditAccountId! }, select: { organizationId: true } }),
    );
    if (!acc) return { ok: true };
    return this.payments.removeSavedCard(acc.organizationId, ctx.creditAccountId);
  }

  /** Consulta o status da parcela no MP (autorefresh do Pix no portal). */
  async checkInstallmentStatus(ctx: CustomerContext, installmentId: string) {
    const inst = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditInstallment.findFirst({
        where: { id: installmentId },
        include: { creditAccount: { select: { id: true, primaryCustomerId: true, organizationId: true } } },
      }),
    );
    if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela não encontrada", 404);
    const acc = inst.creditAccount;
    const owns = (ctx.creditAccountId && acc.id === ctx.creditAccountId) || (ctx.customerId && acc.primaryCustomerId === ctx.customerId);
    if (!owns) throw new AppError(ErrorCode.Forbidden, "Parcela não pertence a este cliente", 403);
    if (inst.status !== "paid" && inst.mpPaymentId) {
      await this.payments.syncMpPayment(acc.organizationId, inst.mpPaymentId).catch(() => undefined);
    }
    const cur = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditInstallment.findFirst({ where: { id: installmentId }, select: { status: true } }),
    );
    return { status: cur?.status ?? inst.status };
  }

  async payInstallment(ctx: CustomerContext, installmentId: string, method: "pix" | "card" | "infinitepay") {
    // valida que a parcela pertence a uma conta deste cliente
    const inst = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditInstallment.findFirst({
        where: { id: installmentId },
        include: { creditAccount: { select: { id: true, primaryCustomerId: true, organizationId: true } } },
      }),
    );
    if (!inst) throw new AppError(ErrorCode.NotFound, "Parcela não encontrada", 404);
    const acc = inst.creditAccount;
    const ownsByAccount = ctx.creditAccountId && acc.id === ctx.creditAccountId;
    const ownsByCustomer = ctx.customerId && acc.primaryCustomerId === ctx.customerId;
    if (!ownsByAccount && !ownsByCustomer) {
      throw new AppError(ErrorCode.Forbidden, "Parcela não pertence a este cliente", 403);
    }
    if (inst.status === "paid") {
      throw new AppError(ErrorCode.ValidationFailed, "Parcela já está paga", 400);
    }

    // contexto de organização (admin) só pra reusar a lógica de pagamento
    const orgCtx: RequestContext = {
      orgId: acc.organizationId,
      isOrgAdmin: true,
    } as RequestContext;

    if (method === "pix") {
      const r = await this.payments.generatePix(orgCtx, installmentId);
      return {
        method: "pix" as const,
        amountCents: r.amountCents,
        qrCode: r.qrCode,
        qrCodeBase64: r.qrCodeBase64,
        ticketUrl: r.ticketUrl,
      };
    }
    if (method === "infinitepay") {
      const r = await this.payments.generateInfinitepayLink(orgCtx, installmentId);
      return { method: "infinitepay" as const, amountCents: r.amountCents, link: r.link };
    }
    const r = await this.payments.generateCardLink(orgCtx, installmentId);
    return { method: "card" as const, amountCents: r.amountCents, initPoint: r.initPoint };
  }

  /** Dashboard: conta + perfil + compras + parcelas. */
  async me(ctx: CustomerContext) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const account = ctx.creditAccountId
        ? await tx.creditAccount.findFirst({
            where: { id: ctx.creditAccountId },
            include: {
              purchases: {
                orderBy: { createdAt: "desc" },
                include: { installments: { orderBy: { number: "asc" } } },
              },
              applications: { orderBy: { createdAt: "desc" }, take: 5 },
            },
          })
        : null;
      const customer = ctx.customerId
        ? await tx.customer.findFirst({ where: { id: ctx.customerId } })
        : null;
      let storeBrand: { primaryColor: string | null; logoUrl: string | null } | null = null;
      if (customer?.storeId) {
        const store = await tx.store.findFirst({
          where: { id: customer.storeId },
          select: { themePrimaryColor: true, logoUrl: true },
        });
        if (store) storeBrand = { primaryColor: store.themePrimaryColor, logoUrl: store.logoUrl };
      }
      // recursos do portal habilitados pela empresa (null = padrão, mostra todos)
      const org = await tx.organization.findFirst({ where: { id: ctx.organizationId }, select: { portalConfig: true } });
      const portalConfig = (org?.portalConfig as string[] | null) ?? null;
      // rastreio dos pedidos de lente do cliente (status + nº do lote)
      let lensOrders: Array<Record<string, unknown>> = [];
      if (ctx.customerId) {
        const orders = await tx.lensOrder.findMany({
          where: { customerId: ctx.customerId },
          orderBy: { createdAt: "desc" },
          include: { batch: { select: { code: true } } },
          take: 50,
        });
        // pesquisas NPS ligadas a esses pedidos (pra mostrar "Avaliar" no portal)
        const orderIds = orders.map((o) => o.id);
        const surveys = orderIds.length
          ? await tx.satisfactionSurvey.findMany({
              where: { kind: "lens_order", refId: { in: orderIds } },
              select: { refId: true, token: true, respondedAt: true },
            })
          : [];
        const surveyByRef = new Map(surveys.map((s) => [s.refId, s]));
        lensOrders = orders.map((o) => {
          const sv = surveyByRef.get(o.id);
          return {
            id: o.id,
            status: o.status,
            batchCode: o.batch?.code ?? null,
            late: o.late,
            createdAt: o.createdAt,
            productDescription: o.productDescription,
            productPhotoUrl: o.productPhotoUrl,
            prescription: o.prescription,
            nfNumber: o.nfNumber,
            nfUrl: o.nfUrl,
            deliveredAt: o.deliveredAt,
            deliveryConfirmedAt: o.deliveryConfirmedAt,
            deliverySignatureUrl: o.deliverySignatureUrl,
            surveyToken: sv?.token ?? null,
            surveyAnswered: !!sv?.respondedAt,
          };
        });
      }
      // compras do cliente (qualquer meio de pagamento, não só crediário)
      let purchases: Array<Record<string, unknown>> = [];
      if (ctx.customerId) {
        const sales = await tx.sale.findMany({
          where: { customerId: ctx.customerId, status: { not: "canceled" } },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: { items: { select: { productName: true, qty: true, unitPriceCents: true } } },
        });
        purchases = sales.map((s) => ({
          id: s.id,
          totalCents: s.totalCents,
          paymentMethod: s.paymentMethod,
          status: s.status,
          createdAt: s.createdAt,
          items: s.items.map((i) => ({ name: i.productName, qty: i.qty, unitPriceCents: i.unitPriceCents })),
        }));
      }

      // agendamentos (exames) do cliente — futuros e recentes
      let appointments: Array<Record<string, unknown>> = [];
      if (ctx.customerId) {
        const appts = await tx.appointment.findMany({
          where: {
            customerId: ctx.customerId,
            deletedAt: null,
            startsAt: { gte: new Date(Date.now() - 7 * 86400_000) },
          },
          orderBy: { startsAt: "asc" },
          take: 20,
          include: {
            professional: { select: { name: true } },
            slot: { select: { capacity: true } },
          },
        });
        appointments = appts.map((a) => ({
          id: a.id,
          shortCode: a.shortCode,
          startsAt: a.startsAt,
          status: a.status,
          serviceName: a.serviceName,
          professionalName: a.professional?.name ?? null,
          byArrival: (a.slot?.capacity ?? 1) > 1,
        }));
      }

      return { account, customer, hasPassword: !!customer?.portalPasswordHash, storeBrand, portalConfig, lensOrders, purchases, appointments };
    });
  }

  async updateProfile(ctx: CustomerContext, input: ProfileInput) {
    if (!ctx.primaryCustomerId) {
      throw new AppError(ErrorCode.ValidationFailed, "Sem cadastro de contato vinculado", 400);
    }
    const data: Record<string, unknown> = {};
    for (const k of [
      "email", "phone", "whatsappPhone", "city", "state", "postalCode",
      "addressLine", "addressNumber", "addressComplement", "neighborhood", "avatarUrl",
    ] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customer.update({ where: { id: ctx.primaryCustomerId! }, data }),
    );
  }

  /**
   * Histórico de pedidos de limite (timeline + gate). Une as aplicações KYC
   * (cliente novo) e os pedidos de aumento (cliente que já tem conta).
   */
  async listApplications(ctx: CustomerContext) {
    const orApp: any[] = [];
    if (ctx.customerId) orApp.push({ customerId: ctx.customerId });
    if (ctx.creditAccountId) orApp.push({ creditAccountId: ctx.creditAccountId });
    if (orApp.length === 0) return { items: [], hasPending: false };

    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const [apps, reqs] = await Promise.all([
        tx.creditApplication.findMany({
          where: { OR: orApp },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, status: true, requestedLimitCents: true, approvedLimitCents: true, createdAt: true, reviewedAt: true },
        }),
        ctx.creditAccountId
          ? tx.creditLimitRequest.findMany({
              where: { creditAccountId: ctx.creditAccountId },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: { id: true, status: true, requestedLimitCents: true, createdAt: true, reviewedAt: true },
            })
          : Promise.resolve([] as any[]),
      ]);
      const items = [
        ...apps.map((a) => ({
          id: a.id, kind: "application", status: a.status,
          requestedLimitCents: a.requestedLimitCents, approvedLimitCents: a.approvedLimitCents,
          createdAt: a.createdAt, reviewedAt: a.reviewedAt,
        })),
        ...reqs.map((r) => ({
          id: r.id, kind: "limit_request", status: r.status,
          requestedLimitCents: r.requestedLimitCents, approvedLimitCents: null,
          createdAt: r.createdAt, reviewedAt: r.reviewedAt,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const hasPending = items.some((i) => i.status === "pending");
      return { items, hasPending };
    });
  }

  /** Cliente COM conta pede aumento de limite (sem refazer KYC). */
  async requestLimitIncrease(ctx: CustomerContext, requestedLimitCents: number, reason?: string | null) {
    if (!ctx.creditAccountId) {
      throw new AppError(ErrorCode.ValidationFailed, "Você ainda não tem conta de crediário", 400);
    }
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const pending = await tx.creditLimitRequest.findFirst({
        where: { creditAccountId: ctx.creditAccountId!, status: "pending" },
        select: { id: true },
      });
      if (pending) throw new AppError(ErrorCode.Conflict, "Você já tem um pedido em análise. Aguarde a resposta da loja.", 409);
      const acc = await tx.creditAccount.findFirst({ where: { id: ctx.creditAccountId! } });
      if (!acc) throw new AppError(ErrorCode.NotFound, "Conta não encontrada", 404);
      const req = await tx.creditLimitRequest.create({
        data: {
          organizationId: ctx.organizationId,
          creditAccountId: ctx.creditAccountId!,
          currentLimitCents: acc.limitCents,
          requestedLimitCents: BigInt(requestedLimitCents),
          reason: reason ?? null,
          status: "pending",
        },
      });
      await tx.creditAccountEvent.create({
        data: {
          organizationId: ctx.organizationId,
          creditAccountId: ctx.creditAccountId!,
          eventType: "limit_requested",
          payload: { request_id: req.id, requested: requestedLimitCents, via: "customer" } as any,
          actorType: "customer",
        },
      });
      return req;
    });
  }

  /** Cliente pede limite (KYC). Cria documents + application pendente. */
  async createApplication(ctx: CustomerContext, input: ApplicationInput) {
    // bloqueia novo pedido se já existe um em análise
    const pending = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.creditApplication.findFirst({
        where: {
          status: "pending",
          OR: [
            ...(ctx.customerId ? [{ customerId: ctx.customerId }] : []),
            ...(ctx.creditAccountId ? [{ creditAccountId: ctx.creditAccountId }] : []),
          ],
        },
        select: { id: true },
      }),
    );
    if (pending) {
      throw new AppError(ErrorCode.Conflict, "Você já tem um pedido em análise. Aguarde a resposta da loja.", 409);
    }
    return this.createApplicationInner(ctx, input);
  }

  private async createApplicationInner(ctx: CustomerContext, input: ApplicationInput) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      // cliente sem conta de crediario: cria uma conta pendente (limite 0) pra
      // anexar a solicitacao. O admin avalia e libera o limite.
      let creditAccountId = ctx.creditAccountId;
      if (!creditAccountId) {
        const acc = await tx.creditAccount.upsert({
          where: {
            organizationId_document: { organizationId: ctx.organizationId, document: ctx.document },
          },
          update: {},
          create: {
            organizationId: ctx.organizationId,
            document: ctx.document,
            holderName: ctx.holderName,
            primaryCustomerId: ctx.customerId,
            limitCents: BigInt(0),
            status: "pending",
          },
        });
        creditAccountId = acc.id;
      }

      // grava documentos
      const docIds: string[] = [];
      for (const d of input.documents) {
        const doc = await tx.customerDocument.create({
          data: {
            organizationId: ctx.organizationId,
            creditAccountId,
            customerId: ctx.customerId,
            docType: d.docType,
            fileUrl: d.fileUrl,
            status: "uploaded",
          },
        });
        docIds.push(doc.id);
      }
      // atualiza renda no customer
      if (ctx.customerId) {
        await tx.customer.update({
          where: { id: ctx.customerId },
          data: { incomeCents: BigInt(input.incomeCents) },
        });
      }
      const app = await tx.creditApplication.create({
        data: {
          organizationId: ctx.organizationId,
          creditAccountId,
          customerId: ctx.customerId,
          incomeCents: BigInt(input.incomeCents),
          requestedLimitCents: BigInt(input.requestedLimitCents),
          documentIds: docIds as any,
          status: "pending",
        },
      });
      await tx.creditAccountEvent.create({
        data: {
          organizationId: ctx.organizationId,
          creditAccountId,
          eventType: "limit_requested",
          payload: { application_id: app.id, requested: input.requestedLimitCents, via: "customer" } as any,
          actorType: "customer",
        },
      });
      return app;
    });
  }

  /**
   * Cliente confirma o recebimento do óculos por ACEITE eletrônico (1 clique).
   * Registra data/hora (+ IP opcional) como assinatura eletrônica.
   */
  async confirmLensDelivery(ctx: CustomerContext, orderId: string, ip?: string | null) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const order = await tx.lensOrder.findFirst({ where: { id: orderId } });
      if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
      if (order.customerId !== ctx.customerId) {
        throw new AppError(ErrorCode.Forbidden, "Pedido de outro cliente", 403);
      }
      if (order.status !== "entregue") {
        throw new AppError(ErrorCode.ValidationFailed, "O pedido ainda não foi entregue", 400);
      }
      if (order.deliveryConfirmedAt) {
        throw new AppError(ErrorCode.Conflict, "Recebimento já confirmado", 409);
      }
      return tx.lensOrder.update({
        where: { id: orderId },
        // guarda o aceite eletrônico (IP) no lugar da imagem de assinatura
        data: { deliverySignatureUrl: ip ? `aceite-eletronico:${ip}` : "aceite-eletronico", deliveryConfirmedAt: new Date() },
      });
    });
  }

  /** HTML do comprovante de entrega (branded) pro cliente baixar. */
  async deliveryReceiptHtml(ctx: CustomerContext, orderId: string): Promise<string> {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const order = await tx.lensOrder.findFirst({ where: { id: orderId } });
      if (!order || order.customerId !== ctx.customerId) {
        throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
      }
      const customer = order.customerId
        ? await tx.customer.findFirst({ where: { id: order.customerId }, select: { name: true, document: true } })
        : null;
      const store = order.storeId
        ? await tx.store.findFirst({ where: { id: order.storeId }, select: { name: true, themePrimaryColor: true, logoUrl: true } })
        : null;
      const brand = store?.themePrimaryColor ?? "#4f46e5";
      const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
      const fmt = (d: Date | null) => (d ? new Date(d).toLocaleString("pt-BR") : "—");
      const confirmed = !!order.deliveryConfirmedAt;
      return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Comprovante de entrega</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#111;margin:0;padding:32px;background:#fff}
  .box{max-width:640px;margin:0 auto;border:1px solid #e5e7eb;border-radius:16px;padding:28px}
  .head{display:flex;align-items:center;gap:14px;border-bottom:2px solid ${esc(brand)};padding-bottom:14px;margin-bottom:18px}
  .head img{height:42px}
  h1{font-size:18px;margin:0;color:${esc(brand)}}
  .row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid #f1f1f1}
  .label{color:#666}
  .ok{margin-top:18px;padding:12px;border-radius:10px;background:#ecfdf5;color:#065f46;font-size:13px}
  .ft{margin-top:18px;font-size:11px;color:#888}
  @media print{button{display:none}}
</style></head><body>
<div class="box">
  <div class="head">
    ${store?.logoUrl ? `<img src="${esc(store.logoUrl)}" alt=""/>` : ""}
    <h1>Comprovante de entrega${store?.name ? ` — ${esc(store.name)}` : ""}</h1>
  </div>
  <div class="row"><span class="label">Cliente</span><span>${esc(customer?.name)}</span></div>
  <div class="row"><span class="label">Documento</span><span>${esc(customer?.document)}</span></div>
  <div class="row"><span class="label">Produto</span><span>${esc(order.productDescription ?? "Óculos")}</span></div>
  ${order.nfNumber ? `<div class="row"><span class="label">Nota fiscal</span><span>${esc(order.nfNumber)}</span></div>` : ""}
  <div class="row"><span class="label">Entregue em</span><span>${fmt(order.deliveredAt)}</span></div>
  <div class="row"><span class="label">Recebimento confirmado</span><span>${fmt(order.deliveryConfirmedAt)}</span></div>
  ${confirmed ? `<div class="ok">✓ O cliente confirmou o recebimento do produto por aceite eletrônico (validade legal — Lei 14.063/2020).</div>` : ""}
  <p class="ft">Documento gerado eletronicamente em ${new Date().toLocaleString("pt-BR")}.</p>
  <button onclick="window.print()" style="margin-top:14px;padding:10px 18px;border:0;border-radius:8px;background:${esc(brand)};color:#fff;font-weight:600;cursor:pointer">Imprimir / Salvar PDF</button>
</div></body></html>`;
    });
  }

  async listDocuments(ctx: CustomerContext) {
    if (!ctx.creditAccountId) return [];
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerDocument.findMany({
        where: { creditAccountId: ctx.creditAccountId! },
        orderBy: { createdAt: "desc" },
      }),
    );
  }
}
