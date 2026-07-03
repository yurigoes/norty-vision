import { Body, Controller, Get, HttpCode, Param, Post, Patch } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { DunningService } from "./dunning.service";

const RuleSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(120),
  daysAfterDue: z.number().int().min(-30).max(365),
  channel: z.enum(["whatsapp", "email", "both"]),
  templateText: z.string().min(5).max(2000),
  isActive: z.boolean().optional(),
});

@Controller("dunning")
export class DunningController {
  constructor(private readonly svc: DunningService) {}

  @Get("rules")
  async listRules(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listRules(ctx) };
  }

  @Post("rules")
  @HttpCode(200)
  async upsertRule(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { rule: await this.svc.upsertRule(ctx, RuleSchema.parse(body)) };
  }

  @Get("timeline/:accountId")
  async timeline(@CurrentContext() ctx: RequestContext, @Param("accountId") accountId: string) {
    return { items: await this.svc.timeline(ctx, accountId) };
  }

  /** Dispara o ciclo manualmente pra org atual (admin/master). */
  @Post("run-now")
  @HttpCode(200)
  async runNow(@CurrentContext() ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      return { ok: false, error: "Apenas admin" };
    }
    if (ctx.orgId) await this.svc.runDailyDunning(ctx.orgId);
    return { ok: true };
  }
}
