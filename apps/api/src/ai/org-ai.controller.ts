import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { OrgAiService } from "./org-ai.service";

@Controller("ai/providers")
export class OrgAiController {
  constructor(private readonly svc: OrgAiService) {}

  @Get()
  async list(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.list(ctx) };
  }
  @Post()
  @HttpCode(200)
  upsert(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsert(ctx, b);
  }
  @Post("models")
  @HttpCode(200)
  models(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.listModels(ctx, b);
  }
  @Post(":id/test")
  @HttpCode(200)
  test(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.test(ctx, id);
  }
  @Post(":id/delete")
  @HttpCode(200)
  remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.remove(ctx, id);
  }
}
