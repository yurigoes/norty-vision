import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "./payments.service";

/**
 * AutoChargeScheduler — cobrança automática do crediário (cartão salvo).
 *
 * Modelo: cartão salvo no MP + cobrança avulsa de cada parcela no vencimento.
 * A cada tick, busca parcelas vencidas/no vencimento que:
 *   - status != paid
 *   - creditAccount.autoCharge = true (cartão salvo + opt-in)
 *   - autoChargeAttempts < 3
 *   - autoChargeLastAt nulo OU > ~20h atrás (1 tentativa por dia, 3x em 3 dias)
 * e chama payments.chargeInstallmentAuto. A própria service:
 *   - aprova → liquida a parcela
 *   - recusa → incrementa attempts, notifica o cliente, e ao chegar em 3
 *     marca autoChargeStatus="exhausted" (entra em cobrança/juros).
 *
 * Self-contained (mesmo padrão do PixCleanup/dunning). DISABLE_SCHEDULER=1 desliga.
 */
@Injectable()
export class AutoChargeScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("AutoCharge");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 180_000); // 3 min após boot
    this.timer = setInterval(() => this.tick(), 60 * 60_000); // a cada 1h
    this.logger.log("AutoCharge iniciado (tick 1h)");
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // janela mínima entre tentativas (1 por dia → ~20h de folga)
      const minGapMs = 20 * 60 * 60_000;
      const retryCutoff = new Date(Date.now() - minGapMs);
      const today = new Date();
      today.setHours(23, 59, 59, 999); // inclui parcelas que vencem hoje

      const due = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.creditInstallment.findMany({
          where: {
            status: { not: "paid" },
            dueDate: { lte: today },
            autoChargeAttempts: { lt: 3 },
            OR: [{ autoChargeLastAt: null }, { autoChargeLastAt: { lt: retryCutoff } }],
            creditAccount: { autoCharge: true, mpCardId: { not: null }, mpCustomerId: { not: null } },
          },
          select: { id: true, organizationId: true },
          take: 300,
        }),
      );

      let approved = 0;
      let rejected = 0;
      for (const ins of due) {
        try {
          const r = await this.payments.chargeInstallmentAuto(ins.organizationId, ins.id);
          if (r?.status === "approved") approved++;
          else if (r?.status === "rejected" || r?.status === "exhausted") rejected++;
        } catch (e: any) {
          this.logger.error(`parcela ${ins.id} falhou: ${e?.message}`);
        }
      }
      if (due.length > 0) {
        this.logger.log(`AutoCharge: ${due.length} elegíveis, ${approved} aprovadas, ${rejected} recusadas`);
      }
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }
}
