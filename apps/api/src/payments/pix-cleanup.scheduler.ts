import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "./payments.service";

/**
 * PixCleanupScheduler — cancela Pix MP que ficou PENDENTE por tempo demais
 * (além da validade do Pix). Antes de cancelar, reconsulta o MP (pode ter sido
 * pago e o webhook não chegou); se ainda pendente, marca como expirado.
 *
 * Self-contained (mesmo padrão do dunning/agenda). DISABLE_SCHEDULER=1 desliga.
 * Janela de expiração configurável por PIX_PENDING_TIMEOUT_MIN (default 60 min).
 */
@Injectable()
export class PixCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("PixCleanup");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 120_000); // 2 min após boot
    this.timer = setInterval(() => this.tick(), 10 * 60_000); // a cada 10 min
    this.logger.log("PixCleanup iniciado (tick 10min)");
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const timeoutMin = Number(process.env.PIX_PENDING_TIMEOUT_MIN ?? 60);
      const cutoff = new Date(Date.now() - timeoutMin * 60_000);
      // pagamentos de venda (PDV) Pix MP pendentes além do prazo
      const stale = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.salePayment.findMany({
          where: { provider: "mp", method: "pix", status: "pending", createdAt: { lt: cutoff } },
          select: { id: true, organizationId: true, mpPaymentId: true },
          take: 200,
        }),
      );
      let canceled = 0;
      for (const sp of stale) {
        // reconsulta o MP (pode ter pago e o webhook não chegou)
        if (sp.mpPaymentId) {
          await this.payments.syncMpPayment(sp.organizationId, sp.mpPaymentId).catch(() => undefined);
        }
        // se continua pendente após a reconsulta → expira
        const cur = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.salePayment.findFirst({ where: { id: sp.id }, select: { status: true } }),
        );
        if (cur?.status === "pending") {
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.salePayment.update({ where: { id: sp.id }, data: { status: "expired" } }),
          );
          canceled++;
        }
      }
      if (canceled > 0) this.logger.log(`Pix pendentes expirados: ${canceled}`);
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }
}
