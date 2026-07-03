// ==============================================================================
// production-wipe.service.ts
//
// LIMPEZA da base de dados ANTES de re-importar uma planilha histórica.
// Pra VR Sports: zera production_orders, customers, conversations, leads etc
// e mantém PDV (sales) e produtos. O usuário precisa digitar o SLUG da org
// como dupla confirmação pra evitar acidente.
//
// Ordem das DELETEs respeita FK: dependentes ANTES de pais. customerId nas
// sales vai pra NULL antes de apagar customers — preserva o histórico de
// vendas com cliente "anônimo".
// ==============================================================================
import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

export interface WipeScope {
  production?: boolean;     // production_orders + items + roster + files + payments + fabrics
  quotes?: boolean;         // quotes + quote_items
  conversations?: boolean;  // conversations + messages + labels links
  leads?: boolean;          // crm_leads + interactions + tasks + attachments
  appointments?: boolean;   // appointments (não toca em slots/templates)
  credit?: boolean;         // credit_accounts + installments + applications + documents
  lens?: boolean;           // lens_orders + lens_batches
  broadcast?: boolean;      // broadcast_messages
  customers?: boolean;      // SET sales.customerId=NULL + delete customer_notes/docs + customers
}

export interface WipeResult {
  deleted: Record<string, number>;
  saleCustomerNulled: number;
}

@Injectable()
export class ProductionWipeService {
  private readonly logger = new Logger(ProductionWipeService.name);
  constructor(private readonly prisma: PrismaService) {}

  async wipe(ctx: RequestContext, input: { confirmSlug: string; scope: WipeScope }): Promise<WipeResult> {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode limpar a base", 403);
    }
    // confirma com slug da org
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findUnique({ where: { id: ctx.orgId! }, select: { slug: true, name: true } }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Org não encontrada", 404);
    if ((input.confirmSlug ?? "").trim().toLowerCase() !== org.slug.toLowerCase()) {
      throw new AppError(ErrorCode.ValidationFailed, `Digite o slug "${org.slug}" pra confirmar`, 400);
    }
    const orgId = ctx.orgId;
    const s = input.scope;
    const deleted: Record<string, number> = {};
    let saleCustomerNulled = 0;
    const TAG = `wipe[${org.slug}]`;

    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      // PRODUÇÃO ─────────────────────────────────────────
      if (s.production) {
        const oIds = await tx.productionOrder.findMany({ where: { organizationId: orgId }, select: { id: true } });
        const ids = oIds.map((o) => o.id);
        if (ids.length) {
          deleted.production_payments = (await tx.productionPayment.deleteMany({ where: { orderId: { in: ids } } })).count;
          deleted.production_order_files = (await tx.productionOrderFile.deleteMany({ where: { orderId: { in: ids } } })).count;
          deleted.production_order_roster = (await tx.productionOrderRoster.deleteMany({ where: { orderId: { in: ids } } })).count;
          deleted.production_order_items = (await tx.productionOrderItem.deleteMany({ where: { orderId: { in: ids } } })).count;
          deleted.production_order_fabrics = (await tx.productionOrderFabric.deleteMany({ where: { orderId: { in: ids } } })).count;
          // reviews (pode ou não existir)
          await tx.productionArtReview.deleteMany({ where: { orderId: { in: ids } } }).then((r) => deleted.production_art_reviews = r.count).catch(() => undefined);
          deleted.production_orders = (await tx.productionOrder.deleteMany({ where: { id: { in: ids } } })).count;
        }
        // batches da org (alguns ficam órfãos)
        deleted.production_batches = (await tx.productionBatch.deleteMany({ where: { organizationId: orgId } })).count;
      }

      // ORÇAMENTOS ────────────────────────────────────────
      if (s.quotes) {
        const qIds = await tx.quote.findMany({ where: { organizationId: orgId }, select: { id: true } });
        const ids = qIds.map((q) => q.id);
        if (ids.length) {
          deleted.quote_items = (await tx.quoteItem.deleteMany({ where: { quoteId: { in: ids } } })).count;
          deleted.quotes = (await tx.quote.deleteMany({ where: { id: { in: ids } } })).count;
        }
      }

      // CONVERSAS / ATENDIMENTO ──────────────────────────
      if (s.conversations) {
        const cIds = await tx.conversation.findMany({ where: { organizationId: orgId }, select: { id: true } });
        const ids = cIds.map((c) => c.id);
        if (ids.length) {
          deleted.conversation_label_links = (await tx.conversationLabelLink.deleteMany({ where: { conversationId: { in: ids } } })).count;
          deleted.conversation_messages = (await tx.conversationMessage.deleteMany({ where: { conversationId: { in: ids } } })).count;
          deleted.conversations = (await tx.conversation.deleteMany({ where: { id: { in: ids } } })).count;
        }
      }

      // LEADS CRM ─────────────────────────────────────────
      if (s.leads) {
        const lIds = await tx.crmLead.findMany({ where: { organizationId: orgId }, select: { id: true } });
        const ids = lIds.map((l) => l.id);
        if (ids.length) {
          await tx.crmLeadEvent.deleteMany({ where: { leadId: { in: ids } } }).then((r) => deleted.crm_lead_events = r.count).catch(() => undefined);
          await tx.crmTask.deleteMany({ where: { leadId: { in: ids } } }).then((r) => deleted.crm_tasks = r.count).catch(() => undefined);
          deleted.crm_leads = (await tx.crmLead.deleteMany({ where: { id: { in: ids } } })).count;
        }
      }

      // AGENDAMENTOS ──────────────────────────────────────
      if (s.appointments) {
        deleted.appointments = (await tx.appointment.deleteMany({ where: { organizationId: orgId } })).count;
      }

      // CREDIÁRIO ─────────────────────────────────────────
      if (s.credit) {
        // Apaga via campo organizationId (todas as 4 tabelas têm esse campo)
        await tx.creditInstallment.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.credit_installments = r.count).catch(() => undefined);
        await tx.creditLimitRequest.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.credit_limit_requests = r.count).catch(() => undefined);
        await tx.creditPurchase.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.credit_purchases = r.count).catch(() => undefined);
        await tx.creditApplication.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.credit_applications = r.count).catch(() => undefined);
        deleted.credit_accounts = (await tx.creditAccount.deleteMany({ where: { organizationId: orgId } })).count;
      }

      // LENS (ÓTICA) ──────────────────────────────────────
      if (s.lens) {
        await tx.lensOrder.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.lens_orders = r.count).catch(() => undefined);
      }

      // BROADCAST (MALA DIRETA) ───────────────────────────
      if (s.broadcast) {
        await tx.broadcastMessage.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.broadcast_messages = r.count).catch(() => undefined);
      }

      // CLIENTES ──────────────────────────────────────────
      // (sempre por último; antes, NULL customerId nas sales pra preservar
      //  o histórico de vendas — não queremos perder a venda só porque o
      //  cliente foi removido).
      if (s.customers) {
        saleCustomerNulled = (await tx.sale.updateMany({
          where: { organizationId: orgId, customerId: { not: null } },
          data: { customerId: null },
        })).count;
        await tx.customerNote.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.customer_notes = r.count).catch(() => undefined);
        await tx.customerDocument.deleteMany({ where: { organizationId: orgId } }).then((r) => deleted.customer_documents = r.count).catch(() => undefined);
        deleted.customers = (await tx.customer.deleteMany({ where: { organizationId: orgId } })).count;
      }
    });

    this.logger.warn(`${TAG} concluído: ${JSON.stringify(deleted)} (sales nulled: ${saleCustomerNulled})`);
    return { deleted, saleCustomerNulled };
  }
}
