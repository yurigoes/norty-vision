import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PayablesService } from "./payables.service";

@Controller("payables")
export class PayablesController {
  constructor(private readonly svc: PayablesService) {}

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Query("status") status?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("search") search?: string) {
    return this.svc.list(ctx, { status, from, to, search });
  }
  @Get("summary")
  summary(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string) { return this.svc.summary(ctx, { from, to }); }
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
  @Get("recipients")
  recipients(@CurrentContext() ctx: RequestContext) { return { items: this.svc.listRecipients(ctx) }; }
  @Post("recipients")
  @HttpCode(200)
  upsertRecipient(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.upsertRecipient(ctx, b ?? {}); }
  @Delete("recipients/:id")
  removeRecipient(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.removeRecipient(ctx, id); }

  @Get(":id")
  getById(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.getById(ctx, id); }
  @Post()
  @HttpCode(201)
  create(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.create(ctx, b ?? {}); }

  /** Lê o boleto (linha digitável / código de barras) → vencimento + valor. */
  @Post("parse-boleto")
  @HttpCode(200)
  parseBoleto(@Body() b: any) { return this.svc.parseBoleto(b?.code ?? ""); }

  /** Importa o XML da NF-e (DANFE) → cria conta + parcelas das duplicatas. */
  @Post("import-nfe")
  @HttpCode(200)
  importNfe(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.importNfe(ctx, b?.xml ?? ""); }

  /** Lê uma imagem de boleto/NF/comprovante com a IA (visão) → extrai os campos. */
  @Post("ocr")
  @HttpCode(200)
  ocr(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.ocrDocument(ctx, { data: b?.data ?? "" }); }
  @Delete(":id")
  remove(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.remove(ctx, id); }

  @Post("installments/:id/pay")
  @HttpCode(200)
  pay(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.payInstallment(ctx, id, b ?? {}); }
  @Post("installments/:id/status")
  @HttpCode(200)
  status(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.setInstallmentStatus(ctx, id, b?.status === "cancelado" ? "cancelado" : "a_pagar"); }

  @Post("attachments")
  @HttpCode(200)
  addAttachment(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.addAttachment(ctx, b ?? {}); }
  @Get("attachments/:id/file")
  async file(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { body, contentType, filename } = await this.svc.attachmentFile(ctx, id);
    reply.type(contentType).header("Content-Disposition", `inline; filename="${filename}"`).send(body);
  }
}
