import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { buildReceipt } from "../payouts/payouts.service";
import type { SupplierContext } from "./supplier-context";

/**
 * Dados do portal do fornecedor. PRIVACIDADE: o medico ve apenas dados
 * clinicos do paciente (medidas/status/data) — NUNCA telefone, endereco ou
 * email. Pagamentos: fechamentos do proprio fornecedor.
 */
@Injectable()
export class SupplierPortalService {
  constructor(private readonly prisma: PrismaService) {}

  async me(ctx: SupplierContext) {
    return {
      id: ctx.supplierId,
      name: ctx.name,
      type: ctx.type,
      mustReset: ctx.mustReset,
    };
  }

  /** Pacientes atendidos (pedidos que o medico receitou) — só dados clínicos. */
  async patients(ctx: SupplierContext) {
    const orders = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.lensOrder.findMany({
        where: { organizationId: ctx.organizationId, doctorSupplierId: ctx.supplierId },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    );
    const custIds = [...new Set(orders.map((o) => o.customerId).filter(Boolean))] as string[];
    const custs = custIds.length
      ? await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          // SO o nome — sem telefone/endereco/email (privacidade)
          tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } }))
      : [];
    const cm = new Map(custs.map((c) => [c.id, c.name]));

    const items = orders.map((o) => ({
      id: o.id,
      patientName: o.customerId ? cm.get(o.customerId) ?? "Paciente" : "Paciente",
      status: o.status,
      prescription: o.prescription, // medidas OD/OE
      createdAt: o.createdAt,
    }));
    return {
      patientsCount: custIds.length,
      ordersCount: orders.length,
      items,
    };
  }

  /** Pagamentos (fechamentos) do fornecedor, com itens. */
  async payments(ctx: SupplierContext) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplierSettlement.findMany({
        where: { organizationId: ctx.organizationId, supplierId: ctx.supplierId },
        orderBy: { createdAt: "desc" },
        include: { items: true },
        take: 200,
      }),
    );
  }

  // ============================== COSTUREIRA (produção) ==============================

  /**
   * Fila de OSs atribuídas à costureira: status produtivo (não pronto/cancelado)
   * e producedAt ainda null. Ordena por prazo (NULLS LAST), depois createdAt.
   * Devolve dados enxutos: id, shortCode, prazo, peças totais, descrição.
   */
  async productionQueue(ctx: SupplierContext) {
    const orders = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findMany({
        where: {
          organizationId: ctx.organizationId,
          assignedSupplierId: ctx.supplierId,
          producedAt: null,
          status: { notIn: ["pronto", "finalizado", "cancelado", "cancelamento_solicitado"] },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: 100,
        include: {
          items: { select: { qty: true, description: true } },
          roster: { select: { qty: true } },
        },
      }),
    );
    return orders.map((o) => {
      const piecesRoster = (o.roster ?? []).reduce((s, r) => s + (r.qty ?? 0), 0);
      const piecesItems = (o.items ?? []).reduce((s, it) => s + (it.qty ?? 0), 0);
      return {
        id: o.id,
        shortCode: o.shortCode,
        status: o.status,
        artStatus: o.artStatus,
        dueDate: o.dueDate,
        totalPieces: piecesRoster > 0 ? piecesRoster : piecesItems,
        description: (o.items ?? [])[0]?.description ?? null,
      };
    });
  }

  /**
   * Detalhe de uma OS atribuída à costureira. Inclui arte (última versão) e
   * roster. NÃO devolve dados sensíveis (telefone/endereço/fiscal do cliente).
   */
  async productionDetail(ctx: SupplierContext, orderId: string) {
    const o: any = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findFirst({
        where: { id: orderId, organizationId: ctx.organizationId, assignedSupplierId: ctx.supplierId },
        include: {
          items: { select: { id: true, description: true, qty: true } },
          roster: { select: { playerName: true, number: true, size: true, qty: true } },
          files: { where: { kind: "art" }, orderBy: { createdAt: "desc" }, take: 1, select: { url: true, name: true, createdAt: true } },
        },
      }),
    );
    if (!o) throw new AppError(ErrorCode.NotFound, "OS não encontrada (ou não atribuída a você)", 404);
    const piecesRoster = (o.roster ?? []).reduce((s: number, r: any) => s + (r.qty ?? 0), 0);
    const piecesItems = (o.items ?? []).reduce((s: number, it: any) => s + (it.qty ?? 0), 0);
    return {
      id: o.id,
      shortCode: o.shortCode,
      status: o.status,
      artStatus: o.artStatus,
      dueDate: o.dueDate,
      notes: o.notes,
      totalPieces: piecesRoster > 0 ? piecesRoster : piecesItems,
      items: o.items,
      // padroniza nome da chave pra o front (mantém o que já espera: jerseyNumber)
      roster: (o.roster ?? []).map((r: any) => ({ playerName: r.playerName, jerseyNumber: r.number, size: r.size, qty: r.qty })),
      artUrl: o.files?.[0]?.url ?? null,
      artFileName: o.files?.[0]?.name ?? null,
      producedAt: o.producedAt,
    };
  }

  /**
   * Pega uma OS LIVRE (sem assignedSupplier) pra si. Se já está atribuída a
   * essa costureira, é no-op. Se atribuída a outra, erro.
   */
  async productionPickup(ctx: SupplierContext, orderId: string) {
    const o = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findFirst({ where: { id: orderId, organizationId: ctx.organizationId }, select: { id: true, assignedSupplierId: true } }),
    );
    if (!o) throw new AppError(ErrorCode.NotFound, "OS não encontrada", 404);
    if (o.assignedSupplierId && o.assignedSupplierId !== ctx.supplierId) {
      throw new AppError(ErrorCode.Conflict, "Essa OS já está com outra costureira", 409);
    }
    if (!o.assignedSupplierId) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.productionOrder.update({ where: { id: orderId }, data: { assignedSupplierId: ctx.supplierId } }),
      );
    }
    return this.productionDetail(ctx, orderId);
  }

  /**
   * Marca "Pedido pronto": calcula valor (= pricePerPiece × peças), congela em
   * productionPriceCents, registra producedAt e avança status pra "pronto"
   * (que dispara a notificação ao cliente final via production.service).
   */
  async productionDone(ctx: SupplierContext, orderId: string) {
    const o = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findFirst({ where: { id: orderId, organizationId: ctx.organizationId, assignedSupplierId: ctx.supplierId } }),
    );
    if (!o) throw new AppError(ErrorCode.NotFound, "OS não encontrada (ou não atribuída a você)", 404);
    if (o.producedAt) {
      // já marcada — devolve o detalhe sem refazer
      return this.productionDetail(ctx, orderId);
    }
    const s = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.supplier.findFirst({ where: { id: ctx.supplierId }, select: { pricePerPieceCents: true } }),
    );
    const perPiece = Number(s?.pricePerPieceCents ?? 0n);
    // soma de peças: prefere roster (real); fallback items
    const fresh = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findUnique({ where: { id: orderId }, include: { roster: { select: { qty: true } }, items: { select: { qty: true } } } }),
    );
    const piecesRoster = (fresh?.roster ?? []).reduce((s, r) => s + (r.qty ?? 0), 0);
    const piecesItems = (fresh?.items ?? []).reduce((s, it) => s + (it.qty ?? 0), 0);
    const pieces = piecesRoster > 0 ? piecesRoster : piecesItems;
    const priceCents = perPiece > 0 && pieces > 0 ? perPiece * pieces : 0;

    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.update({
        where: { id: orderId },
        data: {
          producedAt: new Date(),
          productionPriceCents: BigInt(priceCents),
          status: o.status === "pronto" || o.status === "entrega" || o.status === "finalizado" ? o.status : "pronto",
        },
      }),
    );
    return this.productionDetail(ctx, orderId);
  }

  /**
   * Relatório da costureira: OSs produzidas no período + total de peças e
   * valor (já pago/pendente). Pendente = produzida mas sem settlement.
   */
  async productionReport(ctx: SupplierContext, opts: { from?: string; to?: string }) {
    const from = opts.from ? new Date(opts.from + "T00:00:00") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59") : new Date();
    const orders = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.productionOrder.findMany({
        where: {
          organizationId: ctx.organizationId,
          assignedSupplierId: ctx.supplierId,
          producedAt: { gte: from, lte: to },
        },
        orderBy: { producedAt: "desc" },
        take: 1000,
        include: {
          roster: { select: { qty: true } },
          items: { select: { qty: true } },
        },
      }),
    );
    // marca OSs incluídas em algum settlement como "pagas"
    const paidIds = orders.length
      ? new Set(
          (await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.settlementItem.findMany({
              where: {
                sourceType: "production_order",
                sourceId: { in: orders.map((o) => o.id) },
              },
              select: { sourceId: true },
            }),
          )).map((r) => r.sourceId),
        )
      : new Set<string>();
    const items = orders.map((o) => {
      const piecesRoster = (o.roster ?? []).reduce((s, r) => s + (r.qty ?? 0), 0);
      const piecesItems = (o.items ?? []).reduce((s, it) => s + (it.qty ?? 0), 0);
      const pieces = piecesRoster > 0 ? piecesRoster : piecesItems;
      const valueCents = Number(o.productionPriceCents ?? 0n);
      return {
        id: o.id,
        shortCode: o.shortCode,
        producedAt: o.producedAt,
        pieces,
        valueCents,
        paid: paidIds.has(o.id),
      };
    });
    const totals = items.reduce(
      (acc, it) => ({
        orders: acc.orders + 1,
        pieces: acc.pieces + it.pieces,
        valueCents: acc.valueCents + it.valueCents,
        paidCents: acc.paidCents + (it.paid ? it.valueCents : 0),
        pendingCents: acc.pendingCents + (it.paid ? 0 : it.valueCents),
      }),
      { orders: 0, pieces: 0, valueCents: 0, paidCents: 0, pendingCents: 0 },
    );
    return { from, to, items, totals };
  }

  /** Recibo branded de um fechamento do proprio fornecedor. */
  async receiptHtml(ctx: SupplierContext, settlementId: string): Promise<string> {
    const data = await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const s = await tx.supplierSettlement.findFirst({
        where: { id: settlementId, supplierId: ctx.supplierId, organizationId: ctx.organizationId },
        include: { items: true },
      });
      if (!s) throw new AppError(ErrorCode.NotFound, "Fechamento nao encontrado", 404);
      const org = await tx.organization.findFirst({
        where: { id: ctx.organizationId },
        select: { name: true, logoUrl: true, primaryColor: true },
      });
      return { s, org };
    });
    return buildReceipt({
      brandName: data.org?.name ?? "Empresa",
      logoUrl: data.org?.logoUrl ?? null,
      color: data.org?.primaryColor ?? "#7c3aed",
      supplierName: ctx.name,
      supplierDoc: ctx.document,
      settlement: data.s,
    });
  }
}
