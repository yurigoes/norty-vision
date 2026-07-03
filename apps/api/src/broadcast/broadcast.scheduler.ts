import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email.service";
import { MessagingService } from "../messaging/messaging.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { EvolutionAdapter } from "../integrations/adapters/evolution.adapter";

/**
 * BroadcastScheduler — envia a mala direta enfileirada (broadcast_messages) num
 * ritmo seguro pra NÃO tomar ban do WhatsApp. As mensagens já vêm com
 * scheduled_at escalonado; aqui só pegamos as que "venceram" e mandamos poucas
 * por tick (com jitter). Estado no banco → sobrevive a restart.
 */
@Injectable()
export class BroadcastScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("BroadcastQueue");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly messaging: MessagingService,
    private readonly integrations: IntegrationsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 30_000);
    this.timer = setInterval(() => this.tick(), 15_000); // a cada 15s
    this.logger.log("BroadcastQueue iniciado (tick 15s)");
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const w = await this.processWhatsapp();
      const e = await this.processEmail();
      if (w + e > 0) this.logger.log(`enviados: whats=${w} email=${e}`);
    } catch (err: any) {
      this.logger.error(`tick falhou: ${err?.message}`);
    } finally {
      this.running = false;
    }
  }

  private async orgBrand(orgId: string, cache: Map<string, any>) {
    if (cache.has(orgId)) return cache.get(orgId);
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { slug: true, name: true, logoUrl: true } }),
    );
    cache.set(orgId, org);
    return org;
  }

  /** Poucos WhatsApp por tick + jitter — o "freio de mão" contra ban. */
  private async processWhatsapp(): Promise<number> {
    const perTick = Number(process.env.BROADCAST_WHATS_PER_TICK ?? 2);
    const due = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.broadcastMessage.findMany({
        where: { channel: "whatsapp", status: "queued", scheduledAt: { lte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: perTick,
      }),
    );
    if (due.length === 0) return 0;

    const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "evolution" });
    const adapter = cfg?.baseUrl && cfg.apiKey ? new EvolutionAdapter({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }) : null;
    const brandCache = new Map<string, any>();
    let count = 0;

    for (const m of due) {
      let ok = false; let err: string | null = null;
      try {
        const org = await this.orgBrand(m.organizationId, brandCache);
        if (!adapter || !org?.slug) {
          err = "Evolution não configurado";
        } else {
          const r = m.imageUrl
            ? await adapter.sendMedia({ instanceName: org.slug, number: m.toAddress, mediaUrl: m.imageUrl, caption: m.body })
            : await adapter.sendText({ instanceName: org.slug, number: m.toAddress, text: m.body });
          ok = r.ok;
          if (!r.ok) err = r.error ?? "falha no envio";
        }
      } catch (e: any) { err = e?.message ?? "erro"; }

      await this.mark(m.id, ok, err, m.attempts);
      count++;
      // jitter entre os poucos do tick
      await sleep(randBetween(4000, 9000));
    }
    return count;
  }

  /** Email tolera ritmo maior. */
  private async processEmail(): Promise<number> {
    const perTick = Number(process.env.BROADCAST_EMAIL_PER_TICK ?? 40);
    const due = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.broadcastMessage.findMany({
        where: { channel: "email", status: "queued", scheduledAt: { lte: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: perTick,
      }),
    );
    if (due.length === 0) return 0;
    const brandCache = new Map<string, any>();
    let count = 0;
    for (const m of due) {
      let ok = false; let err: string | null = null;
      try {
        const org = await this.orgBrand(m.organizationId, brandCache);
        const html = this.messaging.buildEmailHtml({
          bodyHtml: escapeHtml(m.body).replace(/\n/g, "<br/>"),
          category: (m.category as any) ?? "info",
          brandName: org?.name ?? "",
          logoUrl: org?.logoUrl ?? null,
        });
        await this.email.sendForOrg(m.organizationId, {
          to: m.toAddress,
          subject: m.subject ?? (org?.name ?? "Novidades"),
          html,
          text: m.body,
        });
        ok = true;
      } catch (e: any) { err = e?.message ?? "erro"; }
      await this.mark(m.id, ok, err, m.attempts);
      count++;
    }
    return count;
  }

  private async mark(id: string, ok: boolean, err: string | null, attempts: number) {
    // 3 tentativas pra WhatsApp/email antes de marcar como failed
    const failedFinal = !ok && attempts + 1 >= 3;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.broadcastMessage.update({
        where: { id },
        data: ok
          ? { status: "sent", sentAt: new Date(), attempts: { increment: 1 }, error: null }
          : failedFinal
            ? { status: "failed", attempts: { increment: 1 }, error: err }
            : { status: "queued", attempts: { increment: 1 }, error: err, scheduledAt: new Date(Date.now() + 60_000) },
      }),
    ).catch(() => undefined);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function randBetween(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min));
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
