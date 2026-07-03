import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import type { RequestContext } from "../auth/session.middleware";

interface CreateAccountInput {
  document: string;
  holderName: string;
  primaryCustomerId?: string | null;
  limitCents: number;
  guarantorName?: string | null;
  guarantorDocument?: string | null;
  guarantorPhone?: string | null;
}

@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/gerente", 403);
    }
  }

  // ============================== CONFIG ==============================
  async getConfig(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    const orgId = ctx.orgId!;
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      let cfg = await tx.orgCreditConfig.findUnique({ where: { organizationId: orgId } });
      if (!cfg) {
        cfg = await tx.orgCreditConfig.create({ data: { organizationId: orgId } });
      }
      return cfg;
    });
  }

  async updateConfig(ctx: RequestContext, patch: Record<string, unknown>) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.orgCreditConfig.upsert({
        where: { organizationId: orgId },
        update: patch,
        create: { organizationId: orgId, ...patch },
      }),
    );
  }

  // ============================== ACCOUNTS ==============================
  async listAccounts(ctx: RequestContext, opts?: { search?: string; status?: string }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAccount.findMany({
        where: {
          ...(opts?.status ? { status: opts.status } : {}),
          ...(opts?.search
            ? {
                OR: [
                  { holderName: { contains: opts.search, mode: "insensitive" } },
                  { document: { contains: opts.search } },
                ],
              }
            : {}),
        },
        orderBy: { holderName: "asc" },
        take: 500,
      }),
    );
  }

  async getAccount(ctx: RequestContext, id: string) {
    const acc = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAccount.findFirst({
        where: { id },
        include: {
          purchases: {
            orderBy: { createdAt: "desc" },
            include: {
              installments: { orderBy: { number: "asc" } },
            },
          },
          limitRequests: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      }),
    );
    if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);
    // pontos de atenção (atrasos, descontos concedidos, ajustes de vencimento)
    const attention = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditAccountEvent.findMany({
        where: { creditAccountId: id, eventType: "attention" },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    );
    return { ...acc, attention };
  }

  async createAccount(ctx: RequestContext, input: CreateAccountInput) {
    this.requireAdmin(ctx);
    const doc = input.document.replace(/\D/g, "");
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const exists = await tx.creditAccount.findFirst({
        where: { organizationId: ctx.orgId!, document: doc },
      });
      if (exists) {
        throw new AppError(ErrorCode.Conflict, "Ja existe conta pra esse documento", 409);
      }
      // identifica o cliente pelo documento (normalizado) pra vincular a conta
      // automaticamente — evita redigitar e mantém o portal/contratos amarrados
      let primaryCustomerId = input.primaryCustomerId ?? null;
      let holderName = input.holderName;
      if (!primaryCustomerId) {
        const match = await tx.$queryRaw<Array<{ id: string; name: string }>>`
          SELECT id, name FROM customers
           WHERE organization_id = ${ctx.orgId!}::uuid
             AND deleted_at IS NULL
             AND regexp_replace(coalesce(document,''), '[^0-9]', '', 'g') = ${doc}
           ORDER BY created_at ASC LIMIT 1
        `;
        if (match[0]) {
          primaryCustomerId = match[0].id;
          if (!holderName || holderName.trim().length < 2) holderName = match[0].name;
        }
      }
      const acc = await tx.creditAccount.create({
        data: {
          organizationId: ctx.orgId!,
          document: doc,
          holderName,
          primaryCustomerId,
          limitCents: BigInt(input.limitCents),
          guarantorName: input.guarantorName ?? null,
          guarantorDocument: input.guarantorDocument ?? null,
          guarantorPhone: input.guarantorPhone ?? null,
          createdByUserId: ctx.userId ?? null,
        },
      });
      await this.event(tx, acc.id, acc.organizationId, "account_created", ctx, {
        limit_cents: input.limitCents,
      });
      await this.event(tx, acc.id, acc.organizationId, "limit_set", ctx, {
        limit_cents: input.limitCents,
      });
      return acc;
    });
  }

  /** Define o limite diretamente (admin/master). */
  async setLimit(ctx: RequestContext, id: string, newLimitCents: number) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const acc = await tx.creditAccount.findFirst({ where: { id } });
      if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);
      const old = Number(acc.limitCents);
      const updated = await tx.creditAccount.update({
        where: { id },
        data: { limitCents: BigInt(newLimitCents) },
      });
      await this.event(
        tx,
        id,
        acc.organizationId,
        newLimitCents > old ? "limit_increased" : "limit_decreased",
        ctx,
        { from: old, to: newLimitCents },
      );
      return updated;
    });
  }

  async block(ctx: RequestContext, id: string, reason: string) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const acc = await tx.creditAccount.findFirst({ where: { id } });
      if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);
      const updated = await tx.creditAccount.update({
        where: { id },
        data: {
          status: "blocked",
          blockedReason: reason,
          blockedAt: new Date(),
          blockedByUserId: ctx.userId ?? null,
        },
      });
      await this.event(tx, id, acc.organizationId, "blocked", ctx, { reason });
      return updated;
    });
  }

  async unblock(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const acc = await tx.creditAccount.findFirst({ where: { id } });
      if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);
      const updated = await tx.creditAccount.update({
        where: { id },
        data: { status: "active", blockedReason: null, blockedAt: null, blockedByUserId: null },
      });
      await this.event(tx, id, acc.organizationId, "unblocked", ctx, {});
      return updated;
    });
  }

  async freeze(ctx: RequestContext, id: string, until: string) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const acc = await tx.creditAccount.findFirst({ where: { id } });
      if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);
      const updated = await tx.creditAccount.update({
        where: { id },
        data: { status: "frozen", frozenUntil: new Date(until) },
      });
      await this.event(tx, id, acc.organizationId, "frozen", ctx, { until });
      return updated;
    });
  }

  // ============================== LIMIT REQUESTS ==============================
  /** Operador pede aumento — fica pendente. */
  async requestLimit(
    ctx: RequestContext,
    accountId: string,
    requestedLimitCents: number,
    reason?: string,
  ) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const acc = await tx.creditAccount.findFirst({ where: { id: accountId } });
      if (!acc) throw new AppError(ErrorCode.NotFound, "Conta nao encontrada", 404);
      const req = await tx.creditLimitRequest.create({
        data: {
          organizationId: acc.organizationId,
          creditAccountId: accountId,
          requestedByUserId: ctx.userId ?? null,
          currentLimitCents: acc.limitCents,
          requestedLimitCents: BigInt(requestedLimitCents),
          reason: reason ?? null,
          status: "pending",
        },
      });
      await this.event(tx, accountId, acc.organizationId, "limit_requested", ctx, {
        requested: requestedLimitCents,
      });
      return req;
    });
  }

  async listLimitRequests(ctx: RequestContext, status = "pending") {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditLimitRequest.findMany({
        where: { status },
        orderBy: { createdAt: "asc" },
        include: { creditAccount: { select: { id: true, holderName: true, document: true, limitCents: true } } },
      }),
    );
  }

  async reviewLimitRequest(
    ctx: RequestContext,
    requestId: string,
    decision: "approved" | "rejected",
    opts?: { via?: "panel" | "token"; authorizerName?: string; note?: string },
  ) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const req = await tx.creditLimitRequest.findFirst({ where: { id: requestId } });
      if (!req) throw new AppError(ErrorCode.NotFound, "Pedido nao encontrado", 404);
      if (req.status !== "pending") {
        throw new AppError(ErrorCode.Conflict, "Pedido ja revisado", 409);
      }
      const updated = await tx.creditLimitRequest.update({
        where: { id: requestId },
        data: {
          status: decision,
          authorizedVia: opts?.via ?? "panel",
          authorizerUserId: ctx.userId ?? null,
          authorizerName: opts?.authorizerName ?? null,
          reviewedAt: new Date(),
          reviewNote: opts?.note ?? null,
        },
      });
      if (decision === "approved") {
        await tx.creditAccount.update({
          where: { id: req.creditAccountId },
          data: { limitCents: req.requestedLimitCents },
        });
        await this.event(tx, req.creditAccountId, req.organizationId, "limit_approved", ctx, {
          to: Number(req.requestedLimitCents),
          via: opts?.via ?? "panel",
        });
      } else {
        await this.event(tx, req.creditAccountId, req.organizationId, "limit_rejected", ctx, {});
      }
      return updated;
    });
  }

  // ============================== APPLICATIONS (KYC do cliente) ==============================
  async listApplications(ctx: RequestContext, status = "pending") {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.creditApplication.findMany({
        where: { status },
        orderBy: { createdAt: "asc" },
        include: {
          creditAccount: { select: { id: true, holderName: true, document: true, limitCents: true } },
        },
      }),
    );
  }

  async getApplicationDocs(ctx: RequestContext, applicationId: string) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const app = await tx.creditApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new AppError(ErrorCode.NotFound, "Aplicacao nao encontrada", 404);
      const ids = (app.documentIds as string[]) ?? [];
      const docs = ids.length
        ? await tx.customerDocument.findMany({ where: { id: { in: ids } } })
        : [];
      // docs privados (priv:<key>) -> URL servida pelo endpoint autenticado
      const documents = docs.map((d) => ({
        ...d,
        viewUrl: (d.fileUrl ?? "").startsWith("priv:")
          ? `/api/credit/documents/${d.id}/file`
          : d.fileUrl,
      }));
      return { application: app, documents };
    });
  }

  /** Serve um documento KYC privado (admin da org). */
  async getDocumentFile(ctx: RequestContext, docId: string): Promise<{ body: Buffer; contentType: string }> {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const doc = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.customerDocument.findFirst({ where: { id: docId }, select: { fileUrl: true } }),
    );
    if (!doc) throw new AppError(ErrorCode.NotFound, "Documento não encontrado", 404);
    const url = doc.fileUrl ?? "";
    if (!url.startsWith("priv:")) {
      throw new AppError(ErrorCode.ValidationFailed, "Documento não é privado", 400);
    }
    return this.storage.getPrivate(url.slice("priv:".length));
  }

  async reviewApplication(
    ctx: RequestContext,
    applicationId: string,
    decision: "approved" | "rejected" | "more_info",
    opts?: { approvedLimitCents?: number; note?: string },
  ) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const app = await tx.creditApplication.findFirst({ where: { id: applicationId } });
      if (!app) throw new AppError(ErrorCode.NotFound, "Aplicacao nao encontrada", 404);
      if (app.status !== "pending" && app.status !== "more_info") {
        throw new AppError(ErrorCode.Conflict, "Aplicacao ja revisada", 409);
      }

      const updated = await tx.creditApplication.update({
        where: { id: applicationId },
        data: {
          status: decision,
          approvedLimitCents:
            decision === "approved"
              ? BigInt(opts?.approvedLimitCents ?? Number(app.requestedLimitCents))
              : null,
          reviewedByUserId: ctx.userId ?? null,
          reviewedAt: new Date(),
          reviewNote: opts?.note ?? null,
        },
      });

      if (decision === "approved") {
        const newLimit = opts?.approvedLimitCents ?? Number(app.requestedLimitCents);
        await tx.creditAccount.update({
          where: { id: app.creditAccountId },
          data: { limitCents: BigInt(newLimit) },
        });
        await this.event(tx, app.creditAccountId, app.organizationId, "limit_approved", ctx, {
          to: newLimit, via: "application",
        });
      } else {
        await this.event(tx, app.creditAccountId, app.organizationId, "limit_rejected", ctx, {
          application_id: applicationId,
        });
      }
      return updated;
    });
  }

  // ============================== CREDIT PURCHASE ==============================
  /**
   * Cria uma compra no crediario + gera parcelas. Valida limite/status.
   * Chamado pelo SalesService dentro da mesma transacao quando method=credit.
   */
  async createPurchaseInTx(
    tx: PrismaClient,
    ctx: RequestContext,
    input: {
      creditAccountId: string;
      storeId: string;
      saleId?: string;
      totalCents: number;
      downPaymentCents: number;
      installmentsCount: number;
      firstDueDate?: string; // ISO date; default +30d
    },
  ) {
    const acc = await tx.creditAccount.findFirst({ where: { id: input.creditAccountId } });
    if (!acc) throw new AppError(ErrorCode.NotFound, "Conta de crediario nao existe", 404);

    if (acc.status === "blocked") {
      throw new AppError(ErrorCode.Forbidden, "Cliente bloqueado no crediario", 403, {
        reason: acc.blockedReason,
      });
    }
    if (acc.status === "frozen") {
      throw new AppError(ErrorCode.Forbidden, "Crediario do cliente esta congelado", 403);
    }
    if (acc.status === "defaulted") {
      throw new AppError(ErrorCode.Forbidden, "Cliente inadimplente — venda bloqueada", 403);
    }

    // exige contrato de crediario assinado, se a org configurar
    const cfg = await tx.orgCreditConfig.findUnique({
      where: { organizationId: acc.organizationId },
    });
    if (cfg?.requireSignedContract) {
      const signed = await tx.contract.findFirst({
        where: { creditAccountId: acc.id, status: "signed" },
        include: { template: true },
      });
      if (!signed || signed.template.kind !== "credit") {
        throw new AppError(
          ErrorCode.Forbidden,
          "Cliente precisa assinar o contrato de crediario antes de comprar",
          403,
          { needsContract: true },
        );
      }
    }

    const financed = input.totalCents - input.downPaymentCents;
    if (financed <= 0) {
      throw new AppError(ErrorCode.ValidationFailed, "Valor financiado deve ser > 0", 400);
    }

    const available = Number(acc.limitCents) - Number(acc.usedCents);
    if (financed > available) {
      throw new AppError(ErrorCode.Forbidden, "Limite de crediario insuficiente", 403, {
        available,
        needed: financed,
      });
    }

    const purchase = await tx.creditPurchase.create({
      data: {
        organizationId: acc.organizationId,
        storeId: input.storeId,
        creditAccountId: acc.id,
        saleId: input.saleId ?? null,
        totalCents: BigInt(input.totalCents),
        downPaymentCents: BigInt(input.downPaymentCents),
        financedCents: BigInt(financed),
        installmentsCount: input.installmentsCount,
        status: "active",
        createdByUserId: ctx.userId ?? null,
      },
    });

    // gera parcelas — distribui o financiado, sobra na ultima
    const base = Math.floor(financed / input.installmentsCount);
    const remainder = financed - base * input.installmentsCount;
    const firstDue = input.firstDueDate
      ? new Date(input.firstDueDate)
      : new Date(Date.now() + 30 * 86400_000);

    for (let i = 1; i <= input.installmentsCount; i++) {
      const amount = i === input.installmentsCount ? base + remainder : base;
      const due = new Date(firstDue);
      due.setMonth(due.getMonth() + (i - 1));
      await tx.creditInstallment.create({
        data: {
          organizationId: acc.organizationId,
          creditPurchaseId: purchase.id,
          creditAccountId: acc.id,
          number: i,
          dueDate: due,
          amountCents: BigInt(amount),
          status: "pending",
        },
      });
    }

    // atualiza used_cents
    await tx.creditAccount.update({
      where: { id: acc.id },
      data: { usedCents: { increment: BigInt(financed) } },
    });

    await this.event(tx, acc.id, acc.organizationId, "purchase_created", ctx, {
      purchase_id: purchase.id,
      financed,
      installments: input.installmentsCount,
    });

    return purchase;
  }

  // ============================== HELPERS ==============================
  private async event(
    tx: PrismaClient,
    accountId: string,
    orgId: string,
    type: string,
    ctx: RequestContext,
    payload: Record<string, unknown>,
  ) {
    await tx.creditAccountEvent.create({
      data: {
        organizationId: orgId,
        creditAccountId: accountId,
        eventType: type,
        payload: payload as any,
        actorType: ctx.isPlatformAdmin ? "platform" : "staff",
        actorUserId: ctx.userId ?? null,
      },
    });
  }
}
