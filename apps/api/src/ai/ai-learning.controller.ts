import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentContext, RequirePlatformAdmin } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { AiLearningService } from "./ai-learning.service";

@Controller("ai-learning")
export class AiLearningController {
  constructor(private readonly svc: AiLearningService) {}

  /** Painel de aprendizado da empresa. */
  @Get("stats")
  async stats(@CurrentContext() ctx: RequestContext) {
    return this.svc.statsForOrg(ctx);
  }

  /** Dúvidas/gargalos pra intervenção humana. */
  @Get("doubts")
  async doubts(@CurrentContext() ctx: RequestContext, @Query("resolved") resolved?: string) {
    return { items: await this.svc.doubts(ctx, { resolved: resolved === "true" }) };
  }

  /** Humano ensina a IA (vira KB publicada) e resolve a dúvida. */
  @Post(":id/teach")
  @HttpCode(200)
  async teach(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ question: z.string().min(2).max(500), answer: z.string().min(2).max(4000), topic: z.string().max(120).nullable().optional() }).parse(body);
    return this.svc.teach(ctx, id, input);
  }

  /** Dispensa a dúvida sem ensinar. */
  @Post(":id/dismiss")
  @HttpCode(200)
  async dismiss(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.dismiss(ctx, id);
  }

  /** Auto-rascunho (IA) de resposta pra dúvida. */
  @Post(":id/draft")
  @HttpCode(200)
  async draft(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.draftAnswer(ctx, id);
  }

  /** Feedback 👍/👎 numa resposta do bot. */
  @Post(":id/rate")
  @HttpCode(200)
  async rate(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ helpful: z.boolean() }).parse(body);
    return this.svc.rate(ctx, id, input.helpful);
  }

  /** Respostas recentes do bot (pra avaliar). */
  @Get("recent")
  async recent(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.recentAnswered(ctx) };
  }

  /** Trace do fluxo da IA numa conversa (passo a passo: ferramentas + respostas). */
  @Get("trace/:conversationId")
  async trace(@CurrentContext() ctx: RequestContext, @Param("conversationId") conversationId: string) {
    return this.svc.trace(ctx, conversationId);
  }

  /** Uso das IAs grátis (por provedor) + saúde + estado do RAG/KB.
   *  Org vê o seu; master (sem org) vê o agregado de todas. */
  @Get("usage")
  async usage(@CurrentContext() ctx: RequestContext) {
    return this.svc.usage(ctx);
  }

  /** Status do RAG semântico (embeddings on/off + modelo). */
  @Get("embeddings/status")
  async embeddingsStatus() {
    return this.svc.embeddingsStatus();
  }

  /** Indexa (embeddings) a base publicada que ainda não tem vetor. */
  @Post("embeddings/backfill")
  @HttpCode(200)
  async embeddingsBackfill(@CurrentContext() ctx: RequestContext) {
    return this.svc.backfillEmbeddings(ctx);
  }

  /** Painel master agregado. */
  @RequirePlatformAdmin()
  @Get("admin/stats")
  async adminStats(@CurrentContext() ctx: RequestContext) {
    return this.svc.statsAll(ctx);
  }
}
