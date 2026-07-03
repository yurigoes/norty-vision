import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import type { RequestContext } from "../auth/session.middleware";

interface LeadItemInput {
  productId?: string | null;
  name: string;
  qty: number;
  unitPriceCents: number;
}
interface CreateLeadInput {
  customerName: string;
  customerPhone: string;
  message?: string | null;
  items: LeadItemInput[];
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  // ===================== VITRINE PÚBLICA (sem auth) =====================

  /**
   * Resolve a vitrine pública pelo slug da EMPRESA (globalmente único). O slug
   * de loja NÃO é único entre empresas (@@unique([organizationId, slug])), então
   * resolver só por slug de loja vazava o catálogo de outra empresa. Aqui
   * resolvemos sempre a partir da organização (slug único) e pegamos a loja com
   * catálogo habilitado. Mantemos um fallback legado: se o slug não casar com
   * nenhuma empresa, tenta loja por slug (compatibilidade de links antigos).
   */
  private async resolveStore(slug: string) {
    const store = await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const org = await tx.organization.findFirst({
        where: { slug, deletedAt: null, status: { not: "canceled" } },
        select: { id: true, name: true },
      });
      if (org) {
        return tx.store.findFirst({
          where: { organizationId: org.id, status: "active", catalogEnabled: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
          include: { organization: { select: { id: true, name: true } } },
        });
      }
      // fallback legado: link antigo apontava pro slug da loja
      return tx.store.findFirst({
        where: { slug, status: "active", catalogEnabled: true, deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: { organization: { select: { id: true, name: true } } },
      });
    });
    if (!store) throw new AppError(ErrorCode.NotFound, "Vitrine não encontrada ou desativada", 404);
    return store;
  }

  /** Catálogo público: branding da loja + produtos publicados. */
  async getPublicCatalog(slug: string) {
    const store = await this.resolveStore(slug);
    const products = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.product.findMany({
        where: {
          organizationId: store.organization!.id,
          // produtos da loja OU da empresa inteira (storeId null)
          OR: [{ storeId: store.id }, { storeId: null }],
          isActive: true,
          showInCatalog: true,
          deletedAt: null,
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, description: true, category: true, imageUrl: true,
          priceCashCents: true, priceCardInstallmentsCents: true, maxInstallments: true,
        },
      }),
    );
    return {
      store: {
        slug: store.slug,
        name: store.name,
        headline: store.catalogHeadline,
        city: store.city,
        state: store.state,
        logoUrl: store.logoUrl,
        primaryColor: store.themePrimaryColor,
        orgName: store.organization?.name ?? null,
      },
      products,
    };
  }

  /** Cliente envia interesse/pedido pela vitrine → cria lead + notifica a loja. */
  async createLead(slug: string, input: CreateLeadInput) {
    const store = await this.resolveStore(slug);
    const items = (input.items ?? []).slice(0, 50).map((i) => ({
      productId: i.productId ?? null,
      name: String(i.name).slice(0, 200),
      qty: Math.max(1, Math.floor(i.qty)),
      unitPriceCents: Math.max(0, Math.floor(i.unitPriceCents)),
    }));
    const totalCents = items.reduce((s, i) => s + i.unitPriceCents * i.qty, 0);

    const lead = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.catalogLead.create({
        data: {
          organizationId: store.organization!.id,
          storeId: store.id,
          customerName: input.customerName.trim().slice(0, 120),
          customerPhone: input.customerPhone.replace(/\D/g, "").slice(0, 20),
          message: input.message?.trim().slice(0, 2000) || null,
          items,
          totalCents: BigInt(totalCents),
        },
      }),
    );

    // notifica a loja (WhatsApp). número da vitrine ou cai na instância da org.
    const lines = items.map((i) => `• ${i.qty}× ${i.name} (${brl(i.unitPriceCents)})`).join("\n");
    const text =
      `🛍️ *Novo pedido pela vitrine*\n` +
      `Cliente: ${lead.customerName}\n` +
      `WhatsApp: ${lead.customerPhone}\n` +
      (items.length ? `\n${lines}\nTotal: *${brl(totalCents)}*\n` : "") +
      (lead.message ? `\nObs.: ${lead.message}` : "");
    if (store.catalogWhatsapp) {
      await this.notifications.notify({
        organizationId: store.organization!.id,
        storeId: store.id,
        whatsappPhone: store.catalogWhatsapp,
        subject: "Novo pedido pela vitrine",
        text,
      }).catch(() => undefined);
    }

    return { ok: true, leadId: lead.id };
  }

  // ===================== ADMIN (painel da empresa) =====================

  async listLeads(ctx: RequestContext, opts: { storeId?: string } = {}) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.catalogLead.findMany({
        where: opts.storeId ? { storeId: opts.storeId } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  }

  async updateLeadStatus(ctx: RequestContext, id: string, status: string) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.catalogLead.update({ where: { id }, data: { status } }),
    );
  }

  /** Config da vitrine por loja (toggle + chamada + whatsapp). */
  async updateSettings(
    ctx: RequestContext,
    storeId: string,
    patch: { catalogEnabled?: boolean; catalogHeadline?: string | null; catalogWhatsapp?: string | null },
  ) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.update({
        where: { id: storeId },
        data: {
          ...(patch.catalogEnabled !== undefined ? { catalogEnabled: patch.catalogEnabled } : {}),
          ...(patch.catalogHeadline !== undefined ? { catalogHeadline: patch.catalogHeadline } : {}),
          ...(patch.catalogWhatsapp !== undefined ? { catalogWhatsapp: patch.catalogWhatsapp?.replace(/\D/g, "") || null } : {}),
        },
        select: { id: true, slug: true, catalogEnabled: true, catalogHeadline: true, catalogWhatsapp: true },
      }),
    );
  }

  /** Liga/desliga um produto na vitrine. */
  async setProductInCatalog(ctx: RequestContext, productId: string, show: boolean) {
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.product.update({ where: { id: productId }, data: { showInCatalog: show }, select: { id: true, showInCatalog: true } }),
    );
  }
}
