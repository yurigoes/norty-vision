import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { CurrentContext } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { HrService } from "./hr.service";

const EmployeeSchema = z.object({
  storeId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  name: z.string().min(2).max(160),
  cpf: z.string().max(20).nullable().optional(),
  rg: z.string().max(30).nullable().optional(),
  birthDate: z.string().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  whatsappPhone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  addressLine: z.string().max(200).nullable().optional(),
  addressNumber: z.string().max(20).nullable().optional(),
  addressComplement: z.string().max(80).nullable().optional(),
  neighborhood: z.string().max(80).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  state: z.string().length(2).nullable().optional(),
  postalCode: z.string().max(12).nullable().optional(),
  roleTitle: z.string().max(120).nullable().optional(),
  cbo: z.string().max(20).nullable().optional(),
  salaryCents: z.number().int().min(0).nullable().optional(),
  admissionDate: z.string().nullable().optional(),
  terminationDate: z.string().nullable().optional(),
  workSchedule: z.record(z.unknown()).optional(),
  photoUrl: z.string().url().nullable().optional(),
  status: z.enum(["active", "inactive", "terminated"]).optional(),
  // acesso ao sistema
  createSystemUser: z.boolean().optional(),
  accessEmail: z.string().email().max(320).nullable().optional(),
  roleSlug: z.string().max(60).nullable().optional(),
  alsoProfessional: z.boolean().optional(),
});

const PayslipSchema = z.object({
  employeeId: z.string().uuid(),
  refMonth: z.string(),
  grossCents: z.number().int().min(0).nullable().optional(),
  netCents: z.number().int().min(0).nullable().optional(),
  fileUrl: z.string().url().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const ReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().max(1000).nullable().optional(),
});

const ShiftSchema = z.object({
  employeeId: z.string().uuid(),
  storeId: z.string().uuid().nullable().optional(),
  shiftDate: z.string(),
  startTime: z.string().max(10).nullable().optional(),
  endTime: z.string().max(10).nullable().optional(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  lunchStart: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  lunchEnd: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

const WeekdayCfg = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean(),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  // aceita HH:MM, "" (dia sem almoço) ou null → normaliza pra null
  lunchStart: z.union([z.string().regex(/^\d{1,2}:\d{2}$/), z.literal(""), z.null()]).optional().transform((v) => v || null),
  lunchEnd: z.union([z.string().regex(/^\d{1,2}:\d{2}$/), z.literal(""), z.null()]).optional().transform((v) => v || null),
});

const MonthlyShiftSchema = z.object({
  employeeId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  weekdays: z.array(WeekdayCfg).optional(),
  // legado (compat)
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  daysOff: z.array(z.number().int().min(0).max(6)).optional(),
  storeId: z.string().uuid().nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

const NoticeSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1).max(5000),
  storeId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
});

const DocSchema = z.object({
  employeeId: z.string().uuid(),
  docType: z.string().max(40),
  title: z.string().max(200).nullable().optional(),
  fileUrl: z.string().url(),
});

@Controller("hr")
export class HrController {
  constructor(private readonly svc: HrService) {}

  // ---- employees ----
  @Get("employees")
  async listEmployees(@CurrentContext() ctx: RequestContext, @Query("status") status?: string, @Query("storeId") storeId?: string) {
    return { items: await this.svc.listEmployees(ctx, { status, storeId }) };
  }
  @Get("employees/:id")
  async getEmployee(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { employee: await this.svc.getEmployee(ctx, id) };
  }
  @Post("employees")
  @HttpCode(201)
  async createEmployee(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { employee: await this.svc.createEmployee(ctx, EmployeeSchema.parse(body)) };
  }
  @Patch("employees/:id")
  async updateEmployee(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { employee: await this.svc.updateEmployee(ctx, id, EmployeeSchema.partial().parse(body)) };
  }
  @Post("employees/:id/send-credentials")
  @HttpCode(200)
  async sendCredentials(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.sendCredentials(ctx, id);
  }

  /** Admissão digital: gera contrato de trabalho a partir de um modelo. */
  @Post("employees/:id/admission-contract")
  @HttpCode(201)
  async admissionContract(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { templateId } = z.object({ templateId: z.string().uuid() }).parse(body);
    return { contract: await this.svc.createAdmissionContract(ctx, id, templateId) };
  }

  // ---- documents ----
  @Get("employees/:id/documents")
  async listDocs(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return { items: await this.svc.listDocuments(ctx, id) };
  }
  @Post("documents")
  @HttpCode(201)
  async addDoc(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { document: await this.svc.addDocument(ctx, DocSchema.parse(body)) };
  }
  @Post("documents/:id/review")
  @HttpCode(200)
  async reviewDoc(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().max(500).nullable().optional() }).parse(body);
    return { document: await this.svc.reviewDocument(ctx, id, input) };
  }

  // ---- dashboard de RH ----
  @Get("dashboard")
  async dashboard(@CurrentContext() ctx: RequestContext) { return this.svc.dashboard(ctx); }

  // ---- rescisão / desligamento ----
  @Get("employees/:id/termination")
  async getTermination(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { termination: await this.svc.getTermination(ctx, id) }; }
  @Post("termination")
  @HttpCode(200)
  async upsertTermination(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.upsertTermination(ctx, b ?? {}); }
  @Post("termination/:employeeId/finalize")
  @HttpCode(200)
  async finalizeTermination(@CurrentContext() ctx: RequestContext, @Param("employeeId") employeeId: string) { return this.svc.finalizeTermination(ctx, employeeId); }
  @Get("employees/:id/termination/pdf")
  async terminationPdf(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const { buffer, filename } = await this.svc.terminationPdf(ctx, id);
    reply.type("application/pdf").header("Content-Disposition", `inline; filename="${filename}"`).send(buffer);
  }

  // ---- exames ocupacionais (ASO) ----
  @Get("employees/:id/exams")
  async listExams(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { items: await this.svc.listExams(ctx, id) }; }
  @Post("exams")
  @HttpCode(200)
  async addExam(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.upsertExam(ctx, b ?? {}); }
  @Delete("exams/:id")
  async delExam(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.removeExam(ctx, id); }
  @Get("exams/expiring")
  async expiringExams(@CurrentContext() ctx: RequestContext, @Query("days") days?: string) { return this.svc.expiringExams(ctx, days ? Number(days) : 30); }

  // ---- treinamentos / certificações ----
  @Get("employees/:id/trainings")
  async listTrainings(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { items: await this.svc.listTrainings(ctx, id) }; }
  @Post("trainings")
  @HttpCode(200)
  async addTraining(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.upsertTraining(ctx, b ?? {}); }
  @Delete("trainings/:id")
  async delTraining(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.removeTraining(ctx, id); }

  // ---- advertências / ocorrências ----
  @Get("employees/:id/warnings")
  async listWarnings(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return { items: await this.svc.listWarnings(ctx, id) }; }
  @Post("warnings")
  @HttpCode(200)
  async addWarning(@CurrentContext() ctx: RequestContext, @Body() b: any) { return this.svc.createWarning(ctx, b ?? {}); }
  @Delete("warnings/:id")
  async delWarning(@CurrentContext() ctx: RequestContext, @Param("id") id: string) { return this.svc.removeWarning(ctx, id); }

  // ---- ponto: edição pendente ----
  @Get("time-entries/edit-requests")
  async timeEditRequests(@CurrentContext() ctx: RequestContext, @Query("status") status?: string) {
    return { items: await this.svc.listTimeEdits(ctx, { status }) };
  }

  @Post("time-entries/:id/review-edit")
  @HttpCode(200)
  async reviewTimeEdit(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().max(300).nullable().optional() }).parse(body);
    return { entry: await this.svc.reviewTimeEdit(ctx, id, input) };
  }

  // ---- justificativas de ponto (falta / esqueceu / atestado) ----
  @Get("justifications")
  async justifications(@CurrentContext() ctx: RequestContext, @Query("status") status?: string, @Query("employeeId") employeeId?: string) {
    return { items: await this.svc.listJustifications(ctx, { status, employeeId }) };
  }
  @Post("justifications/:id/review")
  @HttpCode(200)
  async reviewJustification(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().max(500).nullable().optional() }).parse(body);
    return { justification: await this.svc.reviewJustification(ctx, id, input) };
  }

  // ---- empréstimos ----
  @Get("loans")
  async loans(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) {
    return { items: await this.svc.listLoans(ctx, employeeId) };
  }
  @Post("loans")
  @HttpCode(201)
  async createLoan(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      employeeId: z.string().uuid(),
      principalCents: z.number().int().min(1),
      installmentsCount: z.number().int().min(1).max(120),
      firstDueMonth: z.string().regex(/^\d{4}-\d{2}$/),
      notes: z.string().max(500).nullable().optional(),
    }).parse(body);
    return { loan: await this.svc.createLoan(ctx, input) };
  }
  @Get("loans/open-installments")
  async openInstallments(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId: string) {
    return { items: await this.svc.openLoanInstallments(ctx, employeeId) };
  }
  @Post("loan-installments/:id/pay")
  @HttpCode(200)
  async payLoanInstallment(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({ payslipId: z.string().uuid().nullable().optional(), proofUrl: z.string().url().nullable().optional() }).parse(body ?? {});
    return { installment: await this.svc.payLoanInstallment(ctx, id, input) };
  }

  // ---- payslips ----
  @Get("payslips")
  async listPayslips(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId?: string) {
    return { items: await this.svc.listPayslips(ctx, { employeeId }) };
  }
  @Post("payslips")
  @HttpCode(201)
  async createPayslip(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { payslip: await this.svc.createPayslip(ctx, PayslipSchema.parse(body)) };
  }

  // ---- time ----
  @Get("time-entries")
  async timeEntries(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId?: string, @Query("from") from?: string, @Query("to") to?: string) {
    return { items: await this.svc.listTimeEntries(ctx, { employeeId, from, to }) };
  }
  @Patch("time-entries/:id")
  async adjustTimeEntry(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const input = z.object({
      happenedAt: z.string().optional(),
      reason: z.string().max(300).nullable().optional(),
      note: z.string().max(300).nullable().optional(),
    }).parse(body);
    return { entry: await this.svc.adjustTimeEntry(ctx, id, input) };
  }
  @Get("time-sheets")
  async timeSheets(@CurrentContext() ctx: RequestContext, @Query("employeeId") employeeId?: string) {
    return { items: await this.svc.listTimeSheets(ctx, { employeeId }) };
  }
  /** Espelho de ponto imprimível (HTML branded). */
  @Get("time-sheets/:id/sheet")
  async sheetHtml(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.timeSheetHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }
  /** Folha de fechamento consolidada do mês (HTML branded p/ PDF). refMonth = AAAA-MM. */
  @Get("payroll/:refMonth/sheet")
  async payrollHtml(@CurrentContext() ctx: RequestContext, @Param("refMonth") refMonth: string, @Res() reply: FastifyReply) {
    const html = await this.svc.payrollHtml(ctx, refMonth);
    reply.type("text/html; charset=utf-8").send(html);
  }
  /** Gera/regenera o espelho de ponto do mês (competência por dia de fechamento). */
  @Post("time-sheets/generate")
  @HttpCode(200)
  async generateSheet(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const { employeeId, refMonth } = z.object({ employeeId: z.string().uuid(), refMonth: z.string() }).parse(body);
    return { sheet: await this.svc.generateTimeSheet(ctx, employeeId, refMonth) };
  }

  // ---- geocerca (raio da loja) ----
  @Get("geofences")
  async geofences(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listStoreGeofences(ctx) };
  }
  @Patch("geofences/:storeId")
  async updateGeofence(@CurrentContext() ctx: RequestContext, @Param("storeId") storeId: string, @Body() body: unknown) {
    const input = z.object({
      geoLat: z.number().nullable().optional(),
      geoLng: z.number().nullable().optional(),
      geoRadiusM: z.number().int().min(0).nullable().optional(),
    }).parse(body);
    return { store: await this.svc.updateStoreGeofence(ctx, storeId, input) };
  }

  // ---- settings (fechamento de folha) ----
  @Get("settings")
  async getSettings(@CurrentContext() ctx: RequestContext) {
    return { settings: await this.svc.getSettings(ctx) };
  }
  @Patch("settings")
  async updateSettings(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({
      closingDay: z.number().int().min(1).max(31).optional(),
      paymentDay: z.number().int().min(1).max(31).optional(),
      dailyHours: z.number().min(0).max(24).optional(),
      defaultSchedule: z.array(z.object({
        weekday: z.number().int().min(0).max(6),
        enabled: z.boolean(),
        startTime: z.string().max(10),
        endTime: z.string().max(10),
        breakMinutes: z.number().int().min(0).max(480).optional(),
        lunchStart: z.string().max(10).nullable().optional(),
        lunchEnd: z.string().max(10).nullable().optional(),
      })).optional(),
      snackThresholdMinutes: z.number().int().min(0).max(600).optional(),
      snackMinutes: z.number().int().min(0).max(120).optional(),
    }).parse(body);
    return { settings: await this.svc.updateSettings(ctx, input) };
  }

  // ---- feriados da empresa ----
  @Get("holidays")
  async holidays(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listHolidays(ctx) };
  }
  @Post("holidays")
  @HttpCode(201)
  async addHoliday(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    const input = z.object({ holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().max(120).nullable().optional(), recurringAnnual: z.boolean().optional() }).parse(body);
    return { holiday: await this.svc.addHoliday(ctx, input) };
  }
  @Delete("holidays/:id")
  async removeHoliday(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.removeHoliday(ctx, id);
  }

  // ---- requests ----
  @Get("requests")
  async listRequests(@CurrentContext() ctx: RequestContext, @Query("status") status?: string, @Query("kind") kind?: string) {
    return { items: await this.svc.listRequests(ctx, { status, kind }) };
  }
  @Post("requests/:id/review")
  @HttpCode(200)
  async review(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return { request: await this.svc.reviewRequest(ctx, id, ReviewSchema.parse(body)) };
  }
  /** Anexa comprovante de pagamento (vale/reembolso). */
  @Post("requests/:id/payment-proof")
  @HttpCode(200)
  async paymentProof(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { proofUrl } = z.object({ proofUrl: z.string().url() }).parse(body);
    return { request: await this.svc.attachPaymentProof(ctx, id, proofUrl) };
  }
  /** Recibo de troca de horário (HTML branded). */
  @Get("requests/:id/swap-receipt")
  async swapReceipt(@CurrentContext() ctx: RequestContext, @Param("id") id: string, @Res() reply: FastifyReply) {
    const html = await this.svc.shiftSwapReceiptHtml(ctx, id);
    reply.type("text/html; charset=utf-8").send(html);
  }

  // ---- shifts ----
  @Get("shifts")
  async listShifts(@CurrentContext() ctx: RequestContext, @Query("from") from?: string, @Query("to") to?: string, @Query("storeId") storeId?: string) {
    return { items: await this.svc.listShifts(ctx, { from, to, storeId }) };
  }
  @Post("shifts")
  @HttpCode(201)
  async createShift(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { shift: await this.svc.createShift(ctx, ShiftSchema.parse(body)) };
  }
  /** Gera a escala do mês inteiro (jornada + folgas). */
  @Post("shifts/generate-month")
  @HttpCode(200)
  async generateMonth(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return this.svc.generateMonthlyShifts(ctx, MonthlyShiftSchema.parse(body));
  }
  @Delete("shifts/:id")
  async deleteShift(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteShift(ctx, id);
  }

  // ---- notices ----
  @Get("notices")
  async listNotices(@CurrentContext() ctx: RequestContext) {
    return { items: await this.svc.listNotices(ctx) };
  }
  @Post("notices")
  @HttpCode(201)
  async createNotice(@CurrentContext() ctx: RequestContext, @Body() body: unknown) {
    return { notice: await this.svc.createNotice(ctx, NoticeSchema.parse(body)) };
  }
  @Delete("notices/:id")
  async deleteNotice(@CurrentContext() ctx: RequestContext, @Param("id") id: string) {
    return this.svc.deleteNotice(ctx, id);
  }
}
