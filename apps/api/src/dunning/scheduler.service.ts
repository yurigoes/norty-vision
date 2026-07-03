import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { DunningService } from "./dunning.service";
import { InboxService } from "../inbox/inbox.service";

/**
 * SchedulerService — cron self-contained (sem @nestjs/schedule).
 *
 * setInterval de 1 hora. As rotinas sao idempotentes:
 *  - runDailyDunningAllOrgs: 1 evento por (parcela, regra), nunca duplica
 *  - runCardRetryAllOrgs: processa attempts com next_retry_at vencido
 *
 * Roda uma vez logo apos o boot (delay de 60s pra estabilizar) e depois a
 * cada hora. Em deploy multi-replica, bastaria um lock; no setup atual
 * (1 replica da api) e seguro.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Scheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly dunning: DunningService, private readonly inbox: InboxService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") {
      this.logger.log("Scheduler desabilitado (DISABLE_SCHEDULER=1)");
      return;
    }
    // primeira execucao 60s apos boot
    setTimeout(() => this.tick(), 60_000);
    // depois de hora em hora
    this.timer = setInterval(() => this.tick(), 60 * 60_000);
    this.logger.log("Scheduler iniciado (tick 1h)");
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) {
      this.logger.warn("tick anterior ainda rodando — pulando");
      return;
    }
    this.running = true;
    const start = Date.now();
    try {
      await this.dunning.runDailyDunningAllOrgs();
      await this.dunning.runCardRetryAllOrgs();
      // Auto-resolução silenciosa de conversas inativas (configurável por org).
      // Roda no mesmo tick pra reaproveitar o loop horário; idempotente.
      await this.inbox.autoResolveInactiveAllOrgs().catch((e) => this.logger.warn(`auto-resolve falhou: ${e?.message}`));
      this.logger.log(`tick ok em ${Date.now() - start}ms`);
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }
}
