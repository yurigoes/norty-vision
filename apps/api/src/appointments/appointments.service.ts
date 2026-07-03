import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { SurveysService } from "../surveys/surveys.service";
import { orgBaseUrl } from "../common/org-url";
import type { RequestContext } from "../auth/session.middleware";
import {
  genShortCode,
  buildBookedMessage,
  buildConfirmedMessage,
  buildReminderMessage,
  buildCanceledMessage,
  arrivalWindowLabel,
} from "./appointment-messages";

interface CreateAppointmentInput {
  slotId: string;
  customerId: string;
  serviceName?: string | null;
  notes?: string | null;
  /** admin confirmou lançar em horário passado (backfill) */
  allowPast?: boolean;
  /** não dispara a notificação automática de "agendado" (ex.: a IA do atendimento
   *  já está conversando com o cliente e manda a confirmação ela mesma) */
  skipNotify?: boolean;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger("Appointments");

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly surveys: SurveysService,
  ) {}

  /**
   * Envia a notificação de um agendamento (agendou/confirmou) por WhatsApp/email.
   * Best-effort: nunca quebra o fluxo. Reutilizado pela criação, confirmação
   * (staff e via portal/WhatsApp).
   */
  async notifyAppointment(appointmentId: string, kind: "booked" | "confirmed" | "reminder" | "canceled"): Promise<void> {
    try {
      const a = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.appointment.findFirst({
          where: { id: appointmentId },
          include: {
            customer: { select: { name: true, phone: true, whatsappPhone: true, email: true } },
            slot: { select: { capacity: true } },
          },
        }),
      );
      if (!a || !a.customer) return;
      const store = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.store.findFirst({
          where: { id: a.storeId },
          select: { name: true, examPriceCents: true, examPaymentNote: true },
        }),
      );
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findFirst({ where: { id: a.organizationId }, select: { slug: true } }),
      );
      const base = orgBaseUrl(org?.slug);
      const portalUrl = a.shortCode ? `${base}/a/${a.shortCode}` : null;
      const byArrival = (a.slot?.capacity ?? 1) > 1;
      // Janelas de chegada configuráveis (Atendimento → Config). Array de "HH:MM".
      // Vazio/ausente → usa o default do appointment-messages. Permite a loja
      // ajustar (ex.: porta abre 06:00 em vez de 06:30) sem mexer no código.
      const cc = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.callCenterSettings.findFirst({ where: { organizationId: a.organizationId }, select: { examArrivalWindows: true } }),
      ).catch(() => null);
      const aw = (cc as any)?.examArrivalWindows;
      const arrivalWindows = Array.isArray(aw) && aw.every((x: any) => typeof x === "string" && /^\d{1,2}:\d{2}$/.test(x)) && aw.length > 0
        ? (aw as string[])
        : undefined;
      const msgCtx = {
        name: a.customer.name,
        startsAt: a.startsAt,
        byArrival,
        storeName: store?.name ?? "nossa loja",
        examPriceCents: store?.examPriceCents ?? 14000,
        paymentNote: store?.examPaymentNote ?? "no Pix ou dinheiro",
        portalUrl,
        serviceName: a.serviceName,
        arrivalWindows,
      };
      const text =
        kind === "booked" ? buildBookedMessage(msgCtx)
        : kind === "reminder" ? buildReminderMessage(msgCtx)
        : kind === "canceled" ? buildCanceledMessage(msgCtx)
        : buildConfirmedMessage(msgCtx);
      const subject =
        kind === "booked" ? "Seu agendamento"
        : kind === "reminder" ? "Lembrete do seu agendamento"
        : kind === "canceled" ? "Agendamento cancelado"
        : "Agendamento confirmado";
      const templateCode =
        kind === "booked" ? "agenda_agendado"
        : kind === "reminder" ? "agenda_lembrete"
        : kind === "canceled" ? "agenda_cancelado"
        : "agenda_confirmado";
      await this.notifications.notify({
        organizationId: a.organizationId,
        storeId: a.storeId,
        customerId: a.customerId,
        whatsappPhone: a.customer.whatsappPhone ?? a.customer.phone ?? null,
        email: a.customer.email ?? null,
        subject,
        text,
        templateCode,
      });

      // Os convites (agendou/lembrete) ABREM uma sessão de resposta: a partir
      // daqui o cliente pode responder 1/confirma·2/cancela·3/reagenda UMA vez.
      // "confirmado"/"cancelado" são resultados — não reabrem.
      if (kind === "booked" || kind === "reminder") {
        await this.prisma
          .runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.appointment.update({
              where: { id: appointmentId },
              data: { replyOpenAt: new Date(), customerRespondedAt: null, customerResponse: null },
            }),
          )
          .catch(() => undefined);
      }
    } catch (e: any) {
      this.logger.warn(`notifyAppointment(${kind}) falhou: ${e?.message}`);
    }
  }

  private requireOrg(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
  }

  private rlsCtx(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : {
          orgId: ctx.orgId!,
          userId: ctx.userId ?? undefined,
          storeId: ctx.storeId ?? undefined,
          isOrgAdmin: ctx.isOrgAdmin,
        };
  }

  /**
   * Relatório de recall de exame: por cliente, o último exame atendido e quantos
   * dias faltam pra notificar (365 - dias desde o exame). Negativo = já venceu.
   */
  async examRecallReport(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) return { items: [] };
    const rows = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.$queryRaw<Array<{ customer_id: string; name: string; phone: string | null; last_exam: Date; recalled: boolean }>>`
        SELECT DISTINCT ON (a.customer_id)
               a.customer_id, c.name, COALESCE(c.whatsapp_phone, c.phone) AS phone,
               a.starts_at AS last_exam,
               (a.exam_recall_sent_at IS NOT NULL) AS recalled
          FROM appointments a
          JOIN customers c ON c.id = a.customer_id
         WHERE a.status = 'attended' AND a.deleted_at IS NULL
         ORDER BY a.customer_id, a.starts_at DESC
      `,
    );
    const now = Date.now();
    return {
      items: rows
        .map((r) => {
          const daysSince = Math.floor((now - new Date(r.last_exam).getTime()) / 86400_000);
          return {
            customerId: r.customer_id, name: r.name, phone: r.phone,
            lastExam: r.last_exam, daysSince, daysUntilRecall: 365 - daysSince,
            recalled: r.recalled,
          };
        })
        .sort((a, b) => a.daysUntilRecall - b.daysUntilRecall),
    };
  }

  async list(
    ctx: RequestContext,
    opts: {
      storeId?: string;
      professionalId?: string;
      customerId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
  ) {
    this.requireOrg(ctx);
    const from = opts.startDate ? new Date(opts.startDate + "T00:00:00Z") : undefined;
    const to = opts.endDate ? new Date(opts.endDate + "T23:59:59Z") : undefined;
    const items = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.appointment.findMany({
        where: {
          deletedAt: null,
          ...(opts.storeId ? { storeId: opts.storeId } : {}),
          ...(opts.professionalId ? { professionalId: opts.professionalId } : {}),
          ...(opts.customerId ? { customerId: opts.customerId } : {}),
          ...(opts.status ? { status: opts.status } : {}),
          ...(from && to ? { startsAt: { gte: from, lte: to } } : {}),
        },
        orderBy: { startsAt: "asc" },
        include: {
          professional: { select: { id: true, name: true, colorHex: true } },
          customer: {
            select: { id: true, name: true, phone: true, whatsappPhone: true },
          },
        },
        take: 1000,
      }),
    );
    // anexa o preço de exame da loja (pra prefill do recebimento no check-in)
    const storeIds = [...new Set(items.map((a) => a.storeId).filter(Boolean))];
    const priceMap = new Map<string, number>();
    if (storeIds.length) {
      const stores = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
        tx.store.findMany({ where: { id: { in: storeIds as string[] } }, select: { id: true, examPriceCents: true } }),
      );
      for (const s of stores) priceMap.set(s.id, Number(s.examPriceCents ?? 0));
    }
    return items.map((a) => ({ ...a, examPriceCents: priceMap.get(a.storeId) ?? null }));
  }

  async getById(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    const a = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.appointment.findFirst({
        where: { id, deletedAt: null },
        include: {
          professional: true,
          customer: true,
          slot: true,
          events: { orderBy: { createdAt: "desc" }, take: 50 },
        },
      }),
    );
    if (!a) throw new AppError(ErrorCode.NotFound, "Agendamento nao encontrado", 404);
    return a;
  }

  async create(ctx: RequestContext, input: CreateAppointmentInput) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const slot = await tx.scheduleSlot.findFirst({
        where: { id: input.slotId, deletedAt: null },
      });
      if (!slot) throw new AppError(ErrorCode.NotFound, "Slot nao existe", 404);
      if (slot.isBlocked) {
        throw new AppError(ErrorCode.Conflict, "Slot bloqueado", 409);
      }
      if (slot.used >= slot.capacity) {
        throw new AppError(ErrorCode.Conflict, "Slot lotado", 409);
      }
      // horário/data no passado: só admin/gerente (ou platform) pode lançar
      // (backfill). Usuário comum é bloqueado. allowPast no input libera quando o
      // admin confirmar pelo frontend.
      if (new Date(slot.startsAt).getTime() < Date.now() && !ctx.isOrgAdmin && !ctx.isPlatformAdmin && !input.allowPast) {
        throw new AppError(ErrorCode.Forbidden, "Horário no passado: precisa de autorização do admin", 403);
      }

      // shortCode único (retry em colisão improvável)
      let shortCode = genShortCode();
      for (let i = 0; i < 5; i++) {
        const clash = await tx.appointment.findFirst({ where: { shortCode }, select: { id: true } });
        if (!clash) break;
        shortCode = genShortCode();
      }

      const appointment = await tx.appointment.create({
        data: {
          organizationId: slot.organizationId,
          storeId: slot.storeId,
          slotId: slot.id,
          professionalId: slot.professionalId,
          customerId: input.customerId,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          status: "pending",
          serviceName: input.serviceName ?? null,
          notes: input.notes ?? null,
          source: "staff",
          shortCode,
          createdBy: ctx.userId ?? null,
        },
      });

      // incrementa slot.used atomicamente
      await tx.scheduleSlot.update({
        where: { id: slot.id },
        data: { used: { increment: 1 } },
      });

      // appointment_events: 'created'
      await tx.appointmentEvent.create({
        data: {
          organizationId: appointment.organizationId,
          storeId: appointment.storeId,
          appointmentId: appointment.id,
          eventType: "created",
          actorType: "staff",
          actorUserId: ctx.userId ?? null,
        },
      });

      return appointment;
    }).then(async (appointment) => {
      // notifica o cliente (WhatsApp/email) — fora da transação, best-effort.
      // Pulado quando quem cria já está conversando com o cliente (IA do atendimento).
      if (!input.skipNotify) await this.notifyAppointment(appointment.id, "booked");
      return appointment;
    });
  }

  async confirm(ctx: RequestContext, id: string, opts?: { actor?: "customer" | "staff" }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const a = await tx.appointment.findFirst({ where: { id, deletedAt: null } });
      if (!a) throw new AppError(ErrorCode.NotFound, "Agendamento nao existe", 404);
      const updated = await tx.appointment.update({
        where: { id },
        data: { status: "confirmed" },
      });
      await tx.appointmentEvent.create({
        data: {
          organizationId: a.organizationId,
          storeId: a.storeId,
          appointmentId: a.id,
          eventType: "confirmed",
          actorType: opts?.actor ?? "staff",
          actorUserId: ctx.userId ?? null,
        },
      });
      return updated;
    }).then(async (updated) => {
      await this.notifyAppointment(id, "confirmed");
      return updated;
    });
  }

  async cancel(
    ctx: RequestContext,
    id: string,
    opts: { reason?: string; actor?: "customer" | "staff" | "no_show" | "system" },
  ) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const a = await tx.appointment.findFirst({ where: { id, deletedAt: null } });
      if (!a) throw new AppError(ErrorCode.NotFound, "Agendamento nao existe", 404);
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          canceledReason: opts.reason ?? null,
          canceledBy: opts.actor ?? "staff",
        },
      });
      // libera vaga
      await tx.scheduleSlot.update({
        where: { id: a.slotId },
        data: { used: { decrement: 1 } },
      });
      await tx.appointmentEvent.create({
        data: {
          organizationId: a.organizationId,
          storeId: a.storeId,
          appointmentId: a.id,
          eventType: "canceled",
          payload: { reason: opts.reason ?? null } as any,
          actorType: opts.actor ?? "staff",
          actorUserId: ctx.userId ?? null,
        },
      });
      return updated;
    });
  }

  async reschedule(
    ctx: RequestContext,
    id: string,
    newSlotId: string,
    actor?: "customer" | "staff",
  ) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const oldA = await tx.appointment.findFirst({ where: { id, deletedAt: null } });
      if (!oldA) throw new AppError(ErrorCode.NotFound, "Agendamento nao existe", 404);
      const newSlot = await tx.scheduleSlot.findFirst({
        where: { id: newSlotId, deletedAt: null },
      });
      if (!newSlot) throw new AppError(ErrorCode.NotFound, "Slot novo nao existe", 404);
      if (newSlot.isBlocked || newSlot.used >= newSlot.capacity) {
        throw new AppError(ErrorCode.Conflict, "Slot novo indisponivel", 409);
      }

      // cria novo appointment
      const newAppointment = await tx.appointment.create({
        data: {
          organizationId: newSlot.organizationId,
          storeId: newSlot.storeId,
          slotId: newSlot.id,
          professionalId: newSlot.professionalId,
          customerId: oldA.customerId,
          startsAt: newSlot.startsAt,
          endsAt: newSlot.endsAt,
          status: "pending",
          serviceName: oldA.serviceName,
          notes: oldA.notes,
          source: "reschedule",
          rescheduledFromId: oldA.id,
          createdBy: ctx.userId ?? null,
        },
      });

      // marca o antigo como rescheduled
      await tx.appointment.update({
        where: { id: oldA.id },
        data: { status: "rescheduled", rescheduledToId: newAppointment.id },
      });

      // ajusta vagas
      await tx.scheduleSlot.update({
        where: { id: oldA.slotId },
        data: { used: { decrement: 1 } },
      });
      await tx.scheduleSlot.update({
        where: { id: newSlot.id },
        data: { used: { increment: 1 } },
      });

      await tx.appointmentEvent.create({
        data: {
          organizationId: oldA.organizationId,
          storeId: oldA.storeId,
          appointmentId: oldA.id,
          eventType: "rescheduled",
          payload: { newAppointmentId: newAppointment.id } as any,
          actorType: actor ?? "staff",
          actorUserId: ctx.userId ?? null,
        },
      });

      return newAppointment;
    });
  }

  async checkIn(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const updated = await tx.appointment.update({
        where: { id },
        data: { status: "in_progress", checkedInAt: new Date() },
      });
      await tx.appointmentEvent.create({
        data: {
          organizationId: updated.organizationId,
          storeId: updated.storeId,
          appointmentId: updated.id,
          eventType: "checked_in",
          actorType: "staff",
          actorUserId: ctx.userId ?? null,
        },
      });
      return updated;
    });
  }

  async markAttended(ctx: RequestContext, id: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const updated = await tx.appointment.update({
        where: { id },
        data: { status: "attended", endedAt: new Date() },
      });
      await tx.appointmentEvent.create({
        data: {
          organizationId: updated.organizationId,
          storeId: updated.storeId,
          appointmentId: updated.id,
          eventType: "attended",
          actorType: "staff",
          actorUserId: ctx.userId ?? null,
        },
      });
      return updated;
    }).then(async (updated) => {
      // pesquisa de satisfação (5 estrelas) por WhatsApp/email + link
      await this.surveys.createAndSend({
        organizationId: updated.organizationId,
        storeId: updated.storeId,
        customerId: updated.customerId,
        kind: "appointment",
        refId: updated.id,
      }).catch(() => undefined);
      return updated;
    });
  }

  // ===== Para webhook publico (sem auth — quando customer confirma via WhatsApp) =====
  async findByShortCode(shortCode: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.appointment.findFirst({ where: { shortCode, deletedAt: null } }),
    );
  }

  /** Cria a pendência de follow-up (recepção remarca depois). Best-effort. */
  async createCancelFollowup(appt: { id: string; organizationId: string; storeId: string; customerId: string }, note: string) {
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.customerFollowup.create({
        data: {
          organizationId: appt.organizationId,
          storeId: appt.storeId,
          customerId: appt.customerId,
          kind: "appointment_canceled",
          refType: "appointment",
          refId: appt.id,
          note,
          status: "open",
        },
      }),
    ).catch(() => undefined);
  }

  // ============================================================================
  // PORTAL PÚBLICO (sem login) — ações pelo shortCode (link /a/{code})
  // ============================================================================
  private async loadByCode(code: string) {
    const a = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.appointment.findFirst({
        where: { shortCode: code, deletedAt: null },
        include: {
          professional: { select: { name: true } },
          slot: { select: { capacity: true } },
          customer: { select: { name: true, phone: true, whatsappPhone: true, email: true } },
        },
      }),
    );
    if (!a) throw new AppError(ErrorCode.NotFound, "Agendamento não encontrado", 404);
    const store = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.store.findFirst({ where: { id: a.storeId }, select: { name: true, examPriceCents: true, examPaymentNote: true, logoUrl: true, themePrimaryColor: true } }),
    );
    return { a, store };
  }

  async publicGet(code: string) {
    const { a, store } = await this.loadByCode(code);
    // desfecho do cliente (pra página decidir o que mostrar):
    //  - confirmed   → sucesso, sem ações
    //  - canceled    → ofereço próximas datas
    //  - reschedule  → pediu remarcar (status ainda pendente) → próximas datas
    //  - null        → ainda não respondeu (pendente) → mostra as 3 opções
    let outcome: "confirmed" | "canceled" | "reschedule" | null = null;
    if (a.status === "confirmed") outcome = "confirmed";
    else if (a.status === "canceled") outcome = "canceled";
    else if (a.customerResponse === "reschedule") outcome = "reschedule";
    return {
      shortCode: a.shortCode,
      status: a.status,
      startsAt: a.startsAt,
      byArrival: (a.slot?.capacity ?? 1) > 1,
      // exame é sempre por ordem de chegada → início da janela em que o slot cai
      arrivalLabel: arrivalWindowLabel(a.startsAt),
      serviceName: a.serviceName,
      professionalName: a.professional?.name ?? null,
      customerName: a.customer?.name ?? null,
      store: {
        name: store?.name ?? null,
        examPriceCents: store?.examPriceCents ?? 14000,
        examPaymentNote: store?.examPaymentNote ?? "no Pix ou dinheiro",
        logoUrl: store?.logoUrl ?? null,
        primaryColor: store?.themePrimaryColor ?? null,
      },
      outcome,
      // só agenda quando ainda está pendente E sem desfecho registrado
      canAct: a.status === "pending" && outcome === null,
    };
  }

  async publicConfirm(code: string) {
    const { a } = await this.loadByCode(code);
    if (!["pending", "rescheduled"].includes(a.status)) {
      if (a.status === "confirmed") return { ok: true, status: "confirmed" };
      throw new AppError(ErrorCode.ValidationFailed, "Agendamento não pode ser confirmado", 400);
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      await tx.appointment.update({
        where: { id: a.id },
        data: { status: "confirmed", customerRespondedAt: new Date(), customerResponse: "confirm" },
      });
      await tx.appointmentEvent.create({
        data: {
          organizationId: a.organizationId, storeId: a.storeId, appointmentId: a.id,
          eventType: "confirmed", actorType: "customer", actorLabel: "Portal /a",
        },
      });
    });
    await this.notifyAppointment(a.id, "confirmed");
    return { ok: true, status: "confirmed" };
  }

  async publicCancel(code: string) {
    const { a } = await this.loadByCode(code);
    if (a.status === "canceled") return { ok: true, status: "canceled" };
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      await tx.appointment.update({
        where: { id: a.id },
        data: {
          status: "canceled", canceledAt: new Date(), canceledBy: "customer", canceledReason: "Portal /a",
          customerRespondedAt: new Date(), customerResponse: "cancel",
        },
      });
      await tx.scheduleSlot.update({ where: { id: a.slotId }, data: { used: { decrement: 1 } } }).catch(() => undefined);
      await tx.appointmentEvent.create({
        data: {
          organizationId: a.organizationId, storeId: a.storeId, appointmentId: a.id,
          eventType: "canceled", actorType: "customer", actorLabel: "Portal /a",
        },
      });
    });
    // pendência pra recepção remarcar
    await this.createCancelFollowup(a, `Cliente cancelou pelo portal o exame de ${a.startsAt.toLocaleDateString("pt-BR", { timeZone: "UTC" })}.`);
    // avisa o cliente
    await this.notifyAppointment(a.id, "canceled");
    return { ok: true, status: "canceled" };
  }

  /** Próximos horários livres do profissional, limitados às N próximas datas. */
  private async nextAvailable(professionalId: string, storeId: string, maxDates = 3) {
    const now = new Date();
    const slots = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.scheduleSlot.findMany({
        where: { professionalId, storeId, deletedAt: null, isBlocked: false, startsAt: { gte: now } },
        orderBy: { startsAt: "asc" },
        take: 300,
      }),
    );
    const free = slots.filter((s) => s.used < s.capacity);
    // agrupa por data (UTC) e mantém só as primeiras maxDates datas
    const dates: string[] = [];
    const out: Array<{ id: string; startsAt: Date; byArrival: boolean; free: number }> = [];
    for (const s of free) {
      const day = s.startsAt.toISOString().slice(0, 10);
      if (!dates.includes(day)) {
        if (dates.length >= maxDates) continue;
        dates.push(day);
      }
      out.push({ id: s.id, startsAt: s.startsAt, byArrival: s.capacity > 1, free: s.capacity - s.used });
    }
    return out;
  }

  /** Datas/horários próximos disponíveis pra reagendar (até 3 datas). */
  async publicRescheduleOptions(code: string) {
    const { a } = await this.loadByCode(code);
    const options = await this.nextAvailable(a.professionalId, a.storeId, 3);
    return { options };
  }

  /** Envia por WhatsApp as próximas datas + o link de autoatendimento. */
  async sendRescheduleOptions(appointmentId: string): Promise<void> {
    try {
      const a = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.appointment.findFirst({
          where: { id: appointmentId },
          include: { customer: { select: { name: true, phone: true, whatsappPhone: true, email: true } } },
        }),
      );
      if (!a || !a.customer) return;
      const opts = await this.nextAvailable(a.professionalId, a.storeId, 3);
      const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.findFirst({ where: { id: a.organizationId }, select: { slug: true } }),
      );
      const link = a.shortCode ? `${orgBaseUrl(org?.slug)}/a/${a.shortCode}` : null;
      const fmt = (d: Date) =>
        `${d.toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" })} às ${d.toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })}`;
      const lines = opts.slice(0, 6).map((o) => `• ${fmt(o.startsAt)}`).join("\n");
      const text =
        `📅 Vamos reagendar! Próximos horários disponíveis:\n\n` +
        (lines || "No momento não há horários abertos — em breve liberamos novas datas.") +
        (link ? `\n\nEscolha o melhor pra você por aqui: ${link}` : "") +
        `\n\n> Sistema de Confirmação YUGO+`;
      await this.notifications.notify({
        organizationId: a.organizationId, storeId: a.storeId, customerId: a.customerId,
        whatsappPhone: a.customer.whatsappPhone ?? a.customer.phone ?? null,
        email: a.customer.email ?? null,
        subject: "Reagendar seu exame",
        text,
        templateCode: "agenda_reagendar",
      });
    } catch (e: any) {
      this.logger.warn(`sendRescheduleOptions falhou: ${e?.message}`);
    }
  }

  async publicReschedule(code: string, newSlotId: string) {
    const { a } = await this.loadByCode(code);
    const newAppt = await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const newSlot = await tx.scheduleSlot.findFirst({ where: { id: newSlotId, deletedAt: null } });
      if (!newSlot) throw new AppError(ErrorCode.NotFound, "Horário novo não existe", 404);
      if (newSlot.isBlocked || newSlot.used >= newSlot.capacity) {
        throw new AppError(ErrorCode.Conflict, "Horário novo indisponível", 409);
      }
      if (newSlot.professionalId !== a.professionalId) {
        throw new AppError(ErrorCode.ValidationFailed, "Horário de outro profissional", 400);
      }
      let shortCode = genShortCode();
      for (let i = 0; i < 5; i++) {
        const clash = await tx.appointment.findFirst({ where: { shortCode }, select: { id: true } });
        if (!clash) break;
        shortCode = genShortCode();
      }
      const created = await tx.appointment.create({
        data: {
          organizationId: newSlot.organizationId, storeId: newSlot.storeId, slotId: newSlot.id,
          professionalId: newSlot.professionalId, customerId: a.customerId,
          startsAt: newSlot.startsAt, endsAt: newSlot.endsAt, status: "pending",
          serviceName: a.serviceName, notes: a.notes, source: "reschedule",
          rescheduledFromId: a.id, shortCode,
        },
      });
      await tx.appointment.update({ where: { id: a.id }, data: { status: "rescheduled", rescheduledToId: created.id } });
      // só libera a vaga antiga se ela ainda estava ocupada (não foi cancelada antes)
      if (a.status !== "canceled") {
        await tx.scheduleSlot.update({ where: { id: a.slotId }, data: { used: { decrement: 1 } } }).catch(() => undefined);
      }
      await tx.scheduleSlot.update({ where: { id: newSlot.id }, data: { used: { increment: 1 } } });
      await tx.appointmentEvent.create({
        data: {
          organizationId: a.organizationId, storeId: a.storeId, appointmentId: a.id,
          eventType: "rescheduled", actorType: "customer", actorLabel: "Portal /a",
          payload: { newAppointmentId: created.id } as any,
        },
      });
      return created;
    });
    // notifica o novo agendamento
    await this.notifyAppointment(newAppt.id, "booked");
    return { ok: true, newShortCode: newAppt.shortCode, startsAt: newAppt.startsAt };
  }
}
