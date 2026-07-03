import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../notifications/email.service";
import { MessagingService } from "../messaging/messaging.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { EvolutionAdapter } from "../integrations/adapters/evolution.adapter";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

type Category = "info" | "low" | "warning" | "critical";

interface SendInput {
  channel: "email" | "whatsapp" | "both";
  subject?: string | null;
  body: string;
  imageUrl?: string | null; // só WhatsApp
  category?: Category;
}

/**
 * Mala direta: dispara promoções/novidades por email (HTML branded) e/ou
 * WhatsApp (texto ou imagem) para os clientes que não optaram por sair.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger("Broadcast");

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly messaging: MessagingService,
    private readonly integrations: IntegrationsService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  async send(ctx: RequestContext, input: SendInput) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctxCan(ctx, "broadcast.send")) throw new AppError(ErrorCode.Forbidden, "Sem permissão para enviar mala direta", 403);
    if (!input.body?.trim() && !input.imageUrl) {
      throw new AppError(ErrorCode.ValidationFailed, "Mensagem vazia", 400);
    }
    const orgId = ctx.orgId;

    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { slug: true, name: true, logoUrl: true } }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Org nao encontrada", 404);

    const customers = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.customer.findMany({
        where: { organizationId: orgId, deletedAt: null, optOutMarketing: false },
        select: { id: true, name: true, email: true, phone: true, whatsappPhone: true },
        take: 2000,
      }),
    );

    const wantEmail = input.channel === "email" || input.channel === "both";
    const wantWhats = input.channel === "whatsapp" || input.channel === "both";

    // Espaçamento (segundos) entre WhatsApps — escalonado pra evitar ban da Meta.
    const whatsMin = Number(process.env.BROADCAST_WHATS_MIN_SEC ?? 25);
    const whatsMax = Number(process.env.BROADCAST_WHATS_MAX_SEC ?? 50);
    const emailGapSec = Number(process.env.BROADCAST_EMAIL_GAP_SEC ?? 2);

    const now = Date.now();
    let whatsOffset = randBetween(3, 12); // primeiro envio em alguns segundos
    let emailOffset = 1;
    const rows: any[] = [];
    let queuedWhats = 0;
    let queuedEmail = 0;

    for (const c of customers) {
      const vars = { "cliente.nome": c.name, "empresa.nome": org.name };
      const text = this.messaging.render(input.body, vars);

      if (wantEmail && c.email) {
        rows.push({
          organizationId: orgId,
          storeId: null,
          channel: "email",
          customerId: c.id,
          toAddress: c.email,
          subject: input.subject ? this.messaging.render(input.subject, vars) : org.name,
          body: text,
          imageUrl: null,
          category: input.category ?? "info",
          scheduledAt: new Date(now + emailOffset * 1000),
          createdBy: ctx.userId ?? null,
        });
        emailOffset += emailGapSec;
        queuedEmail++;
      }

      if (wantWhats) {
        const phone = (c.whatsappPhone ?? c.phone ?? "").replace(/\D/g, "");
        if (phone) {
          rows.push({
            organizationId: orgId,
            storeId: null,
            channel: "whatsapp",
            customerId: c.id,
            toAddress: phone,
            subject: null,
            body: text,
            imageUrl: input.imageUrl ?? null,
            category: input.category ?? "info",
            scheduledAt: new Date(now + whatsOffset * 1000),
            createdBy: ctx.userId ?? null,
          });
          whatsOffset += randBetween(whatsMin, whatsMax);
          queuedWhats++;
        }
      }
    }

    if (rows.length > 0) {
      await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.broadcastMessage.createMany({ data: rows }),
      );
    }

    // ETA do WhatsApp (o gargalo): último offset agendado
    const etaMinutes = queuedWhats > 0 ? Math.ceil(whatsOffset / 60) : Math.ceil(emailOffset / 60);
    this.logger.log(`broadcast enfileirado org=${orgId} whats=${queuedWhats} email=${queuedEmail} eta=${etaMinutes}min`);
    return { queued: rows.length, queuedWhats, queuedEmail, etaMinutes };
  }

  /** Contadores da fila da empresa (pra UI). */
  async status(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const [queued, sentRecent, failedRecent] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.broadcastMessage.count({ where: { status: "queued" } })),
      this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.broadcastMessage.count({ where: { status: "sent", sentAt: { gte: new Date(Date.now() - 86400_000) } } })),
      this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.broadcastMessage.count({ where: { status: "failed", createdAt: { gte: new Date(Date.now() - 86400_000) } } })),
    ]);
    return { queued, sent24h: sentRecent, failed24h: failedRecent };
  }
}

function randBetween(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min));
}
