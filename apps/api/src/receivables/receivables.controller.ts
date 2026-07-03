import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { ReceivablesService } from "./receivables.service";

@Controller("receivables")
export class ReceivablesController {
  constructor(private readonly svc: ReceivablesService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query("status") status?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("search") search?: string) {
    return this.svc.list(ctx, { status, from, to, search });
  }
  @Get("summary")
  summary(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) { return this.svc.summary(ctx, { from, to }); }
  @Get("cashflow")
  cashflow(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) { return this.svc.cashflow(ctx, { from, to }); }
  @Get("cashflow.pdf")
  async cashflowPdf(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("from") from?: string, @Query("to") to?: string) {
    const { buffer, filename } = await this.svc.cashflowPdf(ctx, { from, to });
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }
  @Get("export")
  async exportCsv(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("status") status?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("search") search?: string) {
    const { buffer, filename } = await this.svc.exportCsv(ctx, { status, from, to, search });
    reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
  }
  @Get("report.pdf")
  async reportPdf(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("status") status?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("search") search?: string) {
    const { buffer, filename } = await this.svc.reportPdf(ctx, { status, from, to, search });
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  @Get(":id")
  getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.getById(ctx, id); }
  @Post()
  @HttpCode(201)
  create(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.create(ctx, b ?? {}); }
  @Delete(":id")
  remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.remove(ctx, id); }

  @Post("installments/:id/receive")
  @HttpCode(200)
  receive(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.receiveInstallment(ctx, id, b ?? {}); }
  @Post("installments/:id/status")
  @HttpCode(200)
  status(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.setInstallmentStatus(ctx, id, b?.status === "cancelado" ? "cancelado" : "a_receber"); }

  /** Lê uma imagem (comprovante/nota) com a IA (visão) → extrai os campos. */
  @Post("ocr")
  @HttpCode(200)
  ocr(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.ocrDocument(ctx, { data: b?.data ?? "" }); }

  @Post("attachments")
  @HttpCode(200)
  addAttachment(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.addAttachment(ctx, b ?? {}); }
  @Get("attachments/:id/file")
  async file(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { body, contentType, filename } = await this.svc.attachmentFile(ctx, id);
    reply.type(contentType).header("Content-Disposition", `inline; filename="${filename}"`).send(body);
  }
}
