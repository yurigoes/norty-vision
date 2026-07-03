import {
  Body, Controller, Get, HttpCode, Param, Post, Query, Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { CurrentContext, Public, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PaymentsService } from "./payments.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  // ===== TRANSAÇÕES MP (PDV + crediário) =====
  @Get("transactions")
  @RequirePermission("credit.view")
  async transactions(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.listTransactions(ctx, { status }) };
  }

  @Post("transactions/:kind/:id/force")
  @HttpCode(200)
  @RequirePermission("credit.view")
  async forceCheck(
    @CurrentContext() ctx: RequestContext,
    @Param("kind") kind: string,
    @Param("id") id: string,
  ) {
    const k = kind === "sale" ? "sale" : "installment";
    return this.svc.forceCheck(ctx, k, id);
  }

  /** Verifica um pagamento InfinitePay pelo id do link (force /payment_check). */
  @Post("infinitepay/:id/check")
  @HttpCode(200)
  @RequirePermission("credit.view")
  async checkInfinitepay(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.checkInfinitepay(ctx, id);
  }

  /** Gera pagamento da entrada/saldo de um pedido de produção (maquininha/pix infinity/pix MP). */
  @Post("production/:orderId")
  @HttpCode(200)
  @RequirePermission("production.view")
  async productionPayment(@CurrentContext() ctx: RequestContext, @Param("orderId") orderId: string, @Body() body: { kind?: string; method: string; amountCents?: number }) {
    return this.svc.generateProductionPayment(ctx, orderId, body ?? ({} as any));
  }

  @Post("installments/:id/pix")
  @HttpCode(200)
  @RequirePermission("credit.collect")
  async pix(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.generatePix(ctx, id);
  }

  @Post("installments/:id/card-link")
  @HttpCode(200)
  @RequirePermission("credit.collect")
  async cardLink(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.generateCardLink(ctx, id);
  }

  @Post("installments/:id/infinitepay-link")
  @HttpCode(200)
  @RequirePermission("credit.collect")
  async infinitepayLink(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.generateInfinitepayLink(ctx, id);
  }

  @Post("installments/:id/in-person")
  @HttpCode(200)
  @RequirePermission("credit.collect")
  async inPerson(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { proofUrl?: string; authRequestId?: string; authCode?: string },
  ) {
    return {
      installment: await this.svc.markInPerson(ctx, id, body?.proofUrl, {
        authRequestId: body?.authRequestId,
        authCode: body?.authCode,
      }),
    };
  }

  // ===== AUTORIZAÇÃO DE DESCONTO DE JUROS (admin via código WhatsApp) =====
  @Get("auth-admins")
  @RequirePermission("credit.collect")
  async authAdmins(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listAuthAdmins(ctx) };
  }

  @Post("installments/:id/discount-auth")
  @HttpCode(200)
  @RequirePermission("credit.collect")
  async discountAuth(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { adminMembershipId: string; discountCents: number },
  ) {
    return this.svc.requestDiscountAuth(ctx, id, body);
  }

  // ===== AJUSTE DE DATA DE VENCIMENTO (admin/gerente) =====
  @Post("installments/:id/adjust-due")
  @HttpCode(200)
  @RequirePermission("credit.approve")
  async adjustDue(
    @CurrentContext() ctx: RequestContext,
    @Param("id") id: string,
    @Body() body: { newDueDate: string; toleranceDays?: number; reason?: string },
  ) {
    return { installment: await this.svc.adjustDueDate(ctx, id, body) };
  }

  // ===== WEBHOOK PUBLICO POR ORG =====
  @Public()
  @Post("webhooks/mercadopago/:orgId")
  @HttpCode(200)
  async webhook(
    @Param("orgId") orgId: string,
    @Body() body: any,
    @Req() req: FastifyRequest,
    @Query("type") type?: string,
    @Query("id") id?: string,
    @Query("data.id") dataId?: string,
  ) {
    const sig = {
      xSignature: (req.headers["x-signature"] as string) ?? null,
      xRequestId: (req.headers["x-request-id"] as string) ?? null,
      // data.id usado no manifesto da assinatura (query tem prioridade)
      dataId: dataId ?? id ?? body?.data?.id ?? null,
    };
    return this.svc.handleWebhook(orgId, body, type, id, sig);
  }

  @Public()
  @Post("webhooks/infinitepay/:orgId")
  @HttpCode(200)
  async infinitepayWebhook(@Param("orgId") orgId: string, @Body() body: any) {
    return this.svc.handleInfinitepayWebhook(orgId, body);
  }
}
