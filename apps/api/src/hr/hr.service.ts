import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { NotificationService } from "../notifications/notification.service";
import { ContractsService } from "../contracts/contracts.service";
import { UsersService } from "../users/users.service";
import { PontoService } from "../ponto/ponto.service";
import { loadEnv } from "../config";
import { randomBytes } from "crypto";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly notifications: NotificationService,
    private readonly contracts: ContractsService,
    private readonly users: UsersService,
    private readonly ponto: PontoService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext): string {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId;
  }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }
  /** Admin, gerente ou supervisor podem gerir RH / ajustar ponto. */
  private requireHrManager(ctx: RequestContext) {
    const role = (ctx.role ?? "").toLowerCase();
    const ok = ctx.isPlatformAdmin || ctx.isOrgAdmin
      || ctx.permissions?.hr === true
      || ["manager", "gerente", "supervisor", "supervisora"].includes(role);
    if (!ok) throw new AppError(ErrorCode.Forbidden, "Apenas admin, gerente ou supervisor", 403);
  }

  // ============================== EMPLOYEES ==============================
  async listEmployees(ctx: RequestContext, opts?: { status?: string; storeId?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.findMany({
        where: {
          ...(opts?.status ? { status: opts.status } : {}),
          ...(opts?.storeId ? { storeId: opts.storeId } : {}),
        },
        orderBy: { name: "asc" },
        take: 1000,
      }),
    );
  }

  async getEmployee(ctx: RequestContext, id: string) {
    const e = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.findFirst({ where: { id } }),
    );
    if (!e) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado", 404);
    return e;
  }

  async createEmployee(ctx: RequestContext, input: EmployeeInput) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    const cpf = input.cpf ? input.cpf.replace(/\D/g, "") : null;

    // cria o acesso ao sistema (User + Membership com papel) e roda o fluxo de
    // provisionamento (Chatwoot/GLPI via reset de senha). O funcionário fica
    // vinculado a esse usuário.
    let userId = input.userId ?? null;
    if (input.createSystemUser && input.accessEmail && input.roleSlug) {
      const tempInit = "Yg" + randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) + "9!";
      const created = await this.users.create(ctx, {
        name: input.name, email: input.accessEmail, password: tempInit,
        roleSlug: input.roleSlug, storeId: input.storeId ?? null,
        phone: input.whatsappPhone ?? input.phone ?? null,
        alsoProfessional: input.alsoProfessional ?? false,
      });
      userId = created.user.id;
      // reseta a senha (sincroniza no Chatwoot/GLPI) e envia as credenciais
      const { tempPassword } = await this.users.resetPassword(ctx, created.user.id);
      await this.users.sendCredentials(ctx, created.user.id, { password: tempPassword }).catch(() => undefined);
    }

    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.create({
        data: {
          organizationId: orgId,
          storeId: input.storeId ?? null,
          userId,
          name: input.name,
          cpf,
          rg: input.rg ?? null,
          birthDate: input.birthDate ? new Date(input.birthDate) : null,
          phone: input.phone ?? null,
          whatsappPhone: input.whatsappPhone ?? null,
          email: input.email ?? null,
          addressLine: input.addressLine ?? null,
          addressNumber: input.addressNumber ?? null,
          addressComplement: input.addressComplement ?? null,
          neighborhood: input.neighborhood ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          roleTitle: input.roleTitle ?? null,
          cbo: input.cbo ?? null,
          salaryCents: input.salaryCents != null ? BigInt(input.salaryCents) : null,
          admissionDate: input.admissionDate ? new Date(input.admissionDate) : null,
          terminationDate: input.terminationDate ? new Date(input.terminationDate) : null,
          workSchedule: (input.workSchedule ?? {}) as any,
          photoUrl: input.photoUrl ?? null,
          status: input.status ?? "active",
        },
      }),
    );
    // Vincula/cria o funcionário no módulo de Ponto (herda dados + gera crachá).
    await this.ponto.syncFromHr(orgId, { id: emp.id, name: emp.name, cpf: emp.cpf, roleTitle: emp.roleTitle, storeId: emp.storeId, userId: emp.userId, status: emp.status }).catch(() => undefined);
    return emp;
  }

  async updateEmployee(ctx: RequestContext, id: string, input: Partial<EmployeeInput>) {
    this.requireAdmin(ctx);
    await this.getEmployee(ctx, id);
    const data: Record<string, unknown> = {};
    const set = (k: keyof EmployeeInput, v: unknown) => { if (input[k] !== undefined) data[k as string] = v; };
    set("storeId", input.storeId ?? null);
    set("userId", input.userId ?? null);
    set("name", input.name);
    if (input.cpf !== undefined) data.cpf = input.cpf ? input.cpf.replace(/\D/g, "") : null;
    set("rg", input.rg ?? null);
    if (input.birthDate !== undefined) data.birthDate = input.birthDate ? new Date(input.birthDate) : null;
    set("phone", input.phone ?? null);
    set("whatsappPhone", input.whatsappPhone ?? null);
    set("email", input.email ?? null);
    set("addressLine", input.addressLine ?? null);
    set("addressNumber", input.addressNumber ?? null);
    set("addressComplement", input.addressComplement ?? null);
    set("neighborhood", input.neighborhood ?? null);
    set("city", input.city ?? null);
    set("state", input.state ?? null);
    set("postalCode", input.postalCode ?? null);
    set("roleTitle", input.roleTitle ?? null);
    set("cbo", input.cbo ?? null);
    if (input.salaryCents !== undefined) data.salaryCents = input.salaryCents != null ? BigInt(input.salaryCents) : null;
    if (input.admissionDate !== undefined) data.admissionDate = input.admissionDate ? new Date(input.admissionDate) : null;
    if (input.terminationDate !== undefined) data.terminationDate = input.terminationDate ? new Date(input.terminationDate) : null;
    if (input.workSchedule !== undefined) data.workSchedule = (input.workSchedule ?? {}) as any;
    set("photoUrl", input.photoUrl ?? null);
    set("status", input.status);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.update({ where: { id }, data }),
    );
    await this.ponto.syncFromHr(emp.organizationId, { id: emp.id, name: emp.name, cpf: emp.cpf, roleTitle: emp.roleTitle, storeId: emp.storeId, userId: emp.userId, status: emp.status }).catch(() => undefined);
    return emp;
  }

  /** Gera senha provisória e envia credenciais do portal por WhatsApp/email. */
  async sendCredentials(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    const e = await this.getEmployee(ctx, id);
    if (!e.cpf) throw new AppError(ErrorCode.ValidationFailed, "Funcionário sem CPF cadastrado", 400);
    const tempPassword = Math.random().toString(36).slice(-4) + Math.floor(1000 + Math.random() * 9000);
    const hash = await this.argon.hash(tempPassword);
    await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.update({ where: { id }, data: { passwordHash: hash, mustResetPassword: true } }),
    );
    const env = loadEnv();
    const link = `${env.APP_PUBLIC_URL}/rh/login`;
    const text = `Olá ${e.name.split(" ")[0]}! Seu acesso ao portal do funcionário:\n\nLogin (CPF): ${e.cpf}\nSenha provisória: ${tempPassword}\n\nAcesse: ${link}\nVocê vai trocar a senha no primeiro acesso.`;
    try {
      if (e.storeId && (e.whatsappPhone || e.phone || e.email)) {
        await this.notifications.notify({
          organizationId: e.organizationId,
          storeId: e.storeId,
          whatsappPhone: e.whatsappPhone ?? e.phone ?? null,
          email: e.email ?? null,
          subject: "Acesso ao portal do funcionário",
          text,
          templateCode: "employee_credentials",
        });
      }
    } catch { /* best-effort */ }
    return { ok: true };
  }

  // ============================== PAYSLIPS ==============================
  async listPayslips(ctx: RequestContext, opts?: { employeeId?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const rows = await tx.payslip.findMany({
        where: { ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}) },
        orderBy: { refMonth: "desc" },
        take: 500,
      });
      if (opts?.employeeId) return rows;
      const empIds = [...new Set(rows.map((r) => r.employeeId))];
      const emps = empIds.length ? await tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } }) : [];
      const nm = new Map(emps.map((e) => [e.id, e.name] as [string, string]));
      return rows.map((r) => ({ ...r, employeeName: nm.get(r.employeeId) ?? "" }));
    });
  }

  async createPayslip(ctx: RequestContext, input: {
    employeeId: string; refMonth: string; grossCents?: number | null; netCents?: number | null;
    fileUrl?: string | null; notes?: string | null;
  }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    const ref = new Date(input.refMonth);
    ref.setUTCDate(1); ref.setUTCHours(0, 0, 0, 0);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.payslip.upsert({
        where: { employeeId_refMonth: { employeeId: input.employeeId, refMonth: ref } },
        update: {
          grossCents: input.grossCents != null ? BigInt(input.grossCents) : null,
          netCents: input.netCents != null ? BigInt(input.netCents) : null,
          fileUrl: input.fileUrl ?? null,
          notes: input.notes ?? null,
        },
        create: {
          organizationId: orgId,
          employeeId: input.employeeId,
          refMonth: ref,
          grossCents: input.grossCents != null ? BigInt(input.grossCents) : null,
          netCents: input.netCents != null ? BigInt(input.netCents) : null,
          fileUrl: input.fileUrl ?? null,
          notes: input.notes ?? null,
          createdByUserId: ctx.userId ?? null,
        },
      }),
    );
  }

  // ============================== TIME ENTRIES / SHEETS ==============================
  async listTimeEntries(ctx: RequestContext, opts: { employeeId?: string; from?: string; to?: string }) {
    this.requireOrg(ctx);
    const from = opts.from ? new Date(opts.from + "T00:00:00Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59Z") : new Date();
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeEntry.findMany({
        where: { ...(opts.employeeId ? { employeeId: opts.employeeId } : {}), happenedAt: { gte: from, lte: to } },
        orderBy: { happenedAt: "desc" },
        take: 2000,
      }),
    );
  }

  /**
   * Ajuste de batida pelo supervisor (admin/gerente/supervisor). Preserva a
   * batida ORIGINAL (espelho legal imutável — Portaria 671/2021): a primeira
   * vez que se ajusta, original_happened_at recebe o valor original.
   */
  async adjustTimeEntry(ctx: RequestContext, id: string, input: { happenedAt?: string; reason?: string | null; note?: string | null }) {
    this.requireHrManager(ctx);
    const cur = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.timeEntry.findFirst({ where: { id } }));
    if (!cur) throw new AppError(ErrorCode.NotFound, "Batida não encontrada", 404);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeEntry.update({
        where: { id },
        data: {
          // mantém o original na primeira edição
          originalHappenedAt: cur.originalHappenedAt ?? cur.happenedAt,
          ...(input.happenedAt ? { happenedAt: new Date(input.happenedAt) } : {}),
          adjustReason: input.reason ?? cur.adjustReason ?? null,
          note: input.note ?? cur.note ?? null,
          adjusted: true,
          adjustedByUserId: ctx.userId ?? null,
        },
      }),
    );
  }

  // ============================== HR SETTINGS (fechamento de folha) ==============================
  async getSettings(ctx: RequestContext) {
    const orgId = this.requireOrg(ctx);
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.hrSettings.findUnique({ where: { organizationId: orgId } }));
    return s ?? { organizationId: orgId, closingDay: 30, paymentDay: 5, dailyHours: "8.00", defaultSchedule: [], snackThresholdMinutes: 120, snackMinutes: 15 };
  }

  async updateSettings(ctx: RequestContext, input: { closingDay?: number; paymentDay?: number; dailyHours?: number; defaultSchedule?: any; snackThresholdMinutes?: number; snackMinutes?: number }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrSettings.upsert({
        where: { organizationId: orgId },
        update: {
          ...(input.closingDay != null ? { closingDay: input.closingDay } : {}),
          ...(input.paymentDay != null ? { paymentDay: input.paymentDay } : {}),
          ...(input.dailyHours != null ? { dailyHours: input.dailyHours } : {}),
          ...(input.defaultSchedule !== undefined ? { defaultSchedule: input.defaultSchedule } : {}),
          ...(input.snackThresholdMinutes != null ? { snackThresholdMinutes: input.snackThresholdMinutes } : {}),
          ...(input.snackMinutes != null ? { snackMinutes: input.snackMinutes } : {}),
        },
        create: {
          organizationId: orgId,
          closingDay: input.closingDay ?? 30,
          paymentDay: input.paymentDay ?? 5,
          dailyHours: input.dailyHours ?? 8,
          defaultSchedule: input.defaultSchedule ?? [],
          snackThresholdMinutes: input.snackThresholdMinutes ?? 120,
          snackMinutes: input.snackMinutes ?? 15,
        },
      }),
    );
  }

  // ============================== FERIADOS DA EMPRESA ==============================
  async listHolidays(ctx: RequestContext) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrHoliday.findMany({ orderBy: { holidayDate: "asc" } }),
    );
  }
  async addHoliday(ctx: RequestContext, input: { holidayDate: string; name?: string | null; recurringAnnual?: boolean }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrHoliday.create({ data: { organizationId: orgId, holidayDate: new Date(input.holidayDate + "T00:00:00Z"), name: input.name ?? null, recurringAnnual: input.recurringAnnual ?? false } }),
    );
  }
  async removeHoliday(ctx: RequestContext, id: string) {
    this.requireHrManager(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.hrHoliday.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /**
   * Gera (ou regenera) o espelho de ponto mensal a partir das batidas, no
   * período de competência definido pelo dia de fechamento da folha. Calcula
   * horas trabalhadas (original × ajustado), esperadas e saldo (banco de horas).
   * Não sobrescreve espelho já assinado pelo funcionário.
   */
  async generateTimeSheet(ctx: RequestContext, employeeId: string, refMonth: string) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    const settings = await this.getSettings(ctx);
    const closingDay = Number((settings as any).closingDay ?? 30);
    const dailyHours = Number(String((settings as any).dailyHours ?? 8));

    const ref = new Date(refMonth);
    const { start, end } = payrollPeriod(ref, closingDay);

    const entries = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeEntry.findMany({ where: { employeeId, happenedAt: { gte: start, lte: end } }, orderBy: { happenedAt: "asc" } }),
    );
    const shifts = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.workShift.findMany({ where: { employeeId, shiftDate: { gte: start, lte: end } } }),
    );
    const marks = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.attendanceMark.findMany({ where: { employeeId, refDate: { gte: start, lte: end } } }),
    );
    const summary = buildAttendanceSummary({ entries, shifts, marks, dailyHours, start, end });

    const refFirst = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
    const existing = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeSheet.findFirst({ where: { employeeId, refMonth: refFirst } }),
    );
    if (existing?.status === "signed") {
      throw new AppError(ErrorCode.Conflict, "Espelho já assinado pelo funcionário; não pode ser regerado", 409);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeSheet.upsert({
        where: { employeeId_refMonth: { employeeId, refMonth: refFirst } },
        update: { summary: summary as any, status: "closed" },
        create: { organizationId: orgId, employeeId, refMonth: refFirst, summary: summary as any, status: "closed" },
      }),
    );
  }

  /**
   * Folha de fechamento CONSOLIDADA do mês (todos os funcionários ativos):
   * horas trabalhadas, previstas, saldo, faltas, atestados e salário. HTML
   * branded (logo + cor da empresa) pronto pra imprimir/salvar em PDF.
   */
  async payrollHtml(ctx: RequestContext, refMonth: string): Promise<string> {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    const settings = await this.getSettings(ctx);
    const closingDay = Number((settings as any).closingDay ?? 30);
    const dailyHours = Number(String((settings as any).dailyHours ?? 8));
    const paymentDay = Number((settings as any).paymentDay ?? 5);
    const ref = new Date(refMonth.length === 7 ? refMonth + "-01" : refMonth);
    if (isNaN(ref.getTime())) throw new AppError(ErrorCode.ValidationFailed, "Mês inválido (use AAAA-MM)", 400);
    const { start, end } = payrollPeriod(ref, closingDay);

    const employees = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.findMany({ where: { status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, roleTitle: true, salaryCents: true } }),
    );
    const rows: Array<{ name: string; roleTitle: string | null; salaryCents: number | null; workedMin: number; expectedMin: number; balanceMin: number; faltas: number; atestados: number }> = [];
    for (const e of employees) {
      const [entries, shifts, marks] = await Promise.all([
        this.prisma.runWithContext(this.rls(ctx), (tx) => tx.timeEntry.findMany({ where: { employeeId: e.id, happenedAt: { gte: start, lte: end } }, orderBy: { happenedAt: "asc" } })),
        this.prisma.runWithContext(this.rls(ctx), (tx) => tx.workShift.findMany({ where: { employeeId: e.id, shiftDate: { gte: start, lte: end } } })),
        this.prisma.runWithContext(this.rls(ctx), (tx) => tx.attendanceMark.findMany({ where: { employeeId: e.id, refDate: { gte: start, lte: end } } })),
      ]);
      const summary = buildAttendanceSummary({ entries, shifts, marks, dailyHours, start, end });
      const atestados = (summary.days as any[]).filter((d) => d.status === "atestado").length;
      rows.push({
        name: e.name, roleTitle: e.roleTitle, salaryCents: e.salaryCents != null ? Number(e.salaryCents) : null,
        workedMin: Number(summary.totals.workedAdjustedMin) || 0,
        expectedMin: Number(summary.totals.expectedMin) || 0,
        balanceMin: Number(summary.totals.balanceMin) || 0,
        faltas: Number(summary.totals.faltas) || 0,
        atestados,
      });
    }
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true, document: true } }),
    );
    return buildPayrollHtml({
      brandName: org?.name ?? "Empresa", brandDoc: org?.document ?? null,
      logoUrl: org?.logoUrl ?? null, color: org?.primaryColor ?? "#7c3aed",
      refMonth: ref, paymentDay, periodFrom: start, periodTo: end, rows,
    });
  }

  async listTimeSheets(ctx: RequestContext, opts?: { employeeId?: string }) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeSheet.findMany({
        where: { ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}) },
        orderBy: { refMonth: "desc" },
        take: 500,
      }),
    );
  }

  /** Espelho de ponto imprimível (HTML branded, original × ajustado + totais). */
  async timeSheetHtml(ctx: RequestContext, id: string): Promise<string> {
    const orgId = this.requireOrg(ctx);
    const ts = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.timeSheet.findFirst({ where: { id } }));
    if (!ts) throw new AppError(ErrorCode.NotFound, "Espelho não encontrado", 404);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.findFirst({ where: { id: ts.employeeId }, select: { name: true, cpf: true, roleTitle: true, admissionDate: true } }),
    );
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true, document: true } }),
    );
    const settings = await this.getSettings(ctx);
    return buildTimeSheetHtml({
      brandName: org?.name ?? "Empresa",
      brandDoc: org?.document ?? null,
      logoUrl: org?.logoUrl ?? null,
      color: org?.primaryColor ?? "#7c3aed",
      employeeName: emp?.name ?? "Funcionário",
      employeeCpf: emp?.cpf ?? null,
      roleTitle: emp?.roleTitle ?? null,
      refMonth: ts.refMonth,
      paymentDay: Number((settings as any).paymentDay ?? 5),
      summary: (ts.summary ?? {}) as any,
      status: ts.status,
      signedAt: ts.signedAt,
      signatureImageUrl: ts.signatureImageUrl,
    });
  }

  // ============================== REQUESTS ==============================
  async listRequests(ctx: RequestContext, opts?: { status?: string; kind?: string }) {
    this.requireOrg(ctx);
    const reqs = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrRequest.findMany({
        where: { ...(opts?.status ? { status: opts.status } : {}), ...(opts?.kind ? { kind: opts.kind } : {}) },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    );
    // inclui também os colegas referenciados em trocas de horário
    const colleagueIds = reqs
      .map((r) => (r.payload as any)?.withEmployeeId)
      .filter((x): x is string => typeof x === "string");
    const empIds = [...new Set([...reqs.map((r) => r.employeeId), ...colleagueIds])];
    const emps = empIds.length
      ? await this.prisma.runWithContext(this.rls(ctx), (tx) =>
          tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true, salaryCents: true } }))
      : [];
    const em = new Map(emps.map((e) => [e.id, e]));
    return reqs.map((r) => ({
      ...r,
      employeeName: em.get(r.employeeId)?.name ?? "—",
      employeeSalaryCents: em.get(r.employeeId)?.salaryCents ?? null,
      colleagueName: (r.payload as any)?.withEmployeeId ? em.get((r.payload as any).withEmployeeId)?.name ?? null : null,
    }));
  }

  async reviewRequest(ctx: RequestContext, id: string, input: { status: "approved" | "rejected"; reviewNote?: string | null }) {
    this.requireAdmin(ctx);
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.hrRequest.findFirst({ where: { id } }));
    if (!r) throw new AppError(ErrorCode.NotFound, "Solicitação não encontrada", 404);
    if (r.status !== "pending") throw new AppError(ErrorCode.Conflict, "Solicitação já avaliada", 409);

    // troca de horário só pode ser aprovada após o aceite do colega (B)
    if (input.status === "approved" && r.kind === "shift_swap" && (r as any).colleagueDecision !== "accepted") {
      throw new AppError(ErrorCode.ValidationFailed, "Aguardando o aceite do colega antes da aprovação", 400);
    }

    // valida teto do vale (≤40% do salário) na aprovação
    if (input.status === "approved" && r.kind === "advance" && r.amountCents != null) {
      const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.employee.findFirst({ where: { id: r.employeeId }, select: { salaryCents: true } }));
      const salary = Number(emp?.salaryCents ?? 0n);
      if (salary > 0 && Number(r.amountCents) > Math.round(salary * 0.4)) {
        throw new AppError(ErrorCode.ValidationFailed, "Vale acima de 40% do salário", 400);
      }
    }

    const updated = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrRequest.update({
        where: { id },
        data: { status: input.status, reviewerUserId: ctx.userId ?? null, reviewedAt: new Date(), reviewNote: input.reviewNote ?? null },
      }),
    );

    // troca de horário aprovada → efetiva a troca de turnos (best-effort)
    if (input.status === "approved" && r.kind === "shift_swap") {
      await this.applyShiftSwap(ctx, r).catch(() => undefined);
    }
    return updated;
  }

  /**
   * Efetiva a troca: o turno do colega B na data pedida passa pro funcionário A
   * (requester). Se A oferecer um turno em troca (myDate), o turno de A nessa
   * data vai pro B. Best-effort: não falha a aprovação se algum turno não existir.
   */
  private async applyShiftSwap(ctx: RequestContext, r: any) {
    const payload = (r.payload ?? {}) as { withEmployeeId?: string; date?: string; myDate?: string };
    const aId = r.employeeId;            // quem pediu
    const bId = payload.withEmployeeId;  // colega
    if (!bId || !payload.date) return;
    const date = new Date(payload.date + "T00:00:00Z");
    await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const bShift = await tx.workShift.findFirst({ where: { employeeId: bId, shiftDate: date } });
      if (bShift) await tx.workShift.update({ where: { id: bShift.id }, data: { employeeId: aId, note: `Troca aprovada (era de outro colaborador)` } });
      if (payload.myDate) {
        const myDate = new Date(payload.myDate + "T00:00:00Z");
        const aShift = await tx.workShift.findFirst({ where: { employeeId: aId, shiftDate: myDate } });
        if (aShift) await tx.workShift.update({ where: { id: aShift.id }, data: { employeeId: bId, note: `Troca aprovada (era de outro colaborador)` } });
      }
    });
  }

  /** Recibo de troca de horário (HTML branded). Só pra solicitação shift_swap aprovada. */
  async shiftSwapReceiptHtml(ctx: RequestContext, id: string): Promise<string> {
    const orgId = this.requireOrg(ctx);
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.hrRequest.findFirst({ where: { id } }));
    if (!r) throw new AppError(ErrorCode.NotFound, "Solicitação não encontrada", 404);
    if (r.kind !== "shift_swap") throw new AppError(ErrorCode.ValidationFailed, "Não é troca de horário", 400);
    const payload = (r.payload ?? {}) as { withEmployeeId?: string; date?: string; myDate?: string };
    const ids = [r.employeeId, payload.withEmployeeId].filter(Boolean) as string[];
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, cpf: true } }),
    );
    const em = new Map(emps.map((e) => [e.id, e]));
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { name: true, logoUrl: true, primaryColor: true } }),
    );
    let reviewer: string | null = null;
    if (r.reviewerUserId) {
      const u = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.user.findFirst({ where: { id: r.reviewerUserId! }, select: { name: true } }));
      reviewer = u?.name ?? null;
    }
    return buildSwapReceiptHtml({
      brandName: org?.name ?? "Empresa",
      logoUrl: org?.logoUrl ?? null,
      color: org?.primaryColor ?? "#7c3aed",
      requester: em.get(r.employeeId) ?? null,
      colleague: payload.withEmployeeId ? em.get(payload.withEmployeeId) ?? null : null,
      date: payload.date ?? null,
      myDate: payload.myDate ?? null,
      reviewer,
      reviewedAt: r.reviewedAt,
      colleagueDecidedAt: (r as any).colleagueDecidedAt ?? null,
      status: r.status,
    });
  }

  // ============================== SHIFTS / NOTICES ==============================
  async listShifts(ctx: RequestContext, opts: { from?: string; to?: string; storeId?: string }) {
    this.requireOrg(ctx);
    const from = opts.from ? new Date(opts.from) : new Date();
    const to = opts.to ? new Date(opts.to) : new Date(Date.now() + 14 * 86400_000);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.workShift.findMany({
        where: { shiftDate: { gte: from, lte: to }, ...(opts.storeId ? { storeId: opts.storeId } : {}) },
        orderBy: { shiftDate: "asc" },
        take: 2000,
      }),
    );
  }

  async createShift(ctx: RequestContext, input: { employeeId: string; storeId?: string | null; shiftDate: string; startTime?: string | null; endTime?: string | null; breakMinutes?: number; lunchStart?: string | null; lunchEnd?: string | null; note?: string | null }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.workShift.create({
        data: {
          organizationId: orgId,
          employeeId: input.employeeId,
          storeId: input.storeId ?? null,
          shiftDate: new Date(input.shiftDate),
          startTime: input.startTime ?? null,
          endTime: input.endTime ?? null,
          breakMinutes: input.breakMinutes ?? 0,
          lunchStart: input.lunchStart ?? null,
          lunchEnd: input.lunchEnd ?? null,
          note: input.note ?? null,
        },
      }),
    );
  }

  /**
   * Gera a escala do mês inteiro de uma vez: jornada fixa (ex.: 07:00–17:00 com
   * 60min de almoço), folgas por dia da semana (ex.: domingo). Cria um turno por
   * dia útil do mês. Substitui a escala existente do funcionário no mês.
   */
  async generateMonthlyShifts(ctx: RequestContext, input: {
    employeeId: string; month: string;
    // novo: jornada por dia da semana (totalmente configurável)
    weekdays?: Array<{ weekday: number; enabled: boolean; startTime: string; endTime: string; breakMinutes?: number; lunchStart?: string | null; lunchEnd?: string | null }>;
    // legado: jornada única + folgas (compatibilidade)
    startTime?: string; endTime?: string; breakMinutes?: number; daysOff?: number[];
    storeId?: string | null; note?: string | null;
  }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    const ref = new Date(input.month + "-01T00:00:00Z");
    const y = ref.getUTCFullYear(); const m = ref.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(y, m, daysInMonth, 23, 59, 59));

    // config por dia da semana (0..6). Usa `weekdays` se vier; senão monta do legado.
    const cfgByWeekday = new Map<number, { startTime: string; endTime: string; breakMinutes: number; lunchStart: string | null; lunchEnd: string | null }>();
    if (input.weekdays?.length) {
      for (const w of input.weekdays) {
        if (w.enabled && w.startTime && w.endTime) cfgByWeekday.set(w.weekday, { startTime: w.startTime, endTime: w.endTime, breakMinutes: w.breakMinutes ?? 0, lunchStart: w.lunchStart ?? null, lunchEnd: w.lunchEnd ?? null });
      }
    } else if (input.startTime && input.endTime) {
      const off = new Set(input.daysOff ?? [0]);
      for (let wd = 0; wd <= 6; wd++) if (!off.has(wd)) cfgByWeekday.set(wd, { startTime: input.startTime, endTime: input.endTime, breakMinutes: input.breakMinutes ?? 0, lunchStart: null, lunchEnd: null });
    }

    // feriados da empresa (data fixa ou recorrente anual) → folga automática
    const holidays = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrHoliday.findMany({ where: { organizationId: orgId } }),
    );
    const holidaySet = new Set<string>();
    for (const h of holidays) {
      const hd = new Date(h.holidayDate);
      if (h.recurringAnnual) holidaySet.add(`${String(hd.getUTCMonth() + 1).padStart(2, "0")}-${String(hd.getUTCDate()).padStart(2, "0")}`);
      else holidaySet.add(hd.toISOString().slice(0, 10));
    }
    const isHoliday = (d: Date) => holidaySet.has(d.toISOString().slice(0, 10)) || holidaySet.has(`${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);

    // validações CLT por dia configurado
    const offDays = new Set<number>();
    for (let wd = 0; wd <= 6; wd++) if (!cfgByWeekday.has(wd)) offDays.add(wd);
    const warnings: string[] = [];
    for (const [wd, c] of cfgByWeekday) {
      for (const wmsg of validateCltSchedule({ startTime: c.startTime, endTime: c.endTime, breakMinutes: c.breakMinutes, daysOff: offDays })) {
        const dl = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][wd];
        if (!warnings.includes(`${dl}: ${wmsg}`)) warnings.push(`${dl}: ${wmsg}`);
      }
    }

    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      await tx.workShift.deleteMany({ where: { employeeId: input.employeeId, shiftDate: { gte: monthStart, lte: monthEnd } } });
      let created = 0, holidaysSkipped = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(Date.UTC(y, m, d));
        const cfg = cfgByWeekday.get(date.getUTCDay());
        if (!cfg) continue;                       // folga (dia da semana desativado)
        if (isHoliday(date)) { holidaysSkipped++; continue; }   // feriado → folga
        await tx.workShift.create({
          data: {
            organizationId: orgId, employeeId: input.employeeId, storeId: input.storeId ?? null,
            shiftDate: date, startTime: cfg.startTime, endTime: cfg.endTime, breakMinutes: cfg.breakMinutes,
            lunchStart: cfg.lunchStart, lunchEnd: cfg.lunchEnd, note: input.note ?? null,
          },
        });
        created++;
      }
      return { created, holidaysSkipped, warnings };
    });
  }

  // ============================== JUSTIFICATIVAS DE PONTO ==============================
  async listJustifications(ctx: RequestContext, opts?: { status?: string; employeeId?: string }) {
    this.requireHrManager(ctx);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.attendanceJustification.findMany({
        where: { ...(opts?.status ? { status: opts.status } : {}), ...(opts?.employeeId ? { employeeId: opts.employeeId } : {}) },
        orderBy: { createdAt: "desc" }, take: 300,
      }),
    );
    const empIds = [...new Set(items.map((i) => i.employeeId))];
    const emps = empIds.length
      ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } }))
      : [];
    const em = new Map(emps.map((e) => [e.id, e.name]));
    return items.map((i) => ({ ...i, employeeName: em.get(i.employeeId) ?? "—" }));
  }

  /** Pedidos de ajuste de ponto (funcionário pediu pra corrigir uma batida). */
  async listTimeEdits(ctx: RequestContext, opts?: { status?: string }) {
    this.requireHrManager(ctx);
    const status = opts?.status ?? "pending";
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeEntry.findMany({
        where: { editStatus: status },
        orderBy: { editRequestedAt: "desc" },
        take: 300,
      }),
    );
    const empIds = [...new Set(items.map((i) => i.employeeId))];
    const emps = empIds.length
      ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } }))
      : [];
    const em = new Map(emps.map((e) => [e.id, e.name]));
    return items.map((i) => ({
      id: i.id,
      employeeId: i.employeeId,
      employeeName: em.get(i.employeeId) ?? "—",
      kind: i.kind,
      happenedAt: i.happenedAt,
      editRequestedTo: i.editRequestedTo,
      editReason: i.editReason,
      editRequestedAt: i.editRequestedAt,
      editStatus: i.editStatus,
    }));
  }

  /** Aprova/recusa justificativa. Aprovação aplica os efeitos. */
  async reviewJustification(ctx: RequestContext, id: string, input: { status: "approved" | "rejected"; note?: string | null }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    const j = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.attendanceJustification.findFirst({ where: { id } }));
    if (!j) throw new AppError(ErrorCode.NotFound, "Justificativa não encontrada", 404);
    if (j.status !== "pending") throw new AppError(ErrorCode.Conflict, "Justificativa já avaliada", 409);

    let internalCode: string | null = null;
    if (input.status === "approved") {
      if (j.kind === "forgot_punch") {
        // cria as batidas propostas no dia (ajustadas, fonte justificativa)
        const p = (j.proposed ?? {}) as Record<string, string>;
        const base = new Date(j.refDate);
        const mk = (hm?: string) => {
          if (!hm) return null;
          const [h, mi] = hm.split(":").map(Number);
          return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), h ?? 0, mi ?? 0, 0));
        };
        const pairs: Array<[string, string | null]> = [["in", p.in ?? null], ["break_in", p.break_in ?? null], ["break_out", p.break_out ?? null], ["out", p.out ?? null]];
        await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
          for (const [kind, hm] of pairs) {
            const t = mk(hm ?? undefined);
            if (!t) continue;
            await tx.timeEntry.create({
              data: { organizationId: orgId, employeeId: j.employeeId, kind, happenedAt: t, originalHappenedAt: t, source: "justification", adjusted: true, adjustReason: "Esqueceu de bater — justificado", adjustedByUserId: ctx.userId ?? null },
            });
          }
        });
      } else if (j.kind === "medical") {
        // gera código interno + marca os dias do atestado
        internalCode = `ATEST-${new Date(j.refDate).toISOString().slice(2, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const days = Math.max(1, j.daysCount ?? 1);
        await this.prisma.runWithContext(this.rls(ctx), async (tx) => {
          for (let i = 0; i < days; i++) {
            const d = new Date(j.refDate); d.setUTCDate(d.getUTCDate() + i);
            const ref = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
            await tx.attendanceMark.upsert({
              where: { employeeId_refDate: { employeeId: j.employeeId, refDate: ref } },
              update: { status: "atestado", internalCode, justificationId: j.id },
              create: { organizationId: orgId, employeeId: j.employeeId, refDate: ref, status: "atestado", internalCode, justificationId: j.id },
            });
          }
        });
      }
    }

    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.attendanceJustification.update({
        where: { id },
        data: { status: input.status, reviewerUserId: ctx.userId ?? null, reviewedAt: new Date(), reviewNote: input.note ?? null, internalCode },
      }),
    );
  }

  async deleteShift(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.workShift.deleteMany({ where: { id } }));
    return { ok: true };
  }

  async listNotices(ctx: RequestContext) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrNotice.findMany({ orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }], take: 200 }),
    );
  }

  async createNotice(ctx: RequestContext, input: { title: string; body: string; storeId?: string | null; pinned?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrNotice.create({
        data: {
          organizationId: orgId,
          storeId: input.storeId ?? null,
          title: input.title,
          body: input.body,
          pinned: input.pinned ?? false,
          createdByUserId: ctx.userId ?? null,
        },
      }),
    );
  }

  async deleteNotice(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.hrNotice.deleteMany({ where: { id } }));
    return { ok: true };
  }

  // ============================== ADMISSÃO DIGITAL ==============================
  /**
   * Gera um contrato de admissão pro funcionário a partir de um modelo, já
   * com os dados dele preenchidos, e devolve o link de assinatura. Reaproveita
   * o módulo de contratos (assinatura eletrônica + selo).
   */
  async createAdmissionContract(ctx: RequestContext, employeeId: string, templateId: string) {
    this.requireAdmin(ctx);
    const e = await this.getEmployee(ctx, employeeId);
    const contract = await this.contracts.createContract(ctx, {
      templateId,
      signerName: e.name,
      signerEmail: e.email ?? undefined,
      signerDocument: e.cpf ?? undefined,
      signerPhone: e.whatsappPhone ?? e.phone ?? undefined,
      storeId: e.storeId ?? null,
      fieldValues: {
        "funcionario.nome": e.name,
        "funcionario.cpf": e.cpf ?? "",
        "funcionario.cargo": e.roleTitle ?? "",
        "funcionario.admissao": e.admissionDate ? new Date(e.admissionDate).toLocaleDateString("pt-BR") : "",
        "funcionario.salario": e.salaryCents != null ? (Number(e.salaryCents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "",
      },
    } as any);
    // registra como documento do funcionário (referência)
    return contract;
  }

  // ============================== GEOCERCA (raio da loja) ==============================
  async listStoreGeofences(ctx: RequestContext) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, geoLat: true, geoLng: true, geoRadiusM: true },
        orderBy: { name: "asc" },
      }),
    );
  }

  async updateStoreGeofence(ctx: RequestContext, storeId: string, input: { geoLat?: number | null; geoLng?: number | null; geoRadiusM?: number | null }) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.store.update({
        where: { id: storeId },
        data: {
          ...(input.geoLat !== undefined ? { geoLat: input.geoLat } : {}),
          ...(input.geoLng !== undefined ? { geoLng: input.geoLng } : {}),
          ...(input.geoRadiusM !== undefined ? { geoRadiusM: input.geoRadiusM } : {}),
        },
        select: { id: true, name: true, geoLat: true, geoLng: true, geoRadiusM: true },
      }),
    );
  }

  // ============================== DOCUMENTS ==============================
  async listDocuments(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employeeDocument.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" } }),
    );
  }

  async addDocument(ctx: RequestContext, input: { employeeId: string; docType: string; title?: string | null; fileUrl: string }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employeeDocument.create({
        data: {
          organizationId: orgId,
          employeeId: input.employeeId,
          docType: input.docType,
          title: input.title ?? null,
          fileUrl: input.fileUrl,
          uploadedBy: "company",
          status: "approved", // doc enviado pela empresa já entra aprovado
        },
      }),
    );
  }

  /** Aprova/recusa um documento enviado pelo funcionário (admin/gerente/supervisor). */
  async reviewDocument(ctx: RequestContext, id: string, input: { status: "approved" | "rejected"; note?: string | null }) {
    this.requireHrManager(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employeeDocument.update({
        where: { id },
        data: { status: input.status, reviewedByUserId: ctx.userId ?? null, reviewedAt: new Date(), reviewNote: input.note ?? null },
      }),
    );
  }

  // ============================== EXAMES OCUPACIONAIS (ASO) ==============================
  async listExams(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeExam.findMany({ where: { employeeId }, orderBy: { examDate: "desc" } }));
  }
  async upsertExam(ctx: RequestContext, input: { id?: string; employeeId: string; kind?: string; examDate?: string | null; dueDate?: string | null; result?: string | null; doctor?: string | null; fileUrl?: string | null; notes?: string | null }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    const kinds = ["admissional", "periodico", "demissional", "retorno", "mudanca_funcao"];
    const data: any = {
      kind: kinds.includes(input.kind ?? "") ? input.kind : "periodico",
      examDate: input.examDate ? new Date(input.examDate + "T00:00:00Z") : null,
      dueDate: input.dueDate ? new Date(input.dueDate + "T00:00:00Z") : null,
      result: (input.result || "").slice(0, 40) || null, doctor: (input.doctor || "").slice(0, 160) || null,
      fileUrl: input.fileUrl ?? null, notes: (input.notes || "").slice(0, 500) || null,
    };
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.employeeExam.update({ where: { id: input.id }, data: { ...data, updatedAt: new Date() } })
        : tx.employeeExam.create({ data: { organizationId: orgId, employeeId: input.employeeId, createdBy: ctx.userId ?? null, ...data } }),
    );
    return { id: row.id };
  }
  async removeExam(ctx: RequestContext, id: string) {
    this.requireHrManager(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeExam.deleteMany({ where: { id } }));
    return { ok: true };
  }
  /** Exames ocupacionais vencidos/a vencer (próx. N dias) — para alertas. */
  async expiringExams(ctx: RequestContext, days = 30) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const limit = new Date(today.getTime() + days * 86400000);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeExam.findMany({ where: { dueDate: { not: null, lte: limit } }, orderBy: { dueDate: "asc" }, take: 500 }));
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = empIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name]));
    return { items: rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: nm.get(r.employeeId) ?? "", kind: r.kind, dueDate: r.dueDate, overdue: r.dueDate ? new Date(r.dueDate) < today : false })) };
  }

  // ============================== TREINAMENTOS / CERTIFICAÇÕES ==============================
  async listTrainings(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTraining.findMany({ where: { employeeId }, orderBy: { completedDate: "desc" } }));
  }
  async upsertTraining(ctx: RequestContext, input: { id?: string; employeeId: string; name: string; provider?: string | null; completedDate?: string | null; dueDate?: string | null; hours?: number | null; fileUrl?: string | null; notes?: string | null }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    if (!input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Nome do treinamento obrigatório", 400);
    const data: any = {
      name: input.name.trim().slice(0, 160), provider: (input.provider || "").slice(0, 160) || null,
      completedDate: input.completedDate ? new Date(input.completedDate + "T00:00:00Z") : null,
      dueDate: input.dueDate ? new Date(input.dueDate + "T00:00:00Z") : null,
      hours: input.hours != null && Number.isFinite(Number(input.hours)) ? Math.max(0, Math.trunc(Number(input.hours))) : null,
      fileUrl: input.fileUrl ?? null, notes: (input.notes || "").slice(0, 500) || null,
    };
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.employeeTraining.update({ where: { id: input.id }, data: { ...data, updatedAt: new Date() } })
        : tx.employeeTraining.create({ data: { organizationId: orgId, employeeId: input.employeeId, createdBy: ctx.userId ?? null, ...data } }),
    );
    return { id: row.id };
  }
  async removeTraining(ctx: RequestContext, id: string) {
    this.requireHrManager(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTraining.deleteMany({ where: { id } }));
    return { ok: true };
  }
  /** Treinamentos vencidos/a vencer (próx. N dias) — para alertas/dashboard. */
  async expiringTrainings(ctx: RequestContext, days = 30) {
    this.requireOrg(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const limit = new Date(today.getTime() + days * 86400000);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTraining.findMany({ where: { dueDate: { not: null, lte: limit } }, orderBy: { dueDate: "asc" }, take: 500 }));
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = empIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name] as [string, string]));
    return { items: rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: nm.get(r.employeeId) ?? "", name: r.name, dueDate: r.dueDate, overdue: r.dueDate ? new Date(r.dueDate) < today : false })) };
  }

  // ============================== ADVERTÊNCIAS / OCORRÊNCIAS ==============================
  async listWarnings(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeWarning.findMany({ where: { employeeId }, orderBy: { date: "desc" } }));
  }
  async createWarning(ctx: RequestContext, input: { employeeId: string; kind?: string; date: string; reason: string; suspensionDays?: number | null; fileUrl?: string | null; notes?: string | null }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    if (!input.employeeId || !input.date || !input.reason?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Funcionário, data e motivo obrigatórios", 400);
    const kinds = ["advertencia_verbal", "advertencia_escrita", "suspensao"];
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeWarning.create({
      data: {
        organizationId: orgId, employeeId: input.employeeId, createdBy: ctx.userId ?? null,
        kind: kinds.includes(input.kind ?? "") ? input.kind! : "advertencia_escrita",
        date: new Date(input.date + "T00:00:00Z"), reason: input.reason.trim().slice(0, 2000),
        suspensionDays: input.kind === "suspensao" && input.suspensionDays ? Math.max(1, Math.trunc(Number(input.suspensionDays))) : null,
        fileUrl: input.fileUrl ?? null, notes: (input.notes || "").slice(0, 500) || null,
      },
    }));
    return { id: row.id };
  }
  async removeWarning(ctx: RequestContext, id: string) {
    this.requireHrManager(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeWarning.deleteMany({ where: { id } }));
    return { ok: true };
  }

  // ============================== RESCISÃO / DESLIGAMENTO ==============================
  async getTermination(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTermination.findFirst({ where: { employeeId } }));
  }
  async upsertTermination(ctx: RequestContext, input: { employeeId: string; kind?: string; noticeType?: string; noticeDate?: string | null; terminationDate?: string | null; reason?: string | null; asoDone?: boolean; assetsReturned?: boolean; accessRevoked?: boolean; docsDelivered?: boolean; termDocUrl?: string | null; notes?: string | null }) {
    this.requireHrManager(ctx);
    const orgId = this.requireOrg(ctx);
    if (!input.employeeId) throw new AppError(ErrorCode.ValidationFailed, "Funcionário obrigatório", 400);
    const kinds = ["sem_justa_causa", "pedido_demissao", "justa_causa", "acordo", "fim_contrato", "aposentadoria"];
    const notices = ["trabalhado", "indenizado", "dispensado"];
    const data: any = {
      kind: kinds.includes(input.kind ?? "") ? input.kind : "sem_justa_causa",
      noticeType: notices.includes(input.noticeType ?? "") ? input.noticeType : "trabalhado",
      noticeDate: input.noticeDate ? new Date(input.noticeDate + "T00:00:00Z") : null,
      terminationDate: input.terminationDate ? new Date(input.terminationDate + "T00:00:00Z") : null,
      reason: (input.reason || "").slice(0, 1000) || null,
      asoDone: !!input.asoDone, assetsReturned: !!input.assetsReturned, accessRevoked: !!input.accessRevoked, docsDelivered: !!input.docsDelivered,
      termDocUrl: input.termDocUrl ?? null, notes: (input.notes || "").slice(0, 1000) || null,
    };
    const existing = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTermination.findFirst({ where: { employeeId: input.employeeId }, select: { id: true, status: true } }));
    if (existing?.status === "finalized") throw new AppError(ErrorCode.Conflict, "Desligamento já finalizado", 409);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      existing ? tx.employeeTermination.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() } })
        : tx.employeeTermination.create({ data: { organizationId: orgId, employeeId: input.employeeId, createdBy: ctx.userId ?? null, ...data } }),
    );
    return { id: row.id };
  }
  async finalizeTermination(ctx: RequestContext, employeeId: string) {
    this.requireHrManager(ctx);
    const t = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTermination.findFirst({ where: { employeeId } }));
    if (!t) throw new AppError(ErrorCode.NotFound, "Desligamento não encontrado", 404);
    if (t.status === "finalized") return { ok: true, already: true };
    if (!t.terminationDate) throw new AppError(ErrorCode.ValidationFailed, "Informe a data de desligamento antes de finalizar", 400);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTermination.update({ where: { id: t.id }, data: { status: "finalized", finalizedAt: new Date() } }));
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.update({ where: { id: employeeId }, data: { status: "terminated", terminationDate: t.terminationDate } }));
    // inativa o ponto vinculado
    await this.ponto.syncFromHr(emp.organizationId, { id: emp.id, name: emp.name, cpf: emp.cpf, roleTitle: emp.roleTitle, storeId: emp.storeId, userId: emp.userId, status: "terminated" }).catch(() => undefined);
    return { ok: true };
  }
  /** Comunicado/termo de desligamento em PDF (com checklist e aviso prévio). */
  async terminationPdf(ctx: RequestContext, employeeId: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireOrg(ctx);
    const t = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employeeTermination.findFirst({ where: { employeeId } }));
    if (!t) throw new AppError(ErrorCode.NotFound, "Desligamento não encontrado", 404);
    const [emp, org] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findFirst({ where: { id: employeeId }, select: { name: true, cpf: true, roleTitle: true, admissionDate: true } })),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true, document: true } })),
    ]);
    const KIND: any = { sem_justa_causa: "Dispensa sem justa causa", pedido_demissao: "Pedido de demissão", justa_causa: "Dispensa por justa causa", acordo: "Comum acordo (art. 484-A)", fim_contrato: "Término de contrato", aposentadoria: "Aposentadoria" };
    const NOTICE: any = { trabalhado: "Aviso prévio trabalhado", indenizado: "Aviso prévio indenizado", dispensado: "Aviso prévio dispensado" };
    const d = (x: Date | null) => (x ? new Date(x).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      pdf.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(org?.name ?? "Empresa", { align: "center" });
      if (org?.document) pdf.font("Helvetica").fontSize(9).fillColor("#555").text(`CNPJ ${org.document}`, { align: "center" });
      pdf.moveDown(0.3).font("Helvetica-Bold").fontSize(13).fillColor("#111").text("Comunicado de Desligamento", { align: "center" });
      pdf.moveDown(1).font("Helvetica").fontSize(11).fillColor("#222");
      pdf.text(`Empregado(a): ${emp?.name ?? ""}${emp?.roleTitle ? ` — ${emp.roleTitle}` : ""}`);
      if (emp?.cpf) pdf.text(`CPF: ${emp.cpf}`);
      pdf.text(`Admissão: ${d(emp?.admissionDate ?? null)}   ·   Desligamento: ${d(t.terminationDate)}`);
      pdf.moveDown(0.6).font("Helvetica-Bold").text(`Motivo: ${KIND[t.kind] ?? t.kind}`);
      pdf.font("Helvetica").text(`${NOTICE[t.noticeType] ?? t.noticeType}${t.noticeDate ? ` · a partir de ${d(t.noticeDate)}` : ""}`);
      if (t.reason) { pdf.moveDown(0.4).text(`Observações: ${t.reason}`, { align: "justify" }); }
      pdf.moveDown(0.8).font("Helvetica-Bold").text("Checklist de desligamento:");
      pdf.font("Helvetica").fontSize(10);
      const chk = (ok: boolean, label: string) => pdf.text(`${ok ? "[X]" : "[  ]"}  ${label}`);
      chk(t.asoDone, "Exame demissional (ASO) realizado");
      chk(t.assetsReturned, "Devolução de EPI / uniforme / equipamentos");
      chk(t.accessRevoked, "Baixa de acessos (sistemas / crachá)");
      chk(t.docsDelivered, "Entrega de documentos (TRCT / guias)");
      pdf.moveDown(3).fontSize(11);
      pdf.text("__________________________________________", { align: "center" });
      pdf.text(`${emp?.name ?? "Empregado(a)"}`, { align: "center" });
      pdf.moveDown(1.5);
      pdf.text("__________________________________________", { align: "center" });
      pdf.text(`${org?.name ?? "Empregador"}`, { align: "center" });
      pdf.moveDown(0.5).fontSize(9).fillColor("#666").text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, { align: "center" });
      pdf.end();
    });
    return { buffer, filename: `desligamento-${(emp?.name ?? "func").split(" ")[0]}.pdf` };
  }

  // ============================== DASHBOARD DE RH ==============================
  /** KPIs do RH: headcount, turnover, aniversariantes, ASO, advertências, ponto, férias. */
  async dashboard(ctx: RequestContext) {
    this.requireOrg(ctx);
    const rls = this.rls(ctx);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const mo = today.getUTCMonth();
    const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, mo, today.getUTCDate()));
    const all = await this.prisma.runWithContext(rls, (tx) => tx.employee.findMany({ select: { id: true, name: true, status: true, storeId: true, birthDate: true, admissionDate: true, terminationDate: true, photoUrl: true, roleTitle: true } }));
    const active = all.filter((e) => e.status === "active");
    const headcount = active.length;
    const admissions12m = all.filter((e) => e.admissionDate && new Date(e.admissionDate) >= yearAgo).length;
    const terminations12m = all.filter((e) => e.terminationDate && new Date(e.terminationDate) >= yearAgo).length;
    const turnoverPct = headcount > 0 ? Math.round((terminations12m / headcount) * 1000) / 10 : 0;
    const aniversariantes = active
      .filter((e) => e.birthDate && new Date(e.birthDate).getUTCMonth() === mo)
      .map((e) => ({ id: e.id, name: e.name, day: new Date(e.birthDate!).getUTCDate(), photoUrl: e.photoUrl, roleTitle: e.roleTitle }))
      .sort((a, b) => a.day - b.day);
    // por loja
    const byStore = new Map<string, number>();
    for (const e of active) byStore.set(e.storeId ?? "sem-loja", (byStore.get(e.storeId ?? "sem-loja") ?? 0) + 1);
    const stores = await this.prisma.runWithContext(rls, (tx) => tx.store.findMany({ select: { id: true, name: true } })).catch(() => [] as any[]);
    const storeName = new Map(stores.map((s: any) => [s.id, s.name] as [string, string]));
    const headcountByStore = [...byStore.entries()].map(([sid, count]) => ({ store: sid === "sem-loja" ? "Sem loja" : (storeName.get(sid) ?? "—"), count }));

    const [exams, trainings, warningsPending, justPend, vacRows] = await Promise.all([
      this.expiringExams(ctx, 30).catch(() => ({ items: [] as any[] })),
      this.expiringTrainings(ctx, 30).catch(() => ({ items: [] as any[] })),
      this.prisma.runWithContext(rls, (tx) => tx.employeeWarning.count({ where: { acknowledgedAt: null } })).catch(() => 0),
      this.prisma.runWithContext(rls, (tx) => tx.pontoJustification.count({ where: { status: "pending" } })).catch(() => 0),
      this.prisma.runWithContext(rls, (tx) => tx.pontoVacation.findMany({ where: { status: "scheduled", startDate: { gte: today, lte: new Date(today.getTime() + 60 * 86400000) } }, orderBy: { startDate: "asc" }, take: 20 })).catch(() => [] as any[]),
    ]);
    const vacEmpIds = [...new Set(vacRows.map((v: any) => v.employeeId))];
    const vacEmps = vacEmpIds.length ? await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployee.findMany({ where: { id: { in: vacEmpIds } }, select: { id: true, name: true } })).catch(() => [] as any[]) : [];
    const vacNm = new Map(vacEmps.map((e: any) => [e.id, e.name] as [string, string]));
    const vacationsUpcoming = vacRows.map((v: any) => ({ id: v.id, name: vacNm.get(v.employeeId) ?? "", startDate: v.startDate, days: v.days }));

    return {
      headcount, admissions12m, terminations12m, turnoverPct,
      headcountByStore,
      aniversariantes,
      aso: { vencidos: exams.items.filter((i: any) => i.overdue).length, vencendo: exams.items.filter((i: any) => !i.overdue).length, items: exams.items.slice(0, 20) },
      treinamentos: { vencidos: trainings.items.filter((i: any) => i.overdue).length, vencendo: trainings.items.filter((i: any) => !i.overdue).length, items: trainings.items.slice(0, 20) },
      warningsPending, justificationsPending: justPend,
      vacationsUpcoming,
    };
  }

  // ============================== PONTO: edição pendente ==============================
  /** Aprova/recusa um pedido de edição de batida feito pelo funcionário. */
  async reviewTimeEdit(ctx: RequestContext, id: string, input: { status: "approved" | "rejected"; note?: string | null }) {
    this.requireHrManager(ctx);
    const cur = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.timeEntry.findFirst({ where: { id } }));
    if (!cur) throw new AppError(ErrorCode.NotFound, "Batida não encontrada", 404);
    if (cur.editStatus !== "pending") throw new AppError(ErrorCode.Conflict, "Sem edição pendente", 409);
    if (input.status === "rejected") {
      return this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.timeEntry.update({ where: { id }, data: { editStatus: "rejected" } }),
      );
    }
    // aprovado → aplica preservando o original
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.timeEntry.update({
        where: { id },
        data: {
          originalHappenedAt: cur.originalHappenedAt ?? cur.happenedAt,
          happenedAt: cur.editRequestedTo ?? cur.happenedAt,
          adjustReason: cur.editReason ?? null,
          adjusted: true,
          adjustedByUserId: ctx.userId ?? null,
          editStatus: "approved",
        },
      }),
    );
  }

  // ============================== SOLICITAÇÕES: comprovante de pagamento ==============================
  /** Admin anexa o comprovante de pagamento de um vale/reembolso aprovado. */
  async attachPaymentProof(ctx: RequestContext, id: string, proofUrl: string) {
    this.requireHrManager(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.hrRequest.update({ where: { id }, data: { paymentProofUrl: proofUrl, paidAt: new Date() } }),
    );
  }

  // ============================== EMPRÉSTIMOS ==============================
  async listLoans(ctx: RequestContext, employeeId?: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const loans = await tx.employeeLoan.findMany({ where: { ...(employeeId ? { employeeId } : {}) }, orderBy: { createdAt: "desc" }, take: 500 });
      const insts = loans.length
        ? await tx.employeeLoanInstallment.findMany({ where: { loanId: { in: loans.map((l) => l.id) } }, orderBy: { number: "asc" } })
        : [];
      // nome do funcionário (visão consolidada da empresa)
      const empIds = [...new Set(loans.map((l) => l.employeeId))];
      const emps = empIds.length ? await tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } }) : [];
      const nm = new Map(emps.map((e) => [e.id, e.name] as [string, string]));
      return loans.map((l) => ({ ...l, employeeName: nm.get(l.employeeId) ?? "", installments: insts.filter((i) => i.loanId === l.id) }));
    });
  }

  /** Cria empréstimo + parcelas. Bloqueia se a parcela passar de 30% do salário. */
  async createLoan(ctx: RequestContext, input: { employeeId: string; principalCents: number; installmentsCount: number; firstDueMonth: string; notes?: string | null }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    const emp = await this.getEmployee(ctx, input.employeeId);
    const salary = Number(emp.salaryCents ?? 0n);
    const installmentCents = Math.ceil(input.principalCents / input.installmentsCount);
    if (salary > 0 && installmentCents > Math.round(salary * 0.3)) {
      throw new AppError(ErrorCode.ValidationFailed, `Parcela (${(installmentCents / 100).toFixed(2)}) acima de 30% do salário (limite ${(salary * 0.3 / 100).toFixed(2)}).`, 400);
    }
    const first = new Date(input.firstDueMonth + "-01T00:00:00Z");
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const loan = await tx.employeeLoan.create({
        data: {
          organizationId: orgId, employeeId: input.employeeId,
          principalCents: BigInt(input.principalCents), installmentsCount: input.installmentsCount,
          installmentCents: BigInt(installmentCents), firstDueMonth: first, notes: input.notes ?? null,
          createdByUserId: ctx.userId ?? null,
        },
      });
      for (let n = 1; n <= input.installmentsCount; n++) {
        const due = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + (n - 1), 1));
        await tx.employeeLoanInstallment.create({
          data: { organizationId: orgId, loanId: loan.id, employeeId: input.employeeId, number: n, dueMonth: due, amountCents: BigInt(installmentCents) },
        });
      }
      return loan;
    });
  }

  /** Marca uma parcela do empréstimo como paga (geralmente junto ao holerite). */
  async payLoanInstallment(ctx: RequestContext, installmentId: string, input?: { payslipId?: string | null; proofUrl?: string | null }) {
    this.requireAdmin(ctx);
    return this.prisma.runWithContext(this.rls(ctx), async (tx) => {
      const inst = await tx.employeeLoanInstallment.update({
        where: { id: installmentId },
        data: { status: "paid", paidAt: new Date(), payslipId: input?.payslipId ?? null, proofUrl: input?.proofUrl ?? null },
      });
      // se todas pagas, fecha o empréstimo
      const pending = await tx.employeeLoanInstallment.count({ where: { loanId: inst.loanId, status: "pending" } });
      if (pending === 0) await tx.employeeLoan.update({ where: { id: inst.loanId }, data: { status: "paid" } });
      return inst;
    });
  }

  /** Parcelas em aberto de um funcionário (pro admin marcar pagas ao lançar holerite). */
  async openLoanInstallments(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.employeeLoanInstallment.findMany({ where: { employeeId, status: "pending" }, orderBy: { dueMonth: "asc" } }),
    );
  }
}

function escHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtMin(min: number): string {
  const v = Number(min) || 0;
  const h = Math.floor(Math.abs(v) / 60);
  const m = Math.abs(v) % 60;
  return `${v < 0 ? "-" : ""}${h}h${String(m).padStart(2, "0")}`;
}

/** Folha de fechamento consolidada (branded, imprimível). */
export function buildPayrollHtml(opts: {
  brandName: string; brandDoc: string | null; logoUrl: string | null; color: string;
  refMonth: Date; paymentDay: number; periodFrom: Date; periodTo: Date;
  rows: Array<{ name: string; roleTitle: string | null; salaryCents: number | null; workedMin: number; expectedMin: number; balanceMin: number; faltas: number; atestados: number }>;
}): string {
  const color = opts.color || "#7c3aed";
  const header = opts.logoUrl
    ? `<img src="${escHtml(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${escHtml(opts.brandName)}</span>`;
  const brl = (c: number | null) => c == null ? "—" : (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const mes = opts.refMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const per = `${opts.periodFrom.toLocaleDateString("pt-BR", { timeZone: "UTC" })} a ${opts.periodTo.toLocaleDateString("pt-BR", { timeZone: "UTC" })}`;
  const totalSalary = opts.rows.reduce((s, r) => s + (r.salaryCents ?? 0), 0);
  const body = opts.rows.map((r) => `<tr>
      <td>${escHtml(r.name)}</td>
      <td>${escHtml(r.roleTitle ?? "—")}</td>
      <td style="text-align:right">${fmtMin(r.workedMin)}</td>
      <td style="text-align:right">${fmtMin(r.expectedMin)}</td>
      <td style="text-align:right">${fmtMin(r.balanceMin)}</td>
      <td style="text-align:center">${r.faltas}</td>
      <td style="text-align:center">${r.atestados}</td>
      <td style="text-align:right">${brl(r.salaryCents)}</td>
    </tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Folha de fechamento — ${escHtml(mes)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#f3f4f6;color:#111}
    .page{max-width:980px;margin:16px auto;background:#fff;padding:28px;box-shadow:0 1px 8px rgba(0,0,0,.1)}
    .head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px}
    h1{font-size:18px;margin:14px 0 2px} .muted{color:#666;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
    th,td{border:1px solid #e5e7eb;padding:6px 8px} th{background:${color}1a;text-align:left}
    tfoot td{font-weight:700;background:#fafafa}
    .toolbar{text-align:center;padding:12px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:14px}
    @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.toolbar{display:none}@page{margin:12mm}}
  </style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <div class="head">${header}<div style="text-align:right" class="muted">${escHtml(opts.brandName)}${opts.brandDoc ? `<br/>${escHtml(opts.brandDoc)}` : ""}</div></div>
    <h1>Folha de fechamento — ${escHtml(mes)}</h1>
    <p class="muted">Competência: ${per} · Pagamento dia ${opts.paymentDay} · ${opts.rows.length} funcionário(s)</p>
    <table>
      <thead><tr><th>Funcionário</th><th>Cargo</th><th>Trabalhado</th><th>Previsto</th><th>Saldo</th><th>Faltas</th><th>Atestados</th><th>Salário</th></tr></thead>
      <tbody>${body || `<tr><td colspan="8" style="text-align:center;color:#666">Nenhum funcionário ativo no período.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="7" style="text-align:right">Total de salários</td><td style="text-align:right">${brl(totalSalary)}</td></tr></tfoot>
    </table>
    <p class="muted" style="margin-top:18px">Gerado em ${new Date().toLocaleString("pt-BR")}. Documento interno de conferência — não substitui a folha de pagamento oficial.</p>
  </div>
  </body></html>`;
}

export function buildTimeSheetHtml(opts: {
  brandName: string; brandDoc: string | null; logoUrl: string | null; color: string;
  employeeName: string; employeeCpf: string | null; roleTitle: string | null;
  refMonth: Date; paymentDay: number; summary: any; status: string;
  signedAt: Date | null; signatureImageUrl: string | null;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color : "#7c3aed";
  const header = opts.logoUrl
    ? `<img src="${escHtml(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${escHtml(opts.brandName)}</span>`;
  const period = opts.summary?.period;
  const days: any[] = Array.isArray(opts.summary?.days) ? opts.summary.days : [];
  const totals = opts.summary?.totals ?? {};
  const comp = new Date(opts.refMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  const SIT: Record<string, string> = { worked: "OK", falta: "FALTA", atestado: "Atestado", agendado: "—", folga: "Folga" };
  const rows = days.map((d: any) => {
    const date = new Date(d.date + "T12:00:00Z");
    const adj = Number(d.adjustedMin) || 0;
    const sh = d.shift;
    const escala = sh ? `${sh.start}–${sh.end}${sh.breakMinutes ? ` (${sh.breakMinutes}m)` : ""}` : "—";
    const m = d.marks ?? {};
    const interv = m.breakIn && m.breakOut ? `${m.breakIn}–${m.breakOut}` : "—";
    const sit = d.status === "atestado" && d.internalCode ? `Atestado ${escHtml(d.internalCode)}` : (SIT[d.status] ?? d.status);
    const sitColor = d.status === "falta" ? "#dc2626" : d.status === "atestado" ? color : d.status === "folga" || d.status === "agendado" ? "#888" : "#16a34a";
    const dow = date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });
    return `<tr>
      <td>${dow}</td>
      <td>${escala}</td>
      <td style="text-align:center">${m.in ?? "—"}</td>
      <td style="text-align:center">${m.out ?? "—"}</td>
      <td style="text-align:center">${interv}</td>
      <td style="text-align:right">${fmtMin(adj)}${d.edited ? " *" : ""}</td>
      <td style="text-align:right">${fmtMin(adj - (Number(d.expectedMin) || 0))}</td>
      <td style="color:${sitColor};font-weight:600">${sit}</td>
    </tr>`;
  }).join("");
  const faltas = Number((totals as any).faltas) || 0;

  const signature = opts.status === "signed"
    ? `<div class="sign">
        ${opts.signatureImageUrl ? `<img src="${escHtml(opts.signatureImageUrl)}" alt="assinatura" style="max-height:70px"/>` : ""}
        <div class="sline"></div>
        <p>${escHtml(opts.employeeName)}</p>
        ${opts.signedAt ? `<p class="muted">Assinado em ${new Date(opts.signedAt).toLocaleString("pt-BR")}</p>` : ""}
        <div class="seal">
          <span class="seal-badge">✓ ASSINADO DIGITALMENTE</span>
          <p class="muted seal-legal">Assinatura eletrônica com validade legal (Lei 14.063/2020 / MP 2.200-2/2001).</p>
        </div>
      </div>`
    : `<div class="sign"><div class="sline"></div><p>${escHtml(opts.employeeName)}</p><p class="muted">Assinatura do colaborador</p></div>`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Espelho de ponto</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f5f5f5}
  .page{max-width:760px;margin:20px auto;background:#fff;padding:32px 40px;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px}
  h1{font-size:18px;color:${color};margin:16px 0 2px}
  .meta{font-size:12px;color:#555;line-height:1.7}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}
  th{background:${color};color:#fff;padding:6px 8px;border:1px solid ${color};text-align:left}
  td{padding:6px 8px;border:1px solid #e5e7eb}
  tfoot td{font-weight:700;background:#faf7ff}
  .muted{color:#777}
  .legal{margin-top:14px;font-size:11px;color:#777;font-style:italic}
  .sign{margin-top:48px;width:340px}
  .sline{border-top:1px solid #333;margin-top:8px}
  .seal{margin-top:12px;border:2px dashed ${color};border-radius:10px;padding:8px 12px;background:rgba(124,58,237,.04)}
  .seal-badge{display:inline-block;font-size:11px;font-weight:700;color:#fff;background:${color};padding:3px 10px;border-radius:999px}
  .seal-legal{font-style:italic;margin-top:6px}
  .sign p{margin:4px 0 0;font-size:13px}
  .toolbar{text-align:center;padding:10px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @page{margin:14mm}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <header>${header}<span class="meta">Espelho de ponto</span></header>
    <h1>Espelho de ponto — ${escHtml(comp)}</h1>
    <p class="meta">
      Empregador: <strong>${escHtml(opts.brandName)}</strong>${opts.brandDoc ? ` · ${escHtml(opts.brandDoc)}` : ""}<br/>
      Colaborador: <strong>${escHtml(opts.employeeName)}</strong>${opts.employeeCpf ? ` · CPF ${escHtml(opts.employeeCpf)}` : ""}${opts.roleTitle ? ` · ${escHtml(opts.roleTitle)}` : ""}<br/>
      Competência: ${period ? `${new Date(period.from).toLocaleDateString("pt-BR")} a ${new Date(period.to).toLocaleDateString("pt-BR")}` : escHtml(comp)} · Pagamento dia ${opts.paymentDay}
    </p>
    <table>
      <thead><tr><th>Dia</th><th>Escala</th><th style="text-align:center">Entrada</th><th style="text-align:center">Saída</th><th style="text-align:center">Intervalo</th><th style="text-align:right">Trab.</th><th style="text-align:right">Saldo</th><th>Situação</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:#888;padding:20px">Sem dados no período.</td></tr>`}</tbody>
      <tfoot><tr>
        <td colspan="5">Totais${faltas ? ` · ${faltas} falta(s)` : ""}</td>
        <td style="text-align:right">${fmtMin(Number(totals.workedAdjustedMin) || 0)}</td>
        <td style="text-align:right">${fmtMin(Number(totals.balanceMin) || 0)}</td>
        <td></td>
      </tr></tfoot>
    </table>
    <p class="legal">* Dia com batida ajustada/justificada. <strong style="color:#dc2626">FALTA</strong> = dia com escala sem registro. Atestado abona a jornada prevista. Espelho conforme Portaria MTP 671/2021. Saldo positivo = horas extras; negativo = horas a compensar.</p>
    ${signature}
  </div>
</body></html>`;
}

export function buildSwapReceiptHtml(opts: {
  brandName: string; logoUrl: string | null; color: string;
  requester: { name: string; cpf: string | null } | null;
  colleague: { name: string; cpf: string | null } | null;
  date: string | null; myDate: string | null;
  reviewer: string | null; reviewedAt: Date | null; colleagueDecidedAt?: Date | null; status: string;
}): string {
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color : "#7c3aed";
  const header = opts.logoUrl
    ? `<img src="${escHtml(opts.logoUrl)}" alt="" style="max-height:48px;max-width:200px;object-fit:contain"/>`
    : `<span style="font-size:20px;font-weight:700;color:${color}">${escHtml(opts.brandName)}</span>`;
  const d = (s: string | null) => (s ? new Date(s + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—");
  const who = (e: { name: string; cpf: string | null } | null) => e ? `${escHtml(e.name)}${e.cpf ? ` (CPF ${escHtml(e.cpf)})` : ""}` : "—";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Recibo de troca de horário</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;margin:0;background:#f5f5f5}
  .page{max-width:680px;margin:20px auto;background:#fff;padding:32px 40px;box-shadow:0 1px 8px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${color};padding-bottom:12px}
  h1{font-size:18px;color:${color};margin:16px 0 8px}
  p{font-size:14px;line-height:1.7;margin:6px 0}
  .box{margin-top:14px;border:1px solid #e5e7eb;border-radius:10px;padding:14px}
  .muted{color:#777;font-size:12px}
  .status{display:inline-block;font-size:11px;text-transform:uppercase;color:#fff;background:${color};padding:3px 10px;border-radius:999px}
  .toolbar{text-align:center;padding:10px}.toolbar button{background:${color};color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer}
  @page{margin:14mm}@media print{body{background:#fff}.page{box-shadow:none;margin:0}.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
  <div class="page">
    <header>${header}<span class="status">${opts.status === "approved" ? "aprovada" : escHtml(opts.status)}</span></header>
    <h1>Recibo de troca de horário</h1>
    <div class="box">
      <p><strong>${who(opts.requester)}</strong> assumirá o turno de <strong>${who(opts.colleague)}</strong> no dia <strong>${d(opts.date)}</strong>.</p>
      ${opts.myDate ? `<p>Em contrapartida, <strong>${who(opts.colleague)}</strong> assumirá o turno de <strong>${who(opts.requester)}</strong> no dia <strong>${d(opts.myDate)}</strong>.</p>` : ""}
    </div>
    ${opts.colleagueDecidedAt ? `<p class="muted">Colega de acordo (aceite) em ${new Date(opts.colleagueDecidedAt).toLocaleString("pt-BR")}.</p>` : ""}
    <p class="muted">${opts.reviewer ? `Aprovado por ${escHtml(opts.reviewer)}` : "Aprovado pela gestão"}${opts.reviewedAt ? ` em ${new Date(opts.reviewedAt).toLocaleString("pt-BR")}` : ""}.</p>
    <p class="muted">As três partes (solicitante, colega e gestão) estão de acordo com esta troca, registrada no sistema.</p>
  </div>
</body></html>`;
}

/** Período de competência da folha a partir do dia de fechamento. */
function payrollPeriod(refMonth: Date, closingDay: number): { start: Date; end: Date } {
  const y = refMonth.getUTCFullYear();
  const m = refMonth.getUTCMonth(); // 0-based
  const daysThis = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const endDay = Math.min(closingDay, daysThis);
  const end = new Date(Date.UTC(y, m, endDay, 23, 59, 59));
  const daysPrev = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startDayPrev = Math.min(closingDay, daysPrev) + 1;
  const start = startDayPrev > daysPrev
    ? new Date(Date.UTC(y, m, 1, 0, 0, 0))            // fechamento no último dia → competência = mês cheio
    : new Date(Date.UTC(y, m - 1, startDayPrev, 0, 0, 0));
  return { start, end };
}

function hhmmUTC(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Validações CLT da escala (avisos). start/end "HH:MM", break em minutos. */
export function validateCltSchedule(opts: { startTime: string; endTime: string; breakMinutes: number; daysOff: Set<number> }): string[] {
  const w: string[] = [];
  const start = hhmm(opts.startTime);
  const end = hhmm(opts.endTime);
  const span = end - start; // minutos entre entrada e saída
  if (span <= 0) { w.push("Horário de saída deve ser depois da entrada."); return w; }
  const journey = span - (opts.breakMinutes || 0); // jornada efetiva
  // intervalo intrajornada
  if (span > 6 * 60 && opts.breakMinutes < 60) w.push("Jornada acima de 6h exige intervalo mínimo de 1h (intrajornada).");
  else if (span > 4 * 60 && span <= 6 * 60 && opts.breakMinutes < 15) w.push("Jornada de 4h a 6h exige intervalo mínimo de 15 min.");
  // jornada diária
  if (journey > 10 * 60) w.push("Jornada diária acima de 10h (8h + 2h extras é o limite legal).");
  else if (journey > 8 * 60) w.push("Jornada diária acima de 8h — o excedente conta como hora extra (máx 2h/dia).");
  // interjornada (mesma escala todo dia): fim → início do dia seguinte
  const interjornada = (24 * 60 - end) + start;
  if (interjornada < 11 * 60) w.push("Intervalo interjornada abaixo de 11h entre o fim e o início do dia seguinte.");
  // DSR — folga semanal
  if (opts.daysOff.size === 0) w.push("Sem folga semanal definida — a CLT exige ao menos 1 descanso semanal (DSR).");
  // carga semanal estimada (dias trabalhados na semana × jornada)
  const workingDaysPerWeek = 7 - opts.daysOff.size;
  const weekly = (journey / 60) * workingDaysPerWeek;
  if (weekly > 44) w.push(`Carga semanal estimada de ${weekly.toFixed(0)}h — acima das 44h semanais da CLT.`);
  return w;
}

/**
 * Monta o espelho de ponto do período: itera TODOS os dias (incl. folgas),
 * cruzando escala (work_shifts), batidas (time_entries) e marcações
 * (attendance_marks — atestado). Define a situação de cada dia:
 * atestado / trabalhado / falta / agendado / folga.
 */
export function buildAttendanceSummary(opts: {
  entries: Array<{ kind: string; happenedAt: Date; originalHappenedAt?: Date | null; adjusted?: boolean }>;
  shifts: Array<{ shiftDate: Date; startTime: string | null; endTime: string | null; breakMinutes?: number }>;
  marks: Array<{ refDate: Date; status: string; internalCode?: string | null }>;
  dailyHours: number;
  start: Date; end: Date;
}) {
  const shiftByDay = new Map<string, { startTime: string | null; endTime: string | null; breakMinutes: number }>();
  for (const s of opts.shifts) shiftByDay.set(new Date(s.shiftDate).toISOString().slice(0, 10), { startTime: s.startTime, endTime: s.endTime, breakMinutes: (s as any).breakMinutes ?? 0 });
  const markByDay = new Map<string, { status: string; internalCode?: string | null }>();
  for (const m of opts.marks) markByDay.set(new Date(m.refDate).toISOString().slice(0, 10), { status: m.status, internalCode: m.internalCode });
  const byDay = new Map<string, typeof opts.entries>();
  for (const e of opts.entries) {
    const day = new Date(e.happenedAt).toISOString().slice(0, 10);
    const arr = byDay.get(day) ?? []; arr.push(e); byDay.set(day, arr);
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const days: any[] = [];
  let totalOriginal = 0, totalAdjusted = 0, totalExpected = 0, faltas = 0;

  const cursor = new Date(Date.UTC(opts.start.getUTCFullYear(), opts.start.getUTCMonth(), opts.start.getUTCDate()));
  const endKey = opts.end.toISOString().slice(0, 10);
  while (cursor.toISOString().slice(0, 10) <= endKey) {
    const day = cursor.toISOString().slice(0, 10);
    const list = byDay.get(day) ?? [];
    const sh = shiftByDay.get(day);
    const mark = markByDay.get(day);

    const adjustedMin = workedMinutes(list.map((e) => ({ kind: e.kind, t: new Date(e.happenedAt).getTime() })));
    const originalMin = workedMinutes(list.map((e) => ({ kind: e.kind, t: new Date(e.originalHappenedAt ?? e.happenedAt).getTime() })));
    const expectedMin = sh?.startTime && sh?.endTime ? Math.max(0, hhmm(sh.endTime) - hhmm(sh.startTime) - (sh.breakMinutes ?? 0)) : 0;

    // marcações reais (entrada/saída/intervalo) p/ as colunas
    const inE = list.find((e) => e.kind === "in");
    const outE = [...list].reverse().find((e) => e.kind === "out");
    const bi = list.find((e) => e.kind === "break_in");
    const bo = list.find((e) => e.kind === "break_out");

    let status: string;
    if (mark?.status === "atestado") status = "atestado";
    else if (list.length > 0) status = "worked";
    else if (sh?.startTime && day <= todayKey) status = "falta";
    else if (sh?.startTime) status = "agendado";
    else status = "folga";

    if (status === "falta") faltas++;
    // atestado conta como jornada prevista cumprida (abona)
    const effExpected = expectedMin;
    const effWorked = status === "atestado" ? expectedMin : adjustedMin;
    totalOriginal += status === "atestado" ? expectedMin : originalMin;
    totalAdjusted += effWorked;
    totalExpected += effExpected;

    days.push({
      date: day,
      shift: sh?.startTime && sh?.endTime ? { start: sh.startTime, end: sh.endTime, breakMinutes: sh.breakMinutes ?? 0 } : null,
      marks: {
        in: inE ? hhmmUTC(new Date(inE.happenedAt)) : null,
        out: outE ? hhmmUTC(new Date(outE.happenedAt)) : null,
        breakIn: bi ? hhmmUTC(new Date(bi.happenedAt)) : null,
        breakOut: bo ? hhmmUTC(new Date(bo.happenedAt)) : null,
      },
      originalMin, adjustedMin, expectedMin,
      status,
      internalCode: mark?.internalCode ?? null,
      edited: list.some((e) => e.adjusted),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    period: { from: opts.start.toISOString().slice(0, 10), to: opts.end.toISOString().slice(0, 10) },
    days,
    totals: {
      workedOriginalMin: totalOriginal,
      workedAdjustedMin: totalAdjusted,
      expectedMin: totalExpected,
      balanceMin: totalAdjusted - totalExpected,
      faltas,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Minutos trabalhados no dia: in/break_out abrem, out/break_in fecham. */
function workedMinutes(entries: Array<{ kind: string; t: number }>): number {
  const sorted = [...entries].sort((a, b) => a.t - b.t);
  let open: number | null = null;
  let worked = 0;
  for (const e of sorted) {
    if (e.kind === "in" || e.kind === "break_out") {
      open = e.t;
    } else if (e.kind === "out" || e.kind === "break_in") {
      if (open != null) { worked += e.t - open; open = null; }
    }
  }
  return Math.round(worked / 60000);
}

/** "HH:MM" → minutos. */
function hhmm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface EmployeeInput {
  storeId?: string | null;
  userId?: string | null;
  name: string;
  cpf?: string | null;
  rg?: string | null;
  birthDate?: string | null;
  phone?: string | null;
  whatsappPhone?: string | null;
  email?: string | null;
  addressLine?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  roleTitle?: string | null;
  cbo?: string | null;
  salaryCents?: number | null;
  admissionDate?: string | null;
  terminationDate?: string | null;
  workSchedule?: Record<string, unknown>;
  photoUrl?: string | null;
  status?: string;
  // acesso ao sistema (cria User + Membership com papel + Chatwoot/GLPI)
  createSystemUser?: boolean;
  accessEmail?: string | null;
  roleSlug?: string | null;
  alsoProfessional?: boolean;
}
