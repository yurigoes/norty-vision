import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

interface WeeklyBlock {
  weekday: number; // 0=domingo, 6=sabado
  blocks: Array<{
    start: string; // "08:00"
    end: string;   // "12:00"
    slotMinutes: number;
    capacity?: number;
  }>;
}

interface UpsertTemplateInput {
  professionalId: string;
  storeId?: string;
  name: string;
  weeklyBlocks: WeeklyBlock[];
  validFrom?: string;
  validUntil?: string | null;
  isActive?: boolean;
}

interface GenerateSlotsInput {
  templateId: string;
  startDate: string; // ISO YYYY-MM-DD
  endDate: string;
}

interface OpenDayInput {
  professionalId: string;
  storeId?: string;
  date: string; // YYYY-MM-DD
  periods: Array<{ start: string; end: string }>; // ex.: [{start:"08:00",end:"13:00"}]
  mode: "byDuration" | "byCount";
  slotMinutes?: number;     // byDuration
  count?: number;           // byCount = nº de horários desejados (no total)
  capacityPerSlot?: number; // pessoas por horário (>1 = "por ordem de chegada")
  label?: string | null;
  dryRun?: boolean;         // só calcula (preview do modal de confirmação)
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

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

  // ============================== TEMPLATES ==============================
  async listTemplates(ctx: RequestContext, opts?: { storeId?: string; professionalId?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleTemplate.findMany({
        where: {
          ...(opts?.storeId ? { storeId: opts.storeId } : {}),
          ...(opts?.professionalId ? { professionalId: opts.professionalId } : {}),
          isActive: true,
        },
        orderBy: { name: "asc" },
        include: { professional: { select: { id: true, name: true, colorHex: true } } },
      }),
    );
  }

  async createTemplate(ctx: RequestContext, input: UpsertTemplateInput) {
    this.requireOrg(ctx);
    if (!ctxCan(ctx, "agenda.edit")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para editar a agenda", 403);
    }
    const storeId = input.storeId ?? ctx.storeId;
    if (!storeId) {
      throw new AppError(ErrorCode.ValidationFailed, "storeId obrigatorio", 400);
    }
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleTemplate.create({
        data: {
          organizationId: ctx.orgId!,
          storeId,
          professionalId: input.professionalId,
          name: input.name,
          weeklyBlocks: input.weeklyBlocks as any,
          validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
          validUntil: input.validUntil ? new Date(input.validUntil) : null,
          isActive: input.isActive ?? true,
        },
      }),
    );
  }

  async updateTemplate(ctx: RequestContext, id: string, input: Partial<UpsertTemplateInput>) {
    this.requireOrg(ctx);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.weeklyBlocks !== undefined) data.weeklyBlocks = input.weeklyBlocks as any;
    if (input.validFrom !== undefined) data.validFrom = new Date(input.validFrom);
    if (input.validUntil !== undefined)
      data.validUntil = input.validUntil ? new Date(input.validUntil) : null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleTemplate.update({ where: { id }, data }),
    );
  }

  // ============================== SLOTS ==============================
  /**
   * Gera slots concretos a partir de um template entre startDate e endDate.
   * Idempotente: pula slots que ja existem (UNIQUE constraint protege).
   */
  async generateSlots(ctx: RequestContext, input: GenerateSlotsInput) {
    this.requireOrg(ctx);
    const tpl = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleTemplate.findFirst({ where: { id: input.templateId } }),
    );
    if (!tpl) throw new AppError(ErrorCode.NotFound, "Template nao existe", 404);

    const start = new Date(input.startDate + "T00:00:00Z");
    const end = new Date(input.endDate + "T23:59:59Z");
    if (end < start) {
      throw new AppError(ErrorCode.ValidationFailed, "endDate antes de startDate", 400);
    }
    if (end.getTime() - start.getTime() > 366 * 86400_000) {
      throw new AppError(ErrorCode.ValidationFailed, "Janela maxima 1 ano", 400);
    }

    const weeklyBlocks = (tpl.weeklyBlocks as any[]) as WeeklyBlock[];
    const created: Array<{ startsAt: Date; endsAt: Date }> = [];

    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const weekday = d.getUTCDay();
      const day = weeklyBlocks.find((b) => b.weekday === weekday);
      if (!day) continue;

      for (const block of day.blocks) {
        const [sh, sm] = block.start.split(":").map(Number);
        const [eh, em] = block.end.split(":").map(Number);
        const blockStart = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), sh, sm),
        );
        const blockEnd = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), eh, em),
        );
        const slotMs = block.slotMinutes * 60_000;
        for (let s = new Date(blockStart); s < blockEnd; s = new Date(s.getTime() + slotMs)) {
          const e = new Date(s.getTime() + slotMs);
          if (e > blockEnd) break;
          created.push({ startsAt: new Date(s), endsAt: e });
        }
      }
    }

    // batch insert ignorando duplicados (unique partial index)
    let inserted = 0;
    await this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      for (const slot of created) {
        try {
          await tx.scheduleSlot.create({
            data: {
              organizationId: tpl.organizationId,
              storeId: tpl.storeId,
              professionalId: tpl.professionalId,
              templateId: tpl.id,
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
              durationMinutes: Math.round(
                (slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000,
              ),
            },
          });
          inserted++;
        } catch {
          // duplicado — ignora
        }
      }
    });

    return { generated: inserted, candidates: created.length };
  }

  /**
   * Abre a agenda de um profissional numa data específica, de forma simples
   * (sem template). Dois modos:
   *  - byDuration: você diz a janela (08:00–13:00) e a duração de cada horário
   *    (ex.: 15 min) → o sistema calcula QUANTOS horários abre.
   *  - byCount: você diz a janela e QUANTOS pacientes/horários quer (ex.: 20) →
   *    o sistema calcula a DURAÇÃO de cada horário.
   * capacityPerSlot > 1 = "por ordem de chegada" (vários por horário).
   *
   * Com dryRun=true, só devolve o cálculo (pro modal de confirmação) sem gravar.
   */
  async openDay(ctx: RequestContext, input: OpenDayInput) {
    this.requireOrg(ctx);
    if (!ctxCan(ctx, "agenda.edit")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para editar a agenda", 403);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new AppError(ErrorCode.ValidationFailed, "Data inválida", 400);
    }
    if (!input.periods?.length) {
      throw new AppError(ErrorCode.ValidationFailed, "Informe ao menos uma janela", 400);
    }

    const prof = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.professional.findFirst({ where: { id: input.professionalId, deletedAt: null } }),
    );
    if (!prof) throw new AppError(ErrorCode.NotFound, "Profissional não encontrado", 404);
    const storeId = input.storeId ?? prof.storeId;
    const capacity = Math.max(1, input.capacityPerSlot ?? 1);

    // minutos de cada janela
    const toMin = (hhmm: string): number => {
      const parts = hhmm.split(":");
      return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
    };
    const periodsMin = input.periods.map((p) => {
      const startMin = toMin(p.start);
      const endMin = toMin(p.end);
      if (endMin <= startMin) {
        throw new AppError(ErrorCode.ValidationFailed, `Janela inválida: ${p.start}–${p.end}`, 400);
      }
      return { ...p, startMin, endMin, lengthMin: endMin - startMin };
    });
    const totalMin = periodsMin.reduce((s, p) => s + p.lengthMin, 0);

    // resolve slotMinutes conforme o modo
    let slotMinutes: number;
    if (input.mode === "byDuration") {
      slotMinutes = Math.max(5, Math.floor(input.slotMinutes ?? 15));
    } else {
      const count = Math.max(1, Math.floor(input.count ?? 1));
      slotMinutes = Math.max(5, Math.floor(totalMin / count));
    }

    // monta os horários
    const dparts = input.date.split("-");
    const Y = Number(dparts[0]);
    const M = Number(dparts[1]);
    const D = Number(dparts[2]);
    const slots: Array<{ startsAt: Date; endsAt: Date }> = [];
    const perPeriod: Array<{ start: string; end: string; slots: number }> = [];
    for (const p of periodsMin) {
      let n = 0;
      for (let m = p.startMin; m + slotMinutes <= p.endMin; m += slotMinutes) {
        const startsAt = new Date(Date.UTC(Y, M - 1, D, Math.floor(m / 60), m % 60));
        const endsAt = new Date(startsAt.getTime() + slotMinutes * 60_000);
        slots.push({ startsAt, endsAt });
        n++;
      }
      perPeriod.push({ start: p.start, end: p.end, slots: n });
    }

    const summary = {
      mode: input.mode,
      slotMinutes,
      slotsCount: slots.length,
      capacityPerSlot: capacity,
      totalCapacity: slots.length * capacity,
      perPeriod,
      date: input.date,
      professionalId: prof.id,
      professionalName: prof.name,
    };

    if (input.dryRun) return { ...summary, generated: 0, dryRun: true };

    let inserted = 0;
    await this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      for (const s of slots) {
        try {
          await tx.scheduleSlot.create({
            data: {
              organizationId: ctx.orgId!,
              storeId: storeId!,
              professionalId: prof.id,
              startsAt: s.startsAt,
              endsAt: s.endsAt,
              capacity,
              durationMinutes: slotMinutes,
              label: input.label ?? null,
            },
          });
          inserted++;
        } catch {
          // duplicado (mesmo horário já aberto) — ignora
        }
      }
    });

    return { ...summary, generated: inserted, dryRun: false };
  }

  async listSlots(
    ctx: RequestContext,
    opts: {
      storeId?: string;
      professionalId?: string;
      startDate: string;
      endDate: string;
      availableOnly?: boolean;
    },
  ) {
    this.requireOrg(ctx);
    const from = new Date(opts.startDate + "T00:00:00Z");
    const to = new Date(opts.endDate + "T23:59:59Z");
    const slots = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleSlot.findMany({
        where: {
          deletedAt: null,
          startsAt: { gte: from, lte: to },
          ...(opts.storeId ? { storeId: opts.storeId } : {}),
          ...(opts.professionalId ? { professionalId: opts.professionalId } : {}),
          ...(opts.availableOnly
            ? { isBlocked: false, used: { lt: 999 } } // refined no client side
            : {}),
        },
        orderBy: { startsAt: "asc" },
        include: {
          professional: { select: { id: true, name: true, colorHex: true } },
          // agendamentos ATIVOS no slot → pra pintar de vermelho com o nome
          appointments: {
            where: { deletedAt: null, status: { notIn: ["canceled"] } },
            select: { id: true, status: true, customer: { select: { name: true } } },
          },
        },
        take: 2000,
      }),
    );
    // status do slot pro calendário: blocked(cinza) · booked(vermelho+nome) · free(verde)
    return slots.map((s) => {
      const bookings = (s.appointments ?? []).map((a) => ({ id: a.id, status: a.status, customerName: a.customer?.name ?? null }));
      const slotStatus = s.isBlocked ? "blocked" : bookings.length > 0 ? "booked" : "free";
      return { ...s, bookings, slotStatus };
    });
  }

  // ============================== PENDÊNCIAS (follow-ups) ==============================
  async listFollowups(ctx: RequestContext, opts?: { status?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customerFollowup.findMany({
        where: { status: opts?.status ?? "open" },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { customer: { select: { id: true, name: true, phone: true, whatsappPhone: true } } },
      }),
    );
  }

  async resolveFollowup(ctx: RequestContext, id: string, status: "done" | "dismissed") {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.customerFollowup.update({
        where: { id },
        data: { status, resolvedAt: new Date(), resolvedBy: ctx.userId ?? null },
      }),
    );
  }

  /**
   * Envia ao cliente (WhatsApp/email) a próxima data com agenda disponível pra
   * reagendar — em vez de redirecionar pro WhatsApp. Usa o próximo slot livre.
   */
  async notifyNextSlot(ctx: RequestContext, followupId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rlsCtx(ctx), async (tx) => {
      const f = await tx.customerFollowup.findFirst({ where: { id: followupId } });
      if (!f) throw new AppError(ErrorCode.NotFound, "Pendência não encontrada", 404);
      const customer = await tx.customer.findFirst({
        where: { id: f.customerId },
        select: { id: true, name: true, storeId: true, phone: true, whatsappPhone: true, email: true },
      });
      if (!customer) throw new AppError(ErrorCode.NotFound, "Cliente não encontrado", 404);

      // próximo slot livre (não bloqueado, com vaga) a partir de agora
      const now = new Date();
      const slot = await tx.scheduleSlot.findFirst({
        where: {
          deletedAt: null,
          isBlocked: false,
          startsAt: { gte: now },
          ...(customer.storeId ? { storeId: customer.storeId } : {}),
        },
        orderBy: { startsAt: "asc" },
      });
      const free = slot && slot.used < slot.capacity ? slot : await tx.scheduleSlot.findFirst({
        where: { deletedAt: null, isBlocked: false, startsAt: { gte: now }, ...(customer.storeId ? { storeId: customer.storeId } : {}) },
        orderBy: { startsAt: "asc" },
      });
      if (!free) throw new AppError(ErrorCode.ValidationFailed, "Não há datas com agenda aberta. Abra a agenda primeiro.", 400);

      const dateStr = free.startsAt.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "long" });
      const timeStr = free.startsAt.toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
      const firstName = (customer.name ?? "Cliente").split(" ")[0];
      const text = `Olá ${firstName}! Já temos agenda aberta para sua consulta. A próxima data disponível é ${dateStr} a partir das ${timeStr}. Quer agendar? É só responder esta mensagem que confirmamos seu horário. 💙`;

      if (!customer.storeId || (!customer.whatsappPhone && !customer.phone && !customer.email)) {
        throw new AppError(ErrorCode.ValidationFailed, "Cliente sem contato (WhatsApp/email) cadastrado.", 400);
      }
      const r = await this.notifications.notify({
        organizationId: ctx.orgId!,
        storeId: customer.storeId,
        customerId: customer.id,
        whatsappPhone: customer.whatsappPhone ?? customer.phone ?? null,
        email: customer.email ?? null,
        subject: "Agenda disponível para sua consulta",
        text,
        templateCode: "agenda_proxima_data",
      });
      return { ok: r.whatsapp || r.email, date: free.startsAt, whatsapp: r.whatsapp, email: r.email };
    });
  }

  /** Disponibilidade por dia de um mês (pra visão de calendário). */
  async monthAvailability(
    ctx: RequestContext,
    opts: { month: string; professionalId?: string; storeId?: string },
  ) {
    this.requireOrg(ctx);
    if (!/^\d{4}-\d{2}$/.test(opts.month)) {
      throw new AppError(ErrorCode.ValidationFailed, "Mês inválido (use YYYY-MM)", 400);
    }
    const [y, m] = opts.month.split("-").map(Number);
    const from = new Date(Date.UTC(y!, (m! - 1), 1, 0, 0, 0));
    const to = new Date(Date.UTC(y!, m!, 0, 23, 59, 59)); // último dia do mês
    const slots = await this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleSlot.findMany({
        where: {
          deletedAt: null,
          startsAt: { gte: from, lte: to },
          ...(opts.storeId ? { storeId: opts.storeId } : {}),
          ...(opts.professionalId ? { professionalId: opts.professionalId } : {}),
        },
        select: { startsAt: true, capacity: true, used: true, isBlocked: true },
        take: 5000,
      }),
    );
    const byDay = new Map<string, { totalSlots: number; freeSlots: number; freeCapacity: number }>();
    for (const s of slots) {
      const key = s.startsAt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
      const d = byDay.get(key) ?? { totalSlots: 0, freeSlots: 0, freeCapacity: 0 };
      d.totalSlots++;
      if (!s.isBlocked && s.used < s.capacity) {
        d.freeSlots++;
        d.freeCapacity += s.capacity - s.used;
      }
      byDay.set(key, d);
    }
    return { days: Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v })) };
  }

  async blockSlot(ctx: RequestContext, id: string, reason: string) {
    this.requireOrg(ctx);
    if (!ctxCan(ctx, "agenda.edit")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para editar a agenda", 403);
    }
    return this.prisma.runWithContext(this.rlsCtx(ctx), (tx) =>
      tx.scheduleSlot.update({
        where: { id },
        data: { isBlocked: true, blockReason: reason },
      }),
    );
  }
}
