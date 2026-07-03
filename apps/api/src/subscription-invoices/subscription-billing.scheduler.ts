import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SubscriptionInvoicesService } from "./subscription-invoices.service";

/**
 * Cobrança automática das mensalidades. Tica de 6 em 6h (idempotente):
 *  - gera a mensalidade do mês corrente pra cada empresa ativa com plano pago;
 *  - roda a régua de cobrança (avisa vencidas 1x/dia, suspende após carência).
 * Mesmo padrão self-contained do scheduler de dunning do crediário.
 */
@Injectable()
export class SubscriptionBillingScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("SubscriptionBilling");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly svc: SubscriptionInvoicesService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 90_000);
    this.timer = setInterval(() => this.tick(), 6 * 60 * 60_000);
    this.logger.log("Cobrança de assinaturas iniciada (tick 6h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.svc.generateMonthlyInvoices();
      await this.svc.runDunning();
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
