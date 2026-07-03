import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";

const ADMIN = { isPlatformAdmin: true as const };
const DUE_SOON_DAYS = 3;

/**
 * Aviso de contas a pagar: 1x/dia manda um resumo aos destinatários configurados
 * sobre contas A VENCER (próx. 3 dias) e VENCIDAS. Throttle por notify_sent_at na
 * parcela (entra no resumo no máx. 1x/dia). Reusa o NotificationService (WhatsApp+e-mail).
 */
@Injectable()
export class PayablesNotifyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("PayablesNotify");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 180_000);
    this.timer = setInterval(() => this.tick(), 12 * 60 * 60_000);
    this.logger.log("PayablesNotify iniciado (tick 12h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.run();
      if (sent > 0) this.logger.log(`avisos de contas a pagar enviados: ${sent}`);
    } catch (e: any) { this.logger.error(`tick falhou: ${e?.message}`); } finally { this.running = false; }
  }

  private async run(): Promise<number> {
    const recips = await this.prisma.runWithContext(ADMIN, (tx) => tx.payableNotifyRecipient.findMany({ where: { active: true } }));
    if (!recips.length) return 0;
    const byOrg = new Map<string, any[]>();
    for (const r of recips) (byOrg.get(r.organizationId) ?? byOrg.set(r.organizationId, []).get(r.organizationId)!).push(r);

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const soon = new Date(today.getTime() + DUE_SOON_DAYS * 86400000); soon.setUTCHours(23, 59, 59, 999);
    const since = new Date(Date.now() - 23 * 3600_000); // entra no resumo no máx 1x/dia
    const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    let sentTotal = 0;

    for (const [orgId, list] of byOrg) {
      const orgRls = { orgId, isOrgAdmin: true } as any;
      const insts = await this.prisma.runWithContext(orgRls, (tx) => tx.payableInstallment.findMany({
        where: { status: "a_pagar", dueDate: { lte: soon }, OR: [{ notifySentAt: null }, { notifySentAt: { lt: since } }] },
        orderBy: { dueDate: "asc" }, take: 200,
        include: { payable: { select: { supplier: true, description: true } } },
      })).catch(() => []);
      if (!insts.length) continue;
      const vencidas = insts.filter((i: any) => new Date(i.dueDate) < today);
      const aVencer = insts.filter((i: any) => new Date(i.dueDate) >= today);
      const sumV = vencidas.reduce((s: number, i: any) => s + Number(i.amountCents), 0);
      const sumA = aVencer.reduce((s: number, i: any) => s + Number(i.amountCents), 0);
      const org = await this.prisma.runWithContext(ADMIN, (tx) => tx.organization.findFirst({ where: { id: orgId }, select: { name: true } })).catch(() => null);
      const store = await this.prisma.runWithContext(orgRls, (tx) => tx.store.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } })).catch(() => null);
      const lines = (arr: any[]) => arr.slice(0, 8).map((i: any) => `• ${i.payable?.supplier || i.payable?.description || "conta"} — ${brl(Number(i.amountCents))} (vence ${new Date(i.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })})`).join("\n");

      for (const r of list) {
        const wantV = (r.events ?? []).includes("vencido") && vencidas.length;
        const wantA = (r.events ?? []).includes("a_vencer") && aVencer.length;
        if (!wantV && !wantA) continue;
        const parts = [`📌 *Contas a pagar — ${org?.name ?? "sua empresa"}*`];
        if (wantV) parts.push(`\n🔴 *Vencidas:* ${vencidas.length} · ${brl(sumV)}\n${lines(vencidas)}`);
        if (wantA) parts.push(`\n🟡 *A vencer (até ${DUE_SOON_DAYS} dias):* ${aVencer.length} · ${brl(sumA)}\n${lines(aVencer)}`);
        try {
          await this.notifications.notify({
            organizationId: orgId, storeId: store?.id ?? orgId, customerId: null,
            whatsappPhone: r.whatsapp || null, email: r.email || null,
            subject: `Contas a pagar — ${org?.name ?? ""}`.trim(), text: parts.join("\n"), templateCode: "payables_reminder",
          });
          sentTotal++;
        } catch (e: any) { this.logger.warn(`aviso payable falhou org=${orgId} dest=${r.id}: ${e?.message}`); }
      }
      // marca as parcelas como avisadas hoje (throttle)
      await this.prisma.runWithContext(orgRls, (tx) => tx.payableInstallment.updateMany({ where: { id: { in: insts.map((i: any) => i.id) } }, data: { notifySentAt: new Date() } })).catch(() => undefined);
    }
    return sentTotal;
  }
}
