import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePlatformOwner } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { OrgModulesService } from "./org-modules.service";

const GrantSchema = z.object({
  moduleKey: z.string().min(2).max(50),
  kind: z.enum(["trial", "alacarte", "courtesy"]),
  priceCents: z.number().int().min(0).nullable().optional(),
  days: z.number().int().min(1).max(365).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

@Controller("platform/orgs/:id/module-grants")
export class OrgModulesController {
  constructor(private readonly svc: OrgModulesService) {}

  @Get()
  async list(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.list(ctx, id); // { items, planModules, planName }
  }

  @Post()
  @HttpCode(201)
  async grant(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { grant: await this.svc.grant(ctx, id, GrantSchema.parse(body)) };
  }

  @Post(":moduleKey/mark-paid")
  @HttpCode(200)
  async markPaid(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("moduleKey") moduleKey: string) {
    return { grant: await this.svc.markPaid(ctx, id, moduleKey) };
  }

  @Delete(":moduleKey")
  async revoke(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("moduleKey") moduleKey: string) {
    return this.svc.revoke(ctx, id, moduleKey);
  }

  /** Bloqueia um módulo do plano pra essa empresa (override). */
  @Post(":moduleKey/block")
  @HttpCode(200)
  async block(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("moduleKey") moduleKey: string, @Body() body: unknown) {
    const notes = (body as any)?.notes ?? null;
    return { grant: await this.svc.block(ctx, id, moduleKey, notes) };
  }

  @Post(":moduleKey/unblock")
  @HttpCode(200)
  async unblock(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("moduleKey") moduleKey: string) {
    return this.svc.unblock(ctx, id, moduleKey);
  }
}

const FeaturesSchema = z.object({
  features: z.record(z.string(), z.boolean()),
});

/** Sub-módulos da Produção (Fase 2) — controle do master por empresa.
 *  Mantido por compatibilidade; delega pro mapa genérico. */
@Controller("platform/orgs/:id/production-features")
export class OrgProductionFeaturesController {
  constructor(private readonly svc: OrgModulesService) {}

  @RequirePlatformOwner()
  @Get()
  async get(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { productionFeatures: await this.svc.getProductionFeatures(ctx, id) };
  }

  @RequirePlatformOwner()
  @Put()
  @HttpCode(200)
  async put(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { features } = FeaturesSchema.parse(body);
    return this.svc.setProductionFeatures(ctx, id, features);
  }
}

/** Sub-módulos GENÉRICOS (qualquer módulo) — chaves "<modulo>.<sub>". */
@Controller("platform/orgs/:id/submodule-features")
export class OrgSubmoduleFeaturesController {
  constructor(private readonly svc: OrgModulesService) {}

  @RequirePlatformOwner()
  @Get()
  async get(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { submoduleFeatures: await this.svc.getSubmoduleFeatures(ctx, id) };
  }

  @RequirePlatformOwner()
  @Put()
  @HttpCode(200)
  async put(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { features } = FeaturesSchema.parse(body);
    return this.svc.setSubmoduleFeatures(ctx, id, features);
  }
}
