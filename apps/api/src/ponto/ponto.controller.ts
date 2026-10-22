import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyRequest, FastifyReply } from "fastify";
import { CurrentContext, RequirePermission } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { PontoService } from "./ponto.service";
import { JornadaService } from "./jornada.service";
import { PontoSignService } from "./sign.service";
import { FolhaService } from "./folha.service";
import { AejService } from "./aej.service";
import { ShiftSwapService } from "./shift-swap.service";
import { EmployerService } from "./employer.service";
import { ReportsService } from "./reports.service";
import { AllocationService } from "./allocation.service";
import { AssiduidadeService } from "./assiduidade.service";
import { InconsistenciasService } from "./inconsistencias.service";
import { EscalaPlanilhaService } from "./escala-planilha.service";
import { ExtrasService } from "./extras.service";

/**
 * PERMISSÕES DO PONTO — o piso é da CLASSE, a exceção é da rota.
 * ============================================================================
 * 94 rotas. Decorar uma por uma daria 94 linhas de ruído e, na prática, uma
 * rota nova entraria sem guarda nenhuma. Aqui o `@RequirePermission` da CLASSE
 * é o PISO (`ponto.view`), e cada rota que exige mais declara a sua: o
 * `Reflector.getAllAndOverride([handler, class])` do `AuthGuard` dá a palavra
 * final ao decorator do método.
 *
 * O efeito prático: rota nova sem decorator nasce exigindo `ponto.view` —
 * fechada pra quem não tem ponto nenhum, e não aberta por esquecimento.
 *
 *   ponto.view     consultar: espelho, batidas, divergências, relatórios
 *   ponto.adjust   corrigir o dia: batida manual, justificativa, escala, feriado
 *   ponto.close    fechar e exportar: folha, férias, banco, AFD/AEJ, certificado
 *   ponto.devices  terminais: dispositivos, facial, webhook, máquinas
 *   rh.manage      RH: funcionários, alocação/cessão, assiduidade
 *
 * NÃO ENTRA AQUI: `POST ponto/punches/wipe` zera as marcações da empresa. Essa
 * continua exigindo ADMIN de verdade (`requireAdminEstrito` no service), porque
 * é destrutiva e irreversível — nenhuma caixa do catálogo deve poder marcar
 * "apagar o ponto fiscal da empresa".
 *
 * As 4 rotas do TERMINAL (`ponto-pwa/bootstrap|identify|punch|face-punch`)
 * ficam no `PontoPwaController` e são `@Public()`: o relógio de parede não tem
 * sessão nem usuário. O `AuthGuard` responde ao `@Public()` ANTES de olhar
 * permissão, e `permissoes.check.mts` confere que continuem assim.
 */
@Controller("ponto")
@RequirePermission("ponto.view")
export class PontoController {
  constructor(private readonly svc: PontoService, private readonly jornada: JornadaService, private readonly sign: PontoSignService, private readonly folha: FolhaService, private readonly aej: AejService, private readonly swap: ShiftSwapService, private readonly employers: EmployerService, private readonly reports: ReportsService, private readonly alloc: AllocationService, private readonly assid: AssiduidadeService, private readonly inc: InconsistenciasService, private readonly escala: EscalaPlanilhaService, private readonly extras: ExtrasService) {}

  // ----- Fila de pontos inconsistentes -----
  /** Funcionários com dia ainda sem decisão: batida incompleta, falta, atraso, saída antecipada, extra. */
  @Get("inconsistencias")
  inconsistencias(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string; storeId?: string }) {
    return this.inc.list(ctx, q ?? {});
  }

  // ----- Extras (diarista / hora extra avulsa fora da escala oficial) -----
  // A batida do extra vive em tabela SEPARADA e nunca entra no AFD/eSocial —
  // ver `216_ponto_extras.sql`. Literais antes de `:id`.
  @Get("extras")
  extrasList(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string }) { return this.extras.list(ctx, q ?? {}); }
  /** Escala N pessoas num dia e devolve na hora o recibo A4 (2 vias por pessoa). */
  @Post("extras")
  @RequirePermission("ponto.adjust")
  @HttpCode(200)
  async extrasCreate(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Body() b: any) {
    const { buffer, filename } = await this.extras.create(ctx, b ?? {});
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }
  /** Com o papel assinado em mãos: pago / trabalhou mas não pago / não compareceu. */
  @Post("extras/:id/status")
  @RequirePermission("ponto.close")
  @HttpCode(200)
  extrasSetStatus(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.extras.setStatus(ctx, id, b?.status); }
  /** Reimprime o recibo de uma escalação. */
  @Get("extras/:id/document")
  async extrasReprint(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Param("id") id: string) {
    const { buffer, filename } = await this.extras.reprint(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ----- Escala em massa por planilha (vigência por data) -----
  //
  // NÃO VIERAM NUM CONTROLLER NOVO, DE PROPÓSITO.
  // No RH estas rotas moram num `PontoGestaoController` que é `@Controller("ponto")`
  // e declara TAMBÉM `@Get("inconsistencias")` — rota que este controller já tem.
  // Dois `@Controller("ponto")` com a mesma rota não dão ambiguidade: dão API que
  // NÃO SOBE, porque o Fastify recusa no boot com FST_ERR_DUPLICATED_ROUTE, e
  // `tsc`/`nest build` passam os dois. Foi assim que a produção caiu em laço de
  // reinício. Aqui as rotas entram no controller que já existe, e de graça herdam
  // o piso `@RequirePermission("ponto.view")` da classe.
  //
  // As literais vêm ANTES de `:id/desfazer` — convenção desta base.
  @Get("escala-planilha/config")
  escalaConfig(@CurrentContext() ctx: RequestContext) { return this.escala.config(ctx); }
  @Post("escala-planilha/config")
  @RequirePermission("ponto.adjust")
  @HttpCode(200)
  escalaSaveConfig(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.escala.saveConfig(ctx, b ?? {}); }
  /** Empresas/lojas, cargos e funcionários — pra montar o modelo já preenchido. */
  @Get("escala-planilha/referencias")
  escalaReferencias(@CurrentContext() ctx: RequestContext) { return this.escala.referencias(ctx); }
  /** Confere a planilha SEM gravar: o que cada linha faz, o que está errado, os alertas. */
  @Post("escala-planilha/conferir")
  @HttpCode(200)
  escalaConferir(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.escala.preview(ctx, b ?? {}); }
  @Post("escala-planilha/aplicar")
  @RequirePermission("ponto.adjust")
  @HttpCode(200)
  escalaAplicar(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.escala.aplicar(ctx, b ?? {}); }
  @Get("escala-planilha/historico")
  escalaHistorico(@CurrentContext() ctx: RequestContext) { return this.escala.historico(ctx); }
  @Post("escala-planilha/:id/desfazer")
  @RequirePermission("ponto.adjust")
  @HttpCode(200)
  escalaDesfazer(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.escala.desfazer(ctx, id); }
  /** Jornada prevista dia a dia (escala base + planilha + troca + feriado + afastamento). */
  @Get("escala-planejada")
  escalaPlanejada(@CurrentContext() ctx: RequestContext, @Query() q: any) { return this.escala.planejada(ctx, q ?? {}); }

  // ----- Assiduidade (bônus) -----
  @RequirePermission("rh.manage")
  @Get("assiduidade/ranking")
  assidRanking(@CurrentContext() ctx: RequestContext, @Query("refMonth") refMonth: string) { return this.assid.ranking(ctx, refMonth); }
  @RequirePermission("rh.manage")
  @Post("assiduidade/liberar")
  @HttpCode(200)
  assidRelease(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.assid.release(ctx, String(b?.refMonth ?? ""), Array.isArray(b?.employeeIds) ? b.employeeIds : undefined); }
  @RequirePermission("rh.manage")
  @Get("assiduidade/recibos.pdf")
  async assidBatch(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("refMonth") refMonth: string) {
    const { buffer, filename } = await this.assid.batchPdf(ctx, refMonth);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ----- Alocação / cessão (cross-tenant) -----
  /** Funcionários (ponto) p/ o seletor de alocação. */
  @RequirePermission("rh.manage")
  @Get("alocacoes/funcionarios")
  async allocEmployees(@CurrentContext() ctx: RequestContext) { return { items: await this.alloc.ownEmployees(ctx) }; }
  /** Cedidas por nós (empregadora). */
  @RequirePermission("rh.manage")
  @Get("alocacoes/cedidas")
  async allocOwned(@CurrentContext() ctx: RequestContext) { return { items: await this.alloc.listOwned(ctx) }; }
  /** Recebidas (tomadora) — somente leitura. */
  @RequirePermission("rh.manage")
  @Get("alocacoes/recebidas")
  async allocBorrowed(@CurrentContext() ctx: RequestContext) { return { items: await this.alloc.listBorrowed(ctx) }; }
  @RequirePermission("rh.manage")
  @Post("alocacoes")
  @HttpCode(200)
  allocCreate(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.alloc.create(ctx, b ?? {}); }
  @RequirePermission("rh.manage")
  @Post("alocacoes/:id/encerrar")
  @HttpCode(200)
  allocEnd(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.alloc.end(ctx, id, b?.status === "cancelled" ? "cancelled" : "ended"); }
  /** Batidas/horas de um alocado (tomadora). */
  @RequirePermission("rh.manage")
  @Get("alocacoes/:id/batidas")
  allocPunches(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Query() q: { from?: string; to?: string }) { return this.alloc.borrowedPunches(ctx, id, q.from, q.to); }
  /** Relatório de horas dos cedidos (empregadora), agrupado por tomadora + faturamento. */
  @RequirePermission("rh.manage")
  @Get("alocacoes/relatorio/cedidas")
  allocReportOwned(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string; borrowerOrgId?: string }) { return this.alloc.reportOwned(ctx, q.from, q.to, q.borrowerOrgId || undefined); }
  @RequirePermission("rh.manage")
  @Get("alocacoes/relatorio/cedidas.csv")
  async allocReportOwnedCsv(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { from?: string; to?: string; borrowerOrgId?: string }) {
    const csv = await this.alloc.reportOwnedCsv(ctx, q.from, q.to, q.borrowerOrgId || undefined);
    reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="alocados-faturamento-${q.from ?? ""}_${q.to ?? ""}.csv"`).send(csv);
  }
  /** Relatório de horas dos recebidos (tomadora). */
  @RequirePermission("rh.manage")
  @Get("alocacoes/relatorio/recebidas")
  allocReportBorrowed(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string }) { return this.alloc.reportBorrowed(ctx, q.from, q.to); }
  /** Fatura (PDF) de uma tomadora no período. */
  @RequirePermission("rh.manage")
  @Get("alocacoes/relatorio/fatura.pdf")
  async allocInvoice(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { borrowerOrgId: string; from?: string; to?: string }) {
    const { buffer, filename } = await this.alloc.invoicePdf(ctx, q.borrowerOrgId, q.from, q.to);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ----- Relatórios gerenciais -----
  /** Consolidado do mês (HE, atrasos, faltas, absenteísmo) por funcionário + por loja. */
  @Get("relatorios/consolidado")
  consolidado(@CurrentContext() ctx: RequestContext, @Query("refMonth") refMonth: string) { return this.reports.consolidated(ctx, refMonth); }
  @Get("relatorios/consolidado.csv")
  async consolidadoCsv(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("refMonth") refMonth: string) {
    const csv = await this.reports.consolidatedCsv(ctx, refMonth);
    reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="consolidado-${refMonth}.csv"`).send(csv);
  }
  @Get("relatorios/consolidado.pdf")
  async consolidadoPdf(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query("refMonth") refMonth: string) {
    const { buffer, filename } = await this.reports.consolidatedPdf(ctx, refMonth);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }
  /** Extrato de marcações brutas (não-fiscal) por período → CSV. */
  @Get("relatorios/batidas.csv")
  async batidasCsv(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { from: string; to: string; storeId?: string }) {
    const csv = await this.reports.punchesCsv(ctx, q.from, q.to, { storeId: q.storeId || null });
    reply.type("text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="batidas-${q.from}_${q.to}.csv"`).send(csv);
  }
  /** Presença do dia (PDF): só quem bateu ponto na data, com escala, entrada e saída. */
  @Get("relatorios/presenca-dia.pdf")
  async presencaDia(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { date: string; storeId?: string }) {
    const { buffer, filename } = await this.jornada.dayPresencePdf(ctx, q.date, { storeId: q.storeId || null });
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  /** Espelhos em lote filtrados por loja (PDF). */
  @Get("relatorios/espelhos-loja.pdf")
  async espelhosLoja(@CurrentContext() ctx: RequestContext, @Res() reply: FastifyReply, @Query() q: { refMonth: string; storeId?: string }) {
    const { buffer, filename } = await this.jornada.espelhoBatchPdf(ctx, q.refMonth, { storeId: q.storeId || null });
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ----- Empregadores (multi-CNPJ na mesma conta) -----
  @Get("employers")
  async listEmployers(@CurrentContext() ctx: RequestContext) { return this.employers.list(ctx); }
  @RequirePermission("ponto.close")
  @Post("employers")
  @HttpCode(200)
  upsertEmployer(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.employers.upsert(ctx, b ?? {}); }
  @RequirePermission("ponto.close")
  @Post("employers/:id/delete")
  @HttpCode(200)
  removeEmployer(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.employers.remove(ctx, id); }

  // ----- Trocas de turno/folga (visão RH) -----
  @Get("shift-swaps")
  async shiftSwaps(@CurrentContext() ctx: RequestContext) { return { items: await this.swap.rhList(ctx) }; }
  /** RH aprova no lugar do líder (somente quando não há líder direto). */
  @RequirePermission("ponto.adjust")
  @Post("shift-swaps/:id/rh-approve")
  @HttpCode(200)
  swapRhApprove(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.swap.rhApprove(ctx, id, b?.note ?? null); }
  /** RH anexa documento. */
  @RequirePermission("ponto.adjust")
  @Post("shift-swaps/:id/attach")
  @HttpCode(200)
  swapAttach(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.swap.rhAttach(ctx, id, String(b?.attachmentUrl ?? "")); }
  /** RH efetiva a troca (gera os overrides de escala). */
  @RequirePermission("ponto.adjust")
  @Post("shift-swaps/:id/apply")
  @HttpCode(200)
  swapApply(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.swap.rhApply(ctx, id, { attachmentUrl: b?.attachmentUrl ?? null }); }

  @Get("config")
  config(@CurrentContext() ctx: RequestContext) { return this.svc.getConfig(ctx); }
  @RequirePermission("ponto.close")
  @Post("config")
  @HttpCode(200)
  updateConfig(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.updateConfig(ctx, b ?? {}); }

  @Get("employees")
  async employees(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listEmployees(ctx) }; }
  /** Une registros de ponto duplicados (mesmo CPF). */
  @RequirePermission("rh.manage")
  @Post("employees/dedupe")
  @HttpCode(200)
  dedupe(@CurrentContext() ctx: RequestContext) { return this.svc.dedupeEmployees(ctx); }
  @RequirePermission("rh.manage")
  @Post("employees")
  @HttpCode(200)
  upsertEmployee(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.upsertEmployee(ctx, b ?? {}); }
  /** Terminais liberados do funcionário ([] = sem restrição). */
  @RequirePermission("ponto.devices")
  @Post("employees/:id/devices")
  @HttpCode(200)
  setEmpDevices(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.setAllowedDevices(ctx, id, b?.deviceIds ?? []); }
  /** Solicitações de visualização de saldo de banco (somente RH). */
  @Get("bank-requests")
  async bankRequests(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listBankRequests(ctx) }; }
  @RequirePermission("ponto.close")
  @Post("bank-requests/:id/respond")
  @HttpCode(200)
  respondBankReq(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.respondBankRequest(ctx, id, { approve: !!b?.approve, note: b?.note }); }
  /** Máquinas homologadas (liberam solicitações no portal). */
  @Get("machines")
  async machines(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listMachines(ctx) }; }
  @RequirePermission("ponto.devices")
  @Post("machines")
  @HttpCode(200)
  createMachine(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.createMachine(ctx, String(b?.label ?? "")); }
  @RequirePermission("ponto.devices")
  @Post("machines/:id/revoke")
  @HttpCode(200)
  revokeMachine(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.svc.revokeMachine(ctx, id, b?.revoke !== false); }

  /** Bate o ponto (horário do servidor + NSR + hash). */
  @RequirePermission("ponto.adjust")
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
  @RequirePermission("ponto.adjust")
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
  @RequirePermission("ponto.close")
  @Get("afd")
  async afd(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string; employerId?: string }) {
    const r = await this.svc.afd(ctx, q ?? {});
    // assina com o A1 do EMPREGADOR do AFD (cada CNPJ usa o seu)
    const p7s = await this.sign.sign(ctx.orgId!, Buffer.from(r.content, "latin1"), r.employer?.id).catch(() => null);
    return { ...r, signed: !!p7s, p7s: p7s ? p7s.toString("base64") : null };
  }

  // ----- Certificado A1 (ICP-Brasil) — por empregador (employerId opcional = default) -----
  @RequirePermission("ponto.close")
  @Get("cert")
  certStatus(@CurrentContext() ctx: RequestContext, @Query("employerId") employerId?: string) { return this.sign.status(ctx, employerId); }
  @RequirePermission("ponto.close")
  @Post("cert")
  @HttpCode(200)
  uploadCert(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.sign.uploadCert(ctx, b?.pfx ?? "", b?.password ?? "", b?.employerId ?? null); }
  @RequirePermission("ponto.close")
  @Post("cert/remove")
  @HttpCode(200)
  removeCert(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.sign.removeCert(ctx, b?.employerId ?? null); }

  // ----- Afastamentos -----
  @Get("afastamentos")
  leaves(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.jornada.listLeaves(ctx, employeeId); }
  @RequirePermission("ponto.adjust")
  @Post("afastamentos")
  @HttpCode(200)
  addLeave(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.createLeave(ctx, b ?? {}); }
  @RequirePermission("ponto.adjust")
  @Post("afastamentos/:id/delete")
  @HttpCode(200)
  delLeave(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.jornada.removeLeave(ctx, id); }

  // ----- Banco de horas -----
  @Get("banco")
  banco(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.folha.listBank(ctx, employeeId); }
  @RequirePermission("ponto.close")
  @Post("banco")
  @HttpCode(200)
  addBanco(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.addBank(ctx, b ?? {}); }
  @RequirePermission("ponto.close")
  @Post("banco/:id/delete")
  @HttpCode(200)
  delBanco(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.folha.removeBank(ctx, id); }
  @RequirePermission("ponto.close")
  @Post("banco/sweep")
  @HttpCode(200)
  sweepBanco(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.sweepPeriodToBank(ctx, b ?? {}); }
  /** Baixa por vencimento do saldo antigo do banco de horas. */
  @RequirePermission("ponto.close")
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
    // assinatura. Depois de reassinar, o navegador servia o PDF antigo porque
    // a URL e a querystring eram idênticas.
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
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }
  /** Envia o lote do mês por e-mail à contabilidade. */
  @RequirePermission("ponto.close")
  @Post("espelho/enviar-contabilidade")
  @HttpCode(200)
  enviarContabil(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.sendEspelhosToAccountant(ctx, b?.refMonth ?? ""); }

  // ----- Férias -----
  @Get("ferias")
  ferias(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.folha.listVacations(ctx, employeeId); }
  @Get("ferias/saldo")
  feriasSaldo(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) { return this.folha.vacationBalance(ctx, employeeId); }
  @RequirePermission("ponto.close")
  @Post("ferias")
  @HttpCode(200)
  addFerias(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.folha.createVacation(ctx, b ?? {}); }
  @RequirePermission("ponto.close")
  @Post("ferias/:id/status")
  @HttpCode(200)
  statusFerias(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.folha.setVacationStatus(ctx, id, b?.status); }
  @RequirePermission("ponto.close")
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
  closingSummary(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string, @Query("employerId") employerId?: string) { return this.folha.summary(ctx, refMonth, { employerId: employerId || null }); }
  @RequirePermission("ponto.close")
  @Post("fechamento/:refMonth/aprovar-gestor")
  @HttpCode(200)
  closeMgr(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.advanceClosing(ctx, refMonth, "manager"); }
  @RequirePermission("ponto.close")
  @Post("fechamento/:refMonth/fechar-rh")
  @HttpCode(200)
  closeHr(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.advanceClosing(ctx, refMonth, "closed"); }
  @RequirePermission("ponto.close")
  @Post("fechamento/:refMonth/reabrir")
  @HttpCode(200)
  reopen(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string) { return this.folha.reopenClosing(ctx, refMonth); }
  @RequirePermission("ponto.close")
  @Get("fechamento/:refMonth/export.csv")
  async exportCsv(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string, @Query("employerId") employerId?: string, @Query("layout") layout?: string) { return { content: await this.folha.exportCsv(ctx, refMonth, { employerId: employerId || null, layout: layout || null }), layout: layout || "generic" }; }
  @Get("folha/layouts")
  payrollLayouts() { return { items: this.folha.payrollLayouts() }; }

  // ----- AEJ (Arquivo Eletrônico de Jornada) -----
  @RequirePermission("ponto.close")
  @Get("aej")
  aejGen(@CurrentContext() ctx: RequestContext, @Query() q: { from?: string; to?: string; employerId?: string }) { return this.aej.generate(ctx, { from: q.from!, to: q.to!, employerId: q.employerId }); }

  // ----- Webhook / eventos -----
  @RequirePermission("ponto.devices")
  @Get("webhook")
  webhookInfo(@CurrentContext() ctx: RequestContext) { return this.svc.webhookInfo(ctx); }
  @RequirePermission("ponto.devices")
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
  @RequirePermission("ponto.adjust")
  @Post("schedules")
  @HttpCode(200)
  upsertSchedule(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.upsertSchedule(ctx, b ?? {}); }
  /** Aplica uma escala a vários funcionários de uma vez. */
  @RequirePermission("ponto.adjust")
  @Post("schedules/assign")
  @HttpCode(200)
  assignSchedule(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.assignSchedule(ctx, b ?? {}); }

  // ----- Feriados -----
  @Get("holidays")
  holidays(@CurrentContext() ctx: RequestContext) { return this.jornada.listHolidays(ctx); }
  @RequirePermission("ponto.adjust")
  @Post("holidays")
  @HttpCode(200)
  upsertHoliday(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.upsertHoliday(ctx, b ?? {}); }
  @RequirePermission("ponto.adjust")
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
  @RequirePermission("ponto.adjust")
  @Post("justificativas")
  @HttpCode(200)
  createJustification(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.jornada.createJustification(ctx, b ?? {}); }
  @RequirePermission("ponto.adjust")
  @Post("justificativas/:id/review")
  @HttpCode(200)
  reviewJustification(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() b: any) { return this.jornada.reviewJustification(ctx, id, b ?? {}); }

  // ----- Avisos do painel de marcação -----
  @Get("notices")
  async notices(@CurrentContext() ctx: RequestContext) { return { items: await this.svc.listNotices(ctx) }; }
  @RequirePermission("ponto.adjust")
  @Post("notices")
  @HttpCode(200)
  createNotice(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.createNotice(ctx, b ?? {}); }
  @RequirePermission("ponto.adjust")
  @Post("notices/:id/delete")
  @HttpCode(200)
  deleteNotice(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.deleteNotice(ctx, id); }
}
