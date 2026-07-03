import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { InsightsService } from "./insights.service";

@Controller("insights")
export class InsightsController {
  constructor(private readonly svc: InsightsService) {}

  /** Dicas inline (regras, sem custo de IA) ao cadastrar/editar. */
  @Post("tips")
  @HttpCode(200)
  tips(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ kind: z.string().max(40), data: z.record(z.unknown()) }).parse(body);
    return this.svc.inlineTips(ctx, input);
  }

  /** Admin: gargalos da própria empresa. */
  @Get()
  list(@CurrentContext() ctx: RequestContext) {
    return this.svc.listForOrg(ctx);
  }
  @Post("refresh")
  @HttpCode(200)
  refresh(@CurrentContext() ctx: RequestContext) {
    return this.svc.refreshOrg(ctx);
  }

  // ----- master / ecossistema (rotas literais antes de :id) -----
  @Get("ecosystem")
  ecosystem(@CurrentContext() ctx: RequestContext) {
    return this.svc.ecosystem(ctx);
  }
  @Get("master-questions")
  masterQuestions(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return this.svc.listMasterQuestions(ctx, status || "open");
  }
  @Post("master-questions/:id/answer")
  @HttpCode(200)
  answerMasterQuestion(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ answer: z.string().min(1).max(4000) }).parse(body);
    return this.svc.answerMasterQuestion(ctx, id, input.answer);
  }
  @Post("master-questions/:id/dismiss")
  @HttpCode(200)
  dismissMasterQuestion(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.dismissMasterQuestion(ctx, id);
  }

  @Post(":id/dismiss")
  @HttpCode(200)
  dismiss(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.dismiss(ctx, id);
  }
}
