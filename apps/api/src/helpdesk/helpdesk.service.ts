import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { orgBaseUrl } from "../common/org-url";
import type { RequestContext } from "../auth/session.middleware";

function shortCode(prefix: string): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) s += a[(buf[i] ?? 0) % a.length];
  return `${prefix}-${s}`;
}
function token(): string {
  return randomBytes(24).toString("base64url");
}

@Injectable()
export class HelpdeskService {
  private readonly logger = new Logger("Helpdesk");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private orgId(ctx: RequestContext): string {
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId!;
  }

  // ============================== CONFIG ==============================
  async listConfig(ctx: RequestContext) {
    const rls = this.rls(ctx);
    const [categories, teams, slas, hours] = await Promise.all([
      this.prisma.runWithContext(rls, (tx) => tx.ticketCategory.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } })),
      this.prisma.runWithContext(rls, (tx) => tx.helpdeskTeam.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: { members: true } })),
      this.prisma.runWithContext(rls, (tx) => tx.slaPolicy.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })),
      this.prisma.runWithContext(rls, (tx) => tx.businessHours.findMany({ orderBy: { weekday: "asc" } })),
    ]);
    return { categories, teams, slas, hours };
  }

  async upsertCategory(ctx: RequestContext, input: { id?: string; name: string; color?: string; defaultTeamId?: string; defaultSlaId?: string; displayOrder?: number }) {
    const orgId = this.orgId(ctx);
    const data = {
      name: input.name, color: input.color ?? null,
      defaultTeamId: input.defaultTeamId ?? null, defaultSlaId: input.defaultSlaId ?? null,
      displayOrder: input.displayOrder ?? 0,
    };
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id
        ? tx.ticketCategory.update({ where: { id: input.id }, data })
        : tx.ticketCategory.create({ data: { organizationId: orgId, ...data } }),
    );
  }

  async upsertTeam(ctx: RequestContext, input: { id?: string; name: string; description?: string; memberMembershipIds?: string[] }) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const team = input.id
        ? await tx.helpdeskTeam.update({ where: { id: input.id }, data: { name: input.name, description: input.description ?? null } })
        : await tx.helpdeskTeam.create({ data: { organizationId: orgId, name: input.name, description: input.description ?? null } });
      if (input.memberMembershipIds) {
        await tx.helpdeskTeamMember.deleteMany({ where: { teamId: team.id } });
        for (const m of input.memberMembershipIds) {
          await tx.helpdeskTeamMember.create({ data: { organizationId: orgId, teamId: team.id, membershipId: m } });
        }
      }
      return team;
    });
  }

  async upsertSla(ctx: RequestContext, input: { id?: string; name: string; priority?: string; firstResponseMins?: number; resolutionMins?: number; useBusinessHours?: boolean }) {
    const orgId = this.orgId(ctx);
    const data = {
      name: input.name, priority: input.priority ?? "normal",
      firstResponseMins: input.firstResponseMins ?? 240, resolutionMins: input.resolutionMins ?? 1440,
      useBusinessHours: input.useBusinessHours ?? true,
    };
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.slaPolicy.update({ where: { id: input.id }, data }) : tx.slaPolicy.create({ data: { organizationId: orgId, ...data } }),
    );
  }

  async setBusinessHours(ctx: RequestContext, rows: { weekday: number; isOpen: boolean; openTime: string; closeTime: string }[]) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      for (const r of rows) {
        await tx.businessHours.upsert({
          where: { organizationId_weekday: { organizationId: orgId, weekday: r.weekday } },
          create: { organizationId: orgId, weekday: r.weekday, isOpen: r.isOpen, openTime: r.openTime, closeTime: r.closeTime },
          update: { isOpen: r.isOpen, openTime: r.openTime, closeTime: r.closeTime },
        });
      }
      return { ok: true };
    });
  }

  // ============================== TICKETS ==============================
  async listTickets(ctx: RequestContext, f: { status?: string; assignee?: string; teamId?: string; q?: string }) {
    const where: any = {};
    if (f.status && f.status !== "all") {
      if (f.status === "open") where.status = { notIn: ["closed", "resolved"] };
      else where.status = f.status;
    }
    if (f.assignee) where.assigneeMembershipId = f.assignee;
    if (f.teamId) where.teamId = f.teamId;
    if (f.q) where.OR = [{ subject: { contains: f.q, mode: "insensitive" } }, { code: { contains: f.q, mode: "insensitive" } }, { requesterName: { contains: f.q, mode: "insensitive" } }];
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.ticket.findMany({ where, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 }),
    );
  }

  async getTicket(ctx: RequestContext, id: string) {
    const t = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.ticket.findFirst({
        where: { id },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          events: { orderBy: { createdAt: "asc" } },
          attachments: true,
          serviceOrders: { include: { items: true }, orderBy: { createdAt: "desc" } },
        },
      }),
    );
    if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
    return t;
  }

  private async slaDueDates(ctx: RequestContext, slaId: string | null, priority: string) {
    let frMins = 240, resMins = 1440;
    if (slaId) {
      const sla = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.slaPolicy.findFirst({ where: { id: slaId } }));
      if (sla) { frMins = sla.firstResponseMins; resMins = sla.resolutionMins; }
    } else if (priority === "urgent") { frMins = 60; resMins = 240; }
    else if (priority === "high") { frMins = 120; resMins = 480; }
    const now = Date.now();
    return { firstResponseDueAt: new Date(now + frMins * 60_000), resolutionDueAt: new Date(now + resMins * 60_000) };
  }

  async createTicket(ctx: RequestContext, input: {
    subject: string; description: string; priority?: string; categoryId?: string;
    teamId?: string; channel?: string; storeId?: string;
    requesterCustomerId?: string; requesterName?: string; requesterEmail?: string; requesterPhone?: string;
  }) {
    const orgId = this.orgId(ctx);
    // resolve categoria → equipe/SLA padrão
    let teamId = input.teamId ?? null;
    let slaId: string | null = null;
    if (input.categoryId) {
      const cat = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.ticketCategory.findFirst({ where: { id: input.categoryId } }));
      if (cat) { teamId = teamId ?? cat.defaultTeamId; slaId = cat.defaultSlaId; }
    }
    const priority = input.priority ?? "normal";
    const due = await this.slaDueDates(ctx, slaId, priority);
    const ticket = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.ticket.create({
        data: {
          organizationId: orgId, storeId: input.storeId ?? null, code: shortCode("CH"),
          channel: input.channel ?? "manual", categoryId: input.categoryId ?? null, teamId,
          subject: input.subject, priority, status: "new", slaPolicyId: slaId,
          firstResponseDueAt: due.firstResponseDueAt, resolutionDueAt: due.resolutionDueAt,
          requesterCustomerId: input.requesterCustomerId ?? null,
          requesterName: input.requesterName ?? null, requesterEmail: input.requesterEmail ?? null,
          requesterPhone: input.requesterPhone ?? null,
          createdByMembershipId: ctx.membershipId ?? null,
          publicToken: token(),
          messages: { create: { organizationId: orgId, authorType: ctx.userId ? "agent" : "customer", authorMembershipId: ctx.membershipId ?? null, body: input.description, isInternal: false } },
          events: { create: { organizationId: orgId, eventType: "created", actorType: ctx.userId ? "agent" : "customer", actorId: ctx.membershipId ?? null } },
        },
      }),
    );
    return ticket;
  }

  async addMessage(ctx: RequestContext, ticketId: string, input: { body: string; isInternal?: boolean }) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id: ticketId } });
      if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
      const msg = await tx.ticketMessage.create({
        data: {
          organizationId: orgId, ticketId, authorType: "agent",
          authorMembershipId: ctx.membershipId ?? null, body: input.body, isInternal: !!input.isInternal,
        },
      });
      const patch: any = { updatedAt: new Date() };
      if (!input.isInternal && !t.firstResponseAt) patch.firstResponseAt = new Date();
      if (!input.isInternal && (t.status === "new" || t.status === "triage")) patch.status = "open";
      await tx.ticket.update({ where: { id: ticketId }, data: patch });
      await tx.ticketEvent.create({ data: { organizationId: orgId, ticketId, eventType: input.isInternal ? "internal_note" : "reply", actorType: "agent", actorId: ctx.membershipId ?? null } });
      return msg;
    }).then(async (msg) => {
      // notifica o cliente quando a resposta é pública
      if (!input.isInternal) await this.notifyRequester(ctx, ticketId, "Resposta no seu chamado", input.body).catch(() => undefined);
      return msg;
    });
  }

  async assign(ctx: RequestContext, ticketId: string, membershipId: string | null) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.ticket.update({ where: { id: ticketId }, data: { assigneeMembershipId: membershipId } });
      await tx.ticketEvent.create({ data: { organizationId: orgId, ticketId, eventType: "assigned", payload: { membershipId } as any, actorType: "agent", actorId: ctx.membershipId ?? null } });
      return { ok: true };
    });
  }

  async setStatus(ctx: RequestContext, ticketId: string, status: string) {
    const orgId = this.orgId(ctx);
    const valid = ["new", "triage", "open", "pending", "waiting_customer", "resolved", "closed", "reopened"];
    if (!valid.includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status inválido", 400);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const patch: any = { status };
      if (status === "resolved") patch.resolvedAt = new Date();
      if (status === "closed") patch.closedAt = new Date();
      await tx.ticket.update({ where: { id: ticketId }, data: patch });
      await tx.ticketEvent.create({ data: { organizationId: orgId, ticketId, eventType: "status", payload: { status } as any, actorType: "agent", actorId: ctx.membershipId ?? null } });
      return { ok: true };
    }).then(async (r) => {
      if (status === "resolved") {
        // pede confirmação de fechamento ao cliente, com link/token nível 2
        await this.notifyRequester(ctx, ticketId, "Seu chamado foi resolvido", "Resolvemos seu chamado. Confirme o fechamento e avalie o atendimento pelo seu portal.").catch(() => undefined);
      }
      return r;
    });
  }

  // confirmação de fechamento pelo cliente (nota + obs) — via portal ou token nível 2
  async confirmClose(ctx: RequestContext, ticketId: string, input: { rating?: number; comment?: string; satisfied: boolean }) {
    const orgId = this.orgId(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id: ticketId } });
      if (!t) throw new AppError(ErrorCode.NotFound, "Chamado não encontrado", 404);
      if (input.satisfied) {
        await tx.ticket.update({ where: { id: ticketId }, data: { status: "closed", closedAt: new Date(), satisfactionRating: input.rating ?? null, satisfactionComment: input.comment ?? null } });
        await tx.ticketEvent.create({ data: { organizationId: orgId, ticketId, eventType: "closed", payload: { rating: input.rating, comment: input.comment } as any, actorType: "customer" } });
      } else {
        await tx.ticket.update({ where: { id: ticketId }, data: { status: "reopened", reopenedCount: { increment: 1 }, resolvedAt: null, satisfactionComment: input.comment ?? null } });
        await tx.ticketEvent.create({ data: { organizationId: orgId, ticketId, eventType: "reopened", payload: { comment: input.comment } as any, actorType: "customer" } });
      }
      return { ok: true };
    });
  }

  private async notifyRequester(ctx: RequestContext, ticketId: string, subject: string, text: string) {
    const t = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.ticket.findFirst({ where: { id: ticketId } }));
    if (!t) return;
    let phone = t.requesterPhone ?? null;
    let email = t.requesterEmail ?? null;
    let customerId: string | null = t.requesterCustomerId ?? null;
    if (customerId) {
      const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findFirst({ where: { id: customerId! }, select: { whatsappPhone: true, phone: true, email: true } }));
      phone = phone ?? c?.whatsappPhone ?? c?.phone ?? null;
      email = email ?? c?.email ?? null;
    }
    if (!phone && !email) return;
    // link do portal do cliente (acompanha o chamado em tempo real) — usa o slug da empresa
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: t.organizationId }, select: { slug: true } })).catch(() => null);
    const portal = `${orgBaseUrl(org?.slug)}/c/chamados`;
    await this.notifications.notify({
      organizationId: t.organizationId, storeId: t.storeId ?? t.organizationId,
      customerId: customerId ?? undefined, whatsappPhone: phone, email,
      subject: `[${t.code}] ${subject}`,
      text: `${text}\n\nAcompanhe pelo seu portal: ${portal}`,
      templateCode: "helpdesk",
    });
  }

  // ============================== ORDENS DE SERVIÇO ==============================
  async createServiceOrder(ctx: RequestContext, input: {
    title: string; type?: string; description?: string; equipment?: string; urgency?: string; notes?: string;
    customerId?: string; storeId?: string; ticketId?: string; technicianMembershipId?: string;
    dueAt?: string; items?: { kind: string; description: string; qty: number; unitCents: number }[];
  }) {
    const orgId = this.orgId(ctx);
    const urgency = ["low", "normal", "high", "urgent"].includes(input.urgency ?? "") ? input.urgency! : "normal";
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const items = (input.items ?? []).map((i) => ({ ...i, totalCents: Math.round(i.qty * i.unitCents) }));
      const total = items.reduce((s, i) => s + i.totalCents, 0);
      const so = await tx.serviceOrder.create({
        data: {
          organizationId: orgId, storeId: input.storeId ?? null, ticketId: input.ticketId ?? null,
          code: shortCode("OS"), customerId: input.customerId ?? null, type: input.type ?? "repair",
          title: input.title, description: input.description ?? null, equipment: input.equipment ?? null,
          urgency, notes: input.notes ?? null,
          technicianMembershipId: input.technicianMembershipId ?? null, status: "open",
          dueAt: input.dueAt ? new Date(input.dueAt) : null, totalCents: BigInt(total),
          approvalToken: token(),
          items: { create: items.map((i) => ({ organizationId: orgId, kind: i.kind, description: i.description, qty: i.qty, unitCents: BigInt(i.unitCents), totalCents: BigInt(i.totalCents) })) },
          events: { create: { organizationId: orgId, eventType: "created", actorType: "agent", actorId: ctx.membershipId ?? null } },
        },
        include: { items: true },
      });
      return so;
    });
  }

  async listServiceOrders(ctx: RequestContext, f: { status?: string; q?: string }) {
    const where: any = {};
    if (f.status && f.status !== "all") where.status = f.status;
    if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { code: { contains: f.q, mode: "insensitive" } }, { equipment: { contains: f.q, mode: "insensitive" } }];
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.serviceOrder.findMany({ where, include: { items: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 }));
    // nome do cliente
    const custIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
    const cMap = new Map<string, string>();
    if (custIds.length) {
      const cs = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } }));
      for (const c of cs) cMap.set(c.id, c.name);
    }
    return rows.map((r) => ({ ...r, customerName: r.customerId ? cMap.get(r.customerId) ?? null : null }));
  }

  /** Detalhe da OS com itens, timeline e cliente. */
  async getServiceOrder(ctx: RequestContext, id: string) {
    const so = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.serviceOrder.findFirst({ where: { id }, include: { items: true, events: { orderBy: { createdAt: "asc" } } } }),
    );
    if (!so) throw new AppError(ErrorCode.NotFound, "OS não encontrada", 404);
    let customerName: string | null = null;
    if (so.customerId) {
      const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findFirst({ where: { id: so.customerId! }, select: { name: true } }));
      customerName = c?.name ?? null;
    }
    return { ...so, customerName };
  }

  /** Edita campos da OS (urgência, obs, equipamento, prazo, técnico, título). */
  async updateServiceOrder(ctx: RequestContext, id: string, patch: { urgency?: string; notes?: string; equipment?: string; title?: string; description?: string; dueAt?: string | null; technicianMembershipId?: string | null }) {
    const orgId = this.orgId(ctx);
    const data: any = {};
    if (patch.urgency && ["low", "normal", "high", "urgent"].includes(patch.urgency)) data.urgency = patch.urgency;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.equipment !== undefined) data.equipment = patch.equipment;
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.dueAt !== undefined) data.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
    if (patch.technicianMembershipId !== undefined) data.technicianMembershipId = patch.technicianMembershipId;
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.serviceOrder.update({ where: { id }, data }));
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.serviceOrderEvent.create({ data: { organizationId: orgId, serviceOrderId: id, eventType: "updated", payload: data, actorType: "agent", actorId: ctx.membershipId ?? null } })).catch(() => undefined);
    return { ok: true };
  }

  async setServiceOrderStatus(ctx: RequestContext, id: string, status: string) {
    const orgId = this.orgId(ctx);
    const valid = ["open", "in_progress", "waiting_part", "ready", "delivered", "canceled"];
    if (!valid.includes(status)) throw new AppError(ErrorCode.ValidationFailed, "Status inválido", 400);
    const so = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.serviceOrder.findFirst({ where: { id } }));
    if (!so) throw new AppError(ErrorCode.NotFound, "OS não encontrada", 404);
    // reabrir (sair de um estado terminal) só o master
    const terminal = ["delivered", "canceled"];
    if (terminal.includes(so.status) && !terminal.includes(status) && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas o master pode reabrir uma OS finalizada.", 403);
    }
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const patch: any = { status };
      if (status === "ready") patch.readyAt = new Date();
      if (status === "delivered") patch.deliveredAt = new Date();
      await tx.serviceOrder.update({ where: { id }, data: patch });
      await tx.serviceOrderEvent.create({ data: { organizationId: orgId, serviceOrderId: id, eventType: "status", payload: { status } as any, actorType: "agent", actorId: ctx.membershipId ?? null } });
    });
    // "pronta" → avisa o cliente no WhatsApp (1x) com link do portal
    if (status === "ready" && !so.readyNotifiedAt && so.customerId) {
      await this.notifyServiceOrderReady(ctx, so).catch((e) => this.logger.warn(`OS ready notify: ${e?.message}`));
    }
    return { ok: true };
  }

  private async notifyServiceOrderReady(ctx: RequestContext, so: { id: string; code: string; title: string; customerId: string | null; organizationId: string; storeId: string | null }) {
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.customer.findFirst({ where: { id: so.customerId! }, select: { name: true, phone: true, whatsappPhone: true, email: true } }));
    const phone = c?.whatsappPhone ?? c?.phone ?? null;
    if (!phone && !c?.email) return;
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.organization.findFirst({ where: { id: so.organizationId }, select: { slug: true } })).catch(() => null);
    const portal = `${orgBaseUrl(org?.slug)}/c`;
    const first = (c?.name ?? "Olá").split(" ")[0];
    const text = `✅ ${first}, sua ordem de serviço *${so.code}* (${so.title}) está *pronta* para retirada!\nAcompanhe pelo seu portal: ${portal}`;
    await this.notifications.notify({
      organizationId: so.organizationId, storeId: so.storeId ?? so.organizationId,
      customerId: so.customerId ?? undefined, whatsappPhone: phone, email: c?.email ?? null,
      subject: `OS ${so.code} pronta`, text, templateCode: "service_order_ready",
    } as any);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.serviceOrder.update({ where: { id: so.id }, data: { readyNotifiedAt: new Date() } })).catch(() => undefined);
  }
}
