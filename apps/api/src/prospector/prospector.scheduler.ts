import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ProspectorService } from "./prospector.service";

/** Roda campanhas de prospecção ativas (daily/weekly) periodicamente. */
@Injectable()
export class ProspectorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ProspectorScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly svc: ProspectorService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 180_000); // ~3min após boot
    this.timer = setInterval(() => this.tick(), 6 * 60 * 60_000); // a cada 6h
    this.logger.log("ProspectorScheduler iniciado (tick 6h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.svc.runDue(); } catch (e: any) { this.logger.error(`tick falhou: ${e?.message}`); } finally { this.running = false; }
  }
}
