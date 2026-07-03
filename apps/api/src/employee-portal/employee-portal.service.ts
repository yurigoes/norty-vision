import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { buildTimeSheetHtml } from "../hr/hr.service";
import { PontoService } from "../ponto/ponto.service";
import { JornadaService } from "../ponto/jornada.service";
import type { EmployeeContext } from "./employee-context";

const ADMIN = { isPlatformAdmin: true as const };

/** Distância em metros entre dois pontos (Haversine). */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

@Injectable()
export class EmployeePortalService {
  constructor(private readonly prisma: PrismaService, private readonly ponto: PontoService, private readonly jornada: JornadaService) {}

  /** Contexto de gestor (org-admin) para chamar os serviços oficiais de ponto. */
  private orgCtx(ctx: EmployeeContext): any { return { orgId: ctx.organizationId, isOrgAdmin: true }; }

  /** Resolve (provisiona se faltar) o ponto_employee oficial vinculado a este funcionário do RH. */
  private async pontoEmployeeId(ctx: EmployeeContext): Promise<string | null> {
    const found = await this.prisma.runWithContext(ADMIN, (tx) => tx.pontoEmployee.findFirst({ where: { hrEmployeeId: ctx.employeeId, organizationId: ctx.organizationId }, select: { id: true } }));
    if (found) return found.id;
    const e = await this.prisma.runWithContext(ADMIN, (tx) => tx.employee.findFirst({ where: { id: ctx.employeeId }, select: { id: true, name: true, cpf: true, roleTitle: true, storeId: true, userId: true, status: true } }));
    if (!e) return null;
    await this.ponto.syncFromHr(ctx.organizationId, { id: e.id, name: e.name, cpf: e.cpf, roleTitle: e.roleTitle, storeId: e.storeId, userId: e.userId, status: e.status }).catch(() => undefined);
    const created = await this.prisma.runWithContext(ADMIN, (tx) => tx.pontoEmployee.findFirst({ where: { hrEmployeeId: ctx.employeeId, organizationId: ctx.organizationId }, select: { id: true } }));
    return created?.id ?? null;
  }

  /** Painel inicial do funcionário: ficha + estado do dia + pendências. */
  async me(ctx: EmployeeContext) {
    const e = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.employee.findFirst({ where: { id: ctx.employeeId } }),
    );
    if (!e) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado", 404);

    // batidas de hoje (UTC day)
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400_000);
    const todayEntries = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.timeEntry.findMany({
        where: { employeeId: ctx.employeeId, happenedAt: { gte: dayStart, lt: dayEnd } },
        orderBy: { happenedAt: "asc" },
      }),
    );
    const lastKind = todayEntries.length ? todayEntries[todayEntries.length - 1]!.kind : null;

    // próximos turnos — escala OFICIAL (PontoSchedule). Fallback p/ WorkShift (dados antigos).
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    const fromIso = dayStart.toISOString().slice(0, 10);
    const toIso = new Date(dayStart.getTime() + 13 * 86400_000).toISOString().slice(0, 10);
    let shifts: any[] = [];
    if (empId) {
      const sch = await this.jornada.scheduleShifts(this.orgCtx(ctx), empId, fromIso, toIso).catch(() => []);
      shifts = sch.map((s) => ({ id: `sch-${s.date}`, shiftDate: `${s.date}T00:00:00Z`, startTime: s.startTime, endTime: s.endTime, lunchStart: s.lunchStart, lunchEnd: s.lunchEnd, breakMinutes: 0 }));
    }
    if (shifts.length === 0) {
      shifts = await this.prisma.runWithContext(ADMIN, (tx) =>
        tx.workShift.findMany({ where: { employeeId: ctx.employeeId, shiftDate: { gte: dayStart } }, orderBy: { shiftDate: "asc" }, take: 14 }),
      );
    }
    // mural (org, e loja específica do funcionário ou geral)
    const notices = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.hrNotice.findMany({
        where: { organizationId: ctx.organizationId, OR: [{ storeId: null }, ...(e.storeId ? [{ storeId: e.storeId }] : [])] },
        orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
        take: 20,
      }),
    );

    // geocerca da loja base (pro portal indicar se está dentro do raio)
    let geofence: { lat: number; lng: number; radiusM: number } | null = null;
    if (e.storeId) {
      const store = await this.prisma.runWithContext(ADMIN, (tx) =>
        tx.store.findFirst({ where: { id: e.storeId! }, select: { geoLat: true, geoLng: true, geoRadiusM: true } }),
      );
      if (store?.geoLat != null && store?.geoLng != null && store?.geoRadiusM != null) {
        geofence = { lat: store.geoLat, lng: store.geoLng, radiusM: store.geoRadiusM };
      }
    }

    // branding da empresa (logo + cor) pro portal do funcionário
    const org = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true, logoUrl: true, primaryColor: true } }),
    );

    // config de lanche (hora extra → lanche) da empresa
    const settings = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.hrSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { snackThresholdMinutes: true, snackMinutes: true } }),
    );

    // turno de hoje (com horário fixo de almoço) + próxima batida sugerida
    const todayKey = dayStart.toISOString().slice(0, 10);
    const todayShift = shifts.find((s) => new Date(s.shiftDate).toISOString().slice(0, 10) === todayKey) ?? null;
    const doneKinds = new Set(todayEntries.map((t) => t.kind));
    let nextKind: "in" | "break_out" | "break_in" | "out" | "done";
    if (!doneKinds.has("in")) nextKind = "in";
    else if (!doneKinds.has("break_out") && (todayShift?.lunchStart || (todayShift?.breakMinutes ?? 0) > 0)) nextKind = "break_out";
    else if (doneKinds.has("break_out") && !doneKinds.has("break_in")) nextKind = "break_in";
    else if (!doneKinds.has("out")) nextKind = "out";
    else nextKind = "done";
    // pode registrar lanche depois de iniciar a jornada e antes de encerrar
    const canSnack = doneKinds.has("in") && !doneKinds.has("out");

    return {
      geofence,
      brand: org ? { name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor } : null,
      snack: { thresholdMinutes: settings?.snackThresholdMinutes ?? 120, minutes: settings?.snackMinutes ?? 15 },
      todayShift: todayShift ? { startTime: todayShift.startTime, endTime: todayShift.endTime, lunchStart: todayShift.lunchStart, lunchEnd: todayShift.lunchEnd, breakMinutes: todayShift.breakMinutes } : null,
      nextKind,
      canSnack,
      employee: {
        id: e.id, name: e.name, cpf: e.cpf, roleTitle: e.roleTitle,
        admissionDate: e.admissionDate, salaryCents: e.salaryCents != null ? Number(e.salaryCents) : null,
        photoUrl: e.photoUrl, email: e.email, phone: e.phone, whatsappPhone: e.whatsappPhone,
        addressLine: e.addressLine, addressNumber: e.addressNumber, addressComplement: e.addressComplement,
        neighborhood: e.neighborhood, city: e.city, state: e.state, postalCode: e.postalCode,
        storeId: e.storeId, mustResetPassword: e.mustResetPassword,
      },
      todayEntries,
      lastKind,
      shifts,
      notices,
    };
  }

  async updateProfile(ctx: EmployeeContext, input: { phone?: string | null; whatsappPhone?: string | null; email?: string | null; photoUrl?: string | null;
    addressLine?: string | null; addressNumber?: string | null; addressComplement?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null; postalCode?: string | null }) {
    const data: Record<string, unknown> = {};
    for (const k of ["phone", "whatsappPhone", "email", "photoUrl", "addressLine", "addressNumber", "addressComplement", "neighborhood", "city", "state", "postalCode"] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    await this.prisma.runWithContext(ADMIN, (tx) => tx.employee.update({ where: { id: ctx.employeeId }, data }));
    return { ok: true };
  }

  // ---- PONTO ----
  async clockIn(ctx: EmployeeContext, input: { kind: "in" | "out" | "break_in" | "break_out" | "snack_out" | "snack_in"; selfieUrl?: string | null; lat?: number | null; lng?: number | null; accuracyM?: number | null; ip?: string | null }) {
    // geocerca: distância até a loja base (sinaliza, não bloqueia)
    let outOfRange = false;
    let distanceM: number | null = null;
    if (ctx.storeId && input.lat != null && input.lng != null) {
      const store = await this.prisma.runWithContext(ADMIN, (tx) =>
        tx.store.findFirst({ where: { id: ctx.storeId! }, select: { geoLat: true, geoLng: true, geoRadiusM: true } }),
      );
      if (store?.geoLat != null && store?.geoLng != null && store?.geoRadiusM != null) {
        distanceM = haversineMeters(input.lat, input.lng, store.geoLat, store.geoLng);
        outOfRange = distanceM > store.geoRadiusM;
      }
    }
    const entry = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.timeEntry.create({
        data: {
          organizationId: ctx.organizationId,
          employeeId: ctx.employeeId,
          storeId: ctx.storeId,
          kind: input.kind,
          selfieUrl: input.selfieUrl ?? null,
          ipAddress: input.ip ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          accuracyM: input.accuracyM ?? null,
          outOfRange,
          distanceM,
          source: "portal",
        },
      }),
    );
    // Registro OFICIAL no ponto eletrônico (REP-A): garante o vínculo (provisiona se faltar) e bate.
    await this.pontoEmployeeId(ctx).catch(() => null);
    await this.ponto.punchByHrEmployee(ctx.organizationId, ctx.employeeId, {
      origin: "web", lat: input.lat ?? undefined, lng: input.lng ?? undefined, accuracy: input.accuracyM ?? undefined, photoUrl: input.selfieUrl ?? undefined,
    }, input.ip ?? null).catch(() => undefined);
    return { entry, outOfRange, distanceM };
  }

  async myTimeEntries(ctx: EmployeeContext, opts: { from?: string; to?: string }) {
    const from = opts.from ? new Date(opts.from + "T00:00:00Z") : new Date(Date.now() - 30 * 86400_000);
    const to = opts.to ? new Date(opts.to + "T23:59:59Z") : new Date();
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.timeEntry.findMany({ where: { employeeId: ctx.employeeId, happenedAt: { gte: from, lte: to } }, orderBy: { happenedAt: "desc" }, take: 1000 }),
    );
  }

  async myTimeSheets(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.timeSheet.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { refMonth: "desc" }, take: 24 }),
    );
  }

  /** Funcionário assina o espelho de ponto do mês. */
  async signTimeSheet(ctx: EmployeeContext, id: string, input: { signatureImageUrl: string; ip?: string | null }) {
    const ts = await this.prisma.runWithContext(ADMIN, (tx) => tx.timeSheet.findFirst({ where: { id, employeeId: ctx.employeeId } }));
    if (!ts) throw new AppError(ErrorCode.NotFound, "Espelho não encontrado", 404);
    if (ts.status === "signed") throw new AppError(ErrorCode.Conflict, "Espelho já assinado", 409);
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.timeSheet.update({ where: { id }, data: { status: "signed", signedAt: new Date(), signatureImageUrl: input.signatureImageUrl, signerIp: input.ip ?? null } }),
    );
  }

  /** PDF do espelho de ponto (mesmo layout branded do admin) pro funcionário baixar/imprimir. */
  async timeSheetHtml(ctx: EmployeeContext, id: string): Promise<string> {
    const ts = await this.prisma.runWithContext(ADMIN, (tx) => tx.timeSheet.findFirst({ where: { id, employeeId: ctx.employeeId } }));
    if (!ts) throw new AppError(ErrorCode.NotFound, "Espelho não encontrado", 404);
    const [emp, org, settings] = await Promise.all([
      this.prisma.runWithContext(ADMIN, (tx) => tx.employee.findFirst({ where: { id: ctx.employeeId }, select: { name: true, cpf: true, roleTitle: true } })),
      this.prisma.runWithContext(ADMIN, (tx) => tx.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true, logoUrl: true, primaryColor: true, document: true } })),
      this.prisma.runWithContext(ADMIN, (tx) => tx.hrSettings.findUnique({ where: { organizationId: ctx.organizationId } })),
    ]);
    return buildTimeSheetHtml({
      brandName: org?.name ?? "Empresa", brandDoc: org?.document ?? null, logoUrl: org?.logoUrl ?? null, color: org?.primaryColor ?? "#7c3aed",
      employeeName: emp?.name ?? "Funcionário", employeeCpf: emp?.cpf ?? null, roleTitle: emp?.roleTitle ?? null,
      refMonth: ts.refMonth, paymentDay: Number((settings as any)?.paymentDay ?? 5),
      summary: (ts.summary ?? {}) as any, status: ts.status, signedAt: ts.signedAt, signatureImageUrl: ts.signatureImageUrl,
    });
  }

  // ---- HOLERITE ----
  async myPayslips(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.payslip.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { refMonth: "desc" }, take: 36 }),
    );
  }

  /** Dá ciência (assinatura) no holerite. */
  async acknowledgePayslip(ctx: EmployeeContext, id: string, input: { signatureImageUrl?: string | null; ip?: string | null }) {
    const p = await this.prisma.runWithContext(ADMIN, (tx) => tx.payslip.findFirst({ where: { id, employeeId: ctx.employeeId } }));
    if (!p) throw new AppError(ErrorCode.NotFound, "Holerite não encontrado", 404);
    if (p.acknowledgedAt) return { ok: true, already: true };
    await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.payslip.update({ where: { id }, data: { acknowledgedAt: new Date(), signatureImageUrl: input.signatureImageUrl ?? null, signerIp: input.ip ?? null } }),
    );
    return { ok: true };
  }

  // ---- SOLICITAÇÕES ----
  async myRequests(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.hrRequest.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { createdAt: "desc" }, take: 200 }),
    );
  }

  async createRequest(ctx: EmployeeContext, input: { kind: "vacation" | "advance" | "shift_swap" | "absence_justify" | "expense"; payload?: Record<string, unknown>; amountCents?: number | null; attachmentUrl?: string | null }) {
    // AJUSTE DE PONTO (justificar ausência): vai DIRETO pro Ponto Eletrônico
    // (PontoJustification), não pro RH — o gestor aprova/ajusta na aba
    // Solicitações do Ponto. Cria uma justificativa "falta" por dia do período.
    // Se o funcionário não estiver vinculado ao ponto, cai no fluxo antigo (RH).
    if (input.kind === "absence_justify") {
      const empId = await this.pontoEmployeeId(ctx).catch(() => null);
      if (empId) {
        const p = (input.payload ?? {}) as Record<string, unknown>;
        const fromIso = String(p.from ?? "").slice(0, 10);
        const toIso = (String(p.to ?? "").slice(0, 10)) || fromIso;
        if (!fromIso) throw new AppError(ErrorCode.ValidationFailed, "Informe a data da ausência", 400);
        const reason = String(p.reason ?? "Justificativa de ausência").trim() || "Justificativa de ausência";
        const orgCtx = this.orgCtx(ctx);
        const start = new Date(fromIso + "T00:00:00Z");
        const end = new Date((toIso || fromIso) + "T00:00:00Z");
        let firstId: string | null = null;
        let n = 0;
        for (let d = new Date(start); d <= end && n < 60; d.setUTCDate(d.getUTCDate() + 1), n++) {
          const r = await this.jornada.createJustification(orgCtx, { employeeId: empId, day: d.toISOString().slice(0, 10), kind: "falta", reason, attachmentUrl: input.attachmentUrl ?? undefined });
          if (!firstId) firstId = r.id;
        }
        return { id: firstId, routedTo: "ponto" } as any;
      }
      // sem vínculo no ponto → mantém no RH (fluxo antigo abaixo)
    }
    // teto do vale ≤ 40% do salário (validação na criação também)
    if (input.kind === "advance" && input.amountCents != null) {
      const e = await this.prisma.runWithContext(ADMIN, (tx) => tx.employee.findFirst({ where: { id: ctx.employeeId }, select: { salaryCents: true } }));
      const salary = Number(e?.salaryCents ?? 0n);
      if (salary > 0 && input.amountCents > Math.round(salary * 0.4)) {
        throw new AppError(ErrorCode.ValidationFailed, "Vale acima de 40% do salário", 400);
      }
    }
    // troca de horário exige aceite do colega (B) antes da gestão
    const colleagueDecision = input.kind === "shift_swap" ? "pending" : "na";
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.hrRequest.create({
        data: {
          organizationId: ctx.organizationId,
          employeeId: ctx.employeeId,
          kind: input.kind,
          payload: (input.payload ?? {}) as any,
          amountCents: input.amountCents != null ? BigInt(input.amountCents) : null,
          attachmentUrl: input.attachmentUrl ?? null,
          status: "pending",
          colleagueDecision,
        },
      }),
    );
  }

  /** Trocas de horário em que ESTE funcionário é o colega (B) e precisa aceitar. */
  async swapsToAccept(ctx: EmployeeContext) {
    const reqs = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.hrRequest.findMany({
        where: { organizationId: ctx.organizationId, kind: "shift_swap", status: "pending", colleagueDecision: "pending" },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    const mine = reqs.filter((r) => (r.payload as any)?.withEmployeeId === ctx.employeeId);
    if (mine.length === 0) return [];
    const aIds = [...new Set(mine.map((r) => r.employeeId))];
    const emps = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.employee.findMany({ where: { id: { in: aIds } }, select: { id: true, name: true } }),
    );
    const em = new Map(emps.map((e) => [e.id, e.name]));
    return mine.map((r) => ({ id: r.id, requesterName: em.get(r.employeeId) ?? "Colega", date: (r.payload as any)?.date ?? null, reason: (r.payload as any)?.reason ?? null, createdAt: r.createdAt }));
  }

  /** Colega (B) aceita ou recusa a troca. Recusa cancela a solicitação. */
  async decideSwap(ctx: EmployeeContext, id: string, accept: boolean) {
    const r = await this.prisma.runWithContext(ADMIN, (tx) => tx.hrRequest.findFirst({ where: { id } }));
    if (!r || r.kind !== "shift_swap") throw new AppError(ErrorCode.NotFound, "Troca não encontrada", 404);
    if ((r.payload as any)?.withEmployeeId !== ctx.employeeId) throw new AppError(ErrorCode.Forbidden, "Você não é o colega desta troca", 403);
    if (r.colleagueDecision !== "pending" || r.status !== "pending") throw new AppError(ErrorCode.Conflict, "Troca já decidida", 409);
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.hrRequest.update({
        where: { id },
        data: accept
          ? { colleagueDecision: "accepted", colleagueDecidedAt: new Date() }
          : { colleagueDecision: "rejected", colleagueDecidedAt: new Date(), status: "rejected" },
      }),
    );
  }

  async cancelRequest(ctx: EmployeeContext, id: string) {
    const r = await this.prisma.runWithContext(ADMIN, (tx) => tx.hrRequest.findFirst({ where: { id, employeeId: ctx.employeeId } }));
    if (!r) throw new AppError(ErrorCode.NotFound, "Solicitação não encontrada", 404);
    if (r.status !== "pending") throw new AppError(ErrorCode.Conflict, "Só dá pra cancelar pendentes", 409);
    return this.prisma.runWithContext(ADMIN, (tx) => tx.hrRequest.update({ where: { id }, data: { status: "canceled" } }));
  }

  /** Colegas da mesma empresa (pra troca de horário). */
  async coworkers(ctx: EmployeeContext) {
    const list = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.employee.findMany({
        where: { organizationId: ctx.organizationId, status: "active", id: { not: ctx.employeeId } },
        select: { id: true, name: true, storeId: true },
        orderBy: { name: "asc" },
      }),
    );
    return list;
  }

  /** Turnos de um colega numa data (pra A escolher qual turno quer assumir). */
  async coworkerShifts(ctx: EmployeeContext, withEmployeeId: string, date: string) {
    const day = new Date(date + "T00:00:00Z");
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.workShift.findMany({
        where: { organizationId: ctx.organizationId, employeeId: withEmployeeId, shiftDate: day },
        select: { id: true, startTime: true, endTime: true },
      }),
    );
  }

  // ---- PONTO: espelho do mês + justificativas (OFICIAL — ponto eletrônico) ----
  /** Espelho do mês do próprio funcionário, derivado do ponto OFICIAL (escala × batidas × justificativa). */
  async attendanceMonth(ctx: EmployeeContext, month: string) {
    const ref = /^\d{4}-\d{2}$/.test(month) ? new Date(month + "-01T00:00:00Z") : new Date();
    const y = ref.getUTCFullYear(); const m = ref.getUTCMonth();
    const fromIso = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const toIso = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    if (!empId) return { period: { from: fromIso, to: toIso }, days: [], totals: null, note: "Sem vínculo no ponto eletrônico." };
    const esp = await this.jornada.espelho(this.orgCtx(ctx), { employeeId: empId, from: fromIso, to: toIso });
    const today = new Date().toISOString().slice(0, 10);
    const days = (esp.days as any[]).map((d) => {
      const punches: string[] = d.punches ?? [];
      const hasP = punches.length > 0;
      const js: any[] = d.justifications ?? [];
      const approved = js.find((j) => j.status === "approved");
      const pending = js.find((j) => j.status === "pending");
      const isAtestado = (j: any) => j && (j.kind === "abono" || j.kind === "falta" || j.kind === "atestado");
      let status: "worked" | "agendado" | "falta" | "atestado" | "folga";
      if (approved && isAtestado(approved)) status = "atestado";
      else if (hasP && d.workedMin > 0) status = "worked";
      else if (!d.isWorkDay) status = "folga";
      else if (d.day > today) status = "agendado";
      else if (d.faltaMin > 0) status = approved ? "atestado" : "falta";
      else status = "agendado";
      const jr = approved ?? pending ?? js[0];
      return {
        date: d.day, status,
        shift: d.isWorkDay && d.shiftStart ? { start: d.shiftStart, end: d.shiftEnd } : null,
        marks: hasP ? { in: punches[0], out: punches.length > 1 ? punches[punches.length - 1] : null } : null,
        justification: jr ? { status: jr.status, kind: jr.kind } : null,
        incomplete: !!d.incomplete, divergence: !!d.divergence,
        hm: d.hm ?? null,
      };
    });
    return { period: esp.period, days, totals: esp.totals };
  }

  async listJustifications(ctx: EmployeeContext) {
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    if (!empId) return [];
    const { items } = await this.jornada.listJustifications(this.orgCtx(ctx), { employeeId: empId });
    return items;
  }

  /** Funcionário justifica um dia no ponto OFICIAL: esqueceu de bater (propõe horários), atestado (upload + dias) ou abono. */
  async createJustification(ctx: EmployeeContext, input: { refDate: string; kind: "forgot_punch" | "medical" | "other"; proposed?: Record<string, string> | null; attachmentUrl?: string | null; daysCount?: number; note?: string | null }) {
    if (input.kind === "medical" && !input.attachmentUrl) throw new AppError(ErrorCode.ValidationFailed, "Anexe o atestado", 400);
    if (input.kind === "forgot_punch" && (!input.proposed || !input.proposed.in)) throw new AppError(ErrorCode.ValidationFailed, "Informe ao menos o horário de entrada", 400);
    const empId = await this.pontoEmployeeId(ctx);
    if (!empId) throw new AppError(ErrorCode.NotFound, "Funcionário não vinculado ao ponto", 404);
    const orgCtx = this.orgCtx(ctx);
    const days = Math.max(1, Math.min(60, input.daysCount ?? 1));
    // mapeia para os tipos do ponto oficial (PontoJustification)
    if (input.kind === "medical") {
      // atestado: cria uma justificativa "abono" por dia coberto
      const base = new Date(input.refDate + "T00:00:00Z");
      const reason = `Atestado médico${days > 1 ? ` (${days} dia(s))` : ""}${input.note ? ` — ${input.note}` : ""}`;
      let firstId: string | null = null;
      for (let i = 0; i < days; i++) {
        const day = new Date(base); day.setUTCDate(day.getUTCDate() + i);
        const r = await this.jornada.createJustification(orgCtx, { employeeId: empId, day: day.toISOString().slice(0, 10), kind: "abono", reason, attachmentUrl: input.attachmentUrl ?? undefined });
        if (!firstId) firstId = r.id;
      }
      return { id: firstId };
    }
    if (input.kind === "forgot_punch") {
      const p = input.proposed ?? {};
      const lbl: Record<string, string> = { in: "entrada", break_in: "saída p/ intervalo", break_out: "retorno do intervalo", out: "saída" };
      const horarios = ["in", "break_in", "break_out", "out"].map((k) => (p[k] ? `${lbl[k]} ${p[k]}` : null)).filter(Boolean).join(", ");
      const reason = `Esqueci de bater. Horários propostos: ${horarios}${input.note ? ` — ${input.note}` : ""}`;
      // kind "ajuste": guarda os horários estruturados; ao APROVAR vira batida no espelho.
      return this.jornada.createJustification(orgCtx, { employeeId: empId, day: input.refDate, kind: "ajuste", reason, proposed: p });
    }
    return this.jornada.createJustification(orgCtx, { employeeId: empId, day: input.refDate, kind: "outro", reason: input.note || "Justificativa" });
  }

  // ---- COMISSÕES (repasse pago que aparece pro funcionário) ----
  /** Comissões do funcionário: payouts do usuário vinculado (status pago e pendente). */
  async myCommissions(ctx: EmployeeContext) {
    const e = await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.employee.findFirst({ where: { id: ctx.employeeId }, select: { userId: true } }),
    );
    if (!e?.userId) return [];
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.commissionPayout.findMany({
        where: { sellerUserId: e.userId!, organizationId: ctx.organizationId },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    );
  }

  // ---- DOCUMENTOS ----
  async myDocuments(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.employeeDocument.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { createdAt: "desc" } }),
    );
  }

  async addOwnDocument(ctx: EmployeeContext, input: { docType: string; title?: string | null; fileUrl: string }) {
    return this.prisma.runWithContext(ADMIN, (tx) =>
      tx.employeeDocument.create({
        data: { organizationId: ctx.organizationId, employeeId: ctx.employeeId, docType: input.docType, title: input.title ?? null, fileUrl: input.fileUrl, uploadedBy: "employee", status: "pending" },
      }),
    );
  }

  // ---- PONTO: pedir correção de uma batida (vira justificativa OFICIAL pendente de supervisão) ----
  async requestTimeEdit(ctx: EmployeeContext, entryId: string, input: { requestedTo: string; reason: string }) {
    const e = await this.prisma.runWithContext(ADMIN, (tx) => tx.timeEntry.findFirst({ where: { id: entryId, employeeId: ctx.employeeId } }));
    if (!e) throw new AppError(ErrorCode.NotFound, "Batida não encontrada", 404);
    if (e.editStatus === "pending") throw new AppError(ErrorCode.Conflict, "Já há um pedido de correção pendente", 409);
    // marca o pedido no log do portal (UI) ...
    await this.prisma.runWithContext(ADMIN, (tx) =>
      tx.timeEntry.update({ where: { id: entryId }, data: { editStatus: "pending", editRequestedTo: new Date(input.requestedTo), editReason: input.reason, editRequestedAt: new Date() } }),
    );
    // ... e abre a justificativa OFICIAL pro gestor revisar no ponto eletrônico.
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    if (empId) {
      const when = new Date(input.requestedTo);
      const dayIso = when.toISOString().slice(0, 10);
      const hhmm = when.toISOString().slice(11, 16);
      await this.jornada.createJustification(this.orgCtx(ctx), { employeeId: empId, day: dayIso, kind: "outro", reason: `Correção de batida para ${hhmm} — ${input.reason}` }).catch(() => undefined);
    }
    return { ok: true };
  }

  // ---- ESPELHO ASSINADO (oficial) ----
  async myEspelhoSignature(ctx: EmployeeContext, month: string) {
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    if (!empId) return { signature: null, closing: { status: "open" }, canSign: false };
    const signature = await this.jornada.espelhoSignature(this.orgCtx(ctx), empId, month);
    // Status do fechamento daquele mês: só dá pra assinar quando o RH FECHOU
    // (status === "closed"). Evita o funcionário assinar o mês corrente por
    // engano (caso real reportado: assinou junho enquanto só maio estava
    // fechado). Como o funcionário não é admin, faz a query direta aqui.
    const m = String(month || "").slice(0, 7);
    const closing = m && /^\d{4}-\d{2}$/.test(m)
      ? await this.prisma.runWithContext(ADMIN, (tx) =>
          tx.pontoClosing.findFirst({
            where: { organizationId: ctx.organizationId, refMonth: new Date(`${m}-01T00:00:00Z`) },
            select: { status: true, hrAt: true },
          }),
        ).catch(() => null)
      : null;
    const status = closing?.status ?? "open";
    return { signature, closing: { status, hrAt: closing?.hrAt ?? null }, canSign: status === "closed" && !signature };
  }
  async signMyEspelho(ctx: EmployeeContext, month: string, input: { signatureImageUrl?: string | null; ip?: string | null }) {
    const empId = await this.pontoEmployeeId(ctx);
    if (!empId) throw new AppError(ErrorCode.NotFound, "Funcionário não vinculado ao ponto", 404);
    return this.jornada.signEspelho(this.orgCtx(ctx), { employeeId: empId, refMonth: month, signatureImageUrl: input.signatureImageUrl ?? null, ip: input.ip ?? null });
  }
  async myEspelhoPdf(ctx: EmployeeContext, month: string) {
    const empId = await this.pontoEmployeeId(ctx);
    if (!empId) throw new AppError(ErrorCode.NotFound, "Funcionário não vinculado ao ponto", 404);
    return this.jornada.espelhoSignedPdf(this.orgCtx(ctx), empId, month);
  }

  // ---- BANCO DE HORAS (extrato do próprio funcionário) ----
  async myBank(ctx: EmployeeContext) {
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    if (!empId) return { items: [], balanceMin: 0 };
    const rows = await this.prisma.runWithContext(ADMIN, (tx) => tx.pontoBankMovement.findMany({ where: { employeeId: empId }, orderBy: { day: "desc" }, take: 300 }));
    return { items: rows, balanceMin: rows.reduce((s, r) => s + r.minutes, 0) };
  }

  // ---- FÉRIAS (saldo + lista do próprio funcionário) ----
  async myVacations(ctx: EmployeeContext) {
    const empId = await this.pontoEmployeeId(ctx).catch(() => null);
    if (!empId) return { items: [], balance: null };
    const [emp, vacs] = await Promise.all([
      this.prisma.runWithContext(ADMIN, (tx) => tx.employee.findFirst({ where: { id: ctx.employeeId }, select: { admissionDate: true } })),
      this.prisma.runWithContext(ADMIN, (tx) => tx.pontoVacation.findMany({ where: { employeeId: empId }, orderBy: { startDate: "desc" }, take: 100 })),
    ]);
    const used = vacs.filter((v) => v.status !== "canceled").reduce((s, v) => s + v.days, 0);
    let balance: any = { admissionDate: null, accruedDays: null, usedDays: used, balanceDays: null, nextPeriodStart: null };
    if (emp?.admissionDate) {
      const adm = emp.admissionDate; const now = new Date();
      const months = (now.getUTCFullYear() - adm.getUTCFullYear()) * 12 + (now.getUTCMonth() - adm.getUTCMonth()) - (now.getUTCDate() < adm.getUTCDate() ? 1 : 0);
      const periods = Math.max(0, Math.floor(months / 12));
      const accrued = periods * 30;
      const next = new Date(Date.UTC(adm.getUTCFullYear() + periods + 1, adm.getUTCMonth(), adm.getUTCDate()));
      balance = { admissionDate: adm.toISOString().slice(0, 10), accruedDays: accrued, usedDays: used, balanceDays: accrued - used, nextPeriodStart: next.toISOString().slice(0, 10) };
    }
    return { items: vacs, balance };
  }

  // ---- EXAMES OCUPACIONAIS (ASO) — leitura ----
  async myExams(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) => tx.employeeExam.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { examDate: "desc" }, take: 50 }));
  }

  // ---- TREINAMENTOS / CERTIFICAÇÕES — leitura ----
  async myTrainings(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) => tx.employeeTraining.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { completedDate: "desc" }, take: 50 }));
  }

  // ---- ADVERTÊNCIAS — leitura + ciência ----
  async myWarnings(ctx: EmployeeContext) {
    return this.prisma.runWithContext(ADMIN, (tx) => tx.employeeWarning.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { date: "desc" }, take: 100 }));
  }
  async acknowledgeWarning(ctx: EmployeeContext, id: string, input: { signatureImageUrl?: string | null }) {
    const w = await this.prisma.runWithContext(ADMIN, (tx) => tx.employeeWarning.findFirst({ where: { id, employeeId: ctx.employeeId } }));
    if (!w) throw new AppError(ErrorCode.NotFound, "Advertência não encontrada", 404);
    if (w.acknowledgedAt) return { ok: true, already: true };
    await this.prisma.runWithContext(ADMIN, (tx) => tx.employeeWarning.update({ where: { id }, data: { acknowledgedAt: new Date(), ackSignatureUrl: input.signatureImageUrl ?? null } }));
    return { ok: true };
  }

  // ---- EMPRÉSTIMOS (acompanhamento, tipo crediário) ----
  async myLoans(ctx: EmployeeContext) {
    const loans = await this.prisma.runWithContext(ADMIN, (tx) => tx.employeeLoan.findMany({ where: { employeeId: ctx.employeeId }, orderBy: { createdAt: "desc" } }));
    const insts = loans.length
      ? await this.prisma.runWithContext(ADMIN, (tx) => tx.employeeLoanInstallment.findMany({ where: { loanId: { in: loans.map((l) => l.id) } }, orderBy: { number: "asc" } }))
      : [];
    return loans.map((l) => ({ ...l, installments: insts.filter((i) => i.loanId === l.id) }));
  }
}
