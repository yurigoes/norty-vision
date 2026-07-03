import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

export interface Totals {
  cash: number;
  pix: number;
  cardCredit: number;   // cartão de crédito
  cardDebit: number;    // cartão de débito
  card: number;         // cartão sem tipo informado
  credit: number;       // crediário
  other: number;
  total: number;
  salesCount: number;
}

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, storeId: ctx.storeId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private resolveStore(ctx: RequestContext, storeId?: string): string {
    const id = storeId ?? ctx.storeId ?? undefined;
    if (!id) throw new AppError(ErrorCode.ValidationFailed, "storeId obrigatório", 400);
    return id;
  }

  /** Totais por meio de pagamento das vendas da loja desde 'from'. */
  private async computeTotals(ctx: RequestContext, storeId: string, from: Date): Promise<Totals> {
    const sales = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.sale.findMany({
        where: { storeId, status: { not: "canceled" }, createdAt: { gte: from } },
        include: { payments: true },
      }),
    );
    const t: Totals = { cash: 0, pix: 0, cardCredit: 0, cardDebit: 0, card: 0, credit: 0, other: 0, total: 0, salesCount: sales.length };
    const addCard = (cents: number, cardType: string | null) => {
      if (cardType === "credit") t.cardCredit += cents;
      else if (cardType === "debit") t.cardDebit += cents;
      else t.card += cents;
    };
    for (const s of sales) {
      const paid = (s.payments ?? []).filter((p: any) => p.status === "paid");
      if (paid.length > 0) {
        for (const p of paid) {
          const cents = Number(p.amountCents);
          if (p.method === "cash") t.cash += cents;
          else if (p.method === "pix") t.pix += cents;
          else if (p.method === "credit") t.credit += cents;
          else if (p.method === "card") addCard(cents, p.cardType ?? null);
          else t.other += cents;
        }
      } else {
        const cents = Number(s.totalCents);
        switch (s.paymentMethod) {
          case "cash": t.cash += cents; break;
          case "pix": t.pix += cents; break;
          case "credit": t.credit += cents; break;
          case "card_installments": t.cardCredit += cents; break; // parcelado = crédito
          case "card_full": addCard(cents, null); break;          // à vista: tipo não informado
          default: t.other += cents;
        }
      }
    }
    t.total = t.cash + t.pix + t.cardCredit + t.cardDebit + t.card + t.credit + t.other;
    return t;
  }

  /** Totais dos EXAMES (caixa separado) da loja desde 'from'. */
  private async computeExamTotals(ctx: RequestContext, storeId: string, from: Date): Promise<Totals> {
    const exams = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.examPayment.findMany({
        where: { storeId, status: "paid", createdAt: { gte: from } },
        include: { lines: true },
      }),
    );
    const t: Totals = { cash: 0, pix: 0, cardCredit: 0, cardDebit: 0, card: 0, credit: 0, other: 0, total: 0, salesCount: exams.length };
    for (const ep of exams) {
      for (const l of ep.lines ?? []) {
        if ((l.status ?? "paid") !== "paid") continue;
        const cents = Number(l.amountCents);
        if (l.method === "cash") t.cash += cents;
        else if (l.method === "pix") t.pix += cents;
        else if (l.method === "card") {
          if (l.cardType === "credit") t.cardCredit += cents;
          else if (l.cardType === "debit") t.cardDebit += cents;
          else t.card += cents;
        } else t.other += cents;
      }
    }
    t.total = t.cash + t.pix + t.cardCredit + t.cardDebit + t.card + t.other;
    return t;
  }

  async openRegister(ctx: RequestContext, opts: { storeId?: string; openingFloatCents?: number }) {
    const storeId = this.resolveStore(ctx, opts.storeId);
    const existing = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.findFirst({ where: { storeId, status: "open" } }),
    );
    if (existing) throw new AppError(ErrorCode.Conflict, "Já existe um caixa aberto nesta loja", 409);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.create({
        data: {
          organizationId: ctx.orgId!,
          storeId,
          openedBy: ctx.userId ?? null,
          openingFloatCents: BigInt(Math.max(0, Math.round(opts.openingFloatCents ?? 0))),
        },
      }),
    );
  }

  /** Caixa aberto da loja + totais ao vivo. */
  async current(ctx: RequestContext, storeId?: string) {
    const id = this.resolveStore(ctx, storeId);
    const reg = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.findFirst({ where: { storeId: id, status: "open" } }),
    );
    if (!reg) return { register: null, totals: null, examTotals: null, expectedCashCents: 0 };
    const totals = await this.computeTotals(ctx, id, reg.openedAt);
    const examTotals = await this.computeExamTotals(ctx, id, reg.openedAt);
    // a gaveta física junta o dinheiro das vendas + exames
    const expectedCashCents = Number(reg.openingFloatCents) + totals.cash + examTotals.cash;
    return {
      register: { ...reg, openingFloatCents: Number(reg.openingFloatCents) },
      totals,        // vendas (óculos/lentes)
      examTotals,    // exames (caixa separado)
      expectedCashCents,
    };
  }

  async closeRegister(ctx: RequestContext, id: string, opts: { countedCents?: number; notes?: string | null }) {
    const reg = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.findFirst({ where: { id, status: "open" } }),
    );
    if (!reg) throw new AppError(ErrorCode.NotFound, "Caixa aberto não encontrado", 404);
    const totals = await this.computeTotals(ctx, reg.storeId, reg.openedAt);
    const examTotals = await this.computeExamTotals(ctx, reg.storeId, reg.openedAt);
    // gaveta física junta dinheiro de vendas + exames; relatórios ficam separados
    const expectedCash = Number(reg.openingFloatCents) + totals.cash + examTotals.cash;
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.update({
        where: { id },
        data: {
          status: "closed",
          closedBy: ctx.userId ?? null,
          closedAt: new Date(),
          closingCountedCents: opts.countedCents != null ? BigInt(Math.round(opts.countedCents)) : null,
          expectedCashCents: BigInt(expectedCash),
          // guarda os dois separados: vendas no topo (compat) + exames aninhado
          totals: { ...totals, exams: examTotals } as any,
          notes: opts.notes ?? null,
        },
      }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const reg = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.findFirst({ where: { id } }),
    );
    if (!reg) throw new AppError(ErrorCode.NotFound, "Caixa não encontrado", 404);
    const store = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.findFirst({ where: { id: reg.storeId }, select: { name: true } }),
    );
    return {
      ...reg,
      openingFloatCents: Number(reg.openingFloatCents),
      closingCountedCents: reg.closingCountedCents != null ? Number(reg.closingCountedCents) : null,
      expectedCashCents: reg.expectedCashCents != null ? Number(reg.expectedCashCents) : null,
      storeName: store?.name ?? null,
    };
  }

  async list(ctx: RequestContext, storeId?: string) {
    const id = this.resolveStore(ctx, storeId);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cashRegister.findMany({
        where: { storeId: id, status: "closed" },
        orderBy: { closedAt: "desc" },
        take: 60,
      }),
    );
  }
}
