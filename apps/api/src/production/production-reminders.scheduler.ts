import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";

const ADMIN = { isPlatformAdmin: true as const };
const REMINDER_EVERY_MS = 3 * 86400_000; // recobra a cada 3 dias
const MAX_PER_TICK = 100;

/**
 * Lembrete recorrente de cobrança do SALDO (gráfica). Pedidos prontos/entregues
 * (ou atrasados) que NÃO foram quitados recebem um lembrete por WhatsApp/e-mail
 * com o valor em aberto + chave Pix. Cadência controlada por saldo_reminder_at
 * (a cada 3 dias). Para quando a equipe marca o pagamento como pago.
 */
@Injectable()
export class ProductionRemindersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ProductionReminders");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 150_000); // ~2,5min após boot
    this.timer = setInterval(() => this.tick(), 12 * 60 * 60_000); // a cada 12h
    this.logger.log("ProductionReminders iniciado (tick 12h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.sendSaldoReminders();
      if (sent > 0) this.logger.log(`lembretes de saldo enviados: ${sent}`);
    } catch (e: any) {
      this.logger.error(`tick falhou: ${e?.message}`);
    } finally { this.running = false; }
  }

  private async sendSaldoReminders(): Promise<number> {
    // só gráficas
    const orgs = await this.prisma.runWithContext(ADMIN, (tx) => tx.organization.findMany({ where: { niche: "grafica" }, select: { id: true, name: true } })).catch(() => []);
    if (!orgs.length) return 0;
    const orgIds = orgs.map((o) => o.id);
    const orgName = new Map(orgs.map((o) => [o.id, o.name] as [string, string]));
    const cutoff = new Date(Date.now() - REMINDER_EVERY_MS);
    const now = new Date();
    const due = await this.prisma.runWithContext(ADMIN, (tx) => tx.productionOrder.findMany({
      where: {
        organizationId: { in: orgIds },
        paymentStatus: { not: "paid" },
        status: { notIn: ["cancelado"] },
        OR: [{ status: { in: ["pronto", "entrega"] } }, { AND: [{ dueDate: { lt: now } }, { status: { notIn: ["finalizado", "cancelado"] } }] }],
        AND: [{ OR: [{ saldoReminderAt: null }, { saldoReminderAt: { lt: cutoff } }] }],
      },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_TICK,
      select: { id: true, shortCode: true, organizationId: true, storeId: true, customerId: true, contactName: true, contactPhone: true, contactEmail: true, totalCents: true, downPaymentCents: true, paymentStatus: true },
    })).catch(() => []);
    if (!due.length) return 0;

    // chave Pix por org (cache)
    const pixByOrg = new Map<string, string | null>();
    const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    let sent = 0;
    for (const o of due) {
      const total = Number(o.totalCents ?? 0);
      const pago = o.paymentStatus === "partial" ? Number(o.downPaymentCents ?? 0) : 0;
      const saldo = Math.max(0, total - pago);
      if (saldo <= 0) { await this.mark(o.id); continue; }
      if (!o.contactPhone && !o.contactEmail) { await this.mark(o.id); continue; }
      if (!pixByOrg.has(o.organizationId)) {
        const cfg = await this.prisma.runWithContext(ADMIN, (tx) => tx.callCenterSettings.findFirst({ where: { organizationId: o.organizationId }, select: { graficaPixKey: true } })).catch(() => null);
        pixByOrg.set(o.organizationId, cfg?.graficaPixKey ?? null);
      }
      const pix = pixByOrg.get(o.organizationId);
      const first = (o.contactName || "Cliente").split(" ")[0];
      const text = `Oi, ${first}! 🧾 Passando pra lembrar do saldo do seu pedido *${o.shortCode ?? ""}* na ${orgName.get(o.organizationId) ?? "nossa loja"}.`
        + `\n\n💰 Em aberto: *${brl(saldo)}*${pago > 0 ? ` (sinal de ${brl(pago)} já pago)` : ""}.`
        + (pix ? `\n💸 *Pix:* ${pix}\nÉ só mandar o comprovante por aqui assim que pagar. 🙂` : "")
        + `\n\nSe já pagou, pode ignorar este aviso. 😉`;
      try {
        await this.notifications.notify({
          organizationId: o.organizationId, storeId: o.storeId ?? o.organizationId, customerId: o.customerId ?? null,
          whatsappPhone: o.contactPhone ?? null, email: o.contactEmail ?? null,
          subject: `Saldo em aberto — pedido ${o.shortCode ?? ""}`,
          text, templateCode: "production_saldo_reminder",
        });
      } catch (e: any) { this.logger.warn(`lembrete saldo falhou pedido=${o.id}: ${e?.message}`); }
      await this.mark(o.id);
      sent++;
    }
    return sent;
  }

  private async mark(id: string) {
    await this.prisma.runWithContext(ADMIN, (tx) => tx.productionOrder.update({ where: { id }, data: { saldoReminderAt: new Date() } })).catch(() => undefined);
  }
}
