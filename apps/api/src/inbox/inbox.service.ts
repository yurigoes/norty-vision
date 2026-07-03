import { Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { SurveysService } from "../surveys/surveys.service";
import { OrgIntegrationsService } from "../org-integrations/org-integrations.service";
import { MercadoPagoOrgAdapter } from "../payments/mercadopago-org.adapter";
import { OrgAiService } from "../ai/org-ai.service";
import { AiLearningService } from "../ai/ai-learning.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { ProductionService } from "../production/production.service";
import { QuotesService } from "../quotes/quotes.service";
import { orgBaseUrl } from "../common/org-url";
import type { RequestContext } from "../auth/session.middleware";

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * InboxService — atendimento omnichannel (substitui o Chatwoot).
 * Conversas por inbox (whatsapp/email/webchat), mensagens in/out, atribuição,
 * status, labels, respostas rápidas. A ingestão de entrada (ingestInbound) é
 * chamada pelo webhook da Evolution / e-mail / webchat.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger("Inbox");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly surveys: SurveysService,
    private readonly orgIntegrations: OrgIntegrationsService,
    private readonly orgAi: OrgAiService,
    private readonly appointments: AppointmentsService,
    private readonly aiLearning: AiLearningService,
    private readonly production: ProductionService,
    private readonly quotes: QuotesService,
  ) {}

  /** Contexto de sistema p/ chamar serviços org-scoped a partir do bot/IA. */
  private sysCtx(orgId: string, storeId?: string | null): RequestContext {
    // storeId é necessário pro RLS de appointments (WITH CHECK exige
    // store_id = app.current_store_id()). Sem ele, o INSERT/UPDATE é barrado.
    return { orgId, storeId: storeId ?? undefined, isOrgAdmin: true } as RequestContext;
  }

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private orgId(ctx: RequestContext): string {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId!;
  }
  /** atalho: roda como platform admin (contexto de sistema, ex.: webhook). */
  private pa<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, fn);
  }

  // ---- antiban: fila de envio por instância (número) ----
  // Serializa os envios de WhatsApp por número com um gap curto, pra vários
  // operadores no MESMO número não dispararem ao mesmo tempo (risco de ban),
  // sem atrasar demais a operação. Em memória (1 processo de API).
  private sendChains = new Map<string, Promise<unknown>>();
  private lastSentAt = new Map<string, number>();
  private runQueued<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const minGap = Number(process.env.INBOX_SEND_MIN_GAP_MS ?? 800);
    const prev = this.sendChains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      const last = this.lastSentAt.get(key) ?? 0;
      const wait = Math.max(0, last + minGap - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * 250)));
      try { return await fn(); }
      finally { this.lastSentAt.set(key, Date.now()); }
    });
    this.sendChains.set(key, next);
    return next;
  }

  // ============================== CONFIG ==============================
  async listInboxes(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inbox.findMany({ where: {}, orderBy: { createdAt: "asc" } }),
    );
  }

  async upsertInbox(ctx: RequestContext, input: {
    id?: string; name: string; channel: string; channelRef?: string; teamId?: string;
    slaPolicyId?: string; botEnabled?: boolean; autoReply?: string; greeting?: string; storeId?: string;
  }) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => {
      const data: any = {
        name: input.name, channel: input.channel, channelRef: input.channelRef ?? null,
        teamId: input.teamId ?? null, slaPolicyId: input.slaPolicyId ?? null,
        botEnabled: !!input.botEnabled, autoReply: input.autoReply ?? null,
        greeting: input.greeting ?? null, storeId: input.storeId ?? null,
      };
      if (input.id) return tx.inbox.update({ where: { id: input.id }, data });
      return tx.inbox.create({ data: { ...data, organizationId: orgId } });
    });
  }

  async setInboxAgents(ctx: RequestContext, inboxId: string, membershipIds: string[]) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.inboxAgent.deleteMany({ where: { inboxId } });
      for (const mid of membershipIds) {
        await tx.inboxAgent.create({ data: { organizationId: orgId, inboxId, membershipId: mid } });
      }
      return { ok: true };
    });
  }

  async listLabels(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversationLabel.findMany({ orderBy: { name: "asc" } }));
  }
  async upsertLabel(ctx: RequestContext, input: { id?: string; name: string; color?: string }) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id
        ? tx.conversationLabel.update({ where: { id: input.id }, data: { name: input.name, color: input.color ?? null } })
        : tx.conversationLabel.create({ data: { organizationId: orgId, name: input.name, color: input.color ?? null } }),
    );
  }

  /**
   * Auto-assign disparado pela ingestão de mensagem inbound. Roda em fundo
   * pra não atrasar a resposta do webhook. Usa pickNextAgent (load-balanced
   * + respeita maxConcurrent). Se ninguém disponível, conversa fica órfã
   * em "waiting" (aba pra o operador puxar).
   */
  private async tryAutoAssign(orgId: string, conversationId: string): Promise<void> {
    const fakeCtx: any = { orgId, membershipId: null, userId: null, isOrgAdmin: false, isPlatformAdmin: true };
    const memId = await this.pickNextAgent(fakeCtx, {}).catch(() => null);
    if (!memId) return;
    await this.pa((tx) =>
      tx.conversation.update({
        where: { id: conversationId, assigneeMembershipId: null, botActive: false },
        data: { assigneeMembershipId: memId },
      }),
    ).catch(() => undefined);
  }

  // ============================== WEBHOOKS OUT ==============================
  async listWebhooks(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxWebhook.findMany({ orderBy: { name: "asc" } }),
    );
  }

  async upsertWebhook(ctx: RequestContext, input: { id?: string; name: string; url: string; secret?: string | null; events: string[]; isActive?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = this.orgId(ctx);
    if (!/^https?:\/\//.test(input.url)) throw new AppError(ErrorCode.ValidationFailed, "URL deve começar com http(s)://", 400);
    if (!Array.isArray(input.events) || input.events.length === 0) throw new AppError(ErrorCode.ValidationFailed, "Selecione ao menos 1 evento", 400);
    if (input.id) {
      return this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.inboxWebhook.update({
          where: { id: input.id },
          data: { name: input.name, url: input.url, secret: input.secret ?? null, events: input.events, isActive: input.isActive ?? true, deliverFailCount: 0 },
        }),
      );
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxWebhook.create({
        data: { organizationId: orgId, name: input.name, url: input.url, secret: input.secret ?? null, events: input.events, isActive: input.isActive ?? true, createdBy: ctx.userId ?? null },
      }),
    );
  }

  async deleteWebhook(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxWebhook.delete({ where: { id } }));
    return { ok: true };
  }

  /**
   * Dispara o webhook out pra todos os endpoints da org que assinaram esse
   * evento. Best-effort: roda em fundo, captura erro, incrementa fail_count
   * e desativa após 5 falhas consecutivas.
   */
  async fireWebhookEvent(orgId: string, eventName: string, payload: any): Promise<void> {
    try {
      const hooks = await this.pa((tx) =>
        tx.inboxWebhook.findMany({ where: { organizationId: orgId, isActive: true, events: { has: eventName } } }),
      ).catch(() => []);
      if (!hooks.length) return;
      const body = { event: eventName, organizationId: orgId, occurredAt: new Date().toISOString(), data: payload };
      const bodyStr = JSON.stringify(body);
      for (const h of hooks) {
        void this.deliverWebhook(h, bodyStr);
      }
    } catch (e: any) {
      this.logger.error(`fireWebhookEvent ${eventName}: ${e?.message}`);
    }
  }

  private async deliverWebhook(hook: any, bodyStr: string): Promise<void> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "yugo-webhook/1" };
      if (hook.secret) {
        // HMAC-SHA256(secret, body) em hex — n8n/Zapier reconhecem
        const { createHmac } = await import("crypto");
        const sig = createHmac("sha256", hook.secret).update(bodyStr).digest("hex");
        headers["X-Yugo-Signature"] = `sha256=${sig}`;
      }
      const r = await fetch(hook.url, { method: "POST", headers, body: bodyStr, signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        await this.pa((tx) =>
          tx.inboxWebhook.update({ where: { id: hook.id }, data: { lastDeliveredAt: new Date(), deliverFailCount: 0 } }),
        ).catch(() => undefined);
      } else throw new Error(`HTTP ${r.status}`);
    } catch (e: any) {
      const fail = (hook.deliverFailCount ?? 0) + 1;
      await this.pa((tx) =>
        tx.inboxWebhook.update({
          where: { id: hook.id },
          data: { deliverFailCount: fail, isActive: fail < 5 },
        }),
      ).catch(() => undefined);
      this.logger.warn(`webhook ${hook.id} falhou (${fail}/5): ${e?.message ?? e}`);
    }
  }

  // ============================== RELATÓRIOS ==============================
  /**
   * Overview do atendimento no período: totais (abertas, resolvidas, em bot,
   * aguardando) + médias (tempo de primeira resposta, tempo de resolução) +
   * CSAT médio. Tudo escopo da org via RLS.
   */
  async reportsOverview(ctx: RequestContext, opts: { from?: string; to?: string }) {
    const orgId = this.orgId(ctx);
    const from = opts.from ? new Date(opts.from + "T00:00:00") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59") : new Date();
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const [total, abertas, resolvidas, bot, aguardando, resolvedRange] = await Promise.all([
        tx.conversation.count({ where: { createdAt: { gte: from, lte: to } } }),
        tx.conversation.count({ where: { status: "open" } }),
        tx.conversation.count({ where: { status: "resolved", resolvedAt: { gte: from, lte: to } } }),
        tx.conversation.count({ where: { botActive: true, status: { not: "resolved" } } }),
        tx.conversation.count({ where: { assigneeMembershipId: null, teamId: null, botActive: false, status: { not: "resolved" } } }),
        tx.conversation.findMany({
          where: { status: "resolved", resolvedAt: { gte: from, lte: to }, firstResponseAt: { not: null }, lastInboundAt: { not: null } },
          select: { createdAt: true, firstResponseAt: true, resolvedAt: true, lastInboundAt: true },
          take: 1000,
        }),
      ]);
      let firstRespMs = 0, resolveMs = 0, firstRespN = 0, resolveN = 0;
      for (const c of resolvedRange) {
        if (c.firstResponseAt && c.lastInboundAt) {
          firstRespMs += c.firstResponseAt.getTime() - c.lastInboundAt.getTime();
          firstRespN++;
        }
        if (c.resolvedAt) {
          resolveMs += c.resolvedAt.getTime() - c.createdAt.getTime();
          resolveN++;
        }
      }
      // CSAT médio (1-5) do período
      const surveys = await tx.satisfactionSurvey.findMany({
        where: { kind: "manual", stage: "atendimento", respondedAt: { gte: from, lte: to }, npsScore: { not: null } },
        select: { npsScore: true, sellerRating: true },
        take: 1000,
      });
      let npsSum = 0, npsN = 0, sellerSum = 0, sellerN = 0;
      for (const s of surveys) {
        if (s.npsScore != null) { npsSum += s.npsScore; npsN++; }
        if (s.sellerRating != null) { sellerSum += s.sellerRating; sellerN++; }
      }
      return {
        from, to,
        totals: { total, abertas, resolvidas, bot, aguardando },
        avgFirstResponseS: firstRespN > 0 ? Math.round(firstRespMs / firstRespN / 1000) : null,
        avgResolutionS: resolveN > 0 ? Math.round(resolveMs / resolveN / 1000) : null,
        csat: { npsAvg: npsN > 0 ? Number((npsSum / npsN).toFixed(2)) : null, npsCount: npsN, sellerAvg: sellerN > 0 ? Number((sellerSum / sellerN).toFixed(2)) : null, sellerCount: sellerN },
      };
    });
  }

  /**
   * Ranking de operadores no período: conta atendimentos fechados, tempo
   * médio de primeira resposta e CSAT médio. Agrupa por closedByMembershipId.
   */
  async reportsByAgent(ctx: RequestContext, opts: { from?: string; to?: string }) {
    const from = opts.from ? new Date(opts.from + "T00:00:00") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59") : new Date();
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const convs = await tx.conversation.findMany({
        where: { status: "resolved", resolvedAt: { gte: from, lte: to }, closedByMembershipId: { not: null } },
        select: { id: true, closedByMembershipId: true, createdAt: true, firstResponseAt: true, resolvedAt: true, lastInboundAt: true },
        take: 5000,
      });
      const agg = new Map<string, { count: number; firstRespMs: number; firstRespN: number; resolveMs: number; resolveN: number }>();
      for (const c of convs) {
        const k = c.closedByMembershipId!;
        const a = agg.get(k) ?? { count: 0, firstRespMs: 0, firstRespN: 0, resolveMs: 0, resolveN: 0 };
        a.count++;
        if (c.firstResponseAt && c.lastInboundAt) {
          a.firstRespMs += c.firstResponseAt.getTime() - c.lastInboundAt.getTime();
          a.firstRespN++;
        }
        if (c.resolvedAt) {
          a.resolveMs += c.resolvedAt.getTime() - c.createdAt.getTime();
          a.resolveN++;
        }
        agg.set(k, a);
      }
      const ids = [...agg.keys()];
      const memberships = ids.length
        ? await tx.membership.findMany({ where: { id: { in: ids } }, select: { id: true, user: { select: { name: true } } } })
        : [];
      const nameMap = new Map(memberships.map((m) => [m.id, m.user?.name ?? "—"]));
      // CSAT por agente: surveys.sellerUserId vs user do membership
      const userByMembership = new Map<string, string>();
      const userIds: string[] = [];
      if (ids.length) {
        const ms = await tx.membership.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } });
        for (const m of ms) { userByMembership.set(m.id, m.userId); userIds.push(m.userId); }
      }
      const surveys = userIds.length
        ? await tx.satisfactionSurvey.findMany({
            where: { kind: "manual", stage: "atendimento", respondedAt: { gte: from, lte: to }, sellerUserId: { in: userIds } },
            select: { sellerUserId: true, npsScore: true },
          })
        : [];
      const csatByUser = new Map<string, { sum: number; n: number }>();
      for (const s of surveys) {
        if (s.sellerUserId == null || s.npsScore == null) continue;
        const a = csatByUser.get(s.sellerUserId) ?? { sum: 0, n: 0 };
        a.sum += s.npsScore; a.n++;
        csatByUser.set(s.sellerUserId, a);
      }
      return {
        from, to,
        items: ids.map((id) => {
          const a = agg.get(id)!;
          const userId = userByMembership.get(id);
          const csat = userId ? csatByUser.get(userId) : undefined;
          return {
            membershipId: id,
            name: nameMap.get(id) ?? "—",
            atendimentos: a.count,
            avgFirstResponseS: a.firstRespN > 0 ? Math.round(a.firstRespMs / a.firstRespN / 1000) : null,
            avgResolutionS: a.resolveN > 0 ? Math.round(a.resolveMs / a.resolveN / 1000) : null,
            csatAvg: csat && csat.n > 0 ? Number((csat.sum / csat.n).toFixed(2)) : null,
            csatCount: csat?.n ?? 0,
          };
        }).sort((a, b) => b.atendimentos - a.atendimentos),
      };
    });
  }

  /**
   * Volume de mensagens recebidas no período agrupado por hora (do dia) ou
   * dia (do período). Útil pra entender picos e dimensionar a equipe.
   */
  async reportsVolume(ctx: RequestContext, opts: { from?: string; to?: string; groupBy?: "hour" | "day" }) {
    const orgId = this.orgId(ctx);
    const from = opts.from ? new Date(opts.from + "T00:00:00") : new Date(Date.now() - 7 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59") : new Date();
    const groupBy = opts.groupBy === "day" ? "day" : "hour";
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const msgs = await tx.conversationMessage.findMany({
        where: { direction: "in", createdAt: { gte: from, lte: to } },
        select: { createdAt: true },
        take: 50000,
      });
      const buckets = new Map<string, number>();
      for (const m of msgs) {
        const d = m.createdAt;
        let key: string;
        if (groupBy === "hour") {
          // 0-23 (agregado pelo dia da semana)
          key = String(d.getHours()).padStart(2, "0") + "h";
        } else {
          key = d.toISOString().slice(0, 10);
        }
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      return {
        from, to, groupBy,
        items: [...buckets.entries()].map(([k, v]) => ({ key: k, count: v })).sort((a, b) => a.key.localeCompare(b.key)),
      };
    });
  }

  // ============================== SNOOZE ==============================
  /**
   * Adia uma conversa até a data informada. Aceita preset string:
   *   "1h" | "4h" | "tomorrow_9am" | "next_monday_9am" | ISO string
   * Mantém o assigneeMembershipId (mesmo operador pega quando voltar).
   * Reaparece automaticamente em listConversations (auto-revive inline).
   */
  async snoozeConversation(ctx: RequestContext, id: string, input: { until: string }) {
    const until = this.resolveSnoozeUntil(input.until);
    if (!until) throw new AppError(ErrorCode.ValidationFailed, "Data de snooze inválida", 400);
    if (until.getTime() < Date.now() + 60_000) {
      throw new AppError(ErrorCode.ValidationFailed, "O snooze deve ser pelo menos 1 minuto no futuro", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.update({ where: { id }, data: { status: "snoozed", snoozedUntil: until } }),
    );
    return { ok: true, snoozedUntil: until };
  }

  /** Cancela snooze e devolve pra "open" agora. */
  async unsnoozeConversation(ctx: RequestContext, id: string) {
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.update({ where: { id }, data: { status: "open", snoozedUntil: null } }),
    );
    return { ok: true };
  }

  private resolveSnoozeUntil(input: string): Date | null {
    const now = new Date();
    if (input === "1h") return new Date(now.getTime() + 60 * 60_000);
    if (input === "4h") return new Date(now.getTime() + 4 * 60 * 60_000);
    if (input === "tomorrow_9am") {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    if (input === "next_monday_9am") {
      const d = new Date(now);
      const daysUntilMon = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMon);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    // tenta parsear como ISO
    const dt = new Date(input);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // ============================== MACROS ==============================
  async listMacros(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxMacro.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    );
  }

  async upsertMacro(ctx: RequestContext, input: { id?: string; name: string; description?: string | null; actions: any[]; isActive?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = this.orgId(ctx);
    if (input.id) {
      return this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.inboxMacro.update({
          where: { id: input.id },
          data: { name: input.name, description: input.description ?? null, actions: input.actions as any, isActive: input.isActive ?? true },
        }),
      );
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxMacro.create({
        data: {
          organizationId: orgId,
          name: input.name,
          description: input.description ?? null,
          actions: input.actions as any,
          isActive: input.isActive ?? true,
          createdBy: ctx.userId ?? null,
        },
      }),
    );
  }

  async deleteMacro(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxMacro.update({ where: { id }, data: { isActive: false } }),
    );
    return { ok: true };
  }

  /**
   * Executa as ações de uma macro sobre uma conversa. Cada erro de ação
   * isolada é logado mas não interrompe o resto (best-effort).
   */
  async runMacro(ctx: RequestContext, conversationId: string, macroId: string) {
    const macro = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxMacro.findFirst({ where: { id: macroId, isActive: true } }),
    );
    if (!macro) throw new AppError(ErrorCode.NotFound, "Macro não encontrada", 404);
    const actions = Array.isArray(macro.actions) ? (macro.actions as any[]) : [];
    const results: { kind: string; ok: boolean; error?: string }[] = [];
    for (const a of actions) {
      try {
        if (a.kind === "send_message" && typeof a.body === "string") {
          const body = await this.interpolateForConversation(ctx, conversationId, a.body);
          await this.sendMessage(ctx, conversationId, { body, isPrivate: a.isPrivate === true });
        } else if (a.kind === "assign") {
          await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.conversation.update({ where: { id: conversationId }, data: { assigneeMembershipId: a.assigneeMembershipId ?? null, botActive: false } }),
          );
        } else if (a.kind === "transfer_team" && a.teamId) {
          await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.conversation.update({ where: { id: conversationId }, data: { teamId: a.teamId, assigneeMembershipId: null, status: "pending", botActive: false } }),
          );
        } else if ((a.kind === "add_label" || a.kind === "remove_label") && a.labelId) {
          // a tabela de junção é conversation_label_links (não labels)
          const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.conversation.findFirst({ where: { id: conversationId }, select: { organizationId: true } }),
          );
          if (!conv) throw new Error("conversa não encontrada");
          if (a.kind === "add_label") {
            await this.prisma.runWithContext(this.rls(ctx), (tx) =>
              tx.conversationLabelLink.create({ data: { organizationId: conv.organizationId, conversationId, labelId: a.labelId } }).catch(() => undefined),
            );
          } else {
            await this.prisma.runWithContext(this.rls(ctx), (tx) =>
              tx.conversationLabelLink.deleteMany({ where: { conversationId, labelId: a.labelId } }),
            );
          }
        } else if (a.kind === "set_status" && typeof a.status === "string") {
          await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.conversation.update({ where: { id: conversationId }, data: { status: a.status, ...(a.status === "resolved" ? { resolvedAt: new Date() } : {}) } }),
          );
        } else if (a.kind === "set_priority" && typeof a.priority === "string") {
          await this.prisma.runWithContext(this.rls(ctx), (tx) =>
            tx.conversation.update({ where: { id: conversationId }, data: { priority: a.priority } }),
          );
        } else {
          throw new Error(`ação desconhecida: ${a.kind}`);
        }
        results.push({ kind: a.kind, ok: true });
      } catch (e: any) {
        results.push({ kind: a.kind ?? "unknown", ok: false, error: e?.message ?? String(e) });
      }
    }
    return { ran: results };
  }

  /**
   * Retorna o membership ID do próximo agente disponível pra atribuição:
   * online + (active conversations) < maxConcurrent, escolhido por menor
   * carga atual (load balancing simples). Retorna null se ninguém disponível.
   */
  async pickNextAgent(ctx: RequestContext, opts?: { teamId?: string | null }): Promise<string | null> {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const presences = await tx.inboxAgentPresence.findMany({
        where: { organizationId: orgId, status: "online" },
        select: { membershipId: true, maxConcurrent: true },
      });
      if (!presences.length) return null;
      // se for time específico, filtra os membership IDs que pertencem ao time
      let candidates = presences;
      if (opts?.teamId) {
        const teamMembers = await (tx as any).teamMember.findMany({
          where: { teamId: opts.teamId },
          select: { membershipId: true },
        }).catch(() => [] as { membershipId: string }[]);
        const tmSet = new Set(teamMembers.map((m: any) => m.membershipId));
        candidates = candidates.filter((p) => tmSet.has(p.membershipId));
      }
      if (!candidates.length) return null;
      // conta conversas abertas+pendentes por agente
      const active = await tx.conversation.groupBy({
        by: ["assigneeMembershipId"],
        where: {
          assigneeMembershipId: { in: candidates.map((c) => c.membershipId) },
          status: { in: ["open", "pending"] },
        },
        _count: { _all: true },
      }).catch(() => [] as any[]);
      const loadByMember = new Map<string, number>();
      for (const r of active) if (r.assigneeMembershipId) loadByMember.set(r.assigneeMembershipId, r._count._all);
      // filtra quem ainda cabe + ordena por menor carga
      const ranked = candidates
        .map((c) => ({ id: c.membershipId, load: loadByMember.get(c.membershipId) ?? 0, max: c.maxConcurrent }))
        .filter((r) => r.load < r.max)
        .sort((a, b) => a.load - b.load);
      return ranked[0]?.id ?? null;
    });
  }

  /**
   * Substitui {{variaveis}} no texto usando o contexto da conversa:
   * cliente.*, empresa.*, loja.*, operador.*. Variável não encontrada vira "".
   */
  async interpolateForConversation(ctx: RequestContext, conversationId: string, body: string): Promise<string> {
    if (!body || !body.includes("{{")) return body;
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.findFirst({ where: { id: conversationId } }),
    );
    if (!conv) return body;
    const [customer, org, store, agent] = await Promise.all([
      conv.customerId ? this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.customer.findUnique({ where: { id: conv.customerId! }, select: { name: true, document: true, phone: true, email: true, birthDate: true } })) : Promise.resolve(null),
      this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findUnique({ where: { id: ctx.orgId ?? "__none__" }, select: { name: true, slug: true, document: true } })),
      conv.inboxId ? this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.inbox.findUnique({ where: { id: conv.inboxId! }, select: { storeId: true } })).then((i) => i?.storeId ? this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.store.findUnique({ where: { id: i.storeId! }, select: { name: true } })) : null) : Promise.resolve(null),
      ctx.userId ? this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.user.findUnique({ where: { id: ctx.userId! }, select: { name: true } })) : Promise.resolve(null),
    ]).catch(() => [null, null, null, null] as const);
    const firstName = (name: string | null | undefined) => (name ?? "").split(" ")[0] ?? "";
    const fmtDate = (d: Date | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR") : "");
    const vars: Record<string, string> = {
      "cliente.nome": customer?.name ?? conv.contactName ?? "",
      "cliente.primeiro_nome": firstName(customer?.name ?? conv.contactName),
      "cliente.cpf": customer?.document ?? "",
      "cliente.telefone": customer?.phone ?? conv.contactPhone ?? "",
      "cliente.email": customer?.email ?? "",
      "cliente.nascimento": fmtDate(customer?.birthDate),
      "empresa.nome": org?.name ?? "",
      "empresa.documento": org?.document ?? "",
      "loja.nome": store?.name ?? "",
      "operador.nome": agent?.name ?? "",
      "operador.primeiro_nome": firstName(agent?.name),
    };
    return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => vars[key] ?? "");
  }

  /** Marca conversa como NÃO LIDA pelo agente (zera leitura). Volta pra fila visual. */
  async markUnread(ctx: RequestContext, conversationId: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.update({ where: { id: conversationId }, data: { unreadAgent: { increment: 1 } } }),
    );
  }

  /**
   * Ações em lote sobre várias conversas. action: assign | resolve | label | transfer.
   * Ignora conversas que não cabem na permissão (RLS faz o filtro).
   */
  async bulkAction(ctx: RequestContext, input: { ids: string[]; action: string; assigneeMembershipId?: string | null; teamId?: string | null; labelId?: string; remove?: boolean }) {
    if (!input.ids?.length) return { affected: 0 };
    const ids = input.ids.slice(0, 200);
    let affected = 0;
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      if (input.action === "assign") {
        const r = await tx.conversation.updateMany({
          where: { id: { in: ids } },
          data: { assigneeMembershipId: input.assigneeMembershipId ?? null, botActive: false },
        });
        affected = r.count;
      } else if (input.action === "transfer") {
        const r = await tx.conversation.updateMany({
          where: { id: { in: ids } },
          data: { teamId: input.teamId ?? null, assigneeMembershipId: null, status: "pending", botActive: false },
        });
        affected = r.count;
      } else if (input.action === "resolve") {
        const r = await tx.conversation.updateMany({
          where: { id: { in: ids } },
          data: { status: "resolved", resolvedAt: new Date(), assigneeMembershipId: null, teamId: null, botActive: false },
        });
        affected = r.count;
      } else if (input.action === "label" && input.labelId) {
        // tabela de junção é conversation_label_links (precisa orgId)
        if (input.remove) {
          const r = await tx.conversationLabelLink.deleteMany({ where: { conversationId: { in: ids }, labelId: input.labelId } });
          affected = r.count;
        } else {
          // pega orgId de cada conversa pra preencher o link
          const convs = await tx.conversation.findMany({ where: { id: { in: ids } }, select: { id: true, organizationId: true } });
          const r = await tx.conversationLabelLink.createMany({
            data: convs.map((c) => ({ organizationId: c.organizationId, conversationId: c.id, labelId: input.labelId! })),
            skipDuplicates: true,
          });
          affected = r.count;
        }
      } else {
        throw new AppError(ErrorCode.ValidationFailed, `Ação inválida: ${input.action}`, 400);
      }
    });
    return { affected };
  }

  /** Lista respostas visíveis ao operador: globais + compartilhadas + as PRIVADAS dele. */
  async listCanned(ctx: RequestContext) {
    const mid = ctx.membershipId ?? null;
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.cannedResponse.findMany({
        where: {
          isActive: true,
          OR: [{ scope: { in: ["global", "shared"] } }, { scope: "private", ownerMembershipId: mid ?? "__none__" }],
        },
        orderBy: [{ scope: "asc" }, { shortcut: "asc" }],
      }),
    );
    return rows.map((r) => ({ ...r, mine: r.ownerMembershipId != null && r.ownerMembershipId === mid }));
  }
  async upsertCanned(ctx: RequestContext, input: { id?: string; shortcut: string; title?: string; body: string; scope?: "private" | "shared" | "global" }) {
    const orgId = this.orgId(ctx);
    const scope = input.scope ?? "global";
    // global só admin cria/edita; private/shared ficam atreladas ao operador
    if (scope === "global" && !ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas administradores criam respostas globais", 403);
    }
    const owner = scope === "global" ? null : (ctx.membershipId ?? null);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      if (input.id) {
        const cur = await tx.cannedResponse.findFirst({ where: { id: input.id } });
        if (!cur) throw new AppError(ErrorCode.NotFound, "Resposta não encontrada", 404);
        // privadas só o dono edita; globais/compartilhadas exigem admin (exceto o dono da compartilhada)
        const isOwner = cur.ownerMembershipId != null && cur.ownerMembershipId === ctx.membershipId;
        if (!isOwner && !ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem permissão para editar", 403);
        return tx.cannedResponse.update({ where: { id: input.id }, data: { shortcut: input.shortcut, title: input.title ?? null, body: input.body, scope, ownerMembershipId: owner } });
      }
      return tx.cannedResponse.create({ data: { organizationId: orgId, shortcut: input.shortcut, title: input.title ?? null, body: input.body, scope, ownerMembershipId: owner } });
    });
  }
  async deleteCanned(ctx: RequestContext, id: string) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const cur = await tx.cannedResponse.findFirst({ where: { id } });
      if (!cur) return { ok: true };
      const isOwner = cur.ownerMembershipId != null && cur.ownerMembershipId === ctx.membershipId;
      if (!isOwner && !ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem permissão para excluir", 403);
      await tx.cannedResponse.update({ where: { id }, data: { isActive: false } });
      return { ok: true };
    });
  }

  // ============================== CONVERSAS ==============================
  /** Renomeia o contato/cliente da conversa. Operador usa pra corrigir
   *  nomes errados que o WhatsApp puxou (pushName genérico ou nome de
   *  empresa). A IA também chama isso quando o cliente diz "meu nome é X"
   *  na conversa. Sanitiza pra max 80 chars, trim. */
  async renameContact(ctx: RequestContext, conversationId: string, name: string) {
    const orgId = this.orgId(ctx);
    const trimmed = (name || "").trim().slice(0, 80);
    if (trimmed.length < 2) throw new AppError(ErrorCode.ValidationFailed, "Nome inválido (mínimo 2 caracteres)", 400);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id: conversationId }, select: { id: true, customerId: true, contactName: true } }));
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.conversation.update({ where: { id: conversationId }, data: { contactName: trimmed } });
      if (conv.customerId) {
        // Também atualiza o Customer linkado pra refletir em toda a base
        await tx.customer.update({ where: { id: conv.customerId }, data: { name: trimmed } }).catch(() => undefined);
      }
    });
    // Nota de sistema visível no painel pra auditoria (quem renomeou)
    const agent = await this.agentName(ctx);
    await this.systemNote(orgId, conversationId, `Nome do contato alterado de "${conv.contactName ?? "—"}" para "${trimmed}" por ${agent.full ?? "operador"}.`).catch(() => undefined);
    return { ok: true, name: trimmed };
  }

  async listConversations(ctx: RequestContext, f: { inboxId?: string; status?: string; assignee?: string; q?: string; dateFrom?: string; dateTo?: string }) {
    // Auto-revive de conversas snoozed cujo prazo expirou: volta pra "open"
    // antes de listar. Inline (sem cron). Dispara unreadAgent++ pra o operador
    // perceber que voltou. Idempotente: só pega quem ainda está como snoozed.
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.updateMany({
        where: { status: "snoozed", snoozedUntil: { lte: new Date() } },
        data: { status: "open", snoozedUntil: null, unreadAgent: { increment: 1 } },
      }),
    ).catch(() => undefined);
    const where: any = {};
    if (f.inboxId) where.inboxId = f.inboxId;
    // status sintéticos pras abas do front:
    // - "bot": IA tocando a conversa
    // - "mine": conversas atribuídas a ESTE operador (open ou pending)
    // - "waiting": bot já encerrou ou nunca pegou, sem assignee, sem team
    //              — conversa órfã esperando alguém pegar
    // - "open" / "pending" / "resolved": status reais do banco
    // - "all": tudo (menos resolvidas)
    if (f.status === "bot") {
      where.botActive = true;
      where.status = { not: "resolved" };
    } else if (f.status === "mine") {
      // do operador logado
      where.assigneeMembershipId = ctx.membershipId ?? "__none__";
      where.status = { not: "resolved" };
    } else if (f.status === "waiting") {
      // sem assignee, sem team, sem bot, não resolvida — ninguém está cuidando
      where.assigneeMembershipId = null;
      where.teamId = null;
      where.botActive = false;
      where.status = { not: "resolved" };
    } else if (f.status === "snoozed") {
      // adiadas (ver depois) — só as que ainda estão dentro do prazo
      where.status = "snoozed";
    } else if (f.status && f.status !== "all") {
      where.status = f.status;
    } else {
      where.status = { not: "resolved" };
    }
    if (f.assignee) where.assigneeMembershipId = f.assignee;
    if (f.q) where.OR = [{ contactName: { contains: f.q, mode: "insensitive" } }, { contactPhone: { contains: f.q } }, { subject: { contains: f.q, mode: "insensitive" } }];
    // Filtro por DATA (operador busca conversas antigas). Usa lastMessageAt
    // pra refletir "quando a conversa estava ativa". from inclusivo, to expande
    // pro fim do dia (T23:59:59Z) pra incluir conversas do próprio dia.
    if (f.dateFrom || f.dateTo) {
      const range: any = {};
      if (f.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(f.dateFrom)) range.gte = new Date(`${f.dateFrom}T00:00:00Z`);
      if (f.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(f.dateTo)) range.lte = new Date(`${f.dateTo}T23:59:59Z`);
      if (range.gte || range.lte) where.lastMessageAt = range;
    }
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.findMany({
        where, orderBy: { lastMessageAt: "desc" }, take: 200,
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, labels: { include: { label: true } }, _count: { select: { messages: true } } },
      }),
    );
    const named = await this.attachNames(rows);
    return named.map((r: any) => ({ ...r, messageCount: r._count?.messages ?? 0 }));
  }

  /** Contadores pros badges das abas:
   *   open: conversas abertas (com operador ou em fila)
   *   pendingReplied: pendentes que o cliente respondeu (unread>0)
   *   newBoxes: caixas novas — abertas, sem responsável, com não-lidas
   *   bot: em conversa com a IA
   *   mine: atribuídas ao operador logado (não resolvidas)
   *   waiting: órfãs — sem assignee, sem team, sem bot (caíram entre cadeiras)
   */
  async getCounts(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const [open, pendingReplied, newBoxes, bot, mine, waiting] = await Promise.all([
        tx.conversation.count({ where: { status: "open" } }),
        tx.conversation.count({ where: { status: "pending", unreadAgent: { gt: 0 } } }),
        tx.conversation.count({ where: { status: "open", assigneeMembershipId: null, teamId: null, botActive: false, unreadAgent: { gt: 0 } } }),
        tx.conversation.count({ where: { status: { not: "resolved" }, botActive: true } }),
        ctx.membershipId ? tx.conversation.count({ where: { assigneeMembershipId: ctx.membershipId, status: { not: "resolved" } } }) : Promise.resolve(0),
        tx.conversation.count({ where: { assigneeMembershipId: null, teamId: null, botActive: false, status: { not: "resolved" } } }),
      ]);
      return { open, pendingReplied, newBoxes, bot, mine, waiting };
    });
  }

  /** anexa nome do responsável e da equipe (assigneeMembershipId/teamId são scalars). */
  private async attachNames<T extends { assigneeMembershipId: string | null; teamId: string | null }>(rows: T[]): Promise<Array<T & { assigneeName: string | null; teamName: string | null }>> {
    const mIds = [...new Set(rows.map((r) => r.assigneeMembershipId).filter(Boolean))] as string[];
    const tIds = [...new Set(rows.map((r) => r.teamId).filter(Boolean))] as string[];
    const mMap = new Map<string, string>();
    const tMap = new Map<string, string>();
    if (mIds.length) {
      const ms = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.membership.findMany({ where: { id: { in: mIds } }, select: { id: true, user: { select: { name: true } } } }));
      for (const m of ms) mMap.set(m.id, m.user?.name ?? "");
    }
    if (tIds.length) {
      const ts = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.helpdeskTeam.findMany({ where: { id: { in: tIds } }, select: { id: true, name: true } }));
      for (const t of ts) tMap.set(t.id, t.name);
    }
    return rows.map((r) => ({ ...r, assigneeName: r.assigneeMembershipId ? mMap.get(r.assigneeMembershipId) ?? null : null, teamName: r.teamId ? tMap.get(r.teamId) ?? null : null }));
  }

  async getConversation(ctx: RequestContext, id: string) {
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.findFirst({
        where: { id },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 500 }, labels: { include: { label: true } } },
      }),
    );
    if (!c) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    // zera não-lidas do agente ao abrir
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id }, data: { unreadAgent: 0 } })).catch(() => undefined);
    const [withNames] = await this.attachNames([c]);
    if (withNames) {
      (withNames as any).tokenHash = undefined; // não vaza o hash
      // trava de atendimento: 1 operador por conversa. Admin sempre pode.
      const mine = !!c.assigneeMembershipId && c.assigneeMembershipId === ctx.membershipId;
      const lockedByOther = !!c.assigneeMembershipId && !mine && !ctx.isOrgAdmin && !ctx.isPlatformAdmin;
      (withNames as any).assignedToMe = mine;
      (withNames as any).lockedByOther = lockedByOther;
      // aviso: agendamento pendente de confirmação do cliente
      let pendingAppointment: { id: string; startsAt: Date; serviceName: string | null } | null = null;
      if (c.customerId) {
        pendingAppointment = await this.pa((tx) =>
          tx.appointment.findFirst({ where: { customerId: c.customerId!, deletedAt: null, status: "pending", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, serviceName: true } }),
        ).catch(() => null);
      }
      (withNames as any).pendingAppointment = pendingAppointment;
    }
    return withNames;
  }

  /** Agente responde: grava out + despacha pelo canal. */
  async sendMessage(ctx: RequestContext, conversationId: string, input: { body: string; isPrivate?: boolean; contentType?: string; mediaUrl?: string | null; mediaMime?: string | null }) {
    const orgId = this.orgId(ctx);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    // trava: só o responsável (ou admin) responde — evita 2 operadores no mesmo número
    if (conv.assigneeMembershipId && conv.assigneeMembershipId !== ctx.membershipId && !ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Conflict, "Conversa em atendimento por outro operador.", 409);
    }

    const agent = await this.agentName(ctx);
    // resolve variáveis chaveadas das respostas rápidas
    const body = this.resolvePlaceholders(input.body, { cliente: conv.contactName, operador: agent.first ?? agent.full });
    const msg = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversationMessage.create({
        data: {
          organizationId: orgId, conversationId, direction: "out", authorType: "agent",
          authorMembershipId: ctx.membershipId ?? null, authorName: agent.full,
          content: body, contentType: input.contentType ?? "text",
          mediaUrl: input.mediaUrl ?? null, mediaMime: input.mediaMime ?? null,
          isPrivate: !!input.isPrivate, status: "sent",
        },
      }),
    );
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), firstResponseAt: conv.firstResponseAt ?? new Date(), status: conv.status === "resolved" ? "open" : conv.status, botActive: false },
      }),
    );
    // despacha (notas internas não saem pro cliente). Prefixa o nome amigável do
    // atendente: o cliente recebe "*Yuri*\nmensagem".
    if (!input.isPrivate) {
      const prefixed = agent.first ? `*${agent.first}*\n${body}` : body;
      await this.dispatch(conv, prefixed, input.mediaUrl ?? null, input.mediaMime ?? null).catch((e) => this.logger.error(`dispatch: ${e?.message}`));
    }
    // webhook out (best-effort) — mensagem do operador
    void this.fireWebhookEvent(orgId, "message.created", { conversationId, direction: "out", content: body, contentType: input.contentType ?? "text", agentName: agent.full, isPrivate: !!input.isPrivate });
    // menções @nome em NOTAS internas — notifica os mencionados por Web Push
    if (input.isPrivate) {
      void this.notifyMentions(orgId, conversationId, body, agent.full ?? "Operador");
    }
    return msg;
  }

  /**
   * Detecta @nome no corpo de uma nota interna e dispara Web Push pra cada
   * operador mencionado. Match por primeiro nome case-insensitive (igual a
   * exibição no autocomplete). Best-effort: erro não derruba envio.
   */
  private async notifyMentions(orgId: string, conversationId: string, body: string, fromName: string): Promise<void> {
    try {
      const mentions = [...new Set([...body.matchAll(/@([\p{L}][\p{L}0-9_]*)/gu)].map((m) => (m[1] ?? "").toLowerCase()).filter(Boolean))];
      if (!mentions.length) return;
      const memberships = await this.pa((tx) =>
        tx.membership.findMany({
          where: { organizationId: orgId, status: "active" },
          select: { id: true, userId: true, user: { select: { name: true } } },
        }),
      );
      const targets = memberships.filter((m) => {
        const first = (m.user?.name ?? "").split(" ")[0]?.toLowerCase() ?? "";
        return first && mentions.includes(first);
      });
      if (!targets.length) return;
      const subs = await this.pa((tx) =>
        tx.voipPushSubscription.findMany({ where: { membershipId: { in: targets.map((t) => t.id) } } }),
      );
      if (!subs.length) return;
      // payload pro service worker mostrar como notificação clicável
      const payload = JSON.stringify({
        type: "mention",
        title: `${fromName} mencionou você`,
        body: body.length > 120 ? body.slice(0, 117) + "…" : body,
        url: `/app/atendimento?open=${conversationId}`,
      });
      const webpush = (await import("web-push")).default;
      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 600 } as any,
          );
        } catch (e: any) {
          const code = e?.statusCode ?? 0;
          if (code === 404 || code === 410) {
            await this.pa((tx) => tx.voipPushSubscription.delete({ where: { endpoint: s.endpoint } })).catch(() => undefined);
          }
        }
      }));
    } catch (e: any) {
      this.logger.warn(`notifyMentions falhou: ${e?.message ?? e}`);
    }
  }

  /** Lista operadores da org pra autocomplete de @menção. */
  async listMentionables(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.membership.findMany({
        where: { status: "active" },
        select: { id: true, user: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
    ).then((rows) =>
      rows
        .filter((r) => r.user?.name)
        .map((r) => ({ membershipId: r.id, fullName: r.user!.name, firstName: r.user!.name.split(" ")[0] ?? r.user!.name })),
    );
  }

  /** Resolve variáveis chaveadas das respostas rápidas: {{cliente}} {{operador}}
   *  {{saudacao}} (bom dia/tarde/noite) {{data}} {{hora}}. */
  private resolvePlaceholders(text: string, v: { cliente?: string | null; operador?: string | null }): string {
    const h = new Date().getHours();
    const saud = h < 12 ? "bom dia" : h < 18 ? "boa tarde" : "boa noite";
    const now = new Date();
    return (text ?? "")
      .replace(/\{\{\s*cliente\s*\}\}/gi, (v.cliente ?? "").split(" ")[0] || "")
      .replace(/\{\{\s*operador\s*\}\}/gi, v.operador ?? "")
      .replace(/\{\{\s*saudacao\s*\}\}/gi, saud)
      .replace(/\{\{\s*data\s*\}\}/gi, now.toLocaleDateString("pt-BR"))
      .replace(/\{\{\s*hora\s*\}\}/gi, now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  }

  /** Nome do agente logado (completo + primeiro nome amigável). Usa o nome de
   *  exibição do call center (membership.inboxDisplayName) se configurado. */
  private async agentName(ctx: RequestContext): Promise<{ full: string | null; first: string | null }> {
    if (!ctx.userId) return { full: null, first: null };
    let display: string | null = null;
    if (ctx.membershipId) {
      const m = await this.pa((tx) => tx.membership.findFirst({ where: { id: ctx.membershipId! }, select: { inboxDisplayName: true } })).catch(() => null);
      display = m?.inboxDisplayName ?? null;
    }
    if (!display) {
      const u = await this.pa((tx) => tx.user.findFirst({ where: { id: ctx.userId! }, select: { name: true } }));
      display = u?.name ?? null;
    }
    const full = display;
    return { full, first: full ? (full.split(" ")[0] ?? full) : null };
  }

  /** Mensagem de sistema na conversa (ex.: "Yuri pegou o atendimento"). */
  private async systemNote(orgId: string, conversationId: string, text: string) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.conversationMessage.create({ data: { organizationId: orgId, conversationId, direction: "out", authorType: "system", content: text, contentType: "event", isPrivate: true, status: "sent" } }),
    );
  }

  async assign(ctx: RequestContext, id: string, membershipId: string | null) {
    const orgId = this.orgId(ctx);
    const resolved = membershipId === "me" ? (ctx.membershipId ?? null) : membershipId;
    const cur = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id }, select: { assigneeMembershipId: true } }));
    if (!cur) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    // "pegar": só claim se estiver livre (ou já for minha). Admin pode reatribuir.
    if (cur.assigneeMembershipId && cur.assigneeMembershipId !== resolved && cur.assigneeMembershipId !== ctx.membershipId && !ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Conflict, "Conversa já está em atendimento por outro operador.", 409);
    }
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id }, data: { assigneeMembershipId: resolved, teamId: null, botActive: false } }));
    const agent = await this.agentName(ctx);
    await this.systemNote(orgId, id, `${agent.full ?? "Atendente"} pegou o atendimento.`).catch(() => undefined);
    return r;
  }

  /** Transfere para uma PESSOA (atribui) ou para um TIME (fica pendente até alguém pegar). */
  async transfer(ctx: RequestContext, id: string, body: { toMembershipId?: string | null; toTeamId?: string | null }) {
    const orgId = this.orgId(ctx);
    const agent = await this.agentName(ctx);
    if (body.toMembershipId) {
      const target = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.membership.findFirst({ where: { id: body.toMembershipId! }, select: { user: { select: { name: true } } } }),
      );
      const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id }, data: { assigneeMembershipId: body.toMembershipId, teamId: null, botActive: false } }));
      await this.systemNote(orgId, id, `${agent.full ?? "Atendente"} transferiu para ${target?.user?.name ?? "um atendente"}.`).catch(() => undefined);
      return r;
    }
    if (body.toTeamId) {
      const team = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.helpdeskTeam.findFirst({ where: { id: body.toTeamId! }, select: { name: true } }));
      // time: limpa o responsável → fica pendente; cai pra quem pegar primeiro
      const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id }, data: { teamId: body.toTeamId, assigneeMembershipId: null, status: "pending", botActive: false } }));
      await this.systemNote(orgId, id, `${agent.full ?? "Atendente"} transferiu para a equipe ${team?.name ?? ""} (aguardando atendente).`).catch(() => undefined);
      return r;
    }
    throw new AppError(ErrorCode.ValidationFailed, "Informe pessoa ou equipe", 400);
  }

  /** Agentes da org (pra atribuir/transferir). */
  async listAgents(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.membership.findMany({ where: { organizationId: orgId, status: "active" }, select: { id: true, user: { select: { name: true } } } }),
    );
    return rows.map((r) => ({ membershipId: r.id, name: r.user?.name ?? "—" }));
  }
  /** Equipes (reusa helpdesk_teams). */
  async listTeams(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.helpdeskTeam.findMany({ where: { isActive: true }, select: { id: true, name: true } }));
  }

  // ============================== CONFIG DO CALL CENTER ==============================
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas administradores", 403);
  }

  /** SLA + bot da org (cria default se não existir). */
  async getSettings(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.callCenterSettings.findFirst({ where: { organizationId: orgId } }));
    const hasAi = await this.orgAi.hasProvider(orgId).catch(() => false);
    return {
      slaCustomerMin: s?.slaCustomerMin ?? 10, slaAgentMin: s?.slaAgentMin ?? 2,
      botEnabled: s?.botEnabled ?? false, botInstructions: s?.botInstructions ?? "", hasAi,
      // queuePositionEnabled: default true (mantém comportamento histórico). Se a
      // migration 187 ainda não rodou, o select silenciosamente devolve undefined
      // e o ?? true cobre.
      queuePositionEnabled: (s as any)?.queuePositionEnabled ?? true,
      // Auto-resolução silenciosa (0 = desligado, > 0 = horas até resolver)
      autoResolveHours: (s as any)?.autoResolveHours ?? 0,
      // Agenda: hora mínima que a IA oferece (default 7) + janelas de chegada
      aiMinBookingHour: (s as any)?.aiMinBookingHour ?? 7,
      examArrivalWindows: Array.isArray((s as any)?.examArrivalWindows) ? (s as any).examArrivalWindows : [],
      // Estágios opcionais do kanban de produção (gráfica). Default false.
      productionStampEnabled: (s as any)?.productionStampEnabled ?? false,
      productionPackagingEnabled: (s as any)?.productionPackagingEnabled ?? false,
      graficaPixKey: s?.graficaPixKey ?? "", graficaSizeChart: s?.graficaSizeChart ?? "",
      graficaSizeChartUrl: s?.graficaSizeChartUrl ?? "", graficaLeadDays: s?.graficaLeadDays ?? 7,
      graficaDownPaymentPct: s?.graficaDownPaymentPct ?? 50,
      graficaMaxOperatorDiscountPct: s?.graficaMaxOperatorDiscountPct != null ? Number(s.graficaMaxOperatorDiscountPct) : 0,
    };
  }
  async updateSettings(ctx: RequestContext, input: { slaCustomerMin?: number; slaAgentMin?: number; botEnabled?: boolean; botInstructions?: string; queuePositionEnabled?: boolean; autoResolveHours?: number; aiMinBookingHour?: number; examArrivalWindows?: string[]; productionStampEnabled?: boolean; productionPackagingEnabled?: boolean; graficaPixKey?: string; graficaSizeChart?: string; graficaSizeChartUrl?: string; graficaLeadDays?: number; graficaDownPaymentPct?: number; graficaMaxOperatorDiscountPct?: number }) {
    this.requireAdmin(ctx);
    const orgId = this.orgId(ctx);
    const cust = Math.max(1, Math.min(240, Math.round(input.slaCustomerMin ?? 10)));
    const agent = Math.max(1, Math.min(120, Math.round(input.slaAgentMin ?? 2)));
    const botEnabled = input.botEnabled ?? false;
    // Limite generoso (50k chars) pra acomodar prompts elaborados — antes era
    // 4000 e cortava prompts médios. O modelo Postgres é TEXT (sem limite),
    // então só limitamos pra evitar payload absurdo via API. Prompts típicos
    // de gráfica/ótica ficam entre 5k–15k caracteres.
    const botInstructions = (input.botInstructions ?? "").slice(0, 50000) || null;
    // config do nicho gráfica (só sobrescreve o que veio no input — undefined mantém)
    const grafica: any = {};
    if (input.graficaPixKey !== undefined) grafica.graficaPixKey = (input.graficaPixKey || "").slice(0, 200) || null;
    if (input.graficaSizeChart !== undefined) grafica.graficaSizeChart = (input.graficaSizeChart || "").slice(0, 4000) || null;
    if (input.graficaSizeChartUrl !== undefined) grafica.graficaSizeChartUrl = (input.graficaSizeChartUrl || "").slice(0, 500) || null;
    if (input.graficaLeadDays !== undefined) grafica.graficaLeadDays = Math.max(0, Math.min(180, Math.round(input.graficaLeadDays)));
    if (input.graficaDownPaymentPct !== undefined) grafica.graficaDownPaymentPct = Math.max(0, Math.min(100, Math.round(input.graficaDownPaymentPct)));
    if (input.graficaMaxOperatorDiscountPct !== undefined) {
      const v = Number(input.graficaMaxOperatorDiscountPct);
      grafica.graficaMaxOperatorDiscountPct = Math.max(0, Math.min(100, isFinite(v) ? Math.round(v * 100) / 100 : 0));
    }
    // queuePositionEnabled (toggle do aviso "Você está na fila — posição N").
    // Só envia ao banco se veio no input; assim o front pode salvar partes
    // diferentes do form sem zerar essa flag.
    const extra: any = {};
    if (input.queuePositionEnabled !== undefined) extra.queuePositionEnabled = !!input.queuePositionEnabled;
    // 0 desliga; cap em 720h (30 dias) pra evitar fora-do-mundo
    if (input.autoResolveHours !== undefined) extra.autoResolveHours = Math.max(0, Math.min(720, Math.floor(Number(input.autoResolveHours) || 0)));
    if (input.aiMinBookingHour !== undefined) extra.aiMinBookingHour = Math.max(0, Math.min(23, Math.floor(Number(input.aiMinBookingHour) || 0)));
    if (input.examArrivalWindows !== undefined) {
      // Sanitiza: só "HH:MM" válidos, ordenados, no máx 12 janelas. Vazio = limpa (usa default).
      const clean = (Array.isArray(input.examArrivalWindows) ? input.examArrivalWindows : [])
        .map((w) => String(w).trim())
        .filter((w) => /^\d{1,2}:\d{2}$/.test(w))
        .map((w) => { const [h, m] = w.split(":"); return `${String(Math.min(23, Number(h))).padStart(2, "0")}:${String(Math.min(59, Number(m))).padStart(2, "0")}`; })
        .sort()
        .slice(0, 12);
      extra.examArrivalWindows = clean.length ? clean : null;
    }
    if (input.productionStampEnabled !== undefined) extra.productionStampEnabled = !!input.productionStampEnabled;
    if (input.productionPackagingEnabled !== undefined) extra.productionPackagingEnabled = !!input.productionPackagingEnabled;
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const ex = await tx.callCenterSettings.findFirst({ where: { organizationId: orgId } });
      const data = { slaCustomerMin: cust, slaAgentMin: agent, botEnabled, botInstructions, ...grafica, ...extra };
      if (ex) await tx.callCenterSettings.update({ where: { id: ex.id }, data });
      else await tx.callCenterSettings.create({ data: { organizationId: orgId, ...data } });
      // liga/desliga o bot nas inboxes de WhatsApp da empresa
      await tx.inbox.updateMany({ where: { channel: "whatsapp" }, data: { botEnabled } });
    });
    return this.getSettings(ctx);
  }

  /** Nome de exibição do operador (o que o cliente vê). Cada operador edita o seu. */
  async getMyDisplayName(ctx: RequestContext) {
    if (!ctx.membershipId) return { displayName: null, userName: null };
    const m = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findFirst({ where: { id: ctx.membershipId! }, select: { inboxDisplayName: true, user: { select: { name: true } } } }));
    return { displayName: m?.inboxDisplayName ?? null, userName: m?.user?.name ?? null };
  }
  async setMyDisplayName(ctx: RequestContext, name: string) {
    if (!ctx.membershipId) throw new AppError(ErrorCode.Forbidden, "Sem operador", 403);
    const v = (name ?? "").trim().slice(0, 60) || null;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.update({ where: { id: ctx.membershipId! }, data: { inboxDisplayName: v } }));
    return { displayName: v };
  }

  /** Equipes com membros (pra a config). */
  async listTeamsDetailed(ctx: RequestContext) {
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.helpdeskTeam.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { members: { select: { membershipId: true } } } }));
    return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, memberMembershipIds: t.members.map((m) => m.membershipId) }));
  }
  async upsertTeam(ctx: RequestContext, input: { id?: string; name: string; description?: string; memberMembershipIds?: string[] }) {
    this.requireAdmin(ctx);
    const orgId = this.orgId(ctx);
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Informe o nome da equipe", 400);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const team = input.id
        ? await tx.helpdeskTeam.update({ where: { id: input.id }, data: { name: input.name.trim(), description: input.description ?? null } })
        : await tx.helpdeskTeam.create({ data: { organizationId: orgId, name: input.name.trim(), description: input.description ?? null } });
      if (input.memberMembershipIds) {
        await tx.helpdeskTeamMember.deleteMany({ where: { teamId: team.id } });
        for (const m of input.memberMembershipIds) await tx.helpdeskTeamMember.create({ data: { organizationId: orgId, teamId: team.id, membershipId: m } });
      }
      return { id: team.id };
    });
  }
  async deleteTeam(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.helpdeskTeam.update({ where: { id }, data: { isActive: false } }));
    return { ok: true };
  }

  /** Agentes habilitados por inbox (pra a config). */
  async getInboxAgents(ctx: RequestContext, inboxId: string) {
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxAgent.findMany({ where: { inboxId }, select: { membershipId: true } }));
    return rows.map((r) => r.membershipId);
  }

  // ============================== CONVERSA INTERNA (entre atendentes) ==============================
  /** Lista os colegas da org + nº de mensagens internas não lidas de cada um. */
  async listInternalPeers(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const me = ctx.membershipId ?? null;
    const members = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.membership.findMany({ where: { organizationId: orgId, status: "active" }, select: { id: true, inboxDisplayName: true, user: { select: { name: true } } } }),
    );
    let unreadBy = new Map<string, number>();
    if (me) {
      const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.internalMessage.groupBy({ by: ["fromMembershipId"], where: { toMembershipId: me, readAt: null }, _count: { _all: true } } as any),
      ).catch(() => [] as any[]);
      for (const r of rows as any[]) unreadBy.set(r.fromMembershipId, r._count?._all ?? 0);
    }
    return members
      .filter((m) => m.id !== me)
      .map((m) => ({ membershipId: m.id, name: m.inboxDisplayName || m.user?.name || "—", unread: unreadBy.get(m.id) ?? 0 }))
      .sort((a, b) => b.unread - a.unread || a.name.localeCompare(b.name));
  }

  /** Histórico 1:1 com um colega; marca como lidas as que ele me mandou. */
  async listInternalThread(ctx: RequestContext, peerMembershipId: string) {
    const me = ctx.membershipId;
    if (!me) throw new AppError(ErrorCode.Forbidden, "Sem operador", 403);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.internalMessage.findMany({
        where: { OR: [{ fromMembershipId: me, toMembershipId: peerMembershipId }, { fromMembershipId: peerMembershipId, toMembershipId: me }] },
        orderBy: { createdAt: "asc" }, take: 500,
      }),
    );
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.internalMessage.updateMany({ where: { fromMembershipId: peerMembershipId, toMembershipId: me, readAt: null }, data: { readAt: new Date() } }),
    ).catch(() => undefined);
    return rows.map((r) => ({ id: r.id, mine: r.fromMembershipId === me, body: r.body, createdAt: r.createdAt }));
  }

  async sendInternal(ctx: RequestContext, toMembershipId: string, body: string) {
    const orgId = this.orgId(ctx);
    const me = ctx.membershipId;
    if (!me) throw new AppError(ErrorCode.Forbidden, "Sem operador", 403);
    if (!body?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Mensagem vazia", 400);
    if (toMembershipId === me) throw new AppError(ErrorCode.ValidationFailed, "Escolha outro atendente", 400);
    const msg = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.internalMessage.create({ data: { organizationId: orgId, fromMembershipId: me, toMembershipId, body: body.trim() } }),
    );
    return { id: msg.id };
  }

  /** Total de mensagens internas não lidas (pra badge do botão). */
  async internalUnreadCount(ctx: RequestContext) {
    const me = ctx.membershipId;
    if (!me) return { count: 0 };
    const count = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.internalMessage.count({ where: { toMembershipId: me, readAt: null } }));
    return { count };
  }

  // ============================== TRANSCRIÇÃO POR E-MAIL ==============================
  /** Envia a transcrição do atendimento por e-mail (HTML com a marca da empresa).
   *  Notas internas NÃO entram. Usa o e-mail informado, ou o do cliente. */
  async emailTranscript(ctx: RequestContext, conversationId: string, toEmail?: string) {
    const orgId = this.orgId(ctx);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.findFirst({ where: { id: conversationId }, include: { messages: { orderBy: { createdAt: "asc" }, take: 1000 } } }),
    );
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    let email = (toEmail ?? "").trim() || conv.contactEmail || null;
    if (!email && conv.customerId) {
      const c = await this.pa((tx) => tx.customer.findFirst({ where: { id: conv.customerId! }, select: { email: true } })).catch(() => null);
      email = c?.email ?? null;
    }
    if (!email) throw new AppError(ErrorCode.ValidationFailed, "Sem e-mail de destino. Informe um e-mail.", 400);
    const org = await this.pa((tx) => tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true } })).catch(() => null);
    const html = this.buildTranscriptHtml(org, conv as any);
    await this.notifications.notify({
      organizationId: orgId, storeId: orgId, customerId: conv.customerId ?? null, email,
      subject: `Transcrição do atendimento${conv.protocol ? ` — ${conv.protocol}` : ""}`,
      text: "Segue a transcrição do seu atendimento conosco.", html, templateCode: "inbox_transcript",
    } as any);
    await this.systemNote(orgId, conversationId, `Transcrição enviada por e-mail para ${email}.`).catch(() => undefined);
    return { ok: true, email };
  }

  private buildTranscriptHtml(org: { name: string | null; logoUrl: string | null; primaryColor: string | null } | null, conv: { protocol: string | null; contactName: string | null; createdAt: Date; messages: Array<{ direction: string; authorType: string; authorName: string | null; content: string | null; contentType: string; mediaUrl: string | null; isPrivate: boolean; createdAt: Date }> }): string {
    const esc = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const brand = org?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(org.primaryColor) ? org.primaryColor : "#4f46e5";
    const rows = conv.messages
      .filter((m) => !m.isPrivate && m.authorType !== "system")
      .map((m) => {
        const out = m.direction === "out";
        const who = m.authorType === "bot" ? "🤖 Bot" : out ? esc(m.authorName || "Atendente") : esc(m.authorName || conv.contactName || "Cliente");
        const when = new Date(m.createdAt).toLocaleString("pt-BR");
        const media = m.mediaUrl ? `<div><a href="${esc(m.mediaUrl)}" style="color:${brand}">📎 anexo</a></div>` : "";
        const body = m.content ? esc(m.content).replace(/\n/g, "<br>") : (m.mediaUrl ? "" : "—");
        const align = out ? "right" : "left";
        const bg = out ? "#eef2ff" : "#f3f4f6";
        return `<tr><td style="padding:6px 0;text-align:${align}"><div style="display:inline-block;max-width:80%;background:${bg};border-radius:10px;padding:8px 12px;text-align:left"><div style="font-size:11px;color:#6b7280;margin-bottom:2px">${who} · ${when}</div><div style="font-size:14px;color:#111827">${body}${media}</div></div></td></tr>`;
      })
      .join("");
    const logo = org?.logoUrl ? `<img src="${esc(org.logoUrl)}" alt="" style="max-height:48px;max-width:160px;object-fit:contain">` : `<strong style="font-size:18px">${esc(org?.name ?? "Atendimento")}</strong>`;
    return `<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:640px;margin:0 auto;padding:24px">
        <div style="border-bottom:3px solid ${brand};padding-bottom:12px;margin-bottom:16px">${logo}
          <div style="font-size:13px;color:#6b7280;margin-top:6px">Transcrição do atendimento${conv.protocol ? ` · Protocolo ${esc(conv.protocol)}` : ""}</div>
        </div>
        <table style="width:100%;border-collapse:collapse">${rows || `<tr><td style="color:#6b7280">Sem mensagens.</td></tr>`}</table>
        <p style="font-size:11px;color:#9ca3af;margin-top:20px">Enviado por ${esc(org?.name ?? "")} · ${new Date().toLocaleString("pt-BR")}</p>
      </div></body></html>`;
  }
  async setStatus(ctx: RequestContext, id: string, status: string, reason?: string) {
    const orgId = this.orgId(ctx);
    if (status === "pending" && !(reason ?? "").trim()) {
      throw new AppError(ErrorCode.ValidationFailed, "Informe o motivo para deixar pendente", 400);
    }
    const data: any = { status };
    if (status === "resolved") {
      data.resolvedAt = new Date();
      // ao resolver, solta atendente/equipe: próximo contato entra livre (bot/qualquer agente)
      data.assigneeMembershipId = null; data.teamId = null; data.botActive = false;
      if (ctx.membershipId) data.closedByMembershipId = ctx.membershipId;
    }
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id }, data }));
    if (status === "pending") {
      const agent = await this.agentName(ctx);
      await this.systemNote(orgId, id, `${agent.full ?? "Atendente"} deixou pendente: ${reason!.trim()}`).catch(() => undefined);
    }
    if (status === "resolved" && ctx.membershipId) await this.pullFromQueue(orgId, ctx.membershipId).catch(() => undefined);
    return r;
  }

  // ============================== TOKEN (4 dígitos) ==============================
  private tokenHash(code: string): string {
    return createHmac("sha256", process.env.AUTH_CODE_SECRET ?? "yugo-auth").update(String(code)).digest("hex");
  }

  /** Operador solicita: gera o código, envia SÓ pro cliente (operador não vê). */
  async requestToken(ctx: RequestContext, conversationId: string) {
    const orgId = this.orgId(ctx);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    const code = String(Math.floor(1000 + Math.random() * 9000));
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.update({ where: { id: conversationId }, data: { tokenStatus: "pending", tokenHash: this.tokenHash(code), tokenExpiresAt: new Date(Date.now() + 15 * 60_000), tokenAttempts: 0, tokenValidatedAt: null } }),
    );
    // envia o código DIRETO ao cliente (não vira mensagem visível ao operador)
    await this.dispatch(conv as any, `🔐 Seu código de verificação é *${code}*.\nInforme ao atendente para confirmar sua identidade. Válido por 15 minutos.`).catch(() => undefined);
    // nota interna SEM o código
    await this.systemNote(orgId, conversationId, "Token de verificação enviado ao cliente. Peça o código e valide.").catch(() => undefined);
    return { ok: true, tokenStatus: "pending" };
  }

  /** Operador valida o código que o cliente informou. */
  async validateToken(ctx: RequestContext, conversationId: string, code: string) {
    const orgId = this.orgId(ctx);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    if (conv.tokenStatus !== "pending" || !conv.tokenHash) throw new AppError(ErrorCode.ValidationFailed, "Nenhum token pendente. Solicite primeiro.", 400);
    if (conv.tokenExpiresAt && conv.tokenExpiresAt.getTime() < Date.now()) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id: conversationId }, data: { tokenStatus: "failed" } }));
      throw new AppError(ErrorCode.ValidationFailed, "Token expirado. Solicite outro.", 400);
    }
    const expected = this.tokenHash(String(code).trim());
    const ok = expected.length === conv.tokenHash.length && timingSafeEqual(Buffer.from(expected), Buffer.from(conv.tokenHash));
    if (!ok) {
      const attempts = (conv.tokenAttempts ?? 0) + 1;
      const failed = attempts >= 5;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id: conversationId }, data: { tokenAttempts: attempts, tokenStatus: failed ? "failed" : "pending" } }));
      throw new AppError(ErrorCode.ValidationFailed, failed ? "Tentativas esgotadas." : "Código incorreto.", 400);
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.update({ where: { id: conversationId }, data: { tokenStatus: "validated", tokenValidatedAt: new Date(), tokenHash: null } }));
    await this.systemNote(orgId, conversationId, "✅ Identidade confirmada (token validado).").catch(() => undefined);
    return { ok: true, tokenStatus: "validated" };
  }

  // ============================== VENDER PELO CHAT ==============================
  async listOrders(ctx: RequestContext, conversationId: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxOrder.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 50 }),
    );
  }

  /** Cria a cobrança (Pix copia-e-cola ou link de cartão) e envia ao cliente. */
  async createOrder(ctx: RequestContext, conversationId: string, input: { items: Array<{ name: string; qty: number; unitCents: number }>; method: "pix" | "card" }) {
    const orgId = this.orgId(ctx);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    const items = (input.items ?? []).filter((i) => i.name && i.qty > 0 && i.unitCents >= 0);
    if (!items.length) throw new AppError(ErrorCode.ValidationFailed, "Adicione ao menos um produto", 400);
    const total = items.reduce((s, i) => s + i.qty * Math.round(i.unitCents), 0);

    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) throw new AppError(ErrorCode.ValidationFailed, "Mercado Pago não configurado", 400);
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);

    const orderNumber = "OP-" + this.genProtocol().slice(3);
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.inboxOrder.create({
        data: { organizationId: orgId, conversationId, customerId: conv.customerId ?? null, orderNumber, items: items as any, totalCents: BigInt(total), method: input.method, status: "pending", createdByMembershipId: ctx.membershipId ?? null },
      }),
    );

    let email = "sememail@yugochat.com.br";
    if (conv.customerId) {
      const c = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.customer.findFirst({ where: { id: conv.customerId! }, select: { email: true } }));
      if (c?.email) email = c.email;
    }
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const notifUrl = `https://${domain}/api/payments/webhooks/mercadopago/${orgId}`;
    const itemsTxt = items.map((i) => `• ${i.qty}x ${i.name} — ${brl(i.qty * i.unitCents)}`).join("\n");
    const header = `🛒 *Pedido ${orderNumber}*\n${itemsTxt}\n*Total: ${brl(total)}*`;

    if (input.method === "pix") {
      const r = await adapter.createPixPayment({ amountCents: total, description: `Pedido ${orderNumber}`, externalReference: order.id, payerEmail: email, notificationUrl: notifUrl });
      const qr = r.body?.point_of_interaction?.transaction_data;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.update({ where: { id: order.id }, data: { mpPaymentId: r.body?.id ? String(r.body.id) : null, mpQrCode: qr?.qr_code ?? null, mpQrBase64: qr?.qr_code_base64 ?? null } }));
      // 1ª msg: o pedido + instrução. 2ª msg: o Pix copia-e-cola PURO (fácil copiar)
      await this.dispatch(conv as any, `${header}\n\n💠 Pague com o Pix copia-e-cola enviado na próxima mensagem 👇`).catch(() => undefined);
      if (qr?.qr_code) await this.dispatch(conv as any, qr.qr_code).catch(() => undefined);
    } else {
      const r = await adapter.createCheckoutPreference({ amountCents: total, title: `Pedido ${orderNumber}`, externalReference: order.id, payerEmail: email, backUrl: `https://${domain}`, notificationUrl: notifUrl });
      const init = r.body?.init_point ?? null;
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.update({ where: { id: order.id }, data: { mpInitPoint: init } }));
      await this.dispatch(conv as any, `${header}\n\nPague com cartão neste link:\n${init ?? ""}`).catch(() => undefined);
    }
    await this.systemNote(orgId, conversationId, `Cobrança ${orderNumber} gerada (${brl(total)}) via ${input.method === "pix" ? "Pix" : "cartão"}.`).catch(() => undefined);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.findFirst({ where: { id: order.id } }));
  }

  /** Cancela/suspende uma cobrança pendente. */
  async cancelOrder(ctx: RequestContext, orderId: string) {
    const orgId = this.orgId(ctx);
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.findFirst({ where: { id: orderId } }));
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    if (order.status === "paid") throw new AppError(ErrorCode.Conflict, "Pedido já foi pago", 409);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.update({ where: { id: orderId }, data: { status: "canceled" } }));
    await this.systemNote(orgId, order.conversationId, `Cobrança ${order.orderNumber} cancelada.`).catch(() => undefined);
    return { ok: true };
  }

  /** Reconsulta o MP; se aprovou, marca pago + nota interna + avisa o cliente. */
  async checkOrder(ctx: RequestContext, orderId: string) {
    const orgId = this.orgId(ctx);
    const order = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.findFirst({ where: { id: orderId } }));
    if (!order) throw new AppError(ErrorCode.NotFound, "Pedido não encontrado", 404);
    if (order.status === "paid") return { status: "paid", orderNumber: order.orderNumber };
    const mp = await this.orgIntegrations.resolveMp(orgId);
    if (!mp) return { status: order.status };
    const adapter = new MercadoPagoOrgAdapter(mp.accessToken);
    let approved = false;
    let payId: string | null = order.mpPaymentId ?? null;
    if (order.method === "pix" && order.mpPaymentId) {
      const r = await adapter.getPayment(String(order.mpPaymentId)).catch(() => null);
      approved = r?.body?.status === "approved";
    } else {
      const found = await adapter.searchApprovedByRef(order.id).catch(() => null);
      if (found) { approved = true; payId = found.id; }
    }
    if (approved) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxOrder.update({ where: { id: orderId }, data: { status: "paid", paidAt: new Date(), mpPaymentId: payId } }));
      await this.systemNote(orgId, order.conversationId, `✅ Pagamento aprovado — pedido ${order.orderNumber} (${brl(Number(order.totalCents))}).`).catch(() => undefined);
      const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id: order.conversationId } }));
      if (conv) await this.dispatch(conv as any, `✅ Pagamento aprovado!\nPedido *${order.orderNumber}* — ${brl(Number(order.totalCents))}.\nObrigado pela compra!`).catch(() => undefined);
      return { status: "paid", orderNumber: order.orderNumber };
    }
    return { status: order.status };
  }

  // ============================== TABULAÇÃO + PROTOCOLO ==============================
  async listTabulations(ctx: RequestContext) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversationTabulation.findMany({ where: { isActive: true }, orderBy: [{ groupName: "asc" }, { displayOrder: "asc" }, { name: "asc" }] }));
  }
  async upsertTabulation(ctx: RequestContext, input: { id?: string; name: string; groupName?: string; displayOrder?: number }) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id
        ? tx.conversationTabulation.update({ where: { id: input.id }, data: { name: input.name, groupName: input.groupName ?? null, displayOrder: input.displayOrder ?? 0 } })
        : tx.conversationTabulation.create({ data: { organizationId: orgId, name: input.name, groupName: input.groupName ?? null, displayOrder: input.displayOrder ?? 0 } }),
    );
  }

  /** Resolve a conversa: tabula, gera protocolo, envia ao cliente. */
  async resolve(ctx: RequestContext, id: string, input: { tabulationId?: string | null; note?: string }) {
    const orgId = this.orgId(ctx);
    const conv = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversation.findFirst({ where: { id } }));
    if (!conv) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    const protocol = conv.protocol ?? this.genProtocol();
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.update({
        where: { id },
        data: { status: "resolved", resolvedAt: new Date(), protocol, tabulationId: input.tabulationId ?? null, tabulationNote: input.note ?? null, closedByMembershipId: ctx.membershipId ?? null, assigneeMembershipId: null, teamId: null, botActive: false },
      }),
    );
    await this.systemNote(orgId, id, `Atendimento finalizado. Protocolo ${protocol}.`).catch(() => undefined);
    // envia protocolo ao cliente pelo canal
    await this.dispatch(conv as any, `Seu atendimento foi finalizado ✅\nProtocolo: *${protocol}*\nObrigado pelo contato!`).catch(() => undefined);
    // webhook out (best-effort)
    void this.fireWebhookEvent(orgId, "conversation.resolved", { conversationId: id, protocol, customerId: conv.customerId, closedByMembershipId: ctx.membershipId });
    // pesquisa de satisfação atrelada ao atendente que fechou (ctx.userId)
    if (conv.customerId) {
      await this.surveys.createAndSend({
        organizationId: orgId, storeId: null, customerId: conv.customerId,
        kind: "manual", stage: "atendimento", refId: id, sellerUserId: ctx.userId ?? null,
      }).catch(() => undefined);
    }
    // ao fechar, libera vaga → puxa o próximo da fila
    if (ctx.membershipId) await this.pullFromQueue(orgId, ctx.membershipId).catch(() => undefined);
    return { ok: true, protocol };
  }

  private genProtocol(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `AT-${ymd}-${rand}`;
  }

  /** Relatório: contagem por tabulação e por atendente no período. */
  async reportTabulations(ctx: RequestContext, f: { from?: string; to?: string }) {
    const where: any = { status: "resolved", tabulationId: { not: null } };
    if (f.from || f.to) where.resolvedAt = { ...(f.from ? { gte: new Date(f.from + "T00:00:00") } : {}), ...(f.to ? { lte: new Date(f.to + "T23:59:59") } : {}) };
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.findMany({ where, select: { tabulationId: true, closedByMembershipId: true } }),
    );
    const tabs = await this.listTabulations(ctx);
    const tabName = new Map(tabs.map((t) => [t.id, t.name]));
    const byTab = new Map<string, number>();
    const byAgent = new Map<string, number>();
    for (const r of rows) {
      if (r.tabulationId) byTab.set(r.tabulationId, (byTab.get(r.tabulationId) ?? 0) + 1);
      if (r.closedByMembershipId) byAgent.set(r.closedByMembershipId, (byAgent.get(r.closedByMembershipId) ?? 0) + 1);
    }
    // nomes dos agentes
    const agentIds = [...byAgent.keys()];
    const agentMap = new Map<string, string>();
    if (agentIds.length) {
      const ms = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.membership.findMany({ where: { id: { in: agentIds } }, select: { id: true, user: { select: { name: true } } } }));
      for (const m of ms) agentMap.set(m.id, m.user?.name ?? "—");
    }
    return {
      total: rows.length,
      byTabulation: [...byTab.entries()].map(([id, count]) => ({ id, name: tabName.get(id) ?? "—", count })).sort((a, b) => b.count - a.count),
      byAgent: [...byAgent.entries()].map(([id, count]) => ({ id, name: agentMap.get(id) ?? "—", count })).sort((a, b) => b.count - a.count),
    };
  }
  async addLabel(ctx: RequestContext, id: string, labelId: string) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversationLabelLink.upsert({
        where: { conversationId_labelId: { conversationId: id, labelId } },
        create: { organizationId: orgId, conversationId: id, labelId }, update: {},
      }),
    ).catch(() => ({ ok: true }));
  }
  async removeLabel(ctx: RequestContext, id: string, labelId: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversationLabelLink.deleteMany({ where: { conversationId: id, labelId } }));
  }

  // ============================== BUSCA POR PROTOCOLO ==============================
  /** Busca atendimentos por protocolo, nome, telefone ou CPF. Retorna lista com
   *  data + tabulação (pra a aba "Protocolo"). */
  async searchProtocols(ctx: RequestContext, q: string) {
    const term = (q ?? "").trim();
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, "");
    const or: any[] = [
      { protocol: { contains: term, mode: "insensitive" } },
      { contactName: { contains: term, mode: "insensitive" } },
    ];
    if (digits.length >= 4) or.push({ contactPhone: { contains: digits } });
    // por CPF (document do cliente)
    if (digits.length >= 8) {
      const cs = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.customer.findMany({ where: { document: { contains: digits } }, select: { id: true }, take: 50 }),
      ).catch(() => []);
      const ids = cs.map((c) => c.id);
      if (ids.length) or.push({ customerId: { in: ids } });
    }
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversation.findMany({
        where: { OR: or },
        orderBy: [{ resolvedAt: "desc" }, { lastMessageAt: "desc" }],
        take: 100,
        select: { id: true, protocol: true, contactName: true, contactPhone: true, status: true, resolvedAt: true, createdAt: true, tabulationId: true, tabulationNote: true, closedByMembershipId: true },
      }),
    );
    const tabs = await this.listTabulations(ctx);
    const tabName = new Map(tabs.map((t) => [t.id, t.name]));
    const agentIds = [...new Set(rows.map((r) => r.closedByMembershipId).filter(Boolean))] as string[];
    const agentMap = new Map<string, string>();
    if (agentIds.length) {
      const ms = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.membership.findMany({ where: { id: { in: agentIds } }, select: { id: true, user: { select: { name: true } } } }));
      for (const m of ms) agentMap.set(m.id, m.user?.name ?? "—");
    }
    return rows.map((r) => ({
      id: r.id, protocol: r.protocol, contactName: r.contactName, contactPhone: r.contactPhone,
      status: r.status, date: r.resolvedAt ?? r.createdAt, tabulationName: r.tabulationId ? tabName.get(r.tabulationId) ?? null : null,
      tabulationNote: r.tabulationNote, agentName: r.closedByMembershipId ? agentMap.get(r.closedByMembershipId) ?? null : null,
    }));
  }

  // ============================== INICIAR CONVERSA ==============================
  /** Normaliza telefone BR: tira tudo que não é dígito; adiciona 55 se não tiver
   *  código de país; não mexe se já vier com 55. */
  private normalizePhone(raw: string): string | null {
    const digits = (raw ?? "").replace(/\D/g, "");
    if (!digits) return null;
    if (digits.length >= 12 && digits.startsWith("55")) return digits;     // já tem país
    if (digits.length === 10 || digits.length === 11) return "55" + digits; // DDD + número
    return digits.startsWith("55") ? digits : "55" + digits;
  }

  /**
   * Vincula (ou cria) um cliente à conversa pelo telefone. Usado quando o operador
   * vai agendar e a conversa ainda não tem cliente: ele informa só o nome (o
   * telefone vem da própria conversa) e a gente acha-ou-cria o cliente.
   */
  async linkCustomer(ctx: RequestContext, conversationId: string, input: { name?: string; phone?: string }) {
    const orgId = this.orgId(ctx);
    const conv = await this.pa((tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
    if (!conv || conv.organizationId !== orgId) throw new AppError(ErrorCode.NotFound, "Conversa não encontrada", 404);
    const name = String(input.name ?? "").trim();
    if (name.length < 2) throw new AppError(ErrorCode.ValidationFailed, "Informe o nome do cliente", 400);
    const phone = this.normalizePhone(String(input.phone ?? conv.contactPhone ?? ""));
    if (!phone) throw new AppError(ErrorCode.ValidationFailed, "Telefone inválido — informe com DDD", 400);
    const tail = phone.slice(-8);
    let cust = tail.length >= 8
      ? await this.pa((tx) => tx.customer.findFirst({ where: { organizationId: orgId, deletedAt: null, OR: [{ phone: { contains: tail } }, { whatsappPhone: { contains: tail } }] }, select: { id: true, name: true } }))
      : null;
    if (!cust) {
      const store = await this.pa((tx) => tx.store.findFirst({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }));
      if (!store) throw new AppError(ErrorCode.ValidationFailed, "Empresa sem loja cadastrada", 400);
      cust = await this.pa((tx) => tx.customer.create({ data: { organizationId: orgId, storeId: store.id, name, phone, whatsappPhone: phone, source: "atendimento" }, select: { id: true, name: true } }));
    }
    await this.pa((tx) => tx.conversation.update({ where: { id: conversationId }, data: { customerId: cust!.id, contactName: conv.contactName ?? name } }));
    return { customerId: cust.id, name: cust.name };
  }

  /** Inicia (ou reabre) uma conversa de WhatsApp com um cliente cadastrado OU um
   *  telefone avulso. Envia a 1ª mensagem (se informada) e devolve a conversa.
   *  Avisa se o cliente tem agendamento pendente de confirmação. */
  async startConversation(ctx: RequestContext, input: { customerId?: string | null; phone?: string | null; name?: string | null; message?: string }) {
    const orgId = this.orgId(ctx);
    let phoneRaw = input.phone ?? null;
    let name = input.name ?? null;
    let customerId = input.customerId ?? null;
    if (customerId) {
      const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findFirst({ where: { id: customerId! }, select: { name: true, phone: true, whatsappPhone: true } }));
      if (!c) throw new AppError(ErrorCode.NotFound, "Cliente não encontrado", 404);
      phoneRaw = phoneRaw ?? c.whatsappPhone ?? c.phone ?? null;
      name = name ?? c.name ?? null;
    }
    const phone = this.normalizePhone(phoneRaw ?? "");
    if (!phone) throw new AppError(ErrorCode.ValidationFailed, "Informe um telefone válido", 400);

    // slug da org (channelRef da inbox default) — antes da tx, sem aninhar
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (t) => t.organization.findFirst({ where: { id: orgId }, select: { slug: true } }));
    const externalKey = `${phone}@s.whatsapp.net`;

    // tx única (rls): acha/cria inbox + conversa; vincula cliente pelo telefone
    const conv = await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      let inbox = await tx.inbox.findFirst({ where: { channel: "whatsapp" }, orderBy: { createdAt: "asc" } });
      if (!inbox) inbox = await tx.inbox.create({ data: { organizationId: orgId, name: "WhatsApp", channel: "whatsapp", channelRef: org?.slug ?? null, botEnabled: false } });
      let c = await tx.conversation.findFirst({ where: { inboxId: inbox.id, externalId: externalKey, status: { not: "resolved" } }, orderBy: { createdAt: "desc" } });
      if (!c) {
        if (!customerId) {
          const tail = phone.slice(-8);
          const found = tail.length >= 8 ? await tx.customer.findFirst({ where: { OR: [{ phone: { contains: tail } }, { whatsappPhone: { contains: tail } }] }, select: { id: true, name: true } }) : null;
          if (found) { customerId = found.id; name = name ?? found.name; }
        }
        c = await tx.conversation.create({
          data: {
            organizationId: orgId, inboxId: inbox.id, channel: "whatsapp", externalId: externalKey,
            customerId: customerId ?? null, contactName: name, contactPhone: phone,
            assigneeMembershipId: ctx.membershipId ?? null, status: "open", botActive: false,
            lastMessageAt: new Date(),
          },
        });
      }
      return c;
    });

    // 1ª mensagem (opcional) — fora da tx; sendMessage abre sua própria transação
    if (input.message && input.message.trim()) {
      await this.sendMessage(ctx, conv.id, { body: input.message.trim() }).catch(() => undefined);
    }
    // aviso: agendamento pendente de confirmação (sequencial, fora da tx)
    let pendingAppointment: { startsAt: Date; serviceName: string | null } | null = null;
    if (customerId) {
      pendingAppointment = await this.prisma.runWithContext({ isPlatformAdmin: true }, (t) =>
        t.appointment.findFirst({ where: { customerId: customerId!, deletedAt: null, status: "pending", startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, serviceName: true } }),
      ).catch(() => null);
    }
    return { conversationId: conv.id, customerId, phone, pendingAppointment };
  }

  // ============================== PRESENÇA + ROTEAMENTO ==============================
  /** Quantas conversas ativas (não resolvidas) o operador tem. */
  private async activeCountFor(orgId: string, membershipId: string): Promise<number> {
    return this.pa((tx) => tx.conversation.count({ where: { organizationId: orgId, assigneeMembershipId: membershipId, status: { not: "resolved" } } }));
  }

  /** Presença do operador logado + contagem ativa. */
  async getMyPresence(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const mid = ctx.membershipId ?? null;
    if (!mid) return { status: "offline", maxConcurrent: 6, activeCount: 0 };
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxAgentPresence.findFirst({ where: { membershipId: mid } }));
    const activeCount = await this.activeCountFor(orgId, mid);
    return { status: p?.status ?? "offline", maxConcurrent: p?.maxConcurrent ?? 6, activeCount };
  }

  /** Define presença (online/paused/offline). Ao ficar online, puxa da fila. */
  async setPresence(ctx: RequestContext, status: "online" | "paused" | "offline", maxConcurrent?: number) {
    const orgId = this.orgId(ctx);
    const mid = ctx.membershipId ?? null;
    if (!mid) throw new AppError(ErrorCode.Forbidden, "Sem operador", 403);
    if (!["online", "paused", "offline"].includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status inválido", 400);
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const ex = await tx.inboxAgentPresence.findFirst({ where: { membershipId: mid } });
      const data: any = { status, lastSeenAt: new Date() };
      if (maxConcurrent && maxConcurrent > 0) data.maxConcurrent = maxConcurrent;
      if (ex) await tx.inboxAgentPresence.update({ where: { id: ex.id }, data });
      else await tx.inboxAgentPresence.create({ data: { organizationId: orgId, membershipId: mid, status, maxConcurrent: maxConcurrent ?? 6, lastSeenAt: new Date() } });
    });
    if (status === "online") await this.pullFromQueue(orgId, mid).catch(() => undefined);
    return this.getMyPresence(ctx);
  }

  /** Batimento: mantém lastSeen e tenta puxar da fila se houver folga. */
  async heartbeat(ctx: RequestContext) {
    const orgId = this.orgId(ctx);
    const mid = ctx.membershipId ?? null;
    if (!mid) return { ok: true };
    const p = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxAgentPresence.findFirst({ where: { membershipId: mid } }));
    if (p?.status === "online") {
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxAgentPresence.update({ where: { id: p.id }, data: { lastSeenAt: new Date() } }));
      await this.pullFromQueue(orgId, mid).catch(() => undefined);
    }
    return { ok: true };
  }

  /** Painel do supervisor: presença + carga de cada operador da org. */
  async listPresence(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas supervisores", 403);
    const orgId = this.orgId(ctx);
    const members = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.membership.findMany({ where: { organizationId: orgId, status: "active" }, select: { id: true, user: { select: { name: true } } } }));
    const presences = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inboxAgentPresence.findMany({ where: {} }));
    const pMap = new Map(presences.map((p) => [p.membershipId, p]));
    const out: Array<{ membershipId: string; name: string; status: string; maxConcurrent: number; activeCount: number; lastSeenAt: Date | null }> = [];
    for (const m of members) {
      const p = pMap.get(m.id);
      const activeCount = await this.activeCountFor(orgId, m.id);
      out.push({ membershipId: m.id, name: m.user?.name ?? "—", status: p?.status ?? "offline", maxConcurrent: p?.maxConcurrent ?? 6, activeCount, lastSeenAt: p?.lastSeenAt ?? null });
    }
    // online primeiro, depois pausado, depois offline
    const order: Record<string, number> = { online: 0, paused: 1, offline: 2 };
    return out.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.activeCount - a.activeCount);
  }

  /** Roteia uma conversa nova: atribui ao operador online com menos carga e
   *  abaixo do limite; se ninguém disponível, deixa na fila e avisa a posição.
   *  Best-effort — nunca lança. Chamado pelo webhook após a ingestão. */
  async routeConversation(conversationId: string): Promise<void> {
    try {
      const conv = await this.pa((tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
      if (!conv || conv.assigneeMembershipId || conv.status === "resolved") return;
      const orgId = conv.organizationId;
      // se a inbox tem bot ligado, o assistente de IA tria primeiro (ele faz o
      // handoff/ fila depois). Não auto-atribui pra não "roubar" do bot.
      const ibx = await this.pa((tx) => tx.inbox.findFirst({ where: { id: conv.inboxId }, select: { botEnabled: true } }));
      if (ibx?.botEnabled) return;
      const presences = await this.pa((tx) => tx.inboxAgentPresence.findMany({ where: { organizationId: orgId, status: "online" } }));
      const agents = await this.pa((tx) => tx.inboxAgent.findMany({ where: { inboxId: conv.inboxId }, select: { membershipId: true } }));
      const allowed = new Set(agents.map((a: any) => a.membershipId));
      let best: { mid: string; count: number } | null = null;
      for (const pr of presences) {
        if (allowed.size && !allowed.has(pr.membershipId)) continue;
        const count = await this.activeCountFor(orgId, pr.membershipId);
        if (count >= pr.maxConcurrent) continue;
        if (!best || count < best.count) best = { mid: pr.membershipId, count };
      }
      if (best) {
        await this.pa((tx) => tx.conversation.update({ where: { id: conv.id }, data: { assigneeMembershipId: best!.mid, autoAssigned: true, botActive: false, queuedAt: null } }));
        const m = await this.pa((tx) => tx.membership.findFirst({ where: { id: best!.mid }, select: { user: { select: { name: true } } } }));
        await this.systemNote(orgId, conv.id, `Atribuído automaticamente a ${m?.user?.name ?? "atendente"}.`).catch(() => undefined);
        return;
      }
      await this.notifyQueuePosition(conv);
    } catch (e: any) {
      this.logger.error(`routeConversation falhou: ${e?.message}`);
    }
  }

  /** Marca a conversa como enfileirada e avisa a posição (no máx. 1x/5min).
   *  CONFIG: callCenterSettings.queuePositionEnabled = false desliga o aviso
   *  de posição (a conversa ainda fica enfileirada normalmente, mas o cliente
   *  não recebe a mensagem "Você está na fila — posição N"). Toggle em
   *  Atendimento → Configurações. Útil pra empresas que preferem comunicar
   *  o tempo de espera de outra forma ou não querem desestimular o cliente. */
  private async notifyQueuePosition(conv: any): Promise<void> {
    const now = new Date();
    if (!conv.queuedAt) {
      await this.pa((tx) => tx.conversation.update({ where: { id: conv.id }, data: { queuedAt: now } }));
      conv.queuedAt = now;
    }
    // Lê a config global da org. Default = true (mantém comportamento histórico).
    // Se a migration 187 ainda não rodou, default vira true também (fallback).
    const settings = await this.pa((tx) => tx.callCenterSettings.findFirst({ where: { organizationId: conv.organizationId }, select: { queuePositionEnabled: true } })).catch(() => null);
    const queueEnabled = settings?.queuePositionEnabled !== false; // default true
    if (!queueEnabled) return;

    const ahead = await this.pa((tx) => tx.conversation.count({
      where: { organizationId: conv.organizationId, assigneeMembershipId: null, status: { in: ["open", "pending"] }, queuedAt: { not: null, lte: conv.queuedAt } },
    }));
    const pos = Math.max(1, ahead);
    const last = conv.queueNotifiedAt ? new Date(conv.queueNotifiedAt).getTime() : 0;
    if (Date.now() - last > 5 * 60_000) {
      await this.pa((tx) => tx.conversation.update({ where: { id: conv.id }, data: { queueNotifiedAt: now } }));
      await this.dispatch(conv, `🕒 No momento todos os atendentes estão ocupados. Você está na fila — posição *${pos}*. Já já alguém continua por aqui. Obrigado pela paciência! 🙏`).catch(() => undefined);
    }
  }

  /** Operador disponível puxa a próxima da fila (respeitando agentes da inbox). */
  private async pullFromQueue(orgId: string, membershipId: string): Promise<void> {
    const presence = await this.pa((tx) => tx.inboxAgentPresence.findFirst({ where: { organizationId: orgId, membershipId } }));
    if (!presence || presence.status !== "online") return;
    let slots = presence.maxConcurrent - (await this.activeCountFor(orgId, membershipId));
    while (slots > 0) {
      const next = await this.pa((tx) => tx.conversation.findFirst({
        where: { organizationId: orgId, assigneeMembershipId: null, status: { in: ["open", "pending"] }, queuedAt: { not: null } },
        orderBy: { queuedAt: "asc" },
      }));
      if (!next) return;
      const agents = await this.pa((tx) => tx.inboxAgent.findMany({ where: { inboxId: next.inboxId }, select: { membershipId: true } }));
      const allowed = new Set(agents.map((a: any) => a.membershipId));
      if (allowed.size && !allowed.has(membershipId)) return; // a fila topo não é dele; não fura
      await this.pa((tx) => tx.conversation.update({ where: { id: next.id }, data: { assigneeMembershipId: membershipId, autoAssigned: true, botActive: false, queuedAt: null, status: next.status === "pending" ? "open" : next.status } }));
      const m = await this.pa((tx) => tx.membership.findFirst({ where: { id: membershipId }, select: { user: { select: { name: true } } } }));
      await this.systemNote(orgId, next.id, `Atribuído automaticamente a ${m?.user?.name ?? "atendente"} (puxado da fila).`).catch(() => undefined);
      slots--;
    }
  }

  /** Despacho pelo canal (whatsapp via Evolution; email via SMTP; webchat fica no banco).
   *  No WhatsApp, sai pela MESMA instância em que a conversa chegou
   *  (inbox.channelRef) — assim empresas com mais de um número respondem pelo
   *  número certo. Se a inbox não tiver channelRef, cai na instância principal. */
  private async dispatch(
    conv: { organizationId: string; channel: string; contactPhone: string | null; contactEmail: string | null; inboxId?: string | null },
    text: string,
    mediaUrl?: string | null,
    mediaMime?: string | null,
  ) {
    const media = mediaUrl
      ? { url: mediaUrl, mediatype: (mediaMime?.startsWith("image/") ? "image" : mediaMime?.startsWith("audio/") ? "audio" : mediaMime?.startsWith("video/") ? "video" : "document") }
      : undefined;
    if (conv.channel === "whatsapp" && conv.contactPhone) {
      let instanceName: string | null = null;
      if (conv.inboxId) {
        const ib = await this.pa((tx) => tx.inbox.findFirst({ where: { id: conv.inboxId! }, select: { channelRef: true } })).catch(() => null);
        instanceName = ib?.channelRef ?? null;
      }
      // antiban: enfileira por instância/número (gap curto entre envios)
      const queueKey = `wa:${conv.organizationId}:${instanceName ?? "default"}`;
      await this.runQueued(queueKey, () =>
        this.notifications.notify({ organizationId: conv.organizationId, storeId: conv.organizationId, whatsappPhone: conv.contactPhone, subject: "", text, templateCode: "inbox", instanceName, media } as any),
      );
    } else if (conv.channel === "email" && conv.contactEmail) {
      await this.notifications.notify({ organizationId: conv.organizationId, storeId: conv.organizationId, email: conv.contactEmail, subject: "Atendimento", text, templateCode: "inbox" } as any);
    }
    // webchat: o widget faz polling das mensagens; nada a despachar.
  }

  // ============================== BOT DE TRIAGEM ==============================
  /** Menu de triagem padrão (v1; NLU/LLM entram numa evolução). */
  private readonly DEFAULT_MENU = [
    "Olá! 👋 Sou o atendimento automático. Para agilizar, escolha uma opção respondendo o número:",
    "1️⃣ Agendar / confirmar exame",
    "2️⃣ Status do meu pedido de lente",
    "3️⃣ Crediário / 2ª via",
    "4️⃣ Reclamação",
    "5️⃣ Falar com um atendente",
  ].join("\n");

  private readonly MENU_LABEL: Record<string, string> = {
    "1": "Agendar/confirmar exame", "2": "Status do pedido de lente",
    "3": "Crediário / 2ª via", "4": "Reclamação", "5": "Falar com atendente",
  };

  /** Classifica a dúvida do cliente num tópico (palavras-chave, free) para o
   *  painel "Maiores dúvidas". null se não houver texto útil. */
  private questionTopic(text: string): string | null {
    const t = (text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    if (t.length < 2) return null;
    if (/\b(preco|valor|quanto custa|quanto fica|quanto e|custa|orcamento)\b/.test(t)) return "Preço/valores";
    if (/\b(horario|que horas|abre|fecha|funciona|aberto|atendem)\b/.test(t)) return "Horário/funcionamento";
    if (/\b(agendar|marcar|remarcar|exame|consulta|agenda)\b/.test(t)) return "Agendar exame";
    if (/\b(pedido|ficou pronto|pronto|status|chegou|entrega|prazo)\b/.test(t)) return "Status do pedido";
    if (/\b(garantia|conserto|consertar|quebrou|defeito|arrumar|assistencia)\b/.test(t)) return "Garantia/conserto";
    if (/\b(crediario|boleto|parcela|pagar|fatura|2.?via|segunda via|carne|divida)\b/.test(t)) return "Crediário/pagamento";
    if (/\b(onde|endereco|localiza|fica|como chegar|bairro|rua)\b/.test(t)) return "Localização/endereço";
    if (/\b(tem|disponivel|modelo|marca|armacao|lente|oculos|solar|grau)\b/.test(t)) return "Produtos/disponibilidade";
    return "Outros";
  }

  /** Painel "Maiores dúvidas": classifica mensagens de entrada ainda sem tópico
   *  (best-effort) e devolve o ranking por tópico + exemplos. */
  async topQuestions(ctx: RequestContext, f: { from?: string; to?: string }) {
    const orgId = this.orgId(ctx);
    const where: any = { organizationId: orgId, direction: "in", authorType: "contact", isPrivate: false };
    if (f.from || f.to) where.createdAt = { ...(f.from ? { gte: new Date(f.from + "T00:00:00") } : {}), ...(f.to ? { lte: new Date(f.to + "T23:59:59") } : {}) };
    // backfill: classifica até 1000 sem tópico (idempotente)
    const untagged = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversationMessage.findMany({ where: { ...where, topic: null, content: { not: null } }, select: { id: true, content: true }, take: 1000 }),
    ).catch(() => []);
    for (const m of untagged) {
      const topic = this.questionTopic(m.content ?? "");
      if (topic) await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.conversationMessage.update({ where: { id: m.id }, data: { topic } })).catch(() => undefined);
    }
    // agrega
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.conversationMessage.findMany({ where: { ...where, topic: { not: null } }, select: { topic: true, content: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 4000 }),
    );
    const byTopic = new Map<string, { count: number; samples: string[] }>();
    for (const r of rows) {
      const k = r.topic!;
      const e = byTopic.get(k) ?? { count: 0, samples: [] };
      e.count++;
      if (e.samples.length < 3 && r.content && !e.samples.includes(r.content)) e.samples.push(r.content.slice(0, 140));
      byTopic.set(k, e);
    }
    return {
      total: rows.length,
      topics: [...byTopic.entries()].map(([topic, v]) => ({ topic, count: v.count, samples: v.samples })).sort((a, b) => b.count - a.count),
    };
  }

  /** Sugere (via IA, se configurada) uma resposta rápida pra um tópico. */
  async suggestCannedAnswer(ctx: RequestContext, topic: string, samples: string[]) {
    const system = "Você ajuda uma ótica a criar uma RESPOSTA RÁPIDA padrão para uma dúvida frequente de cliente no WhatsApp. Escreva em português do Brasil, cordial, curta (até 3 frases), sem inventar dados específicos (preços, prazos, valores) — use placeholders como {{cliente}} quando útil. Responda só com o texto da resposta, sem aspas.";
    const user = `Tópico: ${topic}\nExemplos de perguntas dos clientes:\n${(samples ?? []).slice(0, 5).map((s) => `- ${s}`).join("\n")}`;
    const out = await this.aiComplete(this.orgId(ctx), system, user, 200).catch(() => null);
    return { suggestion: out?.trim() || null };
  }

  /** Roteamento por linguagem natural SEM IA (fallback): mapeia o texto livre
   *  do cliente para uma opção do menu por palavras-chave. */
  private keywordChoice(text: string): string | null {
    const t = (text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (/\b(agendar|marcar|remarcar|exame|consulta|agenda|horario|hora marcada)\b/.test(t)) return "1";
    if (/\b(pedido|lente|oculos|armacao|status|ficou pronto|pronto|retirar|retirada)\b/.test(t)) return "2";
    if (/\b(crediario|boleto|2.?via|segunda via|fatura|parcela|carne|pagar|pagamento|divida)\b/.test(t)) return "3";
    if (/\b(reclama|reclamacao|problema|insatisfeito|pessimo|defeito|quebrou|errado|nao funciona)\b/.test(t)) return "4";
    if (/\b(atendente|humano|pessoa|falar com|alguem|consultor|vendedor)\b/.test(t)) return "5";
    return null;
  }

  /** Triagem por IA (LLM da Anthropic via HTTP, sem dependência). Só roda se
   *  ANTHROPIC_API_KEY estiver setado. Retorna a fala ao cliente + se deve
   *  encaminhar pra um atendente e qual departamento. null se indisponível. */
  private async llmTriage(orgId: string, text: string, contactName: string | null): Promise<{ reply: string; choice: string | null; handoff: boolean } | null> {
    if (!text?.trim()) return null;
    const system = [
      "Você é o atendente virtual de uma ótica, conversando por WhatsApp. Responda em português do Brasil, breve e cordial.",
      "Departamentos disponíveis: 1) Agendar/confirmar exame; 2) Status do pedido de lente; 3) Crediário / 2ª via de boleto; 4) Reclamação; 5) Falar com um atendente.",
      "Se a mensagem indicar claramente um desses assuntos, encaminhe para um atendente (handoff=true) com o número do departamento em choice.",
      "Você NÃO tem acesso a dados específicos (preços, status de pedidos, datas, valores). NUNCA invente. Se pedirem algo específico, encaminhe para um atendente.",
      "Se for só uma saudação ou dúvida muito genérica, responda gentilmente e pergunte como pode ajudar (handoff=false, choice=null).",
      'Responda SOMENTE com um JSON válido, sem texto fora dele: {"reply": "mensagem ao cliente", "choice": "1"|"2"|"3"|"4"|"5"|null, "handoff": true|false}',
    ].join("\n");
    const userMsg = `${contactName ? `Cliente: ${contactName}\n` : ""}Mensagem: ${text.slice(0, 1000)}`;
    const raw = await this.aiComplete(orgId, system, userMsg, 350);
    if (!raw) return null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);
      const choice = ["1", "2", "3", "4", "5"].includes(String(parsed.choice)) ? String(parsed.choice) : null;
      return { reply: String(parsed.reply ?? "").slice(0, 1500), choice, handoff: !!parsed.handoff };
    } catch { return null; }
  }

  /** Chamada de IA por empresa, com failover entre provedores (OrgAiService). */
  private async aiComplete(orgId: string, system: string, user: string, maxTokens = 350): Promise<string | null> {
    return this.orgAi.complete(orgId, system, user, maxTokens).catch(() => null);
  }

  /** Mensagem de saída do BOT (grava + despacha). */
  private async sendBot(conv: { id: string; organizationId: string; channel: string; contactPhone: string | null; contactEmail: string | null }, text: string) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.conversationMessage.create({ data: { organizationId: conv.organizationId, conversationId: conv.id, direction: "out", authorType: "bot", content: text, contentType: "text", status: "sent" } }),
    );
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } }));
    await this.dispatch(conv, text).catch((e) => this.logger.error(`bot dispatch: ${e?.message}`));
  }

  /**
   * Heurística "conversa fresca": evita a IA começar a atender no MEIO de um papo
   * que já estava rolando antes da inbox conectar/o bot ser ligado.
   *
   * Critérios (qualquer um falhando = NÃO é fresca = IA fica quieta):
   * - Conversa criada nos últimos N segundos OU
   * - Há ≤ 1 mensagem inbound histórica (cliente acabou de iniciar)
   * - E não tem mensagem outbound humana anterior (não está em handover de humano)
   *
   * Em conversa "não-fresca", a gente desliga botActive silenciosamente — assim
   * o atendente humano assume a conversa a partir do próximo passo (auto-assign
   * ou claim manual no inbox).
   */
  private async isConversationFresh(conv: any): Promise<boolean> {
    const FRESH_WINDOW_MS = 5 * 60 * 1000; // 5 min
    // Conversa muito velha = não é fresca
    if (conv.createdAt && Date.now() - new Date(conv.createdAt).getTime() > FRESH_WINDOW_MS) {
      // Conta inbounds históricos. Se já tinha trocas antes (>1 inbound) E o
      // bot nunca respondeu, é provavelmente histórico que veio em rajada.
      const counts = await this.pa((tx) => tx.conversationMessage.groupBy({
        by: ["direction", "authorType"],
        where: { conversationId: conv.id },
        _count: { _all: true },
      })).catch(() => [] as any[]);
      let inboundCount = 0; let humanOutbound = 0; let botOutbound = 0;
      for (const c of counts) {
        const n = (c._count?._all as number) ?? 0;
        if (c.direction === "in") inboundCount += n;
        else if (c.direction === "out" && c.authorType === "agent") humanOutbound += n;
        else if (c.direction === "out" && (c.authorType === "bot" || c.authorType === "system")) botOutbound += n;
      }
      // Se já houve resposta humana, é conversa em atendimento — NÃO bota IA por cima
      if (humanOutbound > 0) return false;
      // Se há muitos inbounds e nenhum bot respondeu, é histórico em rajada
      if (inboundCount > 2 && botOutbound === 0) return false;
    }
    return true;
  }

  /**
   * Debounce por conversa: agenda runBotTurn pra DEBOUNCE_MS no futuro. Se outra
   * mensagem chegar antes do timer disparar, cancela e reagenda (acumulando o
   * texto). Resultado: cliente que manda 5 msgs em 30s recebe UMA resposta da
   * IA referente a todas, em vez de 5 respostas individuais.
   *
   * Limitação: o estado é IN-MEMORY (Map no processo). Se o API reiniciar
   * durante o debounce, a IA não vai responder àquela rajada — mas tudo bem,
   * a próxima mensagem do cliente vai disparar normalmente.
   */
  private readonly botTimers = new Map<string, { timer: NodeJS.Timeout; texts: string[]; firstAt: number }>();
  private static readonly BOT_DEBOUNCE_MS = 5_000;
  private static readonly BOT_MAX_HOLD_MS = 15_000; // não segura mais que isso, mesmo com rajada longa
  scheduleBotTurn(conversationId: string, inboundText: string): void {
    const existing = this.botTimers.get(conversationId);
    if (existing) {
      // Se já está esperando > MAX_HOLD, executa agora e abre nova janela
      if (Date.now() - existing.firstAt > InboxService.BOT_MAX_HOLD_MS) {
        clearTimeout(existing.timer);
        this.botTimers.delete(conversationId);
        const merged = [...existing.texts, inboundText].join("\n").slice(0, 4000);
        void this.runBotTurn(conversationId, merged).catch(() => undefined);
        return;
      }
      clearTimeout(existing.timer);
      existing.texts.push(inboundText);
      existing.timer = setTimeout(() => this.flushBotTurn(conversationId), InboxService.BOT_DEBOUNCE_MS);
      return;
    }
    const slot = { texts: [inboundText], firstAt: Date.now(), timer: undefined as unknown as NodeJS.Timeout };
    slot.timer = setTimeout(() => this.flushBotTurn(conversationId), InboxService.BOT_DEBOUNCE_MS);
    this.botTimers.set(conversationId, slot);
  }
  private flushBotTurn(conversationId: string): void {
    const slot = this.botTimers.get(conversationId);
    if (!slot) return;
    this.botTimers.delete(conversationId);
    const merged = slot.texts.join("\n").slice(0, 4000);
    void this.runBotTurn(conversationId, merged).catch((e) => this.logger.warn(`flushBotTurn: ${e?.message}`));
  }

  /**
   * Conduz a triagem. Só age se a inbox tem bot ligado, a conversa está em modo
   * bot e sem agente. Ao concluir, transfere pro humano (handoff) com resumo.
   * Best-effort — nunca lança.
   */
  async runBotTurn(conversationId: string, inboundText: string): Promise<boolean> {
    try {
      const conv = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
      // bot só entra se em modo bot e SEM atendente E SEM equipe atribuídos
      if (!conv || !conv.botActive || conv.assigneeMembershipId || conv.teamId) return false;
      // PAUSA: o dono respondeu o cliente DIRETO no WhatsApp (fora do sistema).
      // Ficamos quietos pela janela pra não atropelar o atendimento humano.
      if ((conv as any).botPausedUntil && new Date((conv as any).botPausedUntil).getTime() > Date.now()) {
        this.logger.log(`runBotTurn: IA pausada (resposta humana direta) conv=${conv.id}`);
        return false;
      }
      // CONVERSA PRÉ-EXISTENTE: se a conversa começou ANTES da última conexão
      // da inbox (caso típico: WhatsApp foi reconectado, histórico chegou em
      // rajada), a IA NÃO deve "começar a atender" no meio do papo. Marca a
      // conversa como bot=false silenciosamente — o humano segue a partir daí.
      const sinceBotEnabledOk = await this.isConversationFresh(conv).catch(() => true);
      if (!sinceBotEnabledOk) {
        this.logger.log(`runBotTurn: conversa pré-existente (criada antes da reconexão) — desligando bot. conv=${conv.id}`);
        await this.pa((tx) => tx.conversation.update({ where: { id: conv.id }, data: { botActive: false } })).catch(() => undefined);
        return false;
      }
      const inbox = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.inbox.findFirst({ where: { id: conv.inboxId } }));
      if (!inbox || !inbox.botEnabled) return false;

      const orgId = conv.organizationId;
      // Se a empresa tem IA, o assistente conduz desde a PRIMEIRA mensagem (assim
      // ele se apresenta pelo nome). Só caímos no menu fixo quando NÃO há IA.
      const hasAi = await this.orgAi.hasProvider(orgId);
      let session = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.botSession.findFirst({ where: { conversationId } }));
      if (!session) {
        session = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.botSession.create({ data: { organizationId: orgId, conversationId, currentStep: "menu", status: "active" } }));
        if (!hasAi) {
          await this.sendBot(conv, inbox.greeting ? `${inbox.greeting}\n\n${this.DEFAULT_MENU}` : this.DEFAULT_MENU);
          return true;
        }
        // com IA: não manda menu — segue pro agentTurn abaixo, que apresenta o assistente
      }
      if (session.status !== "active") return false;

      // IA agêntica: se a empresa tem IA configurada, o assistente conduz a
      // conversa (ler agenda/produtos/crediário, responder e transferir).
      if (hasAi) {
        const handled = await this.agentTurn(conv, inboundText, session.id).catch((e) => { this.logger.warn(`agentTurn: ${e?.message}`); return false; });
        const prevData: any = (session.data as any) ?? {};
        if (handled) {
          // sucesso → zera o contador de falhas (se havia)
          if (prevData.aiFails) await this.pa((tx) => tx.botSession.update({ where: { id: session!.id }, data: { data: { ...prevData, aiFails: 0 } } })).catch(() => undefined);
          return true;
        }
        // A IA não respondeu agora (provedor em cota/instável ou resposta inválida).
        // NÃO despejamos o menu fixo nem transferimos de cara: tentamos 1 vez
        // recuperar (a próxima mensagem costuma funcionar, o cooldown é curto).
        // Só após falhas seguidas é que transferimos pro humano.
        const aiFails = (Number(prevData.aiFails) || 0) + 1;
        await this.pa((tx) => tx.botSession.update({ where: { id: session!.id }, data: { data: { ...prevData, aiFails } } })).catch(() => undefined);
        if (aiFails < 2) {
          this.logger.warn(`agentTurn vazio (tentativa ${aiFails}) org=${orgId} conv=${conv.id}`);
          await this.sendBot(conv, "Tive uma instabilidade rápida por aqui 😅. Pode me mandar de novo, por favor?");
          return true;
        }
        this.logger.warn(`agentTurn vazio ${aiFails}x — transferindo. org=${orgId} conv=${conv.id}`);
        await this.botHandoff(conv, session.id, "Atendimento", "5", "Vou te conectar com um atendente pra te ajudar melhor. 🙂").catch(() => undefined);
        return true;
      }

      // passo menu: interpreta a escolha (número, IA ou palavras-chave) — só
      // quando a empresa NÃO tem IA configurada.
      let choice = (inboundText.trim().match(/[1-5]/) ?? [])[0] ?? null;
      let handoffReply: string | null = null;
      if (!choice) {
        const llm = await this.llmTriage(orgId, inboundText, conv.contactName).catch(() => null);
        if (llm) {
          if (llm.handoff && llm.choice) { choice = llm.choice; handoffReply = llm.reply || null; }
          else {
            // IA respondeu naturalmente; segue conversando (sem encaminhar)
            await this.sendBot(conv, llm.reply || ("Como posso te ajudar? 🙂\n\n" + this.DEFAULT_MENU));
            return true;
          }
        } else {
          // sem IA: tenta por palavras-chave; se não achar, mostra o menu
          choice = this.keywordChoice(inboundText);
          if (!choice) {
            await this.sendBot(conv, "Não entendi 🤔. Me conta com suas palavras o que precisa, ou responda o número da opção (1 a 5):\n\n" + this.DEFAULT_MENU);
            return true;
          }
        }
      }
      if (!choice) return true;
      const reason = this.MENU_LABEL[choice] ?? "Atendimento";
      // conclui triagem → handoff pro humano
      await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
        await tx.botSession.update({ where: { id: session!.id }, data: { status: "handoff", currentStep: "done", data: { reason, choice } as any } });
        await tx.conversation.update({ where: { id: conversationId }, data: { botActive: false, subject: reason, priority: choice === "4" ? "high" : "normal" } });
        // nota interna com o resumo da triagem
        await tx.conversationMessage.create({ data: { organizationId: orgId, conversationId, direction: "out", authorType: "system", content: `Triagem concluída pelo bot: ${reason}. Cliente: ${conv.contactName ?? conv.contactPhone ?? "—"}.`, contentType: "event", isPrivate: true, status: "sent" } });
      });
      await this.sendBot(conv, handoffReply || "Perfeito! ✅ Já estou te transferindo para um de nossos atendentes. Em instantes alguém continua por aqui. 🙂");
      // avisa internamente a equipe
      await this.notifications.notify({ organizationId: orgId, storeId: orgId, subject: "Nova conversa para atendimento", text: `Triagem concluída (${reason}). Contato: ${conv.contactName ?? conv.contactPhone ?? "—"}.`, templateCode: "inbox_internal", internalOnly: true } as any).catch(() => undefined);
      return true;
    } catch (e: any) {
      this.logger.error(`runBotTurn falhou: ${e?.message}`);
      return false;
    }
  }

  // ============================== IA AGÊNTICA (ferramentas) ==============================
  /** Extrai o PRIMEIRO objeto JSON balanceado de um texto (tolera prosa antes/depois
   *  e múltiplos objetos). Mais robusto que um regex guloso que pegaria do 1º "{" ao
   *  último "}", quebrando o parse quando o modelo escreve algo a mais. */
  private extractFirstJson(s: string): any | null {
    if (typeof s !== "string") { try { s = JSON.stringify(s); } catch { return null; } }
    const start = s.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
      }
    }
    return null;
  }

  /** Conduz a conversa com IA + ferramentas (leitura). Protocolo JSON,
   *  provedor-agnóstico (usa OrgAiService com failover). Retorna true se tratou. */
  private async agentTurn(conv: any, inboundText: string, sessionId: string): Promise<boolean> {
    const orgId = conv.organizationId;
    const history = await this.pa((tx) => tx.conversationMessage.findMany({ where: { conversationId: conv.id, isPrivate: false }, orderBy: { createdAt: "desc" }, take: 12, select: { direction: true, authorType: true, content: true } }));
    const histText = history.reverse().map((m: any) => {
      const who = m.direction === "in" ? "Cliente"
        : m.authorType === "bot" ? "Assistente"
        : m.authorType === "whatsapp_direto" ? "Atendente (respondeu pelo WhatsApp)"
        : "Atendente";
      return `${who}: ${m.content ?? ""}`;
    }).join("\n");
    const hasCustomer = !!conv.customerId;
    // contexto da empresa: nome + instruções do negócio + base de conhecimento
    const org = await this.pa((tx) => tx.organization.findFirst({ where: { id: orgId }, select: { name: true, niche: true } })).catch(() => null);
    const settings = await this.pa((tx) => tx.callCenterSettings.findFirst({ where: { organizationId: orgId }, select: { botInstructions: true } })).catch(() => null);
    const niche = (org?.niche ?? "").toLowerCase();
    // gráfica: se há arte aguardando aprovação deste cliente, o bot deve oferecer aprovar
    let graficaPendingArt = "";
    if (niche === "grafica" && conv.customerId) {
      const pend = await this.pa((tx) => tx.productionOrder.findFirst({ where: { organizationId: orgId, customerId: conv.customerId, artStatus: "enviada", status: { notIn: ["finalizado", "cancelado"] } }, orderBy: { createdAt: "desc" }, select: { shortCode: true } })).catch(() => null);
      if (pend) graficaPendingArt = `ATENÇÃO: há uma ARTE AGUARDANDO APROVAÇÃO (pedido ${pend.shortCode ?? ""}). Se o cliente demonstrar que gostou/aprovou, confirme uma vez e use aprovar_arte com confirmar:true.`;
    }
    // gráfica: tabela de valores (por faixa de qtd) + medidas, pra IA atender sozinha
    let graficaCatalog = "";
    if (niche === "grafica") graficaCatalog = await this.production.graficaCatalogText(orgId).catch(() => "");
    // RAG-lite: puxa as respostas MAIS RELEVANTES à mensagem do cliente
    // (full-text); cai pro comportamento legado se a busca não estiver disponível.
    const kb = await this.aiLearning.retrieveKnowledge(orgId, inboundText, 8).catch(() => [] as any[]);
    const kbText = kb.length ? "\nBase de conhecimento (use estas respostas quando a dúvida bater):\n" + kb.map((k: any) => `P: ${k.question}\nR: ${k.answer}`).join("\n---\n") : "";
    const agora = new Date();
    const hojeISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora); // AAAA-MM-DD
    const hojeBR = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(agora);
    const buildOtica = () => [
      `Você é o assistente virtual de ${org?.name ?? "uma empresa"}, atendendo um cliente por WhatsApp. Português do Brasil, cordial e objetivo.`,
      `Data/hora de agora (horário de Brasília): ${hojeBR}. Hoje em ISO: ${hojeISO}. Use isso para entender "hoje", "amanhã", "sexta", "semana que vem" etc.`,
      settings?.botInstructions ? `Sobre o negócio / instruções: ${settings.botInstructions}` : "",
      "Você pode usar FERRAMENTAS pra consultar dados reais antes de responder. NUNCA invente preços, datas, status ou valores — use as ferramentas ou a base de conhecimento.",
      kbText,
      "Ferramentas disponíveis (action=\"tool\"):",
      "- buscar_produtos {\"q\":\"texto\"}: busca produtos no catálogo.",
      "- renomear_contato {\"nome\":\"...\"}: USE quando o cliente disser o nome dele (ex.: 'sou o Yuri', 'aqui é a Maria'). Atualiza o nome do contato pra todas as próximas mensagens já saírem certas, mesmo SEM cadastro completo.",
      hasCustomer ? "- ver_agendamentos {}: agendamentos do cliente." : "",
      hasCustomer ? "- ver_crediario {}: parcelas em aberto do crediário do cliente + link pra 2ª via/pagamento." : "",
      "- ver_horarios {\"data\":\"AAAA-MM-DD\"}: horários livres. Com data = aquele dia; sem data = próximos dias. SEMPRE use esta ferramenta pra checar disponibilidade (nunca diga que verificou sem chamá-la).",
      "- cadastrar_cliente {\"nome\":\"...\",\"telefone\":\"...\"}: encontra ou cadastra um cliente pelo telefone (valida o número). Retorna o customerId. Use quando o número NÃO for cadastrado, ou quando o agendamento for pra OUTRA pessoa.",
      "- agendar {\"data\":\"AAAA-MM-DD\",\"hora\":\"HH:MM\",\"customerId\":\"(opcional)\",\"confirmar\":true}: marca o exame no dia/horário que o cliente escolheu (pode passar slotId no lugar de data+hora). Sem customerId usa o titular do número; com customerId (de cadastrar_cliente) marca pra outra pessoa. NÃO precisa decorar slotId — basta a data e a hora que você ofereceu.",
      hasCustomer ? "- cancelar_agendamento {\"appointmentId\":\"...\",\"confirmar\":true}: cancela um agendamento." : "",
      hasCustomer ? "- reagendar {\"appointmentId\":\"...\",\"slotId\":\"...\",\"confirmar\":true}: muda pra outro horário." : "",
      "- transferir_pessoa {\"nome\":\"...\"}: transfere pra um atendente específico pelo nome.",
      hasCustomer ? "- solicitar_token {}: envia um código de 4 dígitos ao cliente pra confirmar a identidade." : "",
      hasCustomer ? "- validar_token {\"codigo\":\"1234\"}: valida o código que o cliente informou." : "",
      hasCustomer ? "- resetar_senha {\"confirmar\":true}: reseta a senha do portal do cliente (EXIGE identidade validada por token)." : "",
      `Cliente identificado pelo número do WhatsApp: ${hasCustomer ? "SIM" : "NÃO"}.`,
      "AO OFERECER HORÁRIOS: a ferramenta ver_horarios já devolve as opções dentro da regra (máx 2 datas, 4 horários cada) e JÁ FORMATADAS com 📅 e 🕐. ENVIE exatamente esses horários, MANTENDO as quebras de linha e os emojis 📅/🕐 — não junte tudo numa linha só, não invente outros horários, não corte a estrutura. Coloque só uma saudação curta antes e 'Qual horário você prefere? 😊' depois.",
      "REGRAS DE SEGURANÇA:",
      "- Ações que ALTERAM dados (agendar, cancelar, reagendar, resetar_senha) só com \"confirmar\":true, e só depois de o cliente CONFIRMAR explicitamente. Primeiro proponha e pergunte 'confirma?'.",
      "- ANTES de agendar é OBRIGATÓRIO identificar o cliente: se o número é cadastrado (acima), pode agendar pro titular. Se NÃO é cadastrado, OU se é pra outra pessoa, peça NOME e TELEFONE, chame cadastrar_cliente (ele valida o telefone) e use o customerId retornado no agendar.",
      "- resetar_senha exige identidade: peça solicitar_token, valide com validar_token e só então resetar_senha.",
      "Quando precisar de um humano (assunto sensível, reclamação, algo que você não resolve, ou o cliente pedir), use action=\"handoff\".",
      "Departamentos p/ handoff (campo department): 1 Agendar/confirmar exame; 2 Status do pedido de lente; 3 Crediário/2ª via; 4 Reclamação; 5 Falar com atendente.",
      "MUITO IMPORTANTE: as ferramentas executam IMEDIATAMENTE. NUNCA responda 'vou verificar', 'aguarde', 'um momento' e pare — isso encerra o atendimento sem resultado. Se precisa de dados (horários, agenda, crediário, produtos), responda JÁ com action=tool; só DEPOIS de receber o resultado da ferramenta você escreve a resposta final com os dados REAIS.",
      "As instruções/exemplos do negócio servem só pra TOM e ESTILO. NUNCA copie datas, horários, preços ou valores dos exemplos — use somente o que as ferramentas retornarem.",
      "ESTILO DAS MENSAGENS (siga à risca):",
      "- Apresente-se pelo seu nome SOMENTE na 1ª mensagem da conversa. Depois NÃO repita saudação nem apresentação.",
      "- Seja objetiva e curta (no máximo ~5 linhas). Faça UMA pergunta por vez e mande UMA mensagem por resposta.",
      "- Estruture a mensagem pro WhatsApp: use quebras de linha (\\n) entre as ideias, listas com itens em linhas separadas e poucos emojis. NUNCA jogue tudo numa linha só.",
      "- NÃO repita dados já ditos (endereço, horário de funcionamento, preço) a menos que o cliente pergunte de novo.",
      "- Foque no que o cliente pediu; não fique listando todos os serviços sem necessidade.",
      "- Para AGENDAR: depois que o cliente escolher um horário, pergunte 'reservo para [dia] às [hora]?'; quando ele disser SIM, chame agendar com data, hora e confirmar:true. NUNCA diga que agendou sem ter chamado a ferramenta agendar e recebido 'AGENDADO'.",
      "- Depois de agendar, o horário fica RESERVADO/AGENDADO (status pendente) — NÃO diga que está 'confirmado'. Informe que o cliente receberá um lembrete para confirmar e que pode responder aqui a qualquer momento para CANCELAR ou REAGENDAR (assim ele pode desistir).",
      "Responda SEMPRE com UM JSON, sem texto fora dele. Formatos:",
      '{"action":"reply","text":"mensagem ao cliente"}',
      '{"action":"tool","name":"ver_horarios","args":{"data":"2025-06-12"}}',
      '{"action":"tool","name":"buscar_produtos","args":{"q":"oculos de sol"}}',
      '{"action":"handoff","reason":"motivo curto","department":"1"}',
      "Exemplo de fluxo: cliente pede pra agendar → você responde {\"action\":\"tool\",\"name\":\"ver_horarios\",...} → recebe os horários → responde {\"action\":\"reply\",\"text\":\"...horários reais...\"}.",
    ];
    // === FLUXO GRÁFICA/UNIFORMES (bem-vindo → catálogo → valores → handoff Design → aprovação de arte) ===
    const buildGrafica = () => [
      `Você é o assistente virtual de ${org?.name ?? "uma gráfica"} (gráfica/uniformes), atendendo um cliente por WhatsApp. Português do Brasil, cordial e objetivo.`,
      `Data/hora de agora (horário de Brasília): ${hojeBR}. Hoje em ISO: ${hojeISO}.`,
      settings?.botInstructions ? `Sobre o negócio / instruções: ${settings.botInstructions}` : "",
      "Você pode usar FERRAMENTAS pra consultar dados reais. NUNCA invente preços, prazos ou status — use as ferramentas, a tabela abaixo ou a base de conhecimento.",
      graficaCatalog ? `\n${graficaCatalog}\nIMPORTANTE: o preço cai conforme a quantidade — SEMPRE cobre o valor da FAIXA da quantidade pedida (ex.: 12 camisas usam o preço da faixa "10+"). Ao montar o orçamento, use esse valor unitário.` : "",
      kbText,
      "Ferramentas disponíveis (action=\"tool\"):",
      "- listar_catalogo {}: lista o que a gráfica produz (categorias + itens + preço). Use quando o cliente pedir orçamento ou quiser saber o que fazemos.",
      "- renomear_contato {\"nome\":\"...\"}: USE quando o cliente disser o nome dele (ex.: 'sou o Yuri', 'aqui é a Maria'). Atualiza o nome do contato pra todas as próximas mensagens já saírem certas.",
      "- tabela_valores {\"q\":\"texto\"}: detalha os valores dos itens que casam com o texto (ex.: \"camisa\", \"conjunto\", \"colete\"). Use DEPOIS que o cliente escolher o tipo.",
      "- cadastrar_cliente {\"nome\":\"...\",\"telefone\":\"...\"}: encontra ou cadastra o cliente pelo telefone. Use quando o número NÃO for cadastrado e você precisar criar orçamento/pedido. Retorna o customerId.",
      "- criar_orcamento {\"itens\":[{\"descricao\":\"Camisa poliéster\",\"qtd\":10,\"valor\":39.90}],\"enviar\":true}: REGISTRA um orçamento no sistema com os itens combinados (valor unitário em reais). Com enviar:true, manda o PDF ao cliente por WhatsApp. Use os preços REAIS do catálogo/tabela_valores.",
      "- enviar_orcamento {\"codigo\":\"ORC-XXXX\"}: envia (de novo) o PDF de um orçamento já criado ao cliente. Sem código, usa o mais recente do cliente.",
      "- converter_orcamento {\"codigo\":\"ORC-XXXX\",\"confirmar\":true}: quando o cliente ACEITA um orçamento já enviado, converte ele em PEDIDO DE PRODUÇÃO (sinal pela política). Sem código, usa o orçamento aberto mais recente do cliente. Prefira esta a criar_pedido quando já existe orçamento.",
      "- criar_pedido {\"itens\":[{\"descricao\":\"...\",\"qtd\":1,\"valor\":0}],\"prazoDias\":7,\"entrega\":false,\"confirmar\":true}: abre o PEDIDO DE PRODUÇÃO direto (quando NÃO houve orçamento). Exige cliente identificado e confirmar:true. O sinal é calculado pela política da empresa.",
      hasCustomer ? "- status_pedido {}: status do(s) pedido(s) de produção do cliente (arte e produção)." : "",
      hasCustomer ? "- aprovar_arte {\"confirmar\":true}: APROVA a arte pendente de aprovação do cliente. Só com confirmar:true e DEPOIS de o cliente confirmar que gostou." : "",
      "- transferir_pessoa {\"nome\":\"...\"}: transfere pra um atendente específico pelo nome.",
      `Cliente identificado pelo número do WhatsApp: ${hasCustomer ? "SIM" : "NÃO"}.`,
      graficaPendingArt,
      "FLUXO (siga nesta ordem):",
      "1) Dê as boas-vindas e pergunte como pode ajudar.",
      "2) Cliente quer ORÇAMENTO / saber o que fazemos → chame listar_catalogo e apresente as opções (camisa, conjunto, colete…).",
      "3) Cliente ESCOLHEU um tipo e a quantidade → chame tabela_valores p/ os valores REAIS e monte o orçamento. Se o número não for cadastrado, use cadastrar_cliente. Então chame criar_orcamento (com enviar:true pra mandar o PDF). NÃO invente preços.",
      "4) Cliente FECHOU/aceitou o orçamento → se você JÁ criou um orçamento, chame converter_orcamento (confirmar:true). Se NÃO houve orçamento, chame criar_pedido (confirmar:true) com os itens. Depois informe que o Design vai criar a arte.",
      "5) Havendo ARTE PENDENTE DE APROVAÇÃO e o cliente dizendo que gostou/aprovou (\"pode aprovar\", \"ficou ótimo, fechado\", \"ok aprovado\") → confirme UMA vez (\"Posso aprovar a arte então?\") e, com o SIM, chame aprovar_arte {confirmar:true}. Se ele pedir mudança, use handoff pro Design.",
      "REGRAS: criar_pedido e aprovar_arte só com confirmar:true e após o cliente confirmar. Use SEMPRE preços reais (catálogo/tabela_valores) nos itens. NUNCA invente preços/prazos. Precisa de humano → handoff.",
      "ESTILO: objetiva e curta (~5 linhas), uma pergunta por vez, quebras de linha entre ideias, poucos emojis. Apresente-se pelo nome só na 1ª mensagem.",
      "Responda SEMPRE com UM JSON, sem texto fora dele. Formatos:",
      '{"action":"reply","text":"mensagem ao cliente"}',
      '{"action":"tool","name":"listar_catalogo","args":{}}',
      '{"action":"tool","name":"criar_orcamento","args":{"itens":[{"descricao":"Camisa","qtd":10,"valor":39.9}],"enviar":true}}',
      '{"action":"tool","name":"criar_pedido","args":{"itens":[{"descricao":"Camisa","qtd":10,"valor":39.9}],"prazoDias":7,"confirmar":true}}',
      '{"action":"handoff","reason":"Criação de arte (Design)","department":"5"}',
    ];
    const system = (niche === "grafica" ? buildGrafica() : buildOtica()).filter(Boolean).join("\n");

    const wantsSchedule = /\b(agend|marc|hor[áa]rio|exame|consulta|disponib)/i.test((inboundText ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
    let toolLog = "";
    let toolUsed = false;
    for (let step = 0; step < 4; step++) {
      const user = `Conversa até agora:\n${histText}\n\nÚltima mensagem do cliente: ${inboundText}${toolLog ? `\n\nResultados de ferramentas:${toolLog}` : ""}\n\nResponda em JSON.`;
      const raw = await this.orgAi.complete(orgId, system, user, 600);
      if (!raw) { this.logger.warn(`agentTurn: provedores de IA não retornaram nada (org=${orgId})`); void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "fallback", question: inboundText, response: "IA sem resposta" }); return false; }
      const parsed: any = this.extractFirstJson(raw);
      if (!parsed) {
        // O modelo respondeu em PROSA (sem JSON válido). Em vez de cair no menu
        // "não entendi", entregamos a resposta dele ao cliente. Tenta salvar um
        // campo "text" de um JSON malformado; senão usa o texto limpo.
        const salvaged = raw.match(/"(?:text|reply|message|content|resposta)"\s*:\s*"([\s\S]{2,}?)"\s*[},]/i);
        const prose = (salvaged?.[1] ?? raw).replace(/```[a-z]*|```/gi, "").replace(/\\n/g, "\n").trim();
        if (prose && !/^[{[]/.test(prose)) { await this.sendBot(conv, prose.slice(0, 1500)); void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "uncertain", question: inboundText, response: prose.slice(0, 1500) }); return true; }
        this.logger.warn(`agentTurn: resposta sem JSON utilizável (org=${orgId}): ${raw.slice(0, 300)}`);
        void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "fallback", question: inboundText, response: raw.slice(0, 300) });
        return false;
      }
      // normaliza as chaves que modelos mais fracos costumam variar (reply/message,
      // tool/function, args/arguments) pra não descartar uma resposta válida.
      const replyText = parsed.text ?? parsed.reply ?? parsed.message ?? parsed.content ?? parsed.resposta ?? parsed.response ?? parsed.output ?? null;
      const toolName = parsed.name ?? parsed.tool ?? parsed.function ?? (parsed.action && !["reply", "responder", "tool", "handoff", "transferir"].includes(String(parsed.action).toLowerCase()) ? parsed.action : null);
      const toolArgs = parsed.args ?? parsed.arguments ?? parsed.parameters ?? parsed.params ?? {};
      const action = String(parsed.action ?? (toolName ? "tool" : replyText ? "reply" : "")).toLowerCase();
      // rede de segurança: se "enrolou" (vou verificar/aguarde) sem usar ferramenta
      // e o cliente quer agendar, força a busca de horários em vez de encerrar.
      if (action.startsWith("repl") && !toolUsed && wantsSchedule && /verific|aguard|momento|instante|j[áa] (vou|te)/i.test(String(replyText ?? ""))) {
        const result = await this.runAgentTool(conv, "ver_horarios", {}).catch((e) => `erro: ${e?.message}`);
        toolLog += `\n[ver_horarios] => ${result}`;
        void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "tool", question: "ver_horarios", response: `(auto) => ${result}`.slice(0, 1500) });
        toolUsed = true;
        continue;
      }
      if (action === "handoff" || action === "transferir") { await this.botHandoff(conv, sessionId, String(parsed.reason ?? "Atendimento"), ["1", "2", "3", "4", "5"].includes(String(parsed.department)) ? String(parsed.department) : "5", replyText ? String(replyText) : null); void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "handoff", question: inboundText, response: String(parsed.reason ?? "Atendimento") }); return true; }
      if (action === "tool" && toolName) {
        const result = await this.runAgentTool(conv, String(toolName), toolArgs).catch((e) => `erro: ${e?.message}`);
        toolLog += `\n[${toolName}] => ${result}`;
        // trace: registra a chamada de ferramenta (entrada → saída) pra auditoria do fluxo
        void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "tool", question: String(toolName), response: `args:${(() => { try { return JSON.stringify(toolArgs); } catch { return "{}"; } })()} => ${result}`.slice(0, 1500) });
        toolUsed = true;
        continue;
      }
      if (replyText && String(replyText).trim()) { await this.sendBot(conv, String(replyText).replace(/\\n/g, "\n").slice(0, 1500)); void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "answered", question: inboundText, response: String(replyText).slice(0, 1500) }); return true; }
      this.logger.warn(`agentTurn: JSON sem action/texto reconhecível (org=${orgId}): ${raw.slice(0, 300)}`);
      void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "fallback", question: inboundText, response: raw.slice(0, 300) });
      return false;
    }
    // estourou os passos → transfere
    await this.botHandoff(conv, sessionId, "Não consegui resolver automaticamente", "5", null);
    void this.aiLearning.record(orgId, { storeId: conv.storeId ?? null, conversationId: conv.id, botSessionId: sessionId, eventType: "handoff", question: inboundText, response: "estouro de passos" });
    return true;
  }

  /** Executa uma ferramenta de LEITURA e devolve um resumo textual pra IA. */
  private async runAgentTool(conv: any, name: string, args: any): Promise<string> {
    const orgId = conv.organizationId;

    // ===== ferramentas do nicho GRÁFICA/UNIFORMES =====
    if (name === "listar_catalogo") {
      // tabela de valores da gráfica (faixa por qtd); fallback p/ produtos genéricos
      const gi = await this.pa((tx) => tx.graficaPriceItem.findMany({ where: { organizationId: orgId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).catch(() => [] as any[]);
      if (gi.length) {
        const byCat = new Map<string, string[]>();
        for (const it of gi as any[]) {
          const tiers = (Array.isArray(it.tiers) ? it.tiers : []) as Array<{ minQty: number; priceCents: number }>;
          const min = tiers.length ? Math.min(...tiers.map((t) => t.priceCents)) : 0;
          const cat = (it.category || "Outros").trim();
          if (!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat)!.push(`${it.name}${min ? ` — a partir de ${brl(min)}` : ""}`);
        }
        return [...byCat.entries()].map(([cat, items]) => `*${cat}*\n${items.join("\n")}`).join("\n\n");
      }
      const rows = await this.pa((tx) => tx.product.findMany({ where: { organizationId: orgId, isActive: true, deletedAt: null, showInCatalog: true }, select: { name: true, category: true, priceCashCents: true }, take: 100, orderBy: [{ category: "asc" }, { name: "asc" }] }));
      if (rows.length === 0) return "catálogo vazio — peça pra transferir pra um atendente";
      const byCat = new Map<string, string[]>();
      for (const p of rows as any[]) {
        const cat = (p.category || "Outros").trim();
        const line = `${p.name}${p.priceCashCents ? ` — a partir de ${brl(p.priceCashCents)}` : ""}`;
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat)!.push(line);
      }
      return [...byCat.entries()].map(([cat, items]) => `*${cat}*\n${items.join("\n")}`).join("\n\n");
    }
    if (name === "tabela_valores") {
      const q = String(args?.q ?? "").trim().toLowerCase();
      // tabela de valores da gráfica (preço por FAIXA de quantidade)
      const gi = await this.pa((tx) => tx.graficaPriceItem.findMany({ where: { organizationId: orgId, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).catch(() => [] as any[]);
      if (gi.length) {
        const match = (gi as any[]).filter((it) => !q || String(it.name).toLowerCase().includes(q) || String(it.category ?? "").toLowerCase().includes(q));
        const list = match.length ? match : gi;
        return (list as any[]).map((it) => {
          const tiers = ([...(Array.isArray(it.tiers) ? it.tiers : [])] as Array<{ minQty: number; priceCents: number }>).sort((a, b) => a.minQty - b.minQty);
          const txt = tiers.map((t) => `${t.minQty}+ ${brl(t.priceCents)}`).join(" · ");
          return `${it.name}: ${txt} (preço por unidade conforme a quantidade)`;
        }).join("\n");
      }
      const rows = await this.pa((tx) => tx.product.findMany({ where: { organizationId: orgId, isActive: true, deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }] } : {}) }, select: { name: true, priceCashCents: true, priceCardFullCents: true, priceCardInstallmentsCents: true, maxInstallments: true }, take: 20, orderBy: { name: "asc" } }));
      if (rows.length === 0) return `nenhum item encontrado para "${q}"`;
      return rows.map((p: any) => {
        const parts = [p.name];
        if (p.priceCashCents) parts.push(`à vista ${brl(p.priceCashCents)}`);
        if (p.priceCardInstallmentsCents && p.maxInstallments) parts.push(`ou ${p.maxInstallments}x de ${brl(p.priceCardInstallmentsCents)}`);
        return parts.join(": ").replace(": ou", " ou");
      }).join("\n");
    }
    if (name === "status_pedido") {
      if (!conv.customerId) return "cliente não identificado";
      const orders = await this.pa((tx) => tx.productionOrder.findMany({ where: { organizationId: orgId, customerId: conv.customerId, status: { notIn: ["finalizado", "cancelado"] } }, orderBy: { createdAt: "desc" }, take: 5, select: { shortCode: true, status: true, artStatus: true, dueDate: true } }));
      if (orders.length === 0) return "sem pedidos de produção em aberto";
      const lbl: Record<string, string> = { aguardando_arquivos: "aguardando arquivos", arquivos_recebidos: "arquivos recebidos", em_producao: "arte em produção", enviada: "arte enviada p/ aprovação", reprovada: "arte reprovada", aprovada: "arte aprovada" };
      return orders.map((o: any) => `${o.shortCode ?? "pedido"}: ${this.production.statusLabel(o.status)} (${lbl[o.artStatus] ?? o.artStatus})${o.dueDate ? ` · entrega ${new Date(o.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}`).join("\n");
    }
    if (name === "aprovar_arte") {
      if (!conv.customerId) return "cliente não identificado";
      if (!args?.confirmar) return "peça a confirmação do cliente e chame de novo com confirmar:true";
      const pending = await this.pa((tx) => tx.productionOrder.findFirst({ where: { organizationId: orgId, customerId: conv.customerId, artStatus: "enviada", status: { notIn: ["finalizado", "cancelado"] } }, orderBy: { createdAt: "desc" }, select: { id: true, shortCode: true } }));
      if (!pending) return "não há arte pendente de aprovação para este cliente";
      try {
        await this.production.portalReviewArt(orgId, conv.customerId, pending.id, { decision: "approved" });
        return `arte do pedido ${pending.shortCode ?? ""} APROVADA — a mensagem com tabela de medidas, Pix e prazo já foi enviada`;
      } catch (e: any) {
        return `erro ao aprovar: ${e?.message ?? "falhou"}`;
      }
    }
    // ---- orçamento / pedido (gráfica) ----
    if (name === "criar_orcamento" || name === "criar_pedido") {
      const sysCtx: any = { orgId, isOrgAdmin: true };
      // itens: [{descricao, qtd, valor(reais)}] — aceita variações de chave
      const raw = Array.isArray(args?.itens) ? args.itens : Array.isArray(args?.items) ? args.items : [];
      const items = raw.map((it: any) => ({
        description: String(it?.descricao ?? it?.description ?? it?.nome ?? "").trim().slice(0, 200),
        qty: Math.max(1, Math.trunc(Number(it?.qtd ?? it?.quantidade ?? it?.qty ?? 1) || 1)),
        unitPriceCents: Math.max(0, Math.round(Number(it?.valor ?? it?.preco ?? it?.unitPrice ?? 0) * 100)),
      })).filter((it: any) => it.description && it.unitPriceCents > 0);
      if (!items.length) return "informe os itens com descrição e valor unitário (em reais). Ex.: itens:[{descricao:'Camisa poliéster',qtd:10,valor:39.9}]";
      const contactName = conv.contactName || "Cliente";
      const contactPhone = conv.contactPhone ?? null;
      const total = items.reduce((s: number, it: any) => s + it.unitPriceCents * it.qty, 0);

      if (name === "criar_orcamento") {
        const q = await this.quotes.create(sysCtx, { customerId: conv.customerId ?? null, contactName, contactPhone, items });
        let enviado = "";
        if (args?.enviar === true || args?.enviar === "true") {
          const r = await this.quotes.send(sysCtx, q.id, "whatsapp").catch(() => null);
          enviado = r ? " e ENVIADO ao cliente por WhatsApp (PDF anexo)" : " (não consegui enviar agora — verifique o WhatsApp da empresa)";
        }
        return `orçamento ${q.shortCode ?? ""} registrado${enviado}. Total ${brl(total)}. ${args?.enviar ? "" : "Para enviar, chame enviar_orcamento com o código " + (q.shortCode ?? "") + "."}`.trim();
      }
      // criar_pedido (produção) — exige cliente identificado + confirmação
      if (!conv.customerId) return "PRECISA_CADASTRAR: identifique o cliente (cadastrar_cliente) antes de criar o pedido.";
      if (args?.confirmar !== true) return `PRECISA_CONFIRMAR: confirme com o cliente os itens e o total ${brl(total)} e chame de novo com confirmar:true`;
      const cfg = await this.pa((tx) => tx.callCenterSettings.findFirst({ where: { organizationId: orgId }, select: { graficaLeadDays: true, graficaDownPaymentPct: true } })).catch(() => null);
      const leadDays = Math.max(0, cfg?.graficaLeadDays ?? 7);
      const pct = Math.min(100, Math.max(0, cfg?.graficaDownPaymentPct ?? 50));
      const prazoDias = Number.isFinite(Number(args?.prazoDias)) ? Math.max(0, Math.trunc(Number(args.prazoDias))) : leadDays;
      const dueDate = new Date(Date.now() + prazoDias * 86400_000).toISOString().slice(0, 10);
      const downPaymentCents = Math.round(total * pct / 100);
      try {
        const o = await this.production.create(sysCtx, { customerId: conv.customerId, contactName, contactPhone, delivery: !!args?.entrega, dueDate, downPaymentCents, items });
        const sinalTxt = pct >= 100 ? `pagamento total ${brl(total)}` : pct > 0 ? `sinal ${pct}% = ${brl(downPaymentCents)} (saldo ${brl(total - downPaymentCents)} na entrega)` : `total ${brl(total)}`;
        return `pedido ${o.shortCode ?? ""} criado. Total ${brl(total)} · ${sinalTxt} · prazo até ${new Date(dueDate + "T12:00:00Z").toLocaleDateString("pt-BR")}. O Design vai cuidar da arte.`;
      } catch (e: any) {
        return `erro ao criar pedido: ${e?.message ?? "falhou"}`;
      }
    }
    if (name === "enviar_orcamento") {
      const sysCtx: any = { orgId, isOrgAdmin: true };
      const codigo = String(args?.codigo ?? args?.shortCode ?? "").trim().toUpperCase();
      const q = await this.pa((tx) => tx.quote.findFirst({
        where: { organizationId: orgId, ...(codigo ? { shortCode: codigo } : { customerId: conv.customerId ?? "__none__" }) },
        orderBy: { createdAt: "desc" }, select: { id: true, shortCode: true },
      })).catch(() => null);
      if (!q) return codigo ? `orçamento ${codigo} não encontrado` : "não achei um orçamento recente deste cliente — crie um com criar_orcamento";
      const r = await this.quotes.send(sysCtx, q.id, "whatsapp").catch(() => null);
      return r ? `orçamento ${q.shortCode ?? ""} enviado ao cliente por WhatsApp (PDF anexo)` : "não consegui enviar agora — verifique o WhatsApp da empresa";
    }
    if (name === "converter_orcamento") {
      // cliente ACEITOU o orçamento → vira pedido de produção (sinal pela política)
      if (args?.confirmar !== true) return "PRECISA_CONFIRMAR: confirme com o cliente que ele aceitou o orçamento e chame de novo com confirmar:true";
      const sysCtx: any = { orgId, isOrgAdmin: true };
      const codigo = String(args?.codigo ?? args?.shortCode ?? "").trim().toUpperCase();
      const q = await this.pa((tx) => tx.quote.findFirst({
        where: { organizationId: orgId, status: { not: "converted" }, ...(codigo ? { shortCode: codigo } : { customerId: conv.customerId ?? "__none__" }) },
        orderBy: { createdAt: "desc" }, select: { id: true, shortCode: true },
      })).catch(() => null);
      if (!q) return codigo ? `orçamento ${codigo} não encontrado (ou já virou pedido)` : "não achei um orçamento aberto deste cliente — crie um com criar_orcamento";
      try {
        const r = await this.quotes.convertToProduction(sysCtx, q.id);
        const o: any = (r as any)?.order ?? {};
        return `orçamento ${q.shortCode ?? ""} ACEITO e convertido no pedido ${o.shortCode ?? ""}. O time de Design já vai criar a arte.`;
      } catch (e: any) {
        return `erro ao converter: ${e?.message ?? "falhou"}`;
      }
    }

    if (name === "buscar_produtos") {
      const q = String(args?.q ?? "").trim();
      const rows = await this.pa((tx) => tx.product.findMany({ where: { organizationId: orgId, isActive: true, deletedAt: null, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, select: { name: true, priceCashCents: true, category: true }, take: 8, orderBy: { name: "asc" } }));
      if (rows.length === 0) return "nenhum produto encontrado";
      return rows.map((p: any) => `${p.name}${p.priceCashCents ? ` — ${brl(p.priceCashCents)}` : ""}`).join("; ");
    }
    if (name === "ver_agendamentos") {
      if (!conv.customerId) return "cliente não identificado";
      const apts = await this.pa((tx) => tx.appointment.findMany({ where: { customerId: conv.customerId, deletedAt: null, status: { in: ["pending", "confirmed", "rescheduled"] }, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 5, select: { startsAt: true, serviceName: true, status: true } }));
      if (apts.length === 0) return "sem agendamentos futuros";
      return apts.map((a: any) => `${new Date(a.startsAt).toLocaleString("pt-BR")} (${a.status})${a.serviceName ? ` ${a.serviceName}` : ""}`).join("; ");
    }
    if (name === "ver_crediario") {
      if (!conv.customerId) return "cliente não identificado";
      const acct = await this.pa((tx) => tx.creditAccount.findFirst({ where: { organizationId: orgId, primaryCustomerId: conv.customerId }, select: { id: true } }));
      if (!acct) return "cliente não tem crediário";
      const inst = await this.pa((tx) => tx.creditInstallment.findMany({ where: { creditAccountId: acct.id, status: "pending" }, orderBy: { dueDate: "asc" }, take: 6, select: { number: true, dueDate: true, amountCents: true } }));
      const org = await this.pa((tx) => tx.organization.findFirst({ where: { id: orgId }, select: { slug: true } }));
      const link = `${orgBaseUrl(org?.slug)}/c`;
      if (inst.length === 0) return `nenhuma parcela em aberto. Portal: ${link}`;
      return inst.map((i: any) => `parcela ${i.number} vence ${new Date(i.dueDate).toLocaleDateString("pt-BR")} ${brl(Number(i.amountCents))}`).join("; ") + ` — 2ª via/pagamento no portal: ${link}`;
    }
    if (name === "ver_horarios") {
      const date = String(args?.data ?? "").slice(0, 10);
      const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
      // janela ampla (tolera fuso BR); o agrupamento por dia é feito em horário SP
      const from = hasDate ? new Date(date + "T00:00:00.000Z") : new Date(Date.now() - 3 * 3600_000);
      const to = hasDate ? new Date(date + "T23:59:59.999Z") : new Date(Date.now() + 21 * 86400_000);
      // Hora mínima que a IA pode oferecer (horários antes ficam reservados pra
      // equipe interna marcar manualmente). Default 7 (07:00).
      const minHour = await this.aiMinBookingHour(orgId);
      const slots = await this.pa((tx) => tx.scheduleSlot.findMany({ where: { organizationId: orgId, deletedAt: null, isBlocked: false, startsAt: { gte: from, lte: to } }, orderBy: { startsAt: "asc" }, take: 200, select: { startsAt: true, capacity: true, used: true } }));
      const free = slots.filter((s: any) =>
        (s.used ?? 0) < (s.capacity ?? 1)
        && new Date(s.startsAt).getTime() > Date.now()
        // slots são gravados em UTC = relógio de parede; getUTCHours() = hora local exibida
        && new Date(s.startsAt).getUTCHours() >= minHour,
      );
      if (free.length === 0) return hasDate ? "sem horários livres nesse dia" : "sem horários livres nos próximos dias";
      // agrupa por dia (em horário de Brasília) → no MÁXIMO 2 datas, 4 horários cada
      const byDay = new Map<string, string[]>();
      for (const s of free) {
        const d = new Date(s.startsAt);
        const dayISO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d); // AAAA-MM-DD
        const hhmm = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
        const arr = byDay.get(dayISO) ?? [];
        if (arr.length < 4) arr.push(hhmm);
        byDay.set(dayISO, arr);
      }
      const days = [...byDay.entries()].slice(0, hasDate ? 1 : 2);
      const blocks = days.map(([dayISO, times]) => {
        const label = new Date(dayISO + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
        return `📅 ${label}\n${times.map((t) => `🕐 ${t}`).join("\n")}`;
      });
      // O bloco já vem pronto e dentro da regra (2 datas × 4 horários). A IA deve
      // ENVIAR exatamente estes horários, mantendo a estrutura com 📅 e 🕐.
      return "MOSTRE_EXATAMENTE_ESTES_HORARIOS (não invente nem acrescente outros; mantenha as quebras de linha, 📅 e 🕐):\n" + blocks.join("\n\n");
    }
    // ----- ações que ALTERAM (confirmar + identidade) -----
    if (name === "renomear_contato") {
      // IA usa quando o cliente DIZ o nome dele ("oi, sou o Yuri", "aqui é a Maria").
      // Atualiza conversation.contactName e (se houver) customer.name, pra todas as
      // próximas mensagens já saírem com o nome certo. Não exige cadastro.
      const nome = String(args?.nome ?? "").trim().slice(0, 80);
      if (nome.length < 2) return "nome muito curto — peça pra repetir";
      await this.pa((tx) => tx.conversation.update({ where: { id: conv.id }, data: { contactName: nome } })).catch(() => undefined);
      if (conv.customerId) {
        await this.pa((tx) => tx.customer.update({ where: { id: conv.customerId }, data: { name: nome } })).catch(() => undefined);
      }
      conv.contactName = nome;
      return `contato renomeado pra "${nome}". Use esse nome nas próximas respostas.`;
    }
    if (name === "cadastrar_cliente") {
      const nome = String(args?.nome ?? "").trim();
      const phone = this.normalizePhone(String(args?.telefone ?? ""));
      if (!phone) return "telefone inválido — peça o número com DDD (ex.: 71 99999-9999)";
      if (nome.length < 2) return "informe o nome completo do cliente";
      const tail = phone.slice(-8);
      let cust = tail.length >= 8
        ? await this.pa((tx) => tx.customer.findFirst({ where: { organizationId: orgId, deletedAt: null, OR: [{ phone: { contains: tail } }, { whatsappPhone: { contains: tail } }] }, select: { id: true, name: true } }))
        : null;
      if (!cust) {
        const store = await this.pa((tx) => tx.store.findFirst({ where: { organizationId: orgId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } }));
        if (!store) return "não consegui cadastrar (empresa sem loja)";
        cust = await this.pa((tx) => tx.customer.create({ data: { organizationId: orgId, storeId: store.id, name: nome, phone, whatsappPhone: phone, source: "bot" }, select: { id: true, name: true } }));
      }
      return `cliente ${cust.name} (telefone ${phone}) — customerId=${cust.id}. Confirme com o cliente que o telefone ${phone} está correto antes de agendar.`;
    }
    if (name === "agendar") {
      const customerId = (args?.customerId && String(args.customerId)) || conv.customerId;
      if (!customerId) return "PRECISA_CADASTRAR: o número não é cadastrado. Peça nome e telefone e use cadastrar_cliente primeiro.";
      if (args?.confirmar !== true) return "PRECISA_CONFIRMAR: pergunte se o cliente confirma o agendamento nesse horário";
      // resolve o slot por data+hora (mais robusto que decorar slotId entre turnos)
      let slotId = args?.slotId ? String(args.slotId) : null;
      if (!slotId) {
        const day = String(args?.data ?? "").slice(0, 10);
        const hm = String(args?.hora ?? "").match(/(\d{1,2}):(\d{2})/);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !hm) return "informe a data (AAAA-MM-DD) e a hora (HH:MM) que o cliente escolheu (ou use ver_horarios)";
        const want = `${(hm[1] ?? "").padStart(2, "0")}:${hm[2] ?? ""}`;
        const from = new Date(day + "T00:00:00.000Z");
        const to = new Date(day + "T23:59:59.999Z");
        const slots = await this.pa((tx) => tx.scheduleSlot.findMany({ where: { organizationId: orgId, deletedAt: null, isBlocked: false, startsAt: { gte: new Date(from.getTime() - 12 * 3600_000), lte: new Date(to.getTime() + 12 * 3600_000) } }, select: { id: true, startsAt: true, capacity: true, used: true } }));
        const hit = slots.find((s: any) => {
          const d = new Date(s.startsAt).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
          const t = new Date(s.startsAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
          return d === day && t === want && (s.used ?? 0) < (s.capacity ?? 1);
        });
        if (!hit) return `não há horário livre em ${day} às ${want}. Use ver_horarios pra ver os horários realmente disponíveis e ofereça outro.`;
        slotId = hit.id;
      }
      const slotStore = await this.pa((tx) => tx.scheduleSlot.findFirst({ where: { id: slotId! }, select: { storeId: true, startsAt: true } }));
      // Trava da hora mínima da IA: mesmo que o cliente peça/escolha um slot mais
      // cedo, a IA não agenda antes do horário reservado pra equipe interna.
      const minHour = await this.aiMinBookingHour(orgId);
      if (slotStore?.startsAt && new Date(slotStore.startsAt).getUTCHours() < minHour) {
        return `esse horário é reservado pra marcação interna (a IA agenda a partir das ${String(minHour).padStart(2, "0")}:00). Ofereça ao cliente um horário a partir das ${String(minHour).padStart(2, "0")}:00 com ver_horarios.`;
      }
      try { const a = await this.appointments.create(this.sysCtx(orgId, slotStore?.storeId), { slotId, customerId: String(customerId), skipNotify: true } as any); return `AGENDADO (status PENDENTE, protocolo ${(a as any)?.shortCode ?? (a as any)?.id ?? "ok"}). Avise que o horário está RESERVADO/AGENDADO (ainda NÃO confirmado) e que ele pode responder aqui a qualquer momento para CANCELAR ou REAGENDAR. NÃO diga que está "confirmado".`; }
      catch (e: any) { this.logger.error(`agendar FALHOU org=${orgId} slot=${slotId} cust=${customerId}: ${e?.stack ?? e?.message}`); return `não foi possível agendar: ${e?.message ?? "erro"}`; }
    }
    if (name === "cancelar_agendamento") {
      if (args?.confirmar !== true) return "PRECISA_CONFIRMAR: pergunte se o cliente confirma o cancelamento";
      if (!args?.appointmentId) return "informe o appointmentId (use ver_agendamentos)";
      const aptC = await this.pa((tx) => tx.appointment.findFirst({ where: { id: String(args.appointmentId) }, select: { storeId: true } }));
      try { await this.appointments.cancel(this.sysCtx(orgId, aptC?.storeId), String(args.appointmentId), { actor: "customer", reason: "Cancelado pelo cliente via assistente" }); return "agendamento cancelado"; }
      catch (e: any) { this.logger.error(`cancelar FALHOU org=${orgId} apt=${args?.appointmentId}: ${e?.stack ?? e?.message}`); return `não foi possível cancelar: ${e?.message ?? "erro"}`; }
    }
    if (name === "reagendar") {
      if (args?.confirmar !== true) return "PRECISA_CONFIRMAR: pergunte se o cliente confirma a mudança de horário";
      if (!args?.appointmentId || !args?.slotId) return "informe appointmentId e slotId";
      const aptR = await this.pa((tx) => tx.appointment.findFirst({ where: { id: String(args.appointmentId) }, select: { storeId: true } }));
      try { await this.appointments.reschedule(this.sysCtx(orgId, aptR?.storeId), String(args.appointmentId), String(args.slotId), "customer"); return "reagendado com sucesso"; }
      catch (e: any) { this.logger.error(`reagendar FALHOU org=${orgId} apt=${args?.appointmentId} slot=${args?.slotId}: ${e?.stack ?? e?.message}`); return `não foi possível reagendar: ${e?.message ?? "erro"}`; }
    }
    if (name === "transferir_pessoa") {
      const nome = String(args?.nome ?? "").trim();
      if (!nome) return "informe o nome do atendente";
      const ms = await this.pa((tx) => tx.membership.findMany({ where: { organizationId: orgId, status: "active" }, select: { id: true, user: { select: { name: true } } } }));
      const match = ms.find((m: any) => (m.user?.name ?? "").toLowerCase().includes(nome.toLowerCase()));
      if (!match) return `não encontrei atendente "${nome}"`;
      await this.pa((tx) => tx.conversation.update({ where: { id: conv.id }, data: { assigneeMembershipId: match.id, botActive: false } }));
      await this.systemNote(orgId, conv.id, `IA transferiu para ${match.user?.name ?? "atendente"}.`).catch(() => undefined);
      return `transferido para ${match.user?.name ?? nome}`;
    }
    if (name === "solicitar_token") {
      if (!conv.customerId) return "cliente não identificado";
      try { await this.requestToken(this.sysCtx(orgId), conv.id); return "código de 4 dígitos enviado ao cliente. Peça que ele informe."; }
      catch (e: any) { return `não foi possível enviar o token: ${e?.message ?? "erro"}`; }
    }
    if (name === "validar_token") {
      const code = String(args?.codigo ?? "").replace(/\D/g, "").slice(0, 4);
      try { await this.validateToken(this.sysCtx(orgId), conv.id, code); return "identidade confirmada (token validado)"; }
      catch (e: any) { return `token inválido: ${e?.message ?? "erro"}`; }
    }
    if (name === "resetar_senha") {
      if (!conv.customerId) return "cliente não identificado";
      const fresh = await this.pa((tx) => tx.conversation.findFirst({ where: { id: conv.id }, select: { tokenStatus: true } }));
      if (fresh?.tokenStatus !== "validated") return "IDENTIDADE_NAO_CONFIRMADA: faça solicitar_token e validar_token antes de resetar a senha";
      if (args?.confirmar !== true) return "PRECISA_CONFIRMAR: pergunte se o cliente confirma o reset de senha";
      await this.pa((tx) => tx.customer.update({ where: { id: conv.customerId }, data: { portalPasswordHash: null, portalMustReset: true } })).catch(() => undefined);
      await this.systemNote(orgId, conv.id, "IA resetou a senha do portal do cliente (identidade validada por token).").catch(() => undefined);
      return "senha resetada — o cliente vai definir uma nova no próximo acesso ao portal";
    }
    return "ferramenta desconhecida";
  }

  /** Conclui a triagem do bot e transfere pro humano (handoff). */
  private async botHandoff(conv: any, sessionId: string, reason: string, choice: string, replyText: string | null): Promise<void> {
    const orgId = conv.organizationId;
    await this.pa(async (tx) => {
      await tx.botSession.update({ where: { id: sessionId }, data: { status: "handoff", currentStep: "done", data: { reason, choice } as any } }).catch(() => undefined);
      await tx.conversation.update({ where: { id: conv.id }, data: { botActive: false, subject: reason, priority: choice === "4" ? "high" : "normal" } });
      await tx.conversationMessage.create({ data: { organizationId: orgId, conversationId: conv.id, direction: "out", authorType: "system", content: `Triagem concluída pela IA: ${reason}. Cliente: ${conv.contactName ?? conv.contactPhone ?? "—"}.`, contentType: "event", isPrivate: true, status: "sent" } });
    });
    await this.sendBot(conv, replyText || "Perfeito! ✅ Já estou te transferindo para um atendente. Em instantes alguém continua por aqui. 🙂");
    await this.notifications.notify({ organizationId: orgId, storeId: orgId, subject: "Nova conversa para atendimento", text: `Triagem por IA (${reason}). Contato: ${conv.contactName ?? conv.contactPhone ?? "—"}.`, templateCode: "inbox_internal", internalOnly: true } as any).catch(() => undefined);
  }

  /**
   * Resposta consumida pela automação (ex.: confirmação de agendamento via NLU).
   * Tira a conversa da fila do atendimento: zera não-lidas, registra nota de
   * sistema e — se não houver atendente humano — resolve (some de "Abertas").
   * Se o cliente mandar outra mensagem depois, a ingestão reabre normalmente.
   */
  async handleAutomatedReply(conversationId: string, note: string): Promise<void> {
    try {
      const conv = await this.pa((tx) => tx.conversation.findFirst({ where: { id: conversationId } }));
      if (!conv) return;
      await this.systemNote(conv.organizationId, conversationId, note).catch(() => undefined);
      const data: any = { unreadAgent: 0, botActive: false };
      if (!conv.assigneeMembershipId && conv.status !== "resolved") {
        data.status = "resolved";
        data.resolvedAt = new Date();
      }
      await this.pa((tx) => tx.conversation.update({ where: { id: conversationId }, data })).catch(() => undefined);
    } catch (e: any) {
      this.logger.error(`handleAutomatedReply: ${e?.message}`);
    }
  }

  // ============================== INGESTÃO (entrada) ==============================
  /**
   * Recebe uma mensagem de entrada de qualquer canal. Acha/cria a inbox e a
   * conversa, deduplica por externalId e grava a mensagem. Retorna a conversa
   * (pra o bot decidir agir). NUNCA lança — best-effort.
   */
  async ingestInbound(opts: {
    organizationId: string; storeId?: string | null; channel: string; channelRef: string;
    contact: { phone?: string | null; name?: string | null; email?: string | null; customerId?: string | null };
    externalKey: string;            // chave da conversa (jid whatsapp / email / sessão webchat)
    msgExternalId?: string | null;  // id da mensagem (dedup)
    content: string; contentType?: string; mediaUrl?: string | null; mediaMime?: string | null;
  }): Promise<{ conversationId: string; inboxId: string; isNew: boolean } | null> {
    const orgId = opts.organizationId;
    try {
      return await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
        // inbox por (org, channel, channelRef) — cria default se não existir
        let inbox = await tx.inbox.findFirst({ where: { organizationId: orgId, channel: opts.channel, channelRef: opts.channelRef } });
        if (!inbox) {
          inbox = await tx.inbox.create({
            data: { organizationId: orgId, storeId: opts.storeId ?? null, name: opts.channel === "whatsapp" ? "WhatsApp" : opts.channel, channel: opts.channel, channelRef: opts.channelRef, botEnabled: false },
          });
        }
        // conversa aberta: casa por externalKey OU cliente OU telefone (últimos 8
        // dígitos), pra não duplicar quando o WhatsApp troca o jid (LID x número).
        const phoneTail = (opts.contact.phone ?? "").replace(/\D/g, "").slice(-8);
        const orMatch: any[] = [{ externalId: opts.externalKey }];
        if (opts.contact.customerId) orMatch.push({ customerId: opts.contact.customerId });
        if (phoneTail.length >= 8) orMatch.push({ contactPhone: { contains: phoneTail } });
        let conv = await tx.conversation.findFirst({ where: { inboxId: inbox.id, status: { not: "resolved" }, OR: orMatch }, orderBy: { createdAt: "desc" } });
        // mantém o externalId atualizado pro despacho de saída
        if (conv && conv.externalId !== opts.externalKey) {
          await tx.conversation.update({ where: { id: conv.id }, data: { externalId: opts.externalKey } }).catch(() => undefined);
        }
        let isNew = false;
        if (!conv) {
          conv = await tx.conversation.create({
            data: {
              organizationId: orgId, inboxId: inbox.id, channel: opts.channel, externalId: opts.externalKey,
              customerId: opts.contact.customerId ?? null, contactName: opts.contact.name ?? null,
              contactPhone: opts.contact.phone ?? null, contactEmail: opts.contact.email ?? null,
              teamId: inbox.teamId ?? null, slaPolicyId: inbox.slaPolicyId ?? null,
              status: "open", botActive: inbox.botEnabled, lastInboundAt: new Date(), lastMessageAt: new Date(),
            },
          });
          isNew = true;
        }
        // dedup por msgExternalId
        if (opts.msgExternalId) {
          const dup = await tx.conversationMessage.findFirst({ where: { conversationId: conv.id, externalId: opts.msgExternalId } });
          if (dup) return { conversationId: conv.id, inboxId: inbox.id, isNew: false };
        }
        await tx.conversationMessage.create({
          data: {
            organizationId: orgId, conversationId: conv.id, direction: "in", authorType: "contact",
            authorName: opts.contact.name ?? null, content: opts.content, contentType: opts.contentType ?? "text",
            mediaUrl: opts.mediaUrl ?? null, mediaMime: opts.mediaMime ?? null, externalId: opts.msgExternalId ?? null, status: "received",
            topic: (opts.contentType ?? "text") === "text" ? this.questionTopic(opts.content) : null,
          },
        });
        await tx.conversation.update({
          where: { id: conv.id },
          data: { lastInboundAt: new Date(), lastMessageAt: new Date(), unreadAgent: { increment: 1 }, status: conv.status === "resolved" ? "open" : conv.status, contactName: conv.contactName ?? opts.contact.name ?? null },
        });
        // Auto-assign: se conversa NÃO tem assignee, NÃO tem team, NÃO está com
        // bot ativo e há agente online com capacidade, atribui agora. Não bloqueia
        // a ingestão; se falhar, fica em "waiting" e operador puxa manual.
        if (!conv.assigneeMembershipId && !conv.teamId && !conv.botActive) {
          this.tryAutoAssign(orgId, conv.id).catch(() => undefined);
        }
        // webhooks out (best-effort): conversa nova e mensagem nova
        if (isNew) {
          void this.fireWebhookEvent(orgId, "conversation.created", { conversationId: conv.id, channel: opts.channel, contact: opts.contact });
        }
        void this.fireWebhookEvent(orgId, "message.created", { conversationId: conv.id, direction: "in", content: opts.content, contentType: opts.contentType ?? "text", channel: opts.channel });
        return { conversationId: conv.id, inboxId: inbox.id, isNew };
      });
    } catch (e: any) {
      this.logger.error(`ingestInbound falhou: ${e?.message}`);
      return null;
    }
  }

  /**
   * Mensagem de SAÍDA do WhatsApp (fromMe=true). Pode ser:
   *  - ECO de algo que NÓS enviamos (bot/atendente pelo sistema) → só ignora.
   *  - resposta do DONO direto no celular (fora do sistema) → registra na
   *    conversa como autor "whatsapp_direto" e PAUSA a IA por uma janela, pra não
   *    haver duas respostas conflitantes. Distingue o eco por casar o texto com um
   *    envio nosso recente (≤120s); sem casar = humano no celular.
   * Best-effort: nunca lança.
   */
  /** Auto-resolução silenciosa de conversas inativas.
   *
   *  Para cada org com callCenterSettings.autoResolveHours > 0, resolve
   *  (sem mandar mensagem ao cliente) toda conversa não-resolvida cuja
   *  lastMessageAt seja mais antiga que o limite.
   *
   *  IMPORTANTE: NÃO manda CSAT (auto-close = silencioso). Marca
   *  closedByMembershipId = null pra indicar que foi automático no relatório.
   *  Idempotente (não pega conversas já resolvidas).
   *
   *  Chamado pelo scheduler de 1 em 1 hora. */
  async autoResolveInactiveAllOrgs(): Promise<{ resolved: number }> {
    let resolved = 0;
    const orgs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.callCenterSettings.findMany({ where: { autoResolveHours: { gt: 0 } }, select: { organizationId: true, autoResolveHours: true } }),
    ).catch(() => [] as any[]);
    for (const o of orgs as any[]) {
      const cutoff = new Date(Date.now() - o.autoResolveHours * 3600_000);
      try {
        const r = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.conversation.updateMany({
            where: {
              organizationId: o.organizationId,
              status: { notIn: ["resolved", "snoozed"] },
              // Tem que estar inativa: nenhuma mensagem (inbound ou outbound)
              // depois do cutoff. lastMessageAt cobre os 2 lados.
              OR: [{ lastMessageAt: { lte: cutoff } }, { AND: [{ lastMessageAt: null }, { createdAt: { lte: cutoff } }] }],
            },
            data: { status: "resolved", resolvedAt: new Date(), botActive: false, assigneeMembershipId: null, teamId: null },
          }),
        );
        resolved += r.count;
        if (r.count > 0) this.logger.log(`auto-resolve org=${o.organizationId} ${r.count} conv(s) (>${o.autoResolveHours}h sem interação)`);
      } catch (e: any) {
        this.logger.warn(`auto-resolve falhou org=${o.organizationId}: ${e?.message}`);
      }
    }
    return { resolved };
  }

  /** Estado de quem está cuidando da conversa — usado pelo webhook do WhatsApp
   *  pra decidir se a automação (bot de IA / NLU de confirmação) deve agir.
   *
   *  - humanActive=true se há operador atribuído OU o dono respondeu direto pelo
   *    celular (botPausedUntil ativo). Nesse caso NADA automático fala (não
   *    atropela o operador — mesma regra da gráfica).
   *  - botEnabled=true se a inbox dessa conversa tem o bot de IA ligado. */
  async conversationHandlingState(conversationId: string): Promise<{ humanActive: boolean; botEnabled: boolean }> {
    const conv = await this.pa((tx) => tx.conversation.findFirst({
      where: { id: conversationId },
      select: { assigneeMembershipId: true, botPausedUntil: true, inboxId: true },
    })).catch(() => null);
    if (!conv) return { humanActive: false, botEnabled: false };
    const pausedByOwner = !!conv.botPausedUntil && new Date(conv.botPausedUntil).getTime() > Date.now();
    const humanActive = !!conv.assigneeMembershipId || pausedByOwner;
    const inbox = await this.pa((tx) => tx.inbox.findFirst({ where: { id: conv.inboxId }, select: { botEnabled: true } })).catch(() => null);
    return { humanActive, botEnabled: !!inbox?.botEnabled };
  }

  /** Hora mínima (0-23) que a IA pode oferecer/agendar. Default 7. Cache leve por chamada. */
  private async aiMinBookingHour(orgId: string): Promise<number> {
    const s = await this.pa((tx) => tx.callCenterSettings.findFirst({ where: { organizationId: orgId }, select: { aiMinBookingHour: true } })).catch(() => null);
    const h = (s as any)?.aiMinBookingHour;
    return typeof h === "number" && h >= 0 && h <= 23 ? h : 7;
  }

  async noteOutboundWhatsapp(opts: {
    organizationId: string;
    externalKey: string;       // remoteJid da conversa
    channelMessageId: string;  // id da mensagem (dedup)
    text: string;
  }): Promise<"echo" | "human" | "no-conversation" | "duplicate"> {
    const pauseHours = Number(process.env.BOT_DIRECT_REPLY_PAUSE_HOURS ?? 2);
    try {
      return await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
        const conv = await tx.conversation.findFirst({
          where: { organizationId: opts.organizationId, externalId: opts.externalKey, status: { not: "resolved" } },
          orderBy: { createdAt: "desc" },
        });
        if (!conv) return "no-conversation" as const;
        // dedup: já registramos essa msg?
        if (opts.channelMessageId) {
          const dup = await tx.conversationMessage.findFirst({ where: { conversationId: conv.id, externalId: opts.channelMessageId } });
          if (dup) return "duplicate" as const;
        }
        const text = (opts.text ?? "").trim();
        // ECO: enviamos algo igual nos últimos 120s? (bot/atendente/sistema)
        if (text) {
          const since = new Date(Date.now() - 120_000);
          const recentOurs = await tx.conversationMessage.findFirst({
            where: { conversationId: conv.id, direction: "out", authorType: { in: ["bot", "agent", "system"] }, createdAt: { gte: since }, content: text },
            orderBy: { createdAt: "desc" },
          });
          if (recentOurs) {
            // marca o externalId no nosso registro (pra dedup futuro) e ignora
            if (opts.channelMessageId && !recentOurs.externalId) {
              await tx.conversationMessage.update({ where: { id: recentOurs.id }, data: { externalId: opts.channelMessageId } }).catch(() => undefined);
            }
            return "echo" as const;
          }
        }
        // HUMANO no celular (fora do sistema): registra + pausa a IA
        const until = new Date(Date.now() + pauseHours * 3600_000);
        await tx.conversationMessage.create({
          data: {
            organizationId: opts.organizationId, conversationId: conv.id, direction: "out",
            authorType: "whatsapp_direto",
            // Label explícito pra o operador entender que NÃO foi pelo sistema —
            // antes aparecia só como "Você" e parecia mensagem do operador no app.
            authorName: "Atendente (WhatsApp direto)",
            content: text || "(mídia)", contentType: "text",
            externalId: opts.channelMessageId || null, status: "sent",
          },
        });
        await tx.conversationMessage.create({
          data: {
            organizationId: opts.organizationId, conversationId: conv.id, direction: "out", authorType: "system",
            content: `Resposta enviada pelo WhatsApp (fora do sistema). IA pausada por ${pauseHours}h para não conflitar.`,
            contentType: "event", isPrivate: true, status: "sent",
          },
        });
        await tx.conversation.update({ where: { id: conv.id }, data: { botPausedUntil: until, lastMessageAt: new Date() } });
        this.logger.log(`resposta humana direta no WhatsApp — IA pausada ${pauseHours}h conv=${conv.id}`);
        return "human" as const;
      });
    } catch (e: any) {
      this.logger.warn(`noteOutboundWhatsapp falhou: ${e?.message}`);
      return "no-conversation";
    }
  }
}
