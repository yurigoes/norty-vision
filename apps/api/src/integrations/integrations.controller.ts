import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  CurrentContext,
  RequirePlatformAdmin,
  RequirePlatformOwner,
} from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { IntegrationsService } from "./integrations.service";
import { ProvisioningService } from "./provisioning.service";

@Controller("platform/integrations")
export class IntegrationsController {
  constructor(
    private readonly svc: IntegrationsService,
    private readonly provisioning: ProvisioningService,
  ) {}

  @RequirePlatformOwner()
  @Get()
  async list(@CurrentContext() ctx: RequestContext) {
    return {
      integrations: await this.svc.listGlobal({
        isPlatformAdmin: ctx.isPlatformAdmin,
      }),
    };
  }

  @RequirePlatformOwner()
  @Get(":provider")
  async getOne(
    @CurrentContext() ctx: RequestContext,
    @Param("provider") provider: string,
  ) {
    return {
      integration: await this.svc.getByProvider({
        isPlatformAdmin: ctx.isPlatformAdmin,
        provider,
      }),
    };
  }

  @RequirePlatformOwner()
  @Patch(":provider")
  async update(
    @CurrentContext() ctx: RequestContext,
    @Param("provider") provider: string,
    @Body() body: Record<string, unknown>,
  ) {
    return {
      integration: await this.svc.update(
        {
          isPlatformAdmin: ctx.isPlatformAdmin,
          platformUserId: ctx.platformUserId,
          provider,
        },
        body,
      ),
    };
  }

  /** POST /api/platform/integrations/:provider/test - faz ping na URL configurada */
  @RequirePlatformOwner()
  @Post(":provider/test")
  @HttpCode(200)
  async test(
    @CurrentContext() ctx: RequestContext,
    @Param("provider") provider: string,
  ) {
    return this.provisioning.testConnection({
      isPlatformAdmin: ctx.isPlatformAdmin,
      provider,
    });
  }

  /** POST /api/platform/integrations/provision/:organizationId
   *  Cria a org nos 3 sistemas externos (idempotente; pula o que ja existe). */
  @RequirePlatformAdmin()
  @Post("provision/:organizationId")
  @HttpCode(200)
  async provision(
    @CurrentContext() ctx: RequestContext,
    @Param("organizationId") organizationId: string,
  ) {
    return this.provisioning.provisionOrganization({
      isPlatformAdmin: ctx.isPlatformAdmin,
      organizationId,
      platformUserId: ctx.platformUserId ?? null,
    });
  }

  /**
   * POST /api/platform/integrations/evolution/resync-webhooks
   *
   * Re-aplica o webhook (formato v2.x) em todas as instâncias Evolution
   * existentes. Conserta instâncias antigas que foram criadas com payload v1.x
   * (snake_case) e que no Evolution v2.3.x ficaram conectadas mas sem eventos
   * → não recebem nem confirmam envios. Operação idempotente.
   */
  @RequirePlatformAdmin()
  @Post("evolution/resync-webhooks")
  @HttpCode(200)
  async resyncEvolutionWebhooks(@CurrentContext() ctx: RequestContext) {
    return this.provisioning.resyncEvolutionWebhooks({ isPlatformAdmin: ctx.isPlatformAdmin });
  }
}
