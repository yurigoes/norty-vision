import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { OrgAiService } from "../ai/org-ai.service";
import type { RequestContext } from "../auth/session.middleware";

type Tip = { level: "info" | "warn" | "urgent"; text: string };
type Finding = { kind: string; severity: "info" | "warn" | "urgent"; title: string; detail?: string; metric?: any };

function brl(c: number) { return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

/**
 * IA proativa (econômica): a DETECÇÃO é por REGRAS (sem custo de IA). A IA só é
 * usada pra REDIGIR um resumo curto (1 chamada por empresa, e só quando há
 * achados novos) — usando a cadeia de provedores da org (com cooldown/fallback),
 * pra não estourar a cota gratuita. Também levanta dúvidas do ecossistema pro
 * master ensinar (ai_master_question).
 */
@Injectable()
export class InsightsService {
  private readonly logger = new Logger("Insights");
  constructor(private readonly prisma: PrismaService, private readonly orgAi: OrgAiService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  // ===================== DICAS INLINE (regras puras, sem IA) =====================
  /** Dicas contextuais ao cadastrar/editar — não bloqueiam o fluxo. */
  inlineTips(_ctx: RequestContext, input: { kind: string; data: any }): { tips: Tip[] } {
    const tips: Tip[] = [];
    const d = input?.data ?? {};
    if (input?.kind === "product") {
      const price = Number(d.priceCashCents ?? 0);
      const cost = Number(d.costCents ?? 0);
      if (price > 0 && cost > 0 && price < cost) tips.push({ level: "urgent", text: `Preço à vista (${brl(price)}) está ABAIXO do custo (${brl(cost)}).` });
      else if (price > 0 && cost > 0) {
        const margin = ((price - cost) / price) * 100;
        if (margin < 10) tips.push({ level: "warn", text: `Margem baixa: ${margin.toFixed(0)}% sobre o preço à vista.` });
      }
      if (!price) tips.push({ level: "info", text: "Sem preço à vista definido — o cliente não vê valor na vitrine/atendimento." });
      if (d.trackStock && Number(d.minStockQty ?? 0) > 0 && Number(d.stockQty ?? 0) <= Number(d.minStockQty)) {
        tips.push({ level: "warn", text: "Estoque no/abaixo do mínimo — considere repor." });
      }
      if (!String(d.ncm ?? "").trim()) tips.push({ level: "info", text: "Sem NCM — necessário para emitir nota fiscal deste produto." });
      const inst = Number(d.priceCardInstallmentsCents ?? 0);
      if (inst > 0 && price > 0 && inst > price) tips.push({ level: "info", text: "Parcela do cartão maior que o preço à vista — confira o parcelamento." });
    }
    return { tips };
  }

  // ===================== GARGALOS POR EMPRESA (regras) =====================
  /** Roda as regras de gargalo da empresa, grava/atualiza org_insight e redige resumo. */
  async analyzeOrg(orgId: string): Promise<Finding[]> {
    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
    const adm = { isPlatformAdmin: true as const };
    const findings: Finding[] = [];

    // produção parada/atrasada (gráfica)
    const prodOverdue = await this.prisma.runWithContext(adm, (tx) => tx.productionOrder.count({ where: { organizationId: orgId, status: { notIn: ["finalizado", "cancelado", "entrega"] }, dueDate: { lt: now } } })).catch(() => 0);
    if (prodOverdue > 0) findings.push({ kind: "producao_parada", severity: prodOverdue >= 3 ? "urgent" : "warn", title: `${prodOverdue} pedido(s) de produção com prazo vencido`, detail: "Pedidos passaram da data de entrega e não foram finalizados.", metric: { count: prodOverdue } });

    // parcelas de crediário vencidas
    const overdue = await this.prisma.runWithContext(adm, (tx) => tx.creditInstallment.aggregate({ where: { organizationId: orgId, status: { not: "paid" }, dueDate: { lt: today } }, _count: { _all: true }, _sum: { amountCents: true } })).catch(() => null as any);
    const overdueCount = overdue?._count?._all ?? 0;
    if (overdueCount > 0) findings.push({ kind: "parcela_vencida", severity: overdueCount >= 10 ? "urgent" : "warn", title: `${overdueCount} parcela(s) vencida(s) — ${brl(Number(overdue?._sum?.amountCents ?? 0))}`, detail: "Parcelas de crediário em atraso. Acione a régua de cobrança.", metric: { count: overdueCount, totalCents: Number(overdue?._sum?.amountCents ?? 0) } });

    // estoque baixo (Prisma não compara 2 colunas direto: filtra em memória)
    const stockRows = await this.prisma.runWithContext(adm, (tx) => tx.product.findMany({ where: { organizationId: orgId, isActive: true, deletedAt: null, trackStock: true, minStockQty: { gt: 0 } }, select: { stockQty: true, minStockQty: true }, take: 3000 })).catch(() => [] as any[]);
    const lowStockCount = stockRows.filter((r: any) => Number(r.stockQty) <= Number(r.minStockQty)).length;
    if (lowStockCount > 0) findings.push({ kind: "estoque_baixo", severity: "warn", title: `${lowStockCount} produto(s) no/abaixo do estoque mínimo`, detail: "Reponha para não perder venda.", metric: { count: lowStockCount } });

    // atendimentos parados (cliente esperando há > 2h)
    const twoHago = new Date(now.getTime() - 2 * 3600_000);
    const stuck = await this.prisma.runWithContext(adm, (tx) => tx.conversation.count({ where: { organizationId: orgId, status: "open", unreadAgent: { gt: 0 }, lastInboundAt: { lt: twoHago } } })).catch(() => 0);
    if (stuck > 0) findings.push({ kind: "atendimento_parado", severity: stuck >= 5 ? "urgent" : "warn", title: `${stuck} atendimento(s) sem resposta há +2h`, detail: "Clientes aguardando resposta no atendimento.", metric: { count: stuck } });

    // grava/atualiza: upsert dos achados; fecha os que não apareceram mais
    const seen = new Set(findings.map((f) => f.kind));
    await this.prisma.runWithContext(adm, async (tx) => {
      for (const f of findings) {
        await tx.orgInsight.upsert({
          where: { organizationId_kind: { organizationId: orgId, kind: f.kind } },
          update: { severity: f.severity, title: f.title, detail: f.detail ?? null, metric: (f.metric ?? {}) as any, status: "open" },
          create: { organizationId: orgId, kind: f.kind, severity: f.severity, title: f.title, detail: f.detail ?? null, metric: (f.metric ?? {}) as any },
        });
      }
      // achados operacionais que sumiram → fecha (mantém o "resumo" à parte)
      await tx.orgInsight.updateMany({ where: { organizationId: orgId, status: "open", kind: { notIn: [...seen, "resumo"] } }, data: { status: "dismissed" } });
    });

    // resumo redigido pela IA — só quando há achados E o resumo está velho (>20h) ou ausente.
    if (findings.length) await this.maybeWriteSummary(orgId, findings).catch(() => undefined);
    else await this.prisma.runWithContext(adm, (tx) => tx.orgInsight.updateMany({ where: { organizationId: orgId, kind: "resumo", status: "open" }, data: { status: "dismissed" } })).catch(() => undefined);

    return findings;
  }

  private async maybeWriteSummary(orgId: string, findings: Finding[]) {
    const adm = { isPlatformAdmin: true as const };
    const existing = await this.prisma.runWithContext(adm, (tx) => tx.orgInsight.findFirst({ where: { organizationId: orgId, kind: "resumo" }, select: { id: true, updatedAt: true, status: true } })).catch(() => null);
    const fresh = existing && existing.status === "open" && (Date.now() - new Date(existing.updatedAt).getTime()) < 20 * 3600_000;
    if (fresh) return; // economiza cota: não re-redige toda hora
    const system = "Você é um consultor de operação. Resuma os gargalos da empresa em 1-2 frases curtas, objetivas e acionáveis, em português do Brasil. Sem saudação, sem listar — texto corrido.";
    const user = `Gargalos detectados:\n${findings.map((f) => `- ${f.title}`).join("\n")}\n\nEscreva o resumo (máx. 2 frases).`;
    const text = await this.orgAi.complete(orgId, system, user, 160).catch(() => null);
    if (!text) return; // sem IA disponível agora → fica só com os achados por regra
    await this.prisma.runWithContext(adm, (tx) => tx.orgInsight.upsert({
      where: { organizationId_kind: { organizationId: orgId, kind: "resumo" } },
      update: { severity: "info", title: "Resumo da IA", detail: text.slice(0, 1000), status: "open", metric: {} as any },
      create: { organizationId: orgId, kind: "resumo", severity: "info", title: "Resumo da IA", detail: text.slice(0, 1000) },
    })).catch(() => undefined);
  }

  /** Admin: gargalos da própria empresa. */
  async listForOrg(ctx: RequestContext): Promise<any> {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgInsight.findMany({ where: { status: "open" }, orderBy: [{ severity: "desc" }, { updatedAt: "desc" }] }));
    return { items };
  }
  async dismiss(ctx: RequestContext, id: string) {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.orgInsight.updateMany({ where: { id }, data: { status: "dismissed" } }));
    return { ok: true };
  }
  /** Admin pode forçar a análise da própria empresa agora. */
  async refreshOrg(ctx: RequestContext): Promise<any> {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const findings = await this.analyzeOrg(ctx.orgId);
    return this.listForOrg(ctx).then((r) => ({ ...r, found: findings.length }));
  }

  // ===================== ECOSSISTEMA (master) =====================
  /** Master: visão geral de gargalos de todas as empresas. */
  async ecosystem(ctx: RequestContext): Promise<any> {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
    const adm = { isPlatformAdmin: true as const };
    const insights = await this.prisma.runWithContext(adm, (tx) => tx.orgInsight.findMany({ where: { status: "open", kind: { not: "resumo" } }, orderBy: [{ severity: "desc" }, { updatedAt: "desc" }], take: 200 }));
    const orgIds = [...new Set(insights.map((i) => i.organizationId))];
    const orgs = orgIds.length ? await this.prisma.runWithContext(adm, (tx) => tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, niche: true } })) : [];
    const nm = new Map(orgs.map((o) => [o.id, o] as [string, any]));
    const byKind = new Map<string, number>();
    for (const i of insights) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
    return {
      totals: { open: insights.length, urgent: insights.filter((i) => i.severity === "urgent").length, byKind: [...byKind.entries()].map(([kind, count]) => ({ kind, count })) },
      items: insights.slice(0, 80).map((i) => ({ ...i, orgName: nm.get(i.organizationId)?.name ?? "—", niche: nm.get(i.organizationId)?.niche ?? null })),
    };
  }

  // ----- dúvidas da IA ao master (aprendizado do ecossistema) -----
  /** Gera (por regras) dúvidas do ecossistema pro master ensinar; IA redige a pergunta. */
  async generateEcosystemQuestions() {
    const adm = { isPlatformAdmin: true as const };
    // padrão: nicho com muitas dúvidas não resolvidas → pergunta ao master.
    const since = new Date(Date.now() - 30 * 86400_000);
    const doubts = await this.prisma.runWithContext(adm, (tx) => tx.aiLearningEvent.findMany({ where: { eventType: { in: ["uncertain", "fallback", "handoff"] }, resolved: false, createdAt: { gte: since } }, select: { organizationId: true, question: true }, take: 1000 })).catch(() => [] as any[]);
    if (doubts.length < 5) return { created: 0 };
    const orgIds = [...new Set(doubts.map((d: any) => d.organizationId))];
    const orgs = orgIds.length ? await this.prisma.runWithContext(adm, (tx) => tx.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, niche: true } })) : [];
    const niche = new Map(orgs.map((o) => [o.id, (o.niche ?? "").toLowerCase()] as [string, string]));
    const byNiche = new Map<string, { qs: string[]; orgId: string }>();
    for (const d of doubts as any[]) {
      const n = niche.get(d.organizationId) || "generico";
      if (!byNiche.has(n)) byNiche.set(n, { qs: [], orgId: d.organizationId });
      if (d.question) byNiche.get(n)!.qs.push(String(d.question));
    }
    let created = 0;
    for (const [n, { qs, orgId }] of byNiche) {
      if (qs.length < 5) continue;
      const topic = `duvidas_${n}`;
      const exists = await this.prisma.runWithContext(adm, (tx) => tx.aiMasterQuestion.findFirst({ where: { topic, status: "open" } })).catch(() => null);
      if (exists) continue;
      const sample = qs.slice(0, 12).map((q) => `- ${q.slice(0, 120)}`).join("\n");
      const system = "Você é a IA do ecossistema yugochat aprendendo com o dono da plataforma (master). A partir das dúvidas recorrentes de clientes do nicho, formule UMA pergunta objetiva ao master, pra você aprender a responder melhor. Português do Brasil, 1 frase.";
      const user = `Nicho: ${n}. Dúvidas recorrentes de clientes (não resolvidas):\n${sample}\n\nQual UMA pergunta você faria ao master pra aprender a atender melhor esse nicho?`;
      // usa a cadeia de provedores de uma org representativa do nicho (cooldown/fallback → econômico)
      const q = await this.orgAi.complete(orgId, system, user, 120).catch(() => null);
      const question = (q || `No nicho ${n}, como devo responder às dúvidas recorrentes que os clientes mais trazem?`).trim();
      await this.prisma.runWithContext(adm, (tx) => tx.aiMasterQuestion.create({ data: { topic, question: question.slice(0, 500), context: sample.slice(0, 1500) } })).catch(() => undefined);
      created++;
    }
    return { created };
  }
  async listMasterQuestions(ctx: RequestContext, status = "open"): Promise<any> {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
    const items = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.aiMasterQuestion.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 100 }));
    return { items };
  }
  async answerMasterQuestion(ctx: RequestContext, id: string, answer: string) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
    if (!answer?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Resposta vazia", 400);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.aiMasterQuestion.update({ where: { id }, data: { answer: answer.trim().slice(0, 4000), status: "answered", answeredAt: new Date(), answeredBy: ctx.platformUserId ?? null } }));
    return { ok: true };
  }
  async dismissMasterQuestion(ctx: RequestContext, id: string) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.aiMasterQuestion.update({ where: { id }, data: { status: "dismissed" } }));
    return { ok: true };
  }

  /** Roda a análise de todas as empresas (scheduler). */
  async analyzeAll() {
    const orgs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findMany({ where: { status: "active" }, select: { id: true } })).catch(() => [] as any[]);
    for (const o of orgs) { try { await this.analyzeOrg(o.id); } catch (e: any) { this.logger.warn(`analyzeOrg ${o.id}: ${e?.message}`); } }
    await this.generateEcosystemQuestions().catch(() => undefined);
    return { orgs: orgs.length };
  }
}
