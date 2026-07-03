import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import {
  CurrentContext,
  Public,
  RequirePlatformAdmin,
} from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { SubscriptionsService } from "./subscriptions.service";

const StartCheckoutSchema = z.object({
  planSlug: z.string().min(1).optional(),
  planId: z.string().uuid().optional(),
  backUrl: z.string().url().optional(),
});

const OneTimeSchema = z.object({
  planSlug: z.string().min(1).optional(),
  planId: z.string().uuid().optional(),
  method: z.enum(["pix", "card"]),
});

const ModuleBuySchema = z.object({
  moduleKey: z.string().min(2).max(50),
  method: z.enum(["pix", "card"]),
});

@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get("current")
  async current(@CurrentContext() ctx: RequestContext) {
    return { subscription: await this.svc.current(ctx) };
  }

  @Post("checkout")
  @HttpCode(200)
  async startCheckout(
    @CurrentContext() ctx: RequestContext,
    @Body() body: unknown,
  ) {
    const input = StartCheckoutSchema.parse(body);
    return this.svc.startCheckout(ctx, input);
  }

  /** Cobrança avulsa (Pix/cartão) de 1 período, sem recorrência. */
  @Post("one-time")
  @HttpCode(200)
  async startOneTime(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.startOneTime(ctx, OneTimeSchema.parse(body));
  }

  @Patch("cancel")
  async cancel(@CurrentContext() ctx: RequestContext) {
    return { subscription: await this.svc.cancel(ctx) };
  }

  /** Módulos à la carte que a empresa pode comprar (precificados pelo master). */
  @Get("module-offers")
  async moduleOffers(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listMyModuleOffers(ctx) };
  }

  /** Inicia o pagamento (Pix/cartão) de um módulo à la carte. */
  @Post("module-offers/checkout")
  @HttpCode(200)
  async buyModule(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.startModulePurchase(ctx, ModuleBuySchema.parse(body));
  }

  @RequirePlatformAdmin()
  @Get("admin/all")
  async listAll() {
    return { items: await this.svc.listAll() };
  }

  // ===== WEBHOOK PUBLICO MERCADO PAGO =====
  @Public()
  @Post("webhooks/mercadopago")
  @HttpCode(200)
  async webhook(
    @Body() body: any,
    @Query("type") type: string | undefined,
    @Query("id") id: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const sig = {
      xSignature: (req.headers["x-signature"] as string | undefined) ?? null,
      xRequestId: (req.headers["x-request-id"] as string | undefined) ?? null,
      dataId: (body?.data?.id ?? id ?? null)?.toString() ?? null,
    };
    return this.svc.handleWebhook({ body, queryType: type, queryId: id, sig });
  }
}
