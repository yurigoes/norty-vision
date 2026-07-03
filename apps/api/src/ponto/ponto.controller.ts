import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PontoService } from "./ponto.service";
import { JornadaService } from "./jornada.service";
import { PontoSignService } from "./sign.service";
import { FolhaService } from "./folha.service";
import { AejService } from "./aej.service";

@Controller("ponto")
export class PontoController {
  constructor(private readonly svc: PontoService, private readonly jornada: JornadaService, private readonly sign: PontoSignService, private readonly folha: FolhaService, private readonly aej: AejService) {}

  @Get("config")
  config(@CurrentContext() ctx: RequestContext) { return this.svc.getConfig(ctx); }
  @Post("config")
  @HttpCode(200)
  updateConfig(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.updateConfig(ctx, b ?? {}); }

  @Get("employees")
  async employees(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listEmployees(ctx) }; }
  /** Une registros de ponto duplicados (mesmo CPF). */
  @Post("employees/dedupe")
  @HttpCode(200)
  dedupe(@CurrentContext() ctx: RequestContext) { return this.svc.dedupeEmployees(ctx); }
  @Post("employees")
  @HttpCode(200)
  upsertEmployee(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.upsertEmployee(ctx, b ?? {}); }

  /** Bate o ponto (horário do servidor + NSR + hash). */
  @Post("punch")
  @HttpCode(200)
  punch(@CurrentContext() ctx: RequestContext, @Req() req: FastifyRequest, @Body() b: any) {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? null;
    return this.svc.punch(ctx, b ?? {}, ip);
  }

  @Get("punches")
  async punches(@CurrentContext() ctx: RequestContext, @Query() q: { employeeId?: string; from?: string; to?: string }) {
    return { items: await this.svc.listPunches(ctx, q ?? {}) };
  }
  /** Lançamento manual de batidas pelo empregador (ajuste com horário / migração em massa). */
  @Post("punches/manual")
  @HttpCode(200)
  manualPunches(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.adminPunches(ctx, b ?? {}); }
  /** Zera as marcações da empresa (migração/recomeço) — DESTRUTIVO, só admin. */
  @Post("punches/wipe")
  @HttpCode(200)
  wipePunches(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.resetMarcacoes(ctx, b ?? {}); }
  @Get("punches/:id/comprovante")
  comprovante(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.comprovante(ctx, id); }

  @Get("verify-chain")
  verify(@CurrentContext() ctx: RequestContext) { return this.svc.verifyChain(ctx); }

  /** AFD (REP-A) — marcações tipo 7 + trailer tipo 9 + assinatura. Retorna o conteúdo p/ download.
   *  Se houver certificado A1 configurado, devolve também o `.p7s` (PKCS#7 destacado) em base64. */
  @Get("afd")
  async afd(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string }) {
    const r = await this.svc.afd(ctx, q ?? {});
    const p7s = await this.sign.sign(ctx.orgId!, Buffer.from(r.content, "latin1")).catch(() => null);
    return { ...r, signed: !!p7s, p7s: p7s ? p7s.toString("base64") : null };
  }

  // ----- Certificado A1 (ICP-Brasil) -----
  @Get("cert")
  certStatus(@CurrentContext() ctx: RequestContext) { return this.sign.status(ctx); }
  @Post("cert")
  @HttpCode(200)
  uploadCert(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.sign.uploadCert(ctx, b?.pfx ?? "", b?.password ?? ""); }
  @Post("cert/remove")
  @HttpCode(200)
  removeCert(@CurrentContext() ctx: RequestContext) { return this.sign.removeCert(ctx); }

  // ----- Banco de horas -----
  @Get("banco")
  banco(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.folha.listBank(ctx, employeeId); }
  @Post("banco")
  @HttpCode(200)
  addBanco(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.addBank(ctx, b ?? {}); }
  @Post("banco/:id/delete")
  @HttpCode(200)
  delBanco(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.folha.removeBank(ctx, id); }
  @Post("banco/sweep")
  @HttpCode(200)
  sweepBanco(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.sweepPeriodToBank(ctx, b ?? {}); }
  /** Baixa por vencimento do saldo antigo do banco de horas. */
  @Post("banco/expirar")
  @HttpCode(200)
  expireBanco(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.expireBank(ctx, b?.employeeId ?? ""); }

  // ----- Espelho assinado -----
  @Get("espelho/assinatura")
  espelhoSig(@CurrentContext() ctx: RequestContext, @Query() q: { employeeId: string; refMonth: string }) { return this.jornada.espelhoSignature(ctx, q.employeeId, q.refMonth); }
  @Get("espelho/recibo.pdf")
  async espelhoPdf(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { employeeId: string; refMonth: string }) {
    const { buffer, filename } = await this.jornada.espelhoSignedPdf(ctx, q.employeeId, q.refMonth);
    // Anti-cache: o PDF do espelho assinado tem que refletir SEMPRE a última
    // assinatura (após reassinatura, o navegador estava servindo o PDF antigo
    // porque a URL/querystring eram idênticas).
    reply
      .type("application/pdf")
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .header("Pragma", "no-cache")
      .header("Expires", "0")
      .header("Content-Disposition", `inline; filename="${filename}"`)
      .send(buffer);
  }
  /** Painel de assinaturas do mês (assinados/pendentes) — para a contabilidade. */
  @Get("espelho/assinaturas")
  espelhoSigsMonth(@CurrentContext() ctx: RequestContext, @Query("refMonth") refMonth: string) { return this.jornada.espelhoSignaturesMonth(ctx, refMonth); }
  /** Lote: PDF único com todos os espelhos do mês (para baixar e mandar à contabilidade). */
  @Get("espelho/lote.pdf")
  async espelhoLote(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { refMonth: string }) {
    const { buffer, filename } = await this.jornada.espelhoBatchPdf(ctx, q.refMonth);
    reply
      .type("application/pdf")
      .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
      .header("Pragma", "no-cache")
      .header("Expires", "0")
      .header("Content-Disposition", `inline; filename="${filename}"`)
      .send(buffer);
  }
  /** Envia o lote do mês por e-mail à contabilidade. */
  @Post("espelho/enviar-contabilidade")
  @HttpCode(200)
  enviarContabil(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.sendEspelhosToAccountant(ctx, b?.refMonth ?? ""); }

  // ----- Férias -----
  @Get("ferias")
  ferias(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.folha.listVacations(ctx, employeeId); }
  @Get("ferias/saldo")
  feriasSaldo(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.folha.vacationBalance(ctx, employeeId); }
  @Post("ferias")
  @HttpCode(200)
  addFerias(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.createVacation(ctx, b ?? {}); }
  @Post("ferias/:id/status")
  @HttpCode(200)
  statusFerias(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.folha.setVacationStatus(ctx, id, b?.status); }
  @Post("ferias/:id/delete")
  @HttpCode(200)
  delFerias(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.folha.removeVacation(ctx, id); }
  @Get("ferias/:id/recibo.pdf")
  async reciboFerias(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.folha.vacationReceiptPdf(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ----- Fechamento de folha -----
  @Get("fechamento")
  closings(@CurrentContext() ctx: RequestContext) { return this.folha.listClosings(ctx); }
  @Get("fechamento/:refMonth")
  closing(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.getClosing(ctx, refMonth); }
  @Get("fechamento/:refMonth/resumo")
  closingSummary(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.summary(ctx, refMonth); }
  @Post("fechamento/:refMonth/aprovar-gestor")
  @HttpCode(200)
  closeMgr(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.advanceClosing(ctx, refMonth, "manager"); }
  @Post("fechamento/:refMonth/fechar-rh")
  @HttpCode(200)
  closeHr(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.advanceClosing(ctx, refMonth, "closed"); }
  @Post("fechamento/:refMonth/reabrir")
  @HttpCode(200)
  reopen(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.reopenClosing(ctx, refMonth); }
  @Get("fechamento/:refMonth/export.csv")
  async exportCsv(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return { content: await this.folha.exportCsv(ctx, refMonth) }; }

  // ----- AEJ (Arquivo Eletrônico de Jornada) -----
  @Get("aej")
  aejGen(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string }) { return this.aej.generate(ctx, { from: q.from!, to: q.to! }); }

  // ----- Webhook / eventos -----
  @Get("webhook")
  webhookInfo(@CurrentContext() ctx: RequestContext) { return this.svc.webhookInfo(ctx); }
  @Post("webhook/regenerate")
  @HttpCode(200)
  webhookRegen(@CurrentContext() ctx: RequestContext) { return this.svc.regenWebhookSecret(ctx); }
  @Get("eventos")
  eventos(@CurrentContext() ctx: RequestContext, @Query("limit") limit?: string) { return this.svc.listEvents(ctx, { limit: limit ? Number(limit) : undefined }); }

  // ----- Fase 5: tempo real + IA absenteísmo -----
  @Get("realtime")
  realtime(@CurrentContext() ctx: RequestContext) { return this.folha.realtime(ctx); }
  @Get("absenteismo/:refMonth")
  absenteismo(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.absenteismo(ctx, refMonth); }

  // ----- Fase 1: jornada -----
  @Get("schedules")
  async schedules(@CurrentContext() ctx: RequestContext) { return { items: await this.jornada.listSchedules(ctx) }; }
  @Post("schedules")
  @HttpCode(200)
  upsertSchedule(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.upsertSchedule(ctx, b ?? {}); }
  /** Aplica uma escala a vários funcionários de uma vez. */
  @Post("schedules/assign")
  @HttpCode(200)
  assignSchedule(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.assignSchedule(ctx, b ?? {}); }

  // ----- Feriados -----
  @Get("holidays")
  holidays(@CurrentContext() ctx: RequestContext) { return this.jornada.listHolidays(ctx); }
  @Post("holidays")
  @HttpCode(200)
  upsertHoliday(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.upsertHoliday(ctx, b ?? {}); }
  @Post("holidays/:id/delete")
  @HttpCode(200)
  removeHoliday(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.jornada.removeHoliday(ctx, id); }

  /** Espelho de ponto de um funcionário no período (cálculo derivado das marcações). */
  @Get("espelho")
  espelho(@CurrentContext() ctx: RequestContext, @Query() q: { employeeId: string; from: string; to: string }) {
    return this.jornada.espelho(ctx, q);
  }
  /** Divergências do período (falta/atraso/saída antecipada/extra/marcação incompleta). */
  @Get("divergencias")
  divergencias(@CurrentContext() ctx: RequestContext, @Query() q: { from: string; to: string; employeeId?: string }) {
    return this.jornada.divergencias(ctx, q);
  }

  @Get("justificativas")
  justificativas(@CurrentContext() ctx: RequestContext, @Query() q: { employeeId?: string; status?: string; from?: string; to?: string }) {
    return this.jornada.listJustifications(ctx, q ?? {});
  }
  @Post("justificativas")
  @HttpCode(200)
  createJustification(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.createJustification(ctx, b ?? {}); }
  @Post("justificativas/:id/review")
  @HttpCode(200)
  reviewJustification(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.jornada.reviewJustification(ctx, id, b ?? {}); }

  // ----- Avisos do painel de marcação -----
  @Get("notices")
  async notices(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listNotices(ctx) }; }
  @Post("notices")
  @HttpCode(200)
  createNotice(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.createNotice(ctx, b ?? {}); }
  @Post("notices/:id/delete")
  @HttpCode(200)
  deleteNotice(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.deleteNotice(ctx, id); }
}
