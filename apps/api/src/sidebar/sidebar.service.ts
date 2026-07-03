import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class SidebarService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  /** Contadores de pendências por módulo pra exibir badges na sidebar. */
  async counts(ctx: RequestContext) {
    const empty = { atendimento: 0, chamados: 0, catalogo: 0, estoque: 0 };
    if (!ctx.orgId) return empty;
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const [atendimento, chamados, catalogo] = await Promise.all([
        tx.conversation.count({ where: { unreadAgent: { gt: 0 }, status: { not: "resolved" } } }).catch(() => 0),
        tx.ticket.count({ where: { status: { notIn: ["resolved", "closed", "canceled"] } } }).catch(() => 0),
        tx.catalogLead.count({ where: { status: "new" } }).catch(() => 0),
      ]);
      // estoque baixo: comparação coluna-a-coluna (stock_qty <= min_stock_qty) via SQL cru — RLS aplica
      let estoque = 0;
      try {
        const rows = await tx.$queryRaw<Array<{ c: number }>>`
          SELECT count(*)::int AS c FROM products
          WHERE deleted_at IS NULL AND is_active = true AND track_stock = true
            AND min_stock_qty > 0 AND stock_qty <= min_stock_qty`;
        estoque = Number(rows[0]?.c ?? 0);
      } catch { estoque = 0; }
      return { atendimento, chamados, catalogo, estoque };
    });
  }
}
