import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";

/**
 * SlaScheduler — vigia os prazos de SLA dos chamados (substitui o GLPI).
 *
 * A cada tick: marca como violado (sla_breached) os chamados abertos cujo
 * prazo de resolução estourou e ainda não foram escalados; registra o evento
 * na timeline e notifica internamente a equipe/responsável. Também marca
 * violação de 1ª resposta quando o prazo passou sem nenhuma resposta de agente.
 *
 * Self-contained (mesmo padrão dos outros schedulers). DISABLE_SCHEDULER=1 desliga.
 */
@Injectable()
export class SlaScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("SlaScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 90_000); // 1.5 min após boot
    this.timer = setInterval(() => this.tick(), 5 * 60_000); // a cada 5 min
    this.logger.log("SlaScheduler iniciado (tick 5min)");
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const open = { notIn: ["closed", "resolved"] };

      // 1) violação de RESOLUÇÃO: prazo estourou e ainda não escalado
      const breached = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.ticket.findMany({
          where: { status: open, slaBreached: false, resolutionDueAt: { not: null, lt: now } },
          select: { id: true, organizationId: true, code: true, subject: true, storeId: true, assigneeMembershipId: true, teamId: true },
          take: 200,
        }),
      );
      for (const t of breached) {
        await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
          await tx.ticket.update({ where: { id: t.id }, data: { slaBreached: true, escalatedAt: now } });
          await tx.ticketEvent.create({
            data: { organizationId: t.organizationId, ticketId: t.id, eventType: "sla_breach", actorType: "system", payload: { kind: "resolution" } as any },
          });
        });
        await this.notifyInternal(t, "SLA estourado", `O chamado ${t.code} (${t.subject}) passou do prazo de resolução.`);
      }

      // 2) violação de 1ª RESPOSTA: prazo passou e nenhum agente respondeu
      const noFirst = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.ticket.findMany({
          where: { status: open, firstResponseAt: null, firstResponseDueAt: { not: null, lt: now } },
          select: { id: true, organizationId: true, code: true, subject: true, storeId: true, assigneeMembershipId: true, teamId: true },
          take: 200,
        }),
      );
      for (const t of noFirst) {
        // evita duplicar evento: só cria se ainda não houver first_response_breach
        const already = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.ticketEvent.findFirst({ where: { ticketId: t.id, eventType: "first_response_breach" }, select: { id: true } }),
        );
        if (already) continue;
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.ticketEvent.create({
            data: { organizationId: t.organizationId, ticketId: t.id, eventType: "first_response_breach", actorType: "system" },
          }),
        );
        await this.notifyInternal(t, "1ª resposta atrasada", `O chamado ${t.code} (${t.subject}) está sem 1ª resposta dentro do prazo.`);
      }

      if (breached.length || noFirst.length) {
        this.logger.log(`SLA: ${breached.length} resolução estourada, ${noFirst.length} sem 1ª resposta`);
      }
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Notificação interna pro time (sem expor ao cliente). */
  private async notifyInternal(
    t: { organizationId: string; storeId: string | null; code: string },
    subject: string,
    text: string,
  ) {
    await this.notifications
      .notify({
        organizationId: t.organizationId,
        storeId: t.storeId ?? t.organizationId,
        subject: `[${t.code}] ${subject}`,
        text,
        templateCode: "helpdesk_internal",
        internalOnly: true,
      } as any)
      .catch(() => undefined);
  }
}
