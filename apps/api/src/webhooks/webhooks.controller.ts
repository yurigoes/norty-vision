import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Public } from "../auth/decorators";
import {
  EvolutionWebhookService,
  type EvolutionPayload,
} from "./evolution-webhook.service";
import { MetaWebhookService } from "./meta-webhook.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(
    private readonly evolution: EvolutionWebhookService,
    private readonly meta: MetaWebhookService,
  ) {}

  /**
   * POST /api/webhooks/evolution/:instanceName
   *
   * Recebe eventos do Evolution. Body conforme docs:
   * https://doc.evolution-api.com/v2/api-reference/webhooks
   *
   * Publica intencionalmente - Evolution nao tem auth no callback.
   * Validacao basica: instanceName deve casar com algum stores.evolution_instance_name.
   */
  @Public()
  @Post("evolution/:instanceName")
  @HttpCode(200)
  async evolutionWebhook(
    @Param("instanceName") instanceName: string,
    @Body() body: EvolutionPayload,
  ) {
    // resposta rapida (Evolution faz retry se demorar > 5s)
    // processamento real e best-effort em background
    this.evolution
      .handle(instanceName, body)
      .catch((e) => console.error("[evolution-webhook]", e));

    return { ok: true };
  }

  /**
   * Variante sem instanceName (Evolution global webhook).
   * Evolution pode mandar global webhook com instance no body.
   */
  @Public()
  @Post("evolution")
  @HttpCode(200)
  async evolutionWebhookGlobal(@Body() body: EvolutionPayload) {
    const instance = body.instance ?? "";
    this.evolution
      .handle(instance, body)
      .catch((e) => console.error("[evolution-webhook-global]", e));
    return { ok: true };
  }

  /**
   * GET /api/webhooks/meta — verificação do WhatsApp Cloud API (Meta).
   * A Meta chama isto ao assinar o webhook; respondemos o hub.challenge se o
   * hub.verify_token bater com META_VERIFY_TOKEN.
   */
  @Public()
  @Get("meta")
  metaVerify(@Query() query: Record<string, any>): string {
    const challenge = this.meta.verifyChallenge(query);
    if (challenge === null) throw new ForbiddenException();
    return challenge;
  }

  /**
   * POST /api/webhooks/meta — mensagens do WhatsApp Cloud API.
   * Usa o corpo CRU (req.rawBody) pra validar a assinatura X-Hub-Signature-256.
   * Responde rápido; o processamento é best-effort em background.
   */
  @Public()
  @Post("meta")
  @HttpCode(200)
  async metaWebhook(
    @Req() req: any,
    @Headers("x-hub-signature-256") signature?: string,
  ) {
    const raw: Buffer = req?.rawBody ?? Buffer.from(JSON.stringify(req?.body ?? {}));
    this.meta.handle(raw, signature).catch((e) => console.error("[meta-webhook]", e));
    return { ok: true };
  }
}
