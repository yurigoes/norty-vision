import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { KbService } from "./kb.service";

@Controller("kb")
export class KbController {
  constructor(private readonly svc: KbService) {}

  @Get()
  async list(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.list(ctx) };
  }
  @Post()
  @HttpCode(200)
  upsert(@CurrentContext() ctx: RequestContext, @Body() b: any) {
    return this.svc.upsert(ctx, b);
  }
  @Post("draft")
  @HttpCode(200)
  draft(@CurrentContext() ctx: RequestContext, @Body() b: { question: string; samples?: string[] }) {
    return this.svc.aiDraft(ctx, b?.question ?? "", b?.samples);
  }
  @Post(":id/status")
  @HttpCode(200)
  status(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: { status: "draft" | "published" | "archived" }) {
    return this.svc.setStatus(ctx, id, b?.status);
  }
  @Post(":id/delete")
  @HttpCode(200)
  remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.remove(ctx, id);
  }
  @Post(":id/send/:conversationId")
  @HttpCode(200)
  send(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Param("conversationId") conversationId: string) {
    return this.svc.sendToConversation(ctx, conversationId, id);
  }
}
