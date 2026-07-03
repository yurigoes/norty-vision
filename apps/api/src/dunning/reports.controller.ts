import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ReportsService } from "./reports.service";

@Controller("reports")
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get("credit/summary")
  async summary(@CurrentContext() ctx: RequestContext) {
    return this.svc.creditSummary(ctx);
  }

  @Get("credit/installments")
  async installments(
    @CurrentContext() ctx: RequestContext,
    @Query("bucket") bucket = "overdue",
  ) {
    return { items: await this.svc.installments(ctx, bucket) };
  }

  @Get("collections")
  async collections(
    @CurrentContext() ctx: RequestContext,
    @Query("limit") limit?: string,
  ) {
    return { items: await this.svc.collections(ctx, limit ? parseInt(limit) : 200) };
  }

  // ---- Exportações (Excel/CSV) ----
  @Get("export/installments.csv")
  async installmentsCsv(
    @CurrentContext() ctx: RequestContext,
    @Res() reply: FastifyReply,
    @Query("bucket") bucket = "overdue",
  ) {
    const csv = await this.svc.installmentsCsv(ctx, bucket);
    reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="parcelas-${bucket}.csv"`)
      .send(csv);
  }

  @Get("export/collections.csv")
  async collectionsCsv(
    @CurrentContext() ctx: RequestContext,
    @Res() reply: FastifyReply,
    @Query("limit") limit?: string,
  ) {
    const csv = await this.svc.collectionsCsv(ctx, limit ? parseInt(limit) : 1000);
    reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="cobrancas.csv"`)
      .send(csv);
  }

  // ---- PDF (HTML imprimível) em 3 modelos ----
  @Get("print/:model")
  async print(
    @CurrentContext() ctx: RequestContext,
    @Param("model") model: string,
    @Res() reply: FastifyReply,
    @Query("bucket") bucket = "overdue",
  ) {
    const m = (["analitico", "sintetico", "dashboard"].includes(model) ? model : "sintetico") as
      "analitico" | "sintetico" | "dashboard";
    const html = await this.svc.reportHtml(ctx, m, bucket);
    reply.type("text/html; charset=utf-8").send(html);
  }
}
