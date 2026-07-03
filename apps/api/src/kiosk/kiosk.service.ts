import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

const ADM = { isPlatformAdmin: true as const };

/**
 * Painéis de visualização (kiosk de TV) — abertos por um TOKEN público por empresa,
 * sem login interativo. v1: painel de RECEPÇÃO da gráfica (read-only, auto-refresh).
 */
@Injectable()
export class KioskService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? ADM : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }

  /** Gera (ou rotaciona) o token do kiosk da empresa. */
  async generateToken(ctx: RequestContext): Promise<{ token: string }> {
    this.requireAdmin(ctx);
    const token = randomBytes(20).toString("hex");
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.update({ where: { id: ctx.orgId! }, data: { kioskToken: token } }));
    return { token };
  }
  async getToken(ctx: RequestContext): Promise<{ token: string | null }> {
    this.requireAdmin(ctx);
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: { id: ctx.orgId! }, select: { kioskToken: true } }));
    return { token: org?.kioskToken ?? null };
  }

  /** Dados do painel de recepção (gráfica) — público, validado pelo token. */
  async recepcao(token: string): Promise<any> {
    const t = (token ?? "").trim();
    if (t.length < 10) throw new AppError(ErrorCode.NotFound, "Token inválido", 404);
    const org = await this.prisma.runWithContext(ADM, (tx) => tx.organization.findFirst({ where: { kioskToken: t }, select: { id: true, name: true, logoUrl: true, primaryColor: true, niche: true } }));
    if (!org) throw new AppError(ErrorCode.NotFound, "Painel não encontrado", 404);

    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const dia = brt.toISOString().slice(0, 10);
    const fimHoje = new Date(dia + "T23:59:59.999Z").getTime() + 3 * 3600_000; // fim do dia local em UTC
    const ABERTO = { notIn: ["finalizado", "cancelado", "entregue", "entrega"] };

    const orders = await this.prisma.runWithContext(ADM, (tx) => tx.productionOrder.findMany({
      where: { organizationId: org.id, status: { notIn: ["finalizado", "cancelado"] } },
      orderBy: { dueDate: "asc" }, take: 200,
      select: { id: true, shortCode: true, contactName: true, status: true, artStatus: true, dueDate: true, delivery: true, paymentStatus: true, totalCents: true, createdAt: true },
    })).catch(() => [] as any[]);

    const isToday = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) === dia : false;
    const fmtDay = (d: Date | null) => d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null;

    const novosHoje = orders.filter((o: any) => isToday(o.createdAt)).length;
    const emAberto = orders.length;
    const arte = {
      aguardando: orders.filter((o: any) => ["aguardando_arquivos", "arquivos_recebidos", "em_producao"].includes(o.artStatus)).length,
      pendenteAprovacao: orders.filter((o: any) => o.artStatus === "enviada").length,
      aprovada: orders.filter((o: any) => o.artStatus === "aprovada").length,
    };
    const atrasados = orders.filter((o: any) => o.dueDate && new Date(o.dueDate).getTime() < (fimHoje - 24 * 3600_000) && o.status !== "pronto");
    const prazoHoje = orders.filter((o: any) => isToday(o.dueDate));
    const prontos = orders.filter((o: any) => o.status === "pronto");
    const pendPag = orders.filter((o: any) => o.paymentStatus && o.paymentStatus !== "paid");

    const slim = (o: any) => ({ id: o.id, code: o.shortCode, nome: o.contactName, status: o.status, arte: o.artStatus, prazo: fmtDay(o.dueDate), entrega: o.delivery, totalCents: Number(o.totalCents ?? 0), pago: o.paymentStatus });

    return {
      org: { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor, niche: org.niche },
      generatedAt: now.toISOString(),
      totais: { novosHoje, emAberto, atrasados: atrasados.length, prazoHoje: prazoHoje.length, prontos: prontos.length, pendentesPagamento: pendPag.length, valorPendentePagamento: pendPag.reduce((s: number, o: any) => s + Number(o.totalCents ?? 0), 0) },
      arte,
      atrasados: atrasados.slice(0, 12).map(slim),
      prazoHoje: prazoHoje.slice(0, 12).map(slim),
      prontos: prontos.slice(0, 12).map(slim),
      pendentesPagamento: pendPag.slice(0, 12).map(slim),
    };
  }

  /**
   * Painel de PRODUÇÃO (gráfica) — chão de fábrica: pedidos por etapa de produção,
   * com a grade (roster) e prioridade por prazo. Público, validado pelo token.
   */
  async producao(token: string): Promise<any> {
    const t = (token ?? "").trim();
    if (t.length < 10) throw new AppError(ErrorCode.NotFound, "Token inválido", 404);
    const org = await this.prisma.runWithContext(ADM, (tx) => tx.organization.findFirst({ where: { kioskToken: t }, select: { id: true, name: true, logoUrl: true, primaryColor: true, niche: true } }));
    if (!org) throw new AppError(ErrorCode.NotFound, "Painel não encontrado", 404);

    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const dia = brt.toISOString().slice(0, 10);
    const fimHoje = new Date(dia + "T23:59:59.999Z").getTime() + 3 * 3600_000;

    // etapas de produção (sem novo/cancelado/finalizado) — fila do chão de fábrica
    const ETAPAS = ["arte", "costura", "producao", "separacao", "pronto"];
    const LABEL: Record<string, string> = { arte: "🎨 Arte", costura: "🧵 Costura", producao: "🏭 Produção", separacao: "📦 Separação", pronto: "✅ Pronto" };

    const orders = await this.prisma.runWithContext(ADM, (tx) => tx.productionOrder.findMany({
      where: { organizationId: org.id, status: { in: ETAPAS } },
      orderBy: { dueDate: "asc" }, take: 200,
      select: {
        id: true, shortCode: true, contactName: true, status: true, artStatus: true, dueDate: true, delivery: true, createdAt: true,
        roster: { select: { playerName: true, size: true, qty: true }, orderBy: { position: "asc" }, take: 40 },
        items: { select: { description: true, qty: true }, take: 20 },
      },
    })).catch(() => [] as any[]);

    const isToday = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) === dia : false;
    const fmtDay = (d: Date | null) => d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null;
    const isLate = (d: Date | null) => !!d && new Date(d).getTime() < (fimHoje - 24 * 3600_000);
    const diasRest = (d: Date | null) => d ? Math.round((new Date(new Date(d).toISOString().slice(0, 10) + "T00:00:00Z").getTime() - new Date(dia + "T00:00:00Z").getTime()) / 86400000) : null;

    const slim = (o: any) => {
      const pecas = (o.roster ?? []).reduce((s: number, r: any) => s + Number(r.qty ?? 0), 0)
        || (o.items ?? []).reduce((s: number, r: any) => s + Number(r.qty ?? 0), 0);
      const grade = (o.roster ?? []).map((r: any) => `${r.size ?? "-"}:${r.qty}`).join("  ");
      const itensTxt = (o.items ?? []).map((r: any) => `${r.qty}× ${r.description}`).join(" · ");
      return {
        id: o.id, code: o.shortCode, nome: o.contactName, status: o.status, arte: o.artStatus,
        prazo: fmtDay(o.dueDate), atrasado: isLate(o.dueDate) && o.status !== "pronto", prazoHoje: isToday(o.dueDate),
        dias: diasRest(o.dueDate), entrega: o.delivery, pecas, grade, itens: itensTxt,
      };
    };

    const byStage: Record<string, any[]> = {};
    for (const e of ETAPAS) byStage[e] = [];
    for (const o of orders) { (byStage[o.status] ?? (byStage[o.status] = [])).push(slim(o)); }

    const atrasados = orders.filter((o: any) => isLate(o.dueDate) && o.status !== "pronto").length;
    const prazoHoje = orders.filter((o: any) => isToday(o.dueDate)).length;
    const pecasTotal = orders.reduce((s: number, o: any) => s + ((o.roster ?? []).reduce((a: number, r: any) => a + Number(r.qty ?? 0), 0) || (o.items ?? []).reduce((a: number, r: any) => a + Number(r.qty ?? 0), 0)), 0);

    return {
      org: { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor, niche: org.niche },
      generatedAt: now.toISOString(),
      totais: { emProducao: orders.length, atrasados, prazoHoje, pecas: pecasTotal, prontos: byStage["pronto"]?.length ?? 0 },
      etapas: ETAPAS.map((e) => ({ key: e, label: LABEL[e] ?? e, items: byStage[e] ?? [] })),
    };
  }

  /** valida token e devolve a org (helper interno dos painéis públicos). */
  private async orgByToken(token: string): Promise<any> {
    const t = (token ?? "").trim();
    if (t.length < 10) throw new AppError(ErrorCode.NotFound, "Token inválido", 404);
    const org = await this.prisma.runWithContext(ADM, (tx) => tx.organization.findFirst({ where: { kioskToken: t }, select: { id: true, name: true, logoUrl: true, primaryColor: true, niche: true } }));
    if (!org) throw new AppError(ErrorCode.NotFound, "Painel não encontrado", 404);
    return org;
  }

  /**
   * Painel ADMIN "tudo" — visão geral da empresa: produção + financeiro
   * (faturamento, a receber, a pagar) + pendências. Público por token.
   */
  async admin(token: string): Promise<any> {
    const org = await this.orgByToken(token);
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const dia = brt.toISOString().slice(0, 10);
    const mesIni = dia.slice(0, 8) + "01";
    const inicioHojeUtc = new Date(dia + "T00:00:00Z").getTime() + 3 * 3600_000;
    const inicioMesUtc = new Date(mesIni + "T00:00:00Z").getTime() + 3 * 3600_000;
    const ABERTO_INST = { notIn: ["pago", "recebido", "cancelado"] };

    const [sales, pedidos, pagar, receber] = await Promise.all([
      this.prisma.runWithContext(ADM, (tx) => tx.sale.findMany({
        where: { organizationId: org.id, status: "completed", createdAt: { gte: new Date(inicioMesUtc) } },
        select: { totalCents: true, createdAt: true },
      })).catch(() => [] as any[]),
      this.prisma.runWithContext(ADM, (tx) => tx.productionOrder.findMany({
        where: { organizationId: org.id, status: { notIn: ["finalizado", "cancelado"] } },
        select: { id: true, shortCode: true, contactName: true, status: true, artStatus: true, dueDate: true, paymentStatus: true, totalCents: true },
        orderBy: { dueDate: "asc" }, take: 200,
      })).catch(() => [] as any[]),
      this.prisma.runWithContext(ADM, (tx) => tx.payableInstallment.findMany({
        where: { organizationId: org.id, status: ABERTO_INST },
        select: { amountCents: true, dueDate: true, payable: { select: { supplier: true, description: true } } },
        orderBy: { dueDate: "asc" }, take: 100,
      })).catch(() => [] as any[]),
      this.prisma.runWithContext(ADM, (tx) => tx.receivableInstallment.findMany({
        where: { organizationId: org.id, status: ABERTO_INST },
        select: { amountCents: true, dueDate: true, receivable: { select: { payer: true, description: true } } },
        orderBy: { dueDate: "asc" }, take: 100,
      })).catch(() => [] as any[]),
    ]);

    const isToday = (d: Date | null) => d ? new Date(d).toISOString().slice(0, 10) === dia : false;
    const fmtDay = (d: Date | null) => d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null;
    const venceuOuHoje = (d: Date | null) => !!d && new Date(d).toISOString().slice(0, 10) <= dia;
    const sum = (arr: any[], k = "amountCents") => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0);

    const fatHoje = sales.filter((s: any) => new Date(s.createdAt).getTime() >= inicioHojeUtc);
    const financeiro = {
      faturamentoHoje: sum(fatHoje, "totalCents"), vendasHoje: fatHoje.length,
      faturamentoMes: sum(sales, "totalCents"), vendasMes: sales.length,
    };

    const pagarVencidos = pagar.filter((p: any) => venceuOuHoje(p.dueDate));
    const receberVencidos = receber.filter((r: any) => venceuOuHoje(r.dueDate));
    const producao = {
      emAberto: pedidos.length,
      atrasados: pedidos.filter((o: any) => o.dueDate && new Date(o.dueDate).toISOString().slice(0, 10) < dia && o.status !== "pronto").length,
      prazoHoje: pedidos.filter((o: any) => isToday(o.dueDate)).length,
      prontos: pedidos.filter((o: any) => o.status === "pronto").length,
    };
    const pendArte = pedidos.filter((o: any) => o.artStatus === "enviada");
    const pendPag = pedidos.filter((o: any) => o.paymentStatus && o.paymentStatus !== "paid");

    return {
      org: { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor, niche: org.niche },
      generatedAt: now.toISOString(),
      financeiro,
      contas: {
        aReceberTotal: sum(receber), aReceberVencidoTotal: sum(receberVencidos), aReceberVencidos: receberVencidos.length,
        aPagarTotal: sum(pagar), aPagarVencidoTotal: sum(pagarVencidos), aPagarVencidos: pagarVencidos.length,
        saldoPrevisto: sum(receber) - sum(pagar),
      },
      producao,
      pendencias: {
        arteAprovacao: pendArte.length, pagamentoPedido: pendPag.length,
      },
      listas: {
        aPagar: pagar.slice(0, 10).map((p: any) => ({ nome: p.payable?.supplier || p.payable?.description || "—", venc: fmtDay(p.dueDate), vencido: venceuOuHoje(p.dueDate), valorCents: Number(p.amountCents ?? 0) })),
        aReceber: receber.slice(0, 10).map((r: any) => ({ nome: r.receivable?.payer || r.receivable?.description || "—", venc: fmtDay(r.dueDate), vencido: venceuOuHoje(r.dueDate), valorCents: Number(r.amountCents ?? 0) })),
        pedidos: pedidos.filter((o: any) => o.artStatus === "enviada" || (o.paymentStatus && o.paymentStatus !== "paid") || (o.dueDate && new Date(o.dueDate).toISOString().slice(0, 10) <= dia)).slice(0, 10)
          .map((o: any) => ({ code: o.shortCode, nome: o.contactName, status: o.status, arte: o.artStatus, prazo: fmtDay(o.dueDate), pago: o.paymentStatus, totalCents: Number(o.totalCents ?? 0) })),
      },
    };
  }

  /**
   * Painel ADMIN da ÓTICA — agenda do dia, exames/OS e financeiro do dia.
   * Público por token. Degrada bem se a empresa não usar algum módulo.
   */
  async otica(token: string): Promise<any> {
    const org = await this.orgByToken(token);
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const dia = brt.toISOString().slice(0, 10);
    const inicioHojeUtc = new Date(dia + "T00:00:00Z").getTime() + 3 * 3600_000;
    const fimHojeUtc = inicioHojeUtc + 24 * 3600_000;

    const [appts, sales, receber] = await Promise.all([
      this.prisma.runWithContext(ADM, (tx) => tx.appointment.findMany({
        where: { organizationId: org.id, startsAt: { gte: new Date(inicioHojeUtc), lt: new Date(fimHojeUtc) }, status: { notIn: ["cancelled", "canceled", "cancelado"] }, deletedAt: null },
        select: { id: true, startsAt: true, status: true, serviceName: true, customer: { select: { name: true } }, professional: { select: { name: true } } },
        orderBy: { startsAt: "asc" }, take: 60,
      })).catch(() => [] as any[]),
      this.prisma.runWithContext(ADM, (tx) => tx.sale.findMany({
        where: { organizationId: org.id, status: "completed", createdAt: { gte: new Date(inicioHojeUtc) } },
        select: { totalCents: true },
      })).catch(() => [] as any[]),
      this.prisma.runWithContext(ADM, (tx) => tx.receivableInstallment.findMany({
        where: { organizationId: org.id, status: { notIn: ["pago", "recebido", "cancelado"] }, dueDate: { lte: new Date(dia + "T00:00:00Z") } },
        select: { amountCents: true },
      })).catch(() => [] as any[]),
    ]);

    const fmtTime = (d: Date) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    const sum = (arr: any[], k = "amountCents") => arr.reduce((s, x) => s + Number(x[k] ?? 0), 0);

    return {
      org: { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor, niche: org.niche },
      generatedAt: now.toISOString(),
      totais: {
        agendaHoje: appts.length,
        atendidos: appts.filter((a: any) => ["done", "atendido", "finalizado", "concluido"].includes(a.status)).length,
        faturamentoHoje: sum(sales, "totalCents"), vendasHoje: sales.length,
        aReceberVencido: sum(receber),
      },
      agenda: appts.map((a: any) => ({ id: a.id, hora: fmtTime(a.startsAt), cliente: a.customer?.name ?? "—", servico: a.serviceName, profissional: a.professional?.name ?? "—", status: a.status })),
    };
  }
}
