import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const ADMIN = { isPlatformAdmin: true as const };

/**
 * Gera a parcela mensal dos títulos a receber RECORRENTES (mensalidades…). Roda
 * 1x/dia; para cada título recorrente ativo, se ainda não gerou a parcela do mês
 * corrente, cria uma parcela vencendo no dia configurado. Idempotente via recurrence_last.
 */
@Injectable()
export class ReceivablesRecurringScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ReceivablesRecurring");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 230_000);
    this.timer = setInterval(() => this.tick(), 12 * 60 * 60_000);
    this.logger.log("ReceivablesRecurring iniciado (tick 12h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.run();
      if (n > 0) this.logger.log(`parcelas recorrentes geradas: ${n}`);
    } catch (e: any) { this.logger.error(`tick falhou: ${e?.message}`); } finally { this.running = false; }
  }

  private async run(): Promise<number> {
    const now = new Date();
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await this.prisma.runWithContext(ADMIN, (tx) => tx.receivable.findMany({
      where: {
        recurring: true,
        recurrenceAmountCents: { not: null },
        OR: [{ recurrenceLast: null }, { recurrenceLast: { lt: firstOfMonth } }],
        AND: [{ OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: firstOfMonth } }] }],
      },
      select: { id: true, organizationId: true, recurrenceDay: true, recurrenceAmountCents: true },
      take: 1000,
    })).catch(() => []);
    if (!rows.length) return 0;
    let created = 0;
    for (const r of rows) {
      const day = Math.min(28, Math.max(1, r.recurrenceDay ?? 1));
      const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
      try {
        await this.prisma.runWithContext({ orgId: r.organizationId, isOrgAdmin: true } as any, async (tx) => {
          const count = await tx.receivableInstallment.count({ where: { receivableId: r.id } });
          await tx.receivableInstallment.create({ data: { organizationId: r.organizationId, receivableId: r.id, number: count + 1, dueDate: due, amountCents: r.recurrenceAmountCents! } });
          await tx.receivable.update({ where: { id: r.id }, data: { recurrenceLast: firstOfMonth } });
        });
        created++;
      } catch (e: any) { this.logger.warn(`recorrente falhou receivable=${r.id}: ${e?.message}`); }
    }
    return created;
  }
}
