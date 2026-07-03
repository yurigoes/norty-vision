import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CreditService } from "../credit/credit.service";
import { OrgIntegrationsService } from "../org-integrations/org-integrations.service";
import { MercadoPagoOrgAdapter } from "../payments/mercadopago-org.adapter";
import { PaymentsService } from "../payments/payments.service";
import { applyStoreStockDelta } from "../products/products.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

interface SaleItemInput {
  productId?: string | null;
  productName: string;
  qty: number;
  unitPriceCents: number;
  priceType: "cash" | "card_full" | "card_installments" | "credit";
}

interface CreateSaleInput {
  storeId: string;
  sellerUserId?: string | null;
  customerId?: string | null;
  // identificacao inline do cliente no PDV (find-or-create por CPF)
  customerInline?: {
    name: string;
    document?: string | null;
    birthDate?: string | null; // ddmmaaaa OU yyyy-mm-dd
  } | null;
  paymentMethod: "cash" | "pix" | "card_full" | "card_installments" | "credit";
  // split: vários meios numa venda. provider 'mp' = Pix via Mercado Pago.
  payments?: Array<{ method: "cash" | "pix" | "card"; amountCents: number; provider?: "mp" | "infinitepay" | null; cardType?: "credit" | "debit" | null }>;
  items: SaleItemInput[];
  discountPctApplied?: number;
  discountAuthorizedByUserId?: string | null;
  notes?: string | null;
  // crediario:
  creditAccountId?: string | null;
  downPaymentCents?: number;
  installmentsCount?: number;
  creditAmountCents?: number;   // crediário como parte do split (valor financiado)
  firstDueDate?: string;
}

/** ddmmaaaa -> yyyy-mm-dd (ou passa adiante se ja for ISO). */
function parseBirthDate(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 8 && !raw.includes("-")) {
    return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  }
  return raw; // ja ISO
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credit: CreditService,
    private readonly orgIntegrations: OrgIntegrationsService,
    private readonly payments: PaymentsService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  async list(ctx: RequestContext, opts?: { storeId?: string; startDate?: string; endDate?: string }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const from = opts?.startDate ? new Date(opts.startDate + "T00:00:00Z") : undefined;
    const to = opts?.endDate ? new Date(opts.endDate + "T23:59:59Z") : undefined;
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.sale.findMany({
        where: {
          ...(opts?.storeId ? { storeId: opts.storeId } : {}),
          ...(from && to ? { createdAt: { gte: from, lte: to } } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: { items: true },
        take: 500,
      }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.sale.findFirst({ where: { id }, include: { items: true } }),
    );
    if (!s) throw new AppError(ErrorCode.NotFound, "Venda nao encontrada", 404);
    return s;
  }

  /**
   * Cancela/estorna uma venda e DEVOLVE os itens ao estoque (movimento "return"),
   * só pros produtos com controle de estoque. Não reverte automaticamente
   * crediário/pagamentos — isso é tratado à parte.
   */
  async cancelSale(ctx: RequestContext, id: string, reason?: string | null) {
    if (!ctxCan(ctx, "sales.cancel")) throw new AppError(ErrorCode.Forbidden, "Sem permissão para cancelar venda", 403);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const sale = await tx.sale.findFirst({ where: { id }, include: { items: true } });
      if (!sale) throw new AppError(ErrorCode.NotFound, "Venda não encontrada", 404);
      if (sale.status === "canceled") throw new AppError(ErrorCode.Conflict, "Venda já cancelada", 409);
      let restocked = 0;
      for (const it of sale.items) {
        if (!it.productId) continue;
        const prod = await tx.product.findFirst({ where: { id: it.productId, deletedAt: null }, select: { trackStock: true, storeId: true } });
        if (prod?.trackStock) {
          const st = sale.storeId ?? prod.storeId ?? null;
          const after = await applyStoreStockDelta(tx, sale.organizationId, it.productId, st, it.qty ?? 0);
          await tx.stockMovement.create({
            data: {
              organizationId: sale.organizationId, storeId: st, productId: it.productId,
              kind: "return", qty: it.qty ?? 0, qtyAfter: after,
              reason: reason ?? "Venda cancelada/devolvida", referenceType: "sale", referenceId: sale.id, createdByUserId: ctx.userId ?? null,
            },
          });
          restocked++;
        }
      }
      await tx.sale.update({ where: { id }, data: { status: "canceled", notes: [sale.notes, reason ? `Cancelada: ${reason}` : "Cancelada"].filter(Boolean).join(" · ") } });
      return { ok: true, restocked };
    });
  }

  async create(ctx: RequestContext, input: CreateSaleInput) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (input.items.length === 0) {
      throw new AppError(ErrorCode.ValidationFailed, "Venda sem itens", 400);
    }

    // valida desconto do operador vs config (regra 3)
    if (input.discountPctApplied && input.discountPctApplied > 0) {
      const cfg = await this.credit.getConfig(ctx);
      const maxOperator = cfg.maxOperatorDiscountPct;
      if (
        input.discountPctApplied > maxOperator &&
        !input.discountAuthorizedByUserId
      ) {
        throw new AppError(
          ErrorCode.Forbidden,
          `Desconto acima de ${maxOperator}% precisa de autorizacao gerencial`,
          403,
        );
      }
    }

    const total = input.items.reduce(
      (sum, it) => sum + it.unitPriceCents * it.qty,
      0,
    );
    const discount = input.discountPctApplied
      ? Math.round(total * (input.discountPctApplied / 100))
      : 0;
    const totalAfterDiscount = total - discount;

    // a venda acontece numa LOJA: seta o store_id no contexto RLS pra o INSERT de
    // cliente (customers exige store_id = current_store_id() no WITH CHECK) e demais
    // inserts da venda passarem. Sem isso o cadastro de cliente no PDV viola a RLS.
    const saleRls = ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin, storeId: input.storeId };
    const result = await this.prisma.runWithContext(saleRls, async (tx) => {
      // resolve cliente: id explicito, ou inline (find-or-create por CPF)
      let customerId = input.customerId ?? null;
      if (!customerId && input.customerInline?.name) {
        const doc = (input.customerInline.document ?? "").replace(/\D/g, "") || null;
        if (doc) {
          const existing = await tx.customer.findFirst({
            where: { storeId: input.storeId, document: doc, deletedAt: null },
          });
          if (existing) customerId = existing.id;
        }
        if (!customerId) {
          const created = await tx.customer.create({
            data: {
              organizationId: ctx.orgId!,
              storeId: input.storeId,
              name: input.customerInline.name,
              document: doc,
              birthDate: input.customerInline.birthDate
                ? new Date(parseBirthDate(input.customerInline.birthDate)!)
                : null,
              source: "pdv",
              createdBy: ctx.userId ?? null,
            },
          });
          customerId = created.id;
        }
      }

      // venda com pagamento pendente (Pix MP / InfinitePay) nasce "pending" e só vira
      // "completed" quando o pagamento confirmar (não conta como venda feita antes).
      const hasPending = (input.payments ?? []).some((p) => p.method === "pix" && (p.provider === "mp" || p.provider === "infinitepay"));
      const sale = await tx.sale.create({
        data: {
          organizationId: ctx.orgId!,
          storeId: input.storeId,
          operatorUserId: ctx.userId ?? null,
          sellerUserId: input.sellerUserId ?? ctx.userId ?? null,
          customerId: customerId,
          totalCents: BigInt(totalAfterDiscount),
          paymentMethod: input.paymentMethod,
          discountPctApplied: input.discountPctApplied ?? 0,
          discountAuthorizedByUserId: input.discountAuthorizedByUserId ?? null,
          discountAuthorizedVia: input.discountAuthorizedByUserId ? "token" : "operator",
          notes: input.notes ?? null,
          status: hasPending ? "pending" : "completed",
        },
      });

      for (const it of input.items) {
        await tx.saleItem.create({
          data: {
            organizationId: ctx.orgId!,
            saleId: sale.id,
            productId: it.productId ?? null,
            productName: it.productName,
            qty: it.qty,
            unitPriceCents: BigInt(it.unitPriceCents),
            priceType: it.priceType,
            lineTotalCents: BigInt(it.unitPriceCents * it.qty),
          },
        });
        // baixa de estoque (só produtos com controle de estoque ligado) — da LOJA da venda
        if (it.productId) {
          const prod = await tx.product.findFirst({ where: { id: it.productId, deletedAt: null }, select: { trackStock: true, storeId: true } });
          if (prod?.trackStock) {
            const st = sale.storeId ?? prod.storeId ?? null;
            const after = await applyStoreStockDelta(tx, ctx.orgId!, it.productId, st, -(it.qty ?? 0));
            await tx.stockMovement.create({
              data: {
                organizationId: ctx.orgId!, storeId: st, productId: it.productId,
                kind: "sale", qty: -(it.qty ?? 0), qtyAfter: after,
                referenceType: "sale", referenceId: sale.id, createdByUserId: ctx.userId ?? null,
              },
            });
          }
        }
      }

      // Crediário pode ser a venda toda OU só uma PARTE do split.
      //  - creditAmountCents informado → financia só essa fatia (o resto vai em payments[]);
      //  - senão, paymentMethod="credit" (legado) → financia o total menos a entrada.
      const creditFinanced =
        input.creditAmountCents != null
          ? input.creditAmountCents
          : input.paymentMethod === "credit"
            ? totalAfterDiscount
            : 0;
      if (creditFinanced > 0) {
        if (!input.creditAccountId || !input.installmentsCount) {
          throw new AppError(
            ErrorCode.ValidationFailed,
            "Crediario exige creditAccountId e installmentsCount",
            400,
          );
        }
        const purchase = await this.credit.createPurchaseInTx(tx as any, ctx, {
          creditAccountId: input.creditAccountId,
          storeId: input.storeId,
          saleId: sale.id,
          totalCents: creditFinanced,
          // quando vem como parte do split, a "entrada" são os payments[] → downPayment 0
          downPaymentCents: input.creditAmountCents != null ? 0 : (input.downPaymentCents ?? 0),
          installmentsCount: input.installmentsCount,
          firstDueDate: input.firstDueDate,
        });
        await tx.sale.update({
          where: { id: sale.id },
          data: { creditPurchaseId: purchase.id },
        });
      }

      // pagamentos imediatos (split) — agora rodam SEMPRE, inclusive junto do
      // crediário (a fatia não-financiada / entrada é paga aqui por dinheiro,
      // cartão crédito/débito, pix maquininha (provider null) ou pix MP (provider 'mp')).
      const payments: any[] = [];
      if (input.payments && input.payments.length > 0) {
        const domain = process.env.DOMAIN ?? "yugochat.com.br";
        let mpAdapter: MercadoPagoOrgAdapter | null = null;
        for (const p of input.payments) {
          const isPixMp = p.method === "pix" && p.provider === "mp";
          const isInfinitepay = p.method === "pix" && p.provider === "infinitepay";
          const sp = await tx.salePayment.create({
            data: {
              organizationId: ctx.orgId!,
              storeId: input.storeId,
              saleId: sale.id,
              method: p.method,
              provider: p.provider ?? null,
              cardType: p.method === "card" ? (p.cardType ?? null) : null,
              amountCents: BigInt(p.amountCents),
              // Pix MP e InfinitePay (link) ficam pendentes até a confirmação.
              status: isPixMp || isInfinitepay ? "pending" : "paid",
            },
          });
          if (isPixMp) {
            try {
              if (!mpAdapter) {
                const mp = await this.orgIntegrations.resolveMp(ctx.orgId!);
                if (mp) mpAdapter = new MercadoPagoOrgAdapter(mp.accessToken);
              }
              if (mpAdapter) {
                const r = await mpAdapter.createPixPayment({
                  amountCents: p.amountCents,
                  description: `Venda ${sale.shortCode ?? sale.id}`,
                  externalReference: sp.id,
                  payerEmail: "sememail@yugochat.com.br",
                  payerName: "Cliente",
                  payerDocument: "",
                  notificationUrl: `https://${domain}/api/payments/webhooks/mercadopago/${ctx.orgId}`,
                });
                if (r.ok) {
                  const qr = r.body?.point_of_interaction?.transaction_data;
                  await tx.salePayment.update({
                    where: { id: sp.id },
                    data: {
                      mpPaymentId: r.body?.id ? String(r.body.id) : null,
                      mpQrCode: qr?.qr_code ?? null,
                      mpQrBase64: qr?.qr_code_base64 ?? null,
                    },
                  });
                  (sp as any).mpQrCode = qr?.qr_code ?? null;
                  (sp as any).mpQrBase64 = qr?.qr_code_base64 ?? null;
                }
              }
            } catch { /* best-effort: pagamento fica pending sem QR */ }
          }
          payments.push(sp);
        }
      }

      return { ...sale, payments };
    });

    // Links InfinitePay são gerados FORA da transação (chamada HTTP externa) e o
    // link é anexado ao pagamento retornado + enviado ao cliente (WhatsApp/e-mail).
    const ipPays = ((result as any).payments ?? []).filter(
      (p: any) => p.provider === "infinitepay" && p.status === "pending",
    );
    for (const sp of ipPays) {
      try {
        const lk = await this.payments.generateInfinitepayLinkForSale(ctx, sp.id);
        sp.link = lk.link;
      } catch (e: any) {
        sp.linkError = e?.message ?? "falha ao gerar link InfinitePay";
      }
    }
    return result;
  }

  /** Anexa URL da nota fiscal (operador). */
  async attachNotaFiscal(ctx: RequestContext, id: string, url: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.sale.update({ where: { id }, data: { notaFiscalUrl: url } }),
    );
  }

  /**
   * Dashboard de vendas por vendedor no periodo. Atribui ao seller_user_id
   * (ou, na falta, ao operador). Comissao = total * commission_pct do
   * membership do vendedor na org.
   */
  async sellersDashboard(ctx: RequestContext, opts?: { start?: string; end?: string }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    if (!ctxCan(ctx, "reports.commission")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para ver comissões dos vendedores", 403);
    }
    const from = opts?.start ? new Date(opts.start + "T00:00:00Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts?.end ? new Date(opts.end + "T23:59:59Z") : new Date();

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const sales = await tx.sale.findMany({
        where: { status: "completed", createdAt: { gte: from, lte: to } },
        select: { totalCents: true, sellerUserId: true, operatorUserId: true },
        take: 20000,
      });

      // agrega por vendedor (seller ?? operator)
      const agg = new Map<string, { count: number; total: number }>();
      for (const s of sales) {
        const uid = s.sellerUserId ?? s.operatorUserId;
        if (!uid) continue;
        const cur = agg.get(uid) ?? { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(s.totalCents);
        agg.set(uid, cur);
      }

      const userIds = [...agg.keys()];
      if (userIds.length === 0) {
        return { from, to, rows: [], totals: { count: 0, totalCents: 0, commissionCents: 0 } };
      }
      const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
      const um = new Map(users.map((u) => [u.id, u.name]));
      const memberships = await tx.membership.findMany({
        where: { userId: { in: userIds }, organizationId: ctx.orgId ?? undefined },
        select: { userId: true, commissionPct: true },
      });
      const pm = new Map(memberships.map((m) => [m.userId, m.commissionPct != null ? Number(String(m.commissionPct)) : 0]));

      let tCount = 0, tTotal = 0, tComm = 0;
      const rows = userIds.map((uid) => {
        const a = agg.get(uid)!;
        const pct = pm.get(uid) ?? 0;
        const commission = Math.round(a.total * (pct / 100));
        tCount += a.count; tTotal += a.total; tComm += commission;
        return {
          userId: uid,
          name: um.get(uid) ?? "—",
          salesCount: a.count,
          totalCents: a.total,
          commissionPct: pct,
          commissionCents: commission,
        };
      }).sort((x, y) => y.totalCents - x.totalCents);

      return { from, to, rows, totals: { count: tCount, totalCents: tTotal, commissionCents: tComm } };
    });
  }
}
