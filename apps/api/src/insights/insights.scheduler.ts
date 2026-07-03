import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { InsightsService } from "./insights.service";

/**
 * Roda a análise de gargalos de todas as empresas a cada 6h (regras; a IA só
 * redige resumo, com economia de cota). Também levanta dúvidas do ecossistema
 * pro master ensinar.
 */
@Injectable()
export class InsightsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Insights");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly insights: InsightsService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 320_000); // boot ~5min
    this.timer = setInterval(() => this.tick(), 6 * 60 * 60_000); // 6h
    this.logger.log("Insights iniciado (tick 6h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try { const r = await this.insights.analyzeAll(); this.logger.log(`analisou ${r.orgs} empresa(s)`); }
    catch (e: any) { this.logger.error(`tick falhou: ${e?.message}`); }
    finally { this.running = false; }
  }
}
