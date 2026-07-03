import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { AppointmentsService } from "../appointments/appointments.service";

/**
 * AgendaReminderScheduler — lembrete de agendamento (cron self-contained,
 * mesmo padrão do dunning, sem worker/BullMQ).
 *
 * A cada hora: pega agendamentos que começam nas próximas 24h, ainda não
 * lembrados (reminded_at null) e com status ativo, e dispara WhatsApp/email.
 * Idempotente: marca reminded_at após enviar.
 */
@Injectable()
export class AgendaReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("AgendaReminder");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly appointments: AppointmentsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 90_000); // 90s após boot
    this.timer = setInterval(() => this.tick(), 60 * 60_000); // de hora em hora
    this.logger.log("AgendaReminder iniciado (tick 1h)");
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.sendDueReminders();
      if (sent > 0) this.logger.log(`lembretes 24h enviados: ${sent}`);
      const morning = await this.sendMorningReminders();
      if (morning > 0) this.logger.log(`lembretes da manhã enviados: ${morning}`);
      const noShows = await this.markNoShows();
      if (noShows > 0) this.logger.log(`no-shows marcados: ${noShows}`);
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Marca como no_show agendamentos que já passaram (com 2h de tolerância) e
   * não foram atendidos/cancelados, e abre uma pendência pra recepção recontatar.
   */
  async markNoShows(): Promise<number> {
    const cutoff = new Date(Date.now() - 2 * 60 * 60_000);
    const stale = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.appointment.findMany({
        where: {
          deletedAt: null,
          status: { in: ["pending", "confirmed", "rescheduled"] },
          endsAt: { lt: cutoff },
        },
        take: 500,
        select: { id: true, organizationId: true, storeId: true, customerId: true, startsAt: true },
      }),
    );
    let count = 0;
    for (const a of stale) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
        await tx.appointment.update({ where: { id: a.id }, data: { status: "no_show" } });
        await tx.appointmentEvent.create({
          data: {
            organizationId: a.organizationId, storeId: a.storeId, appointmentId: a.id,
            eventType: "no_show", actorType: "system",
          },
        });
        await tx.customerFollowup.create({
          data: {
            organizationId: a.organizationId, storeId: a.storeId, customerId: a.customerId,
            kind: "other", refType: "appointment", refId: a.id, status: "open",
            note: `Faltou ao exame de ${a.startsAt.toLocaleDateString("pt-BR", { timeZone: "UTC" })} — recontatar para remarcar.`,
          },
        });
      }).catch((e: any) => this.logger.warn(`no-show appt=${a.id} falhou: ${e?.message}`));
      count++;
    }
    return count;
  }

  /**
   * Lembrete da MANHÃ do dia: pega agendamentos de HOJE (que ainda vão começar)
   * sem morning_reminded_at e dispara o lembrete. Roda no tick horário, então
   * só envia depois que a manhã chegou (não na madrugada do dia anterior).
   * Separado do lembrete de 24h pra não duplicar.
   */
  async sendMorningReminders(): Promise<number> {
    const now = new Date();
    // "Hoje" no fuso de Brasília → janela do dia atual em UTC do relógio de parede.
    // Os slots são gravados como wall-clock UTC, então comparamos direto.
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endOfToday = new Date(startOfToday.getTime() + 86400_000 - 1);
    const appts = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.appointment.findMany({
        where: {
          deletedAt: null,
          morningRemindedAt: null,
          status: { in: ["pending", "confirmed", "rescheduled"] },
          startsAt: { gte: now, lte: endOfToday }, // hoje e ainda não passou
        },
        take: 500,
        select: { id: true },
      }),
    );
    let count = 0;
    for (const a of appts) {
      try { await this.appointments.notifyAppointment(a.id, "reminder"); }
      catch (e: any) { this.logger.warn(`falha lembrete-manhã appt=${a.id}: ${e?.message}`); }
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.appointment.update({ where: { id: a.id }, data: { morningRemindedAt: new Date() } }),
      ).catch(() => undefined);
      count++;
    }
    return count;
  }

  /** Envia lembretes dos agendamentos das próximas 24h ainda não lembrados. */
  async sendDueReminders(): Promise<number> {
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60_000);
    const appts = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.appointment.findMany({
        where: {
          deletedAt: null,
          remindedAt: null,
          status: { in: ["pending", "confirmed", "rescheduled"] },
          startsAt: { gte: now, lte: until },
        },
        take: 500,
        select: { id: true },
      }),
    );

    let count = 0;
    for (const a of appts) {
      try {
        // mesma mensagem do agendamento (valor do exame, ordem de chegada,
        // dias restantes e link /a/{code}).
        await this.appointments.notifyAppointment(a.id, "reminder");
      } catch (e: any) {
        this.logger.warn(`falha lembrete appt=${a.id}: ${e?.message}`);
      }
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.appointment.update({ where: { id: a.id }, data: { remindedAt: new Date() } }),
      ).catch(() => undefined);
      count++;
    }
    return count;
  }
}
