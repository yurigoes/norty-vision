import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { SurveysService } from "../surveys/surveys.service";
import { loadEnv } from "../config";

const ADMIN = { isPlatformAdmin: true as const };

/**
 * Follow-ups da ótica (cron self-contained):
 *  - Lembrete de exame: 1 ano após o exame (consulta agendada/atendida), avisa o
 *    cliente que venceu e oferece remarcar. Só vale pra agendamento (exame com o
 *    médico) — venda de óculos não gera lembrete.
 *  - NPS de experiência: 15 dias após o óculos chegar, manda pesquisa rápida.
 * Idempotente (marca *_sent_at).
 */
@Injectable()
export class OpticalFollowupsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("OpticalFollowups");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly surveys: SurveysService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 120_000); // 2min após boot
    this.timer = setInterval(() => this.tick(), 6 * 60 * 60_000); // a cada 6h
    this.logger.log("OpticalFollowups iniciado (tick 6h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const recalls = await this.sendExamRecalls();
      const nps = await this.sendExperienceSurveys();
      if (recalls + nps > 0) this.logger.log(`recalls=${recalls} nps15d=${nps}`);
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally { this.running = false; }
  }

  /** 1 ano após o exame: lembra o cliente (só do exame mais recente, 1x). */
  private async sendExamRecalls(): Promise<number> {
    const cutoff = new Date(Date.now() - 365 * 86400_000);
    const due = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.appointment.findMany({
        where: { status: "attended", startsAt: { lte: cutoff }, examRecallSentAt: null, deletedAt: null },
        orderBy: { startsAt: "desc" },
        take: 500,
      }),
    );
    let sent = 0;
    for (const apt of due) {
      // só recall do exame mais recente do cliente (se houver atendido mais novo, pula)
      const newer = await this.prisma.runWithContext(ADMIN, (tx) =>
        tx.appointment.count({ where: { customerId: apt.customerId, status: "attended", startsAt: { gt: apt.startsAt }, deletedAt: null } }),
      );
      if (newer > 0) { await this.markRecall(apt.id); continue; }

      const customer = await this.prisma.runWithContext(ADMIN, (tx) =>
        tx.customer.findFirst({ where: { id: apt.customerId }, select: { name: true, phone: true, whatsappPhone: true, email: true } }),
      );
      const firstName = (customer?.name ?? "Cliente").split(" ")[0];
      const text = `Olá ${firstName}! Já faz 1 ano desde seu último exame de vista. A receita costuma vencer nesse período — que tal remarcar e manter sua visão em dia? Responda aqui ou fale com a gente pra agendar. 👓`;
      try {
        if (customer && (customer.whatsappPhone || customer.phone || customer.email)) {
          await this.notifications.notify({
            organizationId: apt.organizationId, storeId: apt.storeId, customerId: apt.customerId,
            whatsappPhone: customer.whatsappPhone ?? customer.phone ?? null, email: customer.email ?? null,
            subject: "Hora de renovar seu exame de vista", text, templateCode: "exam_recall",
          });
        }
      } catch (e: any) { this.logger.warn(`recall falhou apt=${apt.id}: ${e?.message}`); }
      await this.markRecall(apt.id);
      sent++;
    }
    return sent;
  }
  private async markRecall(id: string) {
    await this.prisma.runWithContext(ADMIN, (tx) => tx.appointment.update({ where: { id }, data: { examRecallSentAt: new Date() } })).catch(() => undefined);
  }

  /** 15 dias após o óculos chegar/entregar: pesquisa de experiência. */
  private async sendExperienceSurveys(): Promise<number> {
    const cutoff = new Date(Date.now() - 15 * 86400_000);
    const due = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.lensOrder.findMany({
        where: {
          experienceSurveySentAt: null,
          customerId: { not: null },
          OR: [{ deliveredAt: { lte: cutoff } }, { AND: [{ deliveredAt: null }, { arrivedAt: { lte: cutoff } }] }],
        },
        take: 300,
      }),
    );
    let sent = 0;
    for (const o of due) {
      try {
        await this.surveys.createAndSend({
          organizationId: o.organizationId, storeId: o.storeId ?? null, customerId: o.customerId ?? null,
          kind: "lens_order", refId: o.id, stage: "experience_15d",
        });
      } catch (e: any) { this.logger.warn(`nps15d falhou order=${o.id}: ${e?.message}`); }
      await this.prisma.runWithContext(ADMIN, (tx) => tx.lensOrder.update({ where: { id: o.id }, data: { experienceSurveySentAt: new Date() } })).catch(() => undefined);
      sent++;
    }
    return sent;
  }
}
