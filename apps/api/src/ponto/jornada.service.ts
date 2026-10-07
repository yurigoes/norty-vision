import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { createHash } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { EmailService } from "../notifications/email.service";
import { buildBrandedEmail } from "../notifications/template-render";
import { StorageService } from "../storage/storage.service";
import { PontoSignService } from "./sign.service";
import { PontoService } from "./ponto.service";
import type { RequestContext } from "../auth/session.middleware";

type Seg = [number, number]; // [entrada, saida] em minutos do dia (saida pode passar de 1440)

/**
 * Motor de jornada (Fase 1): a partir das marcações imutáveis + escala, DERIVA
 * (sem nunca alterar a marcação) horas normais/extras, atraso, saída antecipada,
 * falta, adicional noturno e saldo do dia. Gera o espelho de ponto e a lista de
 * divergências, e gerencia justificativas com aprovação do gestor.
 */
@Injectable()
export class JornadaService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService, private readonly storage: StorageService, private readonly sign: PontoSignService, private readonly email: EmailService, private readonly ponto: PontoService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext) { if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas gestor", 403); }
  private offMin(tz: string) { const s = tz.startsWith("-") ? -1 : 1; return s * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))); }
  /** Componentes locais (data ISO + minutos do dia) de um instante, no fuso. */
  private local(date: Date, tz: string) {
    const d = new Date(date.getTime() + this.offMin(tz) * 60000);
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    return { day, min: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() };
  }
  private hhmm(s: string): number { const [h, m] = (s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); }
  private fmtHM(min: number): string { const a = Math.abs(Math.round(min)); return `${min < 0 ? "-" : ""}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`; }
  /** Minuto-do-dia → "HH:MM" (relógio, normaliza para 0–1439). */
  private fmtClock(min: number): string { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }

  /** Turnos esperados (escala) de um ponto-employee num período — usado pelo portal do funcionário. */
  async scheduleShifts(ctx: RequestContext, employeeId: string, fromIso: string, toIso: string) {
    this.requireOrg(ctx);
    const rls = this.rls(ctx);
    const emp = await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployee.findFirst({ where: { id: employeeId }, select: { scheduleCode: true } }));
    if (!emp?.scheduleCode) return [] as Array<{ date: string; startTime: string; endTime: string; lunchStart: string | null; lunchEnd: string | null }>;
    const schedule = await this.prisma.runWithContext(rls, (tx) => tx.pontoSchedule.findFirst({ where: { code: emp.scheduleCode! } }));
    if (!schedule) return [];
    const out: Array<{ date: string; startTime: string; endTime: string; lunchStart: string | null; lunchEnd: string | null }> = [];
    const fromD = new Date(fromIso + "T00:00:00Z"); const toD = new Date(toIso + "T00:00:00Z");
    for (let t = fromD.getTime(); t <= toD.getTime(); t += 86400000) {
      const d = new Date(t); const dayIso = d.toISOString().slice(0, 10); const wd = d.getUTCDay();
      const segs = this.expectedSegments(schedule, dayIso, wd);
      if (!segs.length) continue;
      out.push({
        date: dayIso, startTime: this.fmtClock(segs[0]![0]), endTime: this.fmtClock(segs[segs.length - 1]![1]),
        lunchStart: segs.length > 1 ? this.fmtClock(segs[0]![1]) : null, lunchEnd: segs.length > 1 ? this.fmtClock(segs[1]![0]) : null,
      });
    }
    return out;
  }

  // ----- ESCALAS (CRUD) -----
  async listSchedules(ctx: RequestContext) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoSchedule.findMany({ where: {}, orderBy: { name: "asc" } }));
  }
  async upsertSchedule(ctx: RequestContext, input: { id?: string; code: string; name: string; kind?: string; toleranceMin?: number; nightStart?: string; nightEnd?: string; pattern?: any; active?: boolean; holidayPolicy?: string; holidayPay?: string }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.code?.trim() || !input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Código e nome obrigatórios", 400);
    const data: any = {
      code: input.code.trim(), name: input.name.trim(),
      kind: ["12x36", "plantao", "intermitente", "home_office"].includes(input.kind ?? "") ? input.kind! : "fixa",
      toleranceMin: Math.max(0, Math.min(60, input.toleranceMin ?? 10)),
      nightStart: input.nightStart || "22:00", nightEnd: input.nightEnd || "05:00",
      holidayPolicy: ["folga", "trabalha", "alterna"].includes(input.holidayPolicy ?? "") ? input.holidayPolicy! : "folga",
      holidayPay: ["normal", "dobro", "folga_comp"].includes(input.holidayPay ?? "") ? input.holidayPay! : "normal",
      pattern: input.pattern ?? {}, active: input.active ?? true,
    };
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.pontoSchedule.update({ where: { id: input.id }, data }) : tx.pontoSchedule.create({ data: { organizationId: orgId, ...data } }),
    );
    return { id: row.id };
  }

  // ----- ATRIBUIÇÃO EM MASSA -----
  /** Aplica uma escala (scheduleCode) a vários funcionários de uma vez. "" remove a escala. */
  async assignSchedule(ctx: RequestContext, input: { scheduleCode: string; employeeIds: string[] }) {
    this.requireAdmin(ctx);
    const code = (input.scheduleCode || "").trim();
    const ids = (input.employeeIds || []).filter(Boolean);
    if (!ids.length) throw new AppError(ErrorCode.ValidationFailed, "Selecione ao menos um funcionário", 400);
    if (code) {
      const sch = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoSchedule.findFirst({ where: { code }, select: { id: true } }));
      if (!sch) throw new AppError(ErrorCode.ValidationFailed, "Escala não encontrada", 400);
    }
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.updateMany({ where: { id: { in: ids } }, data: { scheduleCode: code || null } }));
    return { ok: true, updated: r.count };
  }

  // ----- FERIADOS -----
  async listHolidays(ctx: RequestContext) {
    this.requireOrg(ctx);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoHoliday.findMany({ where: {}, orderBy: { day: "asc" }, take: 500 }));
    return { items };
  }
  async upsertHoliday(ctx: RequestContext, input: { id?: string; day: string; name: string; kind?: string; recurring?: boolean; storeId?: string | null }) {
    this.requireAdmin(ctx);
    if (!input.day || !input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Data e nome obrigatórios", 400);
    const data: any = { day: new Date(input.day + "T00:00:00Z"), name: input.name.trim().slice(0, 120), recurring: !!input.recurring, storeId: input.storeId ?? null };
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      input.id ? tx.pontoHoliday.update({ where: { id: input.id }, data }) : tx.pontoHoliday.create({ data: { organizationId: ctx.orgId!, ...data } }),
    );
    return { id: row.id };
  }
  async removeHoliday(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoHoliday.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /** Segmentos esperados (em minutos) de uma escala num dia. [] = folga. */
  private expectedSegments(schedule: any, dayIso: string, wd: number): Seg[] {
    return this.rawPattern(schedule, dayIso, wd).map((s) => this.seg(s));
  }
  /** Segmentos CRUS (["HH:MM","HH:MM"]) esperados pela escala num dia — sem feriado/override. */
  private rawPattern(schedule: any, dayIso: string, wd: number): [string, string][] {
    const p = (schedule?.pattern ?? {}) as any;
    const kind = schedule?.kind;
    if (kind === "intermitente") return []; // sem jornada fixa — só conta o que bater (não há falta)
    if (kind === "home_office") return []; // flexível — esperado vem de durMin (tratado no espelho), sem horário fixo
    if (kind === "12x36") {
      const anchor = p.anchor ? new Date(p.anchor + "T00:00:00Z") : null;
      if (!anchor) return [];
      const days = Math.floor((new Date(dayIso + "T00:00:00Z").getTime() - anchor.getTime()) / 86400000);
      if (((days % 2) + 2) % 2 !== 0) return []; // trabalha em dias pares desde a âncora
      return (p.segments ?? []) as [string, string][];
    }
    if (kind === "plantao") {
      // ciclo: onDays trabalhados + offDays de folga, a partir de uma âncora
      const anchor = p.anchor ? new Date(p.anchor + "T00:00:00Z") : null;
      const on = Math.max(1, Number(p.onDays) || 1), off = Math.max(0, Number(p.offDays) || 0);
      if (!anchor || on + off === 0) return [];
      const days = Math.floor((new Date(dayIso + "T00:00:00Z").getTime() - anchor.getTime()) / 86400000);
      const pos = (((days % (on + off)) + (on + off)) % (on + off));
      if (pos >= on) return []; // dia de folga no ciclo
      return (p.segments ?? []) as [string, string][];
    }
    return (p[String(wd)] ?? []) as [string, string][];
  }
  /** Segmentos crus esperados de um ponto_employee num dia (escala vigente). Para a troca de turno. */
  async rawSegmentsForDay(ctx: RequestContext, pontoEmployeeId: string, dayIso: string): Promise<[string, string][]> {
    const rls = this.rls(ctx);
    const emp = await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployee.findFirst({ where: { id: pontoEmployeeId }, select: { scheduleCode: true } }));
    const schedule = emp?.scheduleCode ? await this.prisma.runWithContext(rls, (tx) => tx.pontoSchedule.findFirst({ where: { code: emp.scheduleCode! } })) : null;
    const wd = new Date(dayIso + "T00:00:00Z").getUTCDay();
    return this.rawPattern(schedule, dayIso, wd);
  }
  /** Minutos-alvo flexíveis (home office): durMinutes nos dias configurados (default seg-sex). */
  private flexTarget(schedule: any, wd: number): number {
    if (schedule?.kind !== "home_office") return 0;
    const p = (schedule?.pattern ?? {}) as any;
    const days: number[] = Array.isArray(p.days) ? p.days : [1, 2, 3, 4, 5];
    return days.includes(wd) ? Math.max(0, Number(p.dailyMinutes) || 480) : 0;
  }
  private seg([ent, sai]: [string, string]): Seg { let a = this.hhmm(ent), b = this.hhmm(sai); if (b <= a) b += 1440; return [a, b]; }

  /** Minutos trabalhados dentro da janela noturna (cruza meia-noite). */
  private nightOverlap(a: number, b: number, ns: number, ne: number): number {
    const windows: Seg[] = [];
    for (let k = -1; k <= 1; k++) {
      if (ns < ne) windows.push([ns + 1440 * k, ne + 1440 * k]);
      else { windows.push([ns + 1440 * k, 1440 + 1440 * k]); windows.push([0 + 1440 * k, ne + 1440 * k]); }
    }
    let sum = 0;
    for (const [ws, we] of windows) sum += Math.max(0, Math.min(b, we) - Math.max(a, ws));
    return sum;
  }

  /** Hora noturna REDUZIDA (CLT art. 73 §1º): 52min30s de relógio = 60min fictos. */
  private nightReduced(nightMin: number, enabled: boolean): number {
    return enabled && nightMin > 0 ? Math.round(nightMin * 60 / 52.5) : nightMin;
  }

  /** Calcula um dia: esperado x trabalhado, atraso, saída antecipada, extra, falta, noturno, saldo. */
  // feriados nacionais fixos (MM-DD) — aplicados a todas as empresas
  private static FIXED_NATIONAL: Record<string, string> = {
    "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho",
    "09-07": "Independência", "10-12": "N. Sra. Aparecida", "11-02": "Finados",
    "11-15": "Proclamação da República", "12-25": "Natal",
  };
  /** Domingo de Páscoa (algoritmo de Meeus/Gregoriano). */
  private easter(year: number): Date {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }
  /** Feriados nacionais MÓVEIS do ano (Carnaval, Sexta-feira Santa, Corpus Christi). */
  private movableNational(year: number): Array<{ iso: string; name: string }> {
    const e = this.easter(year);
    const add = (days: number) => { const x = new Date(e); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
    return [{ iso: add(-47), name: "Carnaval" }, { iso: add(-2), name: "Sexta-feira Santa" }, { iso: add(60), name: "Corpus Christi" }];
  }

  private computeDay(segments: Seg[], punchMins: number[], tol: number, ns: number, ne: number, flexMin = 0, nightRed = true) {
    const pts = [...punchMins].sort((x, y) => x - y);
    let workedMin = 0, nightMin = 0;
    const incomplete = pts.length % 2 !== 0;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const a = pts[i]!; let b = pts[i + 1]!; if (b < a) b += 1440;
      workedMin += b - a;
      nightMin += this.nightOverlap(a, b, ns, ne);
    }
    const nightReducedMin = this.nightReduced(nightMin, nightRed);
    const nightFictaMin = nightReducedMin - nightMin; // "ganho" da hora ficta noturna
    const hasPunches = pts.length > 0;
    // Home office (flex): alvo de minutos no dia, sem horário fixo → sem atraso/saída antecipada.
    if (flexMin > 0 && segments.length === 0) {
      const extraMin = Math.max(0, workedMin - flexMin);
      const faltaMin = hasPunches ? 0 : flexMin;
      return { expectedMin: flexMin, workedMin, nightMin, nightReducedMin, nightFictaMin, lateMin: 0, earlyMin: 0, extraMin, faltaMin, balanceMin: workedMin - flexMin, incomplete, isWorkDay: true, hasPunches };
    }
    const expectedMin = segments.reduce((s, [a, b]) => s + (b - a), 0);
    const isWorkDay = segments.length > 0;
    const firstIn = hasPunches ? pts[0]! : null;
    const lastRaw = hasPunches ? pts[pts.length - 1]! : null;
    const lastOut = lastRaw != null && firstIn != null && !incomplete ? (lastRaw < firstIn ? lastRaw + 1440 : lastRaw) : null;
    const expStart = isWorkDay ? segments[0]![0] : null;
    const expEnd = isWorkDay ? segments[segments.length - 1]![1] : null;
    const lateMin = isWorkDay && firstIn != null && expStart != null ? Math.max(0, firstIn - expStart - tol) : 0;
    const earlyMin = isWorkDay && lastOut != null && expEnd != null ? Math.max(0, expEnd - lastOut - tol) : 0;
    // contagem de atrasos POR SEGMENTO (entrada, volta do almoço, etc.): cada batida de
    // ENTRADA de um segmento que chega após o início esperado + tolerância conta 1 atraso.
    let lateCount = 0;
    if (isWorkDay) {
      for (let i = 0; i < segments.length; i++) {
        const inIdx = 2 * i; if (inIdx >= pts.length) break;
        if (pts[inIdx]! - segments[i]![0] - tol > 0) lateCount++;
      }
    }
    const extraMin = isWorkDay ? Math.max(0, workedMin - expectedMin - tol) : workedMin; // dia de folga: tudo é extra
    const faltaMin = isWorkDay && !hasPunches ? expectedMin : 0;
    const balanceMin = workedMin - expectedMin;
    return { expectedMin, workedMin, nightMin, nightReducedMin, nightFictaMin, lateMin, earlyMin, lateCount, extraMin, faltaMin, balanceMin, incomplete, isWorkDay, hasPunches };
  }

  // ----- ESPELHO DE PONTO -----
  async espelho(ctx: RequestContext, opts: { employeeId: string; from: string; to: string }) {
    this.requireOrg(ctx);
    if (!opts.employeeId || !opts.from || !opts.to) throw new AppError(ErrorCode.ValidationFailed, "employeeId, from e to obrigatórios", 400);
    const rls = this.rls(ctx);
    const emp = await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployee.findFirst({ where: { id: opts.employeeId } }));
    if (!emp) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado", 404);
    const cfg = await this.prisma.runWithContext(rls, (tx) => tx.pontoConfig.findFirst({ where: {}, select: { timezone: true, razaoOuNome: true, nightReducedHour: true, dsrLossEnabled: true } }));
    const tz = cfg?.timezone ?? "-0300";
    const nightRed = cfg?.nightReducedHour ?? true;
    const dsrOn = cfg?.dsrLossEnabled ?? true;
    const schedule = emp.scheduleCode ? await this.prisma.runWithContext(rls, (tx) => tx.pontoSchedule.findFirst({ where: { code: emp.scheduleCode! } })) : null;
    const fromD = new Date(opts.from + "T00:00:00Z"); const toD = new Date(opts.to + "T23:59:59Z");
    const punches = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoPunch.findMany({ where: { employeeId: emp.id, voided: false, punchedAt: { gte: new Date(fromD.getTime() - 86400000), lte: new Date(toD.getTime() + 86400000) } }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }),
    );
    const justs = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoJustification.findMany({ where: { employeeId: emp.id, day: { gte: fromD, lte: toD } }, select: { day: true, kind: true, status: true, reason: true, proposed: true } }),
    );
    // exceções de escala por dia (troca de turno/folga aplicada, ajuste manual)
    const overrideRows = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoScheduleOverride.findMany({ where: { employeeId: emp.id, day: { gte: fromD, lte: toD } }, select: { day: true, kind: true, segments: true, source: true } }),
    ).catch(() => [] as any[]);
    const overrideByDay = new Map<string, any>();
    for (const o of overrideRows) overrideByDay.set(new Date(o.day).toISOString().slice(0, 10), o);
    // afastamentos (INSS/maternidade/acidente…): dias afastados não são falta nem previsto
    const leaveRows = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoLeave.findMany({ where: { employeeId: emp.id, startDate: { lte: toD }, OR: [{ endDate: null }, { endDate: { gte: fromD } }] }, select: { type: true, startDate: true, endDate: true } }),
    ).catch(() => [] as any[]);
    const leaveByDay = new Map<string, string>();
    for (const lv of leaveRows) {
      const s = new Date(lv.startDate); const e = lv.endDate ? new Date(lv.endDate) : toD;
      for (let tt = Math.max(s.getTime(), fromD.getTime()); tt <= Math.min(e.getTime(), toD.getTime()); tt += 86400000) {
        leaveByDay.set(new Date(tt).toISOString().slice(0, 10), lv.type);
      }
    }
    // feriados (aplicáveis: gerais OU da loja do funcionário). Recorrentes batem por dia/mês.
    const holidayRows = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoHoliday.findMany({ where: { OR: [{ storeId: null }, ...(emp.storeId ? [{ storeId: emp.storeId } as any] : [])] }, select: { day: true, name: true, kind: true, recurring: true } }),
    ).catch(() => [] as any[]);
    const holidayByDay = new Map<string, string>();  // "YYYY-MM-DD" → nome
    const holidayByMd = new Map<string, string>();    // "MM-DD" (recorrente) → nome
    for (const h of holidayRows) {
      const iso = new Date(h.day).toISOString().slice(0, 10);
      // "Ponto facultativo" é dia abonado igual a feriado, mas o espelho precisa
      // dizer qual dos dois foi — a contabilidade trata diferente.
      const label = `${(h as any).kind === "facultativo" ? "Ponto facultativo" : "Feriado"}${h.name ? `: ${h.name}` : ""}`;
      if (h.recurring) holidayByMd.set(iso.slice(5), label); else holidayByDay.set(iso, label);
    }
    // feriados NACIONAIS (padrão pra todas as empresas): fixos + móveis (Páscoa)
    for (const [md, name] of Object.entries(JornadaService.FIXED_NATIONAL)) if (!holidayByMd.has(md)) holidayByMd.set(md, name);
    for (let yy = fromD.getUTCFullYear(); yy <= toD.getUTCFullYear(); yy++) for (const mv of this.movableNational(yy)) if (!holidayByDay.has(mv.iso)) holidayByDay.set(mv.iso, mv.name);
    // agrupa marcações por dia local
    const byDay = new Map<string, number[]>();
    for (const p of punches) { const l = this.local(p.punchedAt, tz); (byDay.get(l.day) ?? byDay.set(l.day, []).get(l.day)!).push(l.min); }
    const ns = this.hhmm(schedule?.nightStart ?? "22:00"), ne = this.hhmm(schedule?.nightEnd ?? "05:00");
    const tol = schedule?.toleranceMin ?? 10;
    const todayIso = this.local(new Date(), tz).day;
    const days: any[] = [];
    const tot = { expectedMin: 0, workedMin: 0, abonoMin: 0, nightMin: 0, nightReducedMin: 0, nightFictaMin: 0, lateMin: 0, earlyMin: 0, extraMin: 0, faltaMin: 0, balanceMin: 0, restDays: 0, dsrLostWeeks: 0 };
    for (let t = fromD.getTime(); t <= toD.getTime(); t += 86400000) {
      const d = new Date(t); const dayIso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const wd = d.getUTCDay();
      const holidayName = holidayByDay.get(dayIso) ?? holidayByMd.get(dayIso.slice(5)) ?? null;
      // Dia que ainda não chegou não é falta nem entra nos totais — senão o
      // espelho do dia 10 já mostra o mês inteiro em vermelho.
      // `&& sem batida`: dia marcado como futuro que TEM batida (relógio do
      // terminal adiantado, importação com data errada) precisa aparecer com o
      // que foi batido, senão a batida fica invisível e ninguém a corrige.
      const isFuture = dayIso > todayIso && !(byDay.get(dayIso)?.length);
      // HOJE não é dia fechado. Quem ainda não foi embora tem batida ímpar, e
      // isso não é erro — é alguém trabalhando. Sem esta distinção o espelho e a
      // fila de inconsistências acusam a empresa inteira toda manhã.
      const inProgress = dayIso === todayIso;
      const ov = overrideByDay.get(dayIso);
      const leaveType = leaveByDay.get(dayIso) ?? null;
      const dayJusts = justs.filter((j) => this.local(j.day, "+0000").day === dayIso);
      const SPECIAL_KINDS = ["feriado", "facultativo", "folga_premium"];
      const specialJust = dayJusts.find((j) => j.status === "approved" && SPECIAL_KINDS.includes(j.kind));
      const specialOff = !!specialJust;
      // troca aplicada / ajuste manual: a exceção da escala SOBREPÕE feriado e pattern
      let segs: Seg[];
      if (leaveType) {
        segs = []; // afastado: sem jornada esperada
      } else if (ov) {
        segs = ov.kind === "folga" ? [] : ((ov.segments ?? []) as [string, string][]).map((s) => this.seg(s));
      } else if (specialOff) {
        // folga premium / ponto facultativo / feriado lançado e aprovado:
        // esperado vira 0 — não é falta, não desconta, e o que bater vira extra.
        segs = [];
      } else if (holidayName) {
        // feriado: aplica a política da escala (folga | trabalha | alterna 1 sim/1 não)
        const pol = (schedule as any)?.holidayPolicy ?? "folga";
        const worksHoliday = pol === "trabalha" || (pol === "alterna" && Math.floor(Date.parse(dayIso + "T00:00:00Z") / 604800000) % 2 === 0);
        segs = worksHoliday ? this.expectedSegments(schedule, dayIso, wd) : [];
      } else {
        segs = this.expectedSegments(schedule, dayIso, wd);
      }
      // DE ONDE veio o previsto do dia. A grade de ajuste mostra isso no tooltip
      // da coluna "Previsto": sem ele, um dia sem escala e um dia de folga ficam
      // idênticos na tela (ambos em branco) e a pessoa não sabe se é erro de
      // cadastro ou descanso. "sem_escala" também é o que faz a fila de
      // inconsistências NÃO acusar extra: quem não tem escala tem todo minuto
      // trabalhado contado como extra, e isso é cadastro faltando, não erro de ponto.
      const scheduleOrigin = leaveType ? "afastamento" : ov ? "troca" : specialOff ? "especial"
        : holidayName ? "feriado" : !schedule ? "sem_escala" : "escala";
      const flexH = holidayName && segs.length === 0 ? 0 : this.flexTarget(schedule, wd);
      const c0 = this.computeDay(segs, byDay.get(dayIso) ?? [], tol, ns, ne, flexH, nightRed);
      // o que falta do dia de hoje só é cobrado depois que o dia terminar:
      // saída antecipada, falta e batida incompleta ficam zeradas, e o saldo não
      // fica negativo só porque ainda é meio-dia.
      const c = inProgress
        ? { ...c0, earlyMin: 0, faltaMin: 0, balanceMin: Math.max(0, c0.balanceMin), incomplete: false }
        : c0;
      const justified = dayJusts.some((j) => j.status === "approved");
      // ABONO: dia com justificativa aprovada não conta atraso/saída antecipada/falta
      // (foi abonado). Afastamento (leave) também não conta. Mantém trabalhado/extra/noturno.
      const excused = justified && !leaveType;
      const lateMin = excused ? 0 : c.lateMin;
      const earlyMin = excused ? 0 : c.earlyMin;
      const lateCount = excused ? 0 : c.lateCount;
      const faltaMin = (justified || leaveType) ? 0 : c.faltaMin;
      const abonado = excused && (c.faltaMin > 0 || c.lateMin > 0 || c.earlyMin > 0 || c.incomplete);
      // ABONO PARCIAL DE HORAS: trabalhou 08–13 e o resto do dia foi abonado.
      // Os minutos abonados PAGAM o déficit — abatem saída antecipada, depois
      // atraso, e entram no saldo. Nunca passam do déficit do dia.
      const deficitMin = Math.max(0, c.expectedMin - c.workedMin);
      const abonoMin = Math.min(deficitMin, dayJusts
        .filter((j) => j.status === "approved" && j.kind === "abono" && (j.proposed as any)?.abonoMinutes)
        .reduce((acc, j) => acc + Math.max(0, Math.trunc(Number((j.proposed as any).abonoMinutes) || 0)), 0));
      const adjEarly = Math.max(0, earlyMin - abonoMin);
      const adjLate = Math.max(0, lateMin - Math.max(0, abonoMin - earlyMin));
      const adjBalance = c.balanceMin + abonoMin;
      if (isFuture) {
        days.push({
          day: dayIso, wd, punches: [], ...c, expectedMin: 0, faltaMin: 0,
          expectedSegs: segs.map(([a, b]) => [this.fmtClock(a), this.fmtClock(b)]), scheduleOrigin,
          future: true, inProgress: false, special: false, justifications: [], dsrLost: false, unjustifiedFalta: false, divergence: false,
        });
        continue;
      }
      if (!c.isWorkDay) tot.restDays++;
      tot.expectedMin += c.expectedMin; tot.workedMin += c.workedMin; tot.nightMin += c.nightMin;
      tot.nightReducedMin += c.nightReducedMin; tot.nightFictaMin += c.nightFictaMin;
      tot.lateMin += adjLate; tot.earlyMin += adjEarly; tot.abonoMin += abonoMin; tot.extraMin += c.extraMin;
      tot.faltaMin += faltaMin; tot.balanceMin += adjBalance;
      days.push({
        day: dayIso, wd, punches: (byDay.get(dayIso) ?? []).sort((a, b) => a - b).map((m) => this.fmtHM(m)),
        shiftStart: segs.length ? this.fmtClock(segs[0]![0]) : null, shiftEnd: segs.length ? this.fmtClock(segs[segs.length - 1]![1]) : null,
        ...c, lateMin: adjLate, earlyMin: adjEarly, lateCount, faltaMin, abonado, abonoMin, balanceMin: adjBalance,
        expectedSegs: segs.map(([a, b]) => [this.fmtClock(a), this.fmtClock(b)]), scheduleOrigin,
        future: false, inProgress, special: specialOff, specialReason: holidayName ?? specialJust?.reason ?? null, holiday: !!holidayName, holidayName, swapped: !!ov, swapKind: ov?.kind ?? null, leave: !!leaveType, leaveType, justified: justified || !!leaveType, justifications: dayJusts, dsrLost: false,
        unjustifiedFalta: !justified && !specialOff && c.faltaMin > 0,
        divergence: !justified && !specialOff && (c.faltaMin > 0 || c.incomplete || adjLate > 0 || adjEarly > 0 || c.extraMin > 0),
      });
    }
    // DSR: semana (seg→dom) com falta INJUSTIFICADA perde o descanso semanal remunerado.
    // Marca o domingo (ou o último dia de folga da semana) como dsrLost.
    if (dsrOn) {
      const weekKey = (iso: string) => { const dt = new Date(iso + "T00:00:00Z"); const dow = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - dow); return dt.toISOString().slice(0, 10); };
      const byWeek = new Map<string, any[]>();
      for (const d of days) { const k = weekKey(d.day); (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(d); }
      for (const [, wdays] of byWeek) {
        if (!wdays.some((d) => d.unjustifiedFalta)) continue;
        const rest = [...wdays].reverse().find((d) => !d.isWorkDay) ?? wdays[wdays.length - 1];
        if (rest) { rest.dsrLost = true; tot.dsrLostWeeks++; }
      }
    }
    const fmt = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" && k.endsWith("Min") ? this.fmtHM(v as number) : v]));
    return {
      employee: { id: emp.id, name: emp.name, cpf: emp.cpf, matricula: emp.matricula, cargo: emp.cargo },
      employer: cfg?.razaoOuNome ?? "", schedule: schedule ? { code: schedule.code, name: schedule.name, kind: schedule.kind } : null,
      period: { from: opts.from, to: opts.to },
      days: days.map((d) => ({ ...d, hm: fmt({ expectedMin: d.expectedMin, workedMin: d.workedMin, extraMin: d.extraMin, lateMin: d.lateMin, earlyMin: d.earlyMin, faltaMin: d.faltaMin, nightMin: d.nightMin, nightReducedMin: d.nightReducedMin, balanceMin: d.balanceMin }) })),
      totals: { ...tot, hm: fmt(tot) },
    };
  }

  /** Divergências do período (todos os funcionários ativos ou um). */
  async divergencias(ctx: RequestContext, opts: { from: string; to: string; employeeId?: string }) {
    this.requireAdmin(ctx);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoEmployee.findMany({ where: { active: true, ...(opts.employeeId ? { id: opts.employeeId } : {}) }, select: { id: true, name: true } }),
    );
    const out: any[] = [];
    for (const e of emps) {
      const esp = await this.espelho(ctx, { employeeId: e.id, from: opts.from, to: opts.to });
      for (const d of esp.days as any[]) if (d.divergence) out.push({ employeeId: e.id, employeeName: e.name, day: d.day, ...d.hm, incomplete: d.incomplete });
    }
    return { items: out };
  }

  // ----- AFASTAMENTOS -----
  async listLeaves(ctx: RequestContext, employeeId: string) {
    this.requireOrg(ctx);
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoLeave.findMany({ where: { employeeId }, orderBy: { startDate: "desc" }, take: 200 }));
  }
  async createLeave(ctx: RequestContext, input: { employeeId: string; type: string; startDate: string; endDate?: string | null; reason?: string | null }) {
    this.requireAdmin(ctx);
    if (!input.employeeId || !input.type || !input.startDate) throw new AppError(ErrorCode.ValidationFailed, "Funcionário, tipo e início obrigatórios", 400);
    const types = ["inss_doenca", "acidente", "maternidade", "paternidade", "servico_militar", "licenca_nr", "outro"];
    const type = types.includes(input.type) ? input.type : "outro";
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoLeave.create({ data: { organizationId: ctx.orgId!, employeeId: input.employeeId, type, startDate: new Date(input.startDate), endDate: input.endDate ? new Date(input.endDate) : null, reason: input.reason ?? null, createdBy: ctx.userId ?? null } }));
    return { id: r.id };
  }
  async removeLeave(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoLeave.deleteMany({ where: { id } }));
    return { ok: true };
  }

  // ----- JUSTIFICATIVAS -----
  async listJustifications(ctx: RequestContext, opts: { employeeId?: string; status?: string; from?: string; to?: string }) {
    this.requireOrg(ctx);
    const where: any = {};
    if (opts.employeeId) where.employeeId = opts.employeeId;
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) where.day = { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lte: new Date(opts.to) } : {}) };
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoJustification.findMany({ where, orderBy: { day: "desc" }, take: 500 }));
    const empIds = [...new Set(rows.map((r) => r.employeeId))];
    const emps = empIds.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name] as [string, string]));
    return { items: rows.map((r) => ({ ...r, employeeName: nm.get(r.employeeId) ?? "" })) };
  }
  async createJustification(ctx: RequestContext, input: { employeeId: string; day: string; kind: string; reason: string; attachmentUrl?: string; proposed?: Record<string, string> | null }) {
    this.requireOrg(ctx);
    const orgId = ctx.orgId!;
    if (!input.employeeId || !input.day || !input.reason?.trim()) throw new AppError(ErrorCode.ValidationFailed, "employeeId, day e motivo obrigatórios", 400);
    // "ajuste" = ajuste de horário (esqueceu de bater): guarda os horários propostos
    // e, ao aprovar, vira batida no espelho.
    const kinds = ["atraso", "falta", "saida_antecipada", "abono", "extra", "ajuste", "outro"];
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoJustification.create({
      data: { organizationId: orgId, employeeId: input.employeeId, day: new Date(input.day), kind: kinds.includes(input.kind) ? input.kind : "outro", reason: input.reason.trim(), proposed: (input.proposed ?? undefined) as any, attachmentUrl: input.attachmentUrl ?? null, requestedBy: ctx.userId ?? null },
    }));
    return { id: row.id };
  }
  // ----- ESPELHO ASSINADO (A1 ou contingência) -----
  private monthRange(refMonth: string): { from: string; to: string; first: Date } {
    const m = /^(\d{4})-(\d{2})/.exec(refMonth || "");
    const now = new Date();
    const y = m ? Number(m[1]) : now.getUTCFullYear();
    const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
    const first = new Date(Date.UTC(y, mo, 1));
    const last = new Date(Date.UTC(y, mo + 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), first };
  }
  /** Hash determinístico do conteúdo do espelho (integridade da assinatura). */
  private espelhoHash(esp: any): string {
    const canon = JSON.stringify({
      e: esp.employee?.id, p: esp.period,
      d: (esp.days as any[]).map((d) => [d.day, d.punches, d.hm?.workedMin, d.hm?.faltaMin, d.hm?.extraMin]),
      t: esp.totals?.hm,
    });
    return createHash("sha256").update(canon).digest("hex");
  }
  async espelhoSignature(ctx: RequestContext, employeeId: string, refMonth: string) {
    this.requireOrg(ctx);
    const { first } = this.monthRange(refMonth);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEspelhoSignature.findFirst({ where: { employeeId, refMonth: first } }));
    return row;
  }
  /** Assina o espelho do mês: A1 (ICP-Brasil) se houver; senão assinatura eletrônica de CONTINGÊNCIA (hash). */
  async signEspelho(ctx: RequestContext, input: { employeeId: string; refMonth: string; signatureImageUrl?: string | null; ip?: string | null }) {
    this.requireOrg(ctx);
    const orgId = ctx.orgId!;
    const { from, to, first } = this.monthRange(input.refMonth);
    // só assina depois que o RH FECHA a folha do mês (status closed)
    const closing = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.findFirst({ where: { refMonth: first as any }, select: { status: true } })).catch(() => null);
    if ((closing?.status ?? "open") !== "closed") {
      throw new AppError(ErrorCode.ValidationFailed, "A folha de ponto deste mês ainda não foi fechada pelo RH. Você poderá assiná-la quando o período estiver fechado.", 400);
    }
    const esp = await this.espelho(ctx, { employeeId: input.employeeId, from, to });
    const hash = this.espelhoHash(esp);
    // assina com o A1 do EMPREGADOR (CNPJ) do funcionário
    const empRow = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: input.employeeId }, select: { employerId: true } }));
    let a1Signed = false, a1Subject: string | null = null, p7sKey: string | null = null;
    const p7s = await this.sign.sign(orgId, Buffer.from(hash, "utf8"), empRow?.employerId ?? null).catch(() => null);
    if (p7s) {
      a1Signed = true;
      const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { a1Subject: true } })).catch(() => null);
      a1Subject = cfg?.a1Subject ?? null;
      const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/espelho/${orgId}`, contentType: "application/pkcs7-signature", body: p7s, originalName: `espelho-${from.slice(0, 7)}.p7s` });
      p7sKey = key;
    }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEspelhoSignature.upsert({
      where: { organizationId_employeeId_refMonth: { organizationId: orgId, employeeId: input.employeeId, refMonth: first } },
      update: { contentHash: hash, signatureImageUrl: input.signatureImageUrl ?? null, signerIp: input.ip ?? null, a1Signed, a1Subject, p7sKey, signedAt: new Date() },
      create: { organizationId: orgId, employeeId: input.employeeId, refMonth: first, contentHash: hash, signatureImageUrl: input.signatureImageUrl ?? null, signerIp: input.ip ?? null, a1Signed, a1Subject, p7sKey },
    }));
    return { ok: true, a1Signed, hash, mode: a1Signed ? "icp_a1" : "contingencia" };
  }
  /** Carrega a marca da empresa (nome, cor, logo) p/ o cabeçalho do espelho. */
  private async loadBrand(ctx: RequestContext): Promise<{ name: string; color: string | null; logoBuf: Buffer | null }> {
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true, logoUrl: true, primaryColor: true } })).catch(() => null);
    const logoBuf = await this.loadLogoBuf(org?.logoUrl ?? null);
    return { name: org?.name || "", color: org?.primaryColor ?? null, logoBuf };
  }
  /** Baixa a logo (URL pública) e devolve bytes só se PNG/JPEG (pdfkit não aceita svg/webp). */
  private async loadLogoBuf(logoUrl: string | null): Promise<Buffer | null> {
    if (!logoUrl) return null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const res = await fetch(logoUrl, { signal: ctl.signal }); clearTimeout(t);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50;
      const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
      return isPng || isJpg ? buf : null;
    } catch { return null; }
  }

  /** Desenha UM espelho (tabela + carimbo de assinatura) no documento PDF já aberto. */
  private drawEspelhoInto(pdf: any, esp: any, sig: any, hashNow: string, from: string, brand?: { name: string; color: string | null; logoBuf: Buffer | null }) {
    const M = 40, right = pdf.page.width - M;
    const accent = brand?.color && /^#[0-9a-fA-F]{6}$/.test(brand.color) ? brand.color : "#111827";
    const company = brand?.name || esp.employer || "Empregador";
    const topY = pdf.y;
    // logo (esquerda) — se houver
    let nameX = M;
    if (brand?.logoBuf) { try { pdf.image(brand.logoBuf, M, topY, { fit: [120, 32] }); nameX = M + 132; } catch { /* ignora logo inválida */ } }
    // nome da empresa (esquerda) + título "Espelho de Ponto" (direita, cor da marca)
    pdf.font("Helvetica-Bold").fontSize(14).fillColor("#111").text(company, nameX, topY + (brand?.logoBuf ? 8 : 0), { width: (right - nameX) * 0.62, lineBreak: false });
    pdf.font("Helvetica-Bold").fontSize(13).fillColor(accent).text("Espelho de Ponto", M, topY + 4, { width: right - M, align: "right" });
    // régua na cor da marca
    pdf.y = topY + 36;
    pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).lineWidth(2).strokeColor(accent).stroke(); pdf.lineWidth(1);
    pdf.moveDown(0.5);
    // identificação do funcionário + empregador (fiscal)
    pdf.font("Helvetica").fontSize(10).fillColor("#333").text(`${esp.employee.name}${esp.employee.cargo ? " — " + esp.employee.cargo : ""}${esp.employee.cpf ? " · CPF " + esp.employee.cpf : ""}`, M, pdf.y, { align: "left" });
    pdf.fontSize(9).fillColor("#555").text(`Competência: ${from.slice(0, 7)} · escala ${esp.schedule?.name ?? "—"}`, { align: "left" });
    if (esp.employer && esp.employer !== company) pdf.fontSize(8).fillColor("#777").text(`Empregador: ${esp.employer}`, { align: "left" });
    pdf.moveDown(0.5); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.4);
    const cols = [{ t: "Dia", w: 70 }, { t: "Marcações", w: 200 }, { t: "Trab.", w: 70 }, { t: "Extra", w: 60 }, { t: "Falta", w: 60 }];
    const head = () => { let cx = M; pdf.font("Helvetica-Bold").fontSize(8).fillColor("#111"); cols.forEach((c) => { pdf.text(c.t, cx, pdf.y, { width: c.w, lineBreak: false }); cx += c.w; }); pdf.moveDown(0.3); };
    head(); pdf.font("Helvetica").fontSize(8).fillColor("#333");
    for (const d of esp.days as any[]) {
      const hasPunches = !!(d.punches && d.punches.length);
      const isRest = !d.isWorkDay || d.leave;
      // rótulo de dias sem jornada esperada (folga/DSR/feriado/afastamento)
      let restLabel: string | null = null;
      if (d.leave) restLabel = `Afastamento${d.leaveType ? ` (${d.leaveType})` : ""}`;
      else if (d.holiday) restLabel = `Feriado${d.holidayName ? ` — ${d.holidayName}` : ""}`;
      else if (d.swapKind === "folga") restLabel = "Folga (troca)";
      else if (!d.isWorkDay) restLabel = d.dsrLost ? "Folga — DSR descontado" : "Folga";
      const reason = (((d.justifications || []).find((j: any) => j.status === "approved")) ?? (d.justifications || [])[0])?.reason || null;
      const abonado = !!d.abonado;
      if (pdf.y > pdf.page.height - 120) { pdf.addPage(); head(); pdf.font("Helvetica").fontSize(8).fillColor("#333"); }
      const y = pdf.y; let cx = M;
      const wd = new Date(d.day + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short", timeZone: "UTC" });
      pdf.fillColor(d.divergence ? "#b00" : isRest ? "#888" : "#333");
      pdf.text(wd, cx, y, { width: cols[0]!.w, lineBreak: false }); cx += cols[0]!.w;
      // Marcações: batidas, OU rótulo de folga, OU "Abonado: motivo"
      let marc: string;
      if (hasPunches) { marc = d.punches.join("  "); if (abonado) marc += `  · Abonado${reason ? ": " + reason : ""}`; }
      else if (restLabel) marc = restLabel;
      else if (abonado || d.justified) marc = `Abonado${reason ? ": " + reason : ""}`;
      else marc = "—";
      pdf.text(marc, cx, y, { width: cols[1]!.w, lineBreak: false }); cx += cols[1]!.w;
      const dash = isRest && !hasPunches;
      pdf.text(dash ? "—" : (d.hm?.workedMin ?? ""), cx, y, { width: cols[2]!.w, lineBreak: false }); cx += cols[2]!.w;
      pdf.text(dash ? "—" : (d.hm?.extraMin ?? ""), cx, y, { width: cols[3]!.w, lineBreak: false }); cx += cols[3]!.w;
      const faltaCell = dash ? "—" : abonado ? "Abonado" : (d.hm?.faltaMin ?? "");
      pdf.text(faltaCell, cx, y, { width: cols[4]!.w, lineBreak: false });
      pdf.moveDown(0.35);
    }
    pdf.fillColor("#111").moveDown(0.4); pdf.moveTo(M, pdf.y).lineTo(right, pdf.y).strokeColor("#ddd").stroke(); pdf.moveDown(0.3);
    pdf.font("Helvetica-Bold").fontSize(9).text(`Totais — Trabalhado: ${esp.totals.hm.workedMin}  ·  Extra: ${esp.totals.hm.extraMin}  ·  Falta: ${esp.totals.hm.faltaMin}  ·  Noturno: ${esp.totals.hm.nightMin}  ·  Saldo: ${esp.totals.hm.balanceMin}`);
    pdf.moveDown(1.2);
    if (sig) {
      const integ = sig.contentHash === hashNow;
      pdf.font("Helvetica-Bold").fontSize(10).fillColor(integ ? "#0a0" : "#b00").text(integ ? "Espelho ASSINADO pelo funcionário" : "ATENÇÃO: o espelho foi alterado após a assinatura");
      pdf.font("Helvetica").fontSize(9).fillColor("#333");
      pdf.text(`Assinado em ${new Date(sig.signedAt).toLocaleString("pt-BR")}${sig.signerIp ? ` · IP ${sig.signerIp}` : ""}`);
      if (sig.a1Signed) pdf.text(`Assinatura digital ICP-Brasil (A1)${sig.a1Subject ? ` — ${sig.a1Subject}` : ""} · PKCS#7 anexo (.p7s)`);
      else pdf.text(`Assinatura eletrônica (contingência) — MP 2.200-2/2001. Integridade por hash SHA-256.`);
      pdf.fontSize(7).fillColor("#666").text(`SHA-256: ${sig.contentHash}`);
    } else {
      pdf.font("Helvetica").fontSize(9).fillColor("#999").text("Espelho ainda não assinado pelo funcionário.");
    }
  }

  /** PDF do espelho do mês com carimbo de assinatura (A1 ou contingência) + hash de integridade. */
  async espelhoSignedPdf(ctx: RequestContext, employeeId: string, refMonth: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireOrg(ctx);
    const { from, to } = this.monthRange(refMonth);
    const esp = await this.espelho(ctx, { employeeId, from, to });
    const sig = await this.espelhoSignature(ctx, employeeId, refMonth);
    const hashNow = this.espelhoHash(esp);
    const brand = await this.loadBrand(ctx);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      this.drawEspelhoInto(pdf, esp, sig, hashNow, from, brand);
      pdf.end();
    });
    return { buffer, filename: `espelho-${esp.employee.name.split(" ")[0]}-${from.slice(0, 7)}.pdf` };
  }

  /** Status de assinatura do mês (todos os funcionários ativos): assinado/pendente. */
  async espelhoSignaturesMonth(ctx: RequestContext, refMonth: string) {
    this.requireOrg(ctx);
    const { first } = this.monthRange(refMonth);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, cargo: true } }));
    const sigs = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEspelhoSignature.findMany({ where: { refMonth: first }, select: { employeeId: true, signedAt: true, a1Signed: true } }));
    const sm = new Map(sigs.map((s) => [s.employeeId, s]));
    const items = emps.map((e) => { const s = sm.get(e.id); return { employeeId: e.id, name: e.name, cargo: e.cargo, signed: !!s, a1Signed: s?.a1Signed ?? false, signedAt: s?.signedAt ?? null }; });
    return { refMonth: first.toISOString().slice(0, 7), total: items.length, signed: items.filter((i) => i.signed).length, items };
  }

  /** PDF único (lote) com o espelho de todos os funcionários ativos do mês — para a contabilidade. */
  async espelhoBatchPdf(ctx: RequestContext, refMonth: string, opts?: { onlySigned?: boolean; storeId?: string | null }): Promise<{ buffer: Buffer; filename: string; count: number }> {
    this.requireOrg(ctx);
    const { from, to, first } = this.monthRange(refMonth);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true, ...(opts?.storeId ? { storeId: opts.storeId } : {}) }, orderBy: { name: "asc" }, select: { id: true } }));
    const prepared: Array<{ esp: any; sig: any; hash: string }> = [];
    for (const e of emps) {
      const esp = await this.espelho(ctx, { employeeId: e.id, from, to }).catch(() => null);
      if (!esp) continue;
      const sig = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEspelhoSignature.findFirst({ where: { employeeId: e.id, refMonth: first } })).catch(() => null);
      if (opts?.onlySigned && !sig) continue;
      prepared.push({ esp, sig, hash: this.espelhoHash(esp) });
    }
    const brand = await this.loadBrand(ctx);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      if (!prepared.length) { pdf.font("Helvetica").fontSize(11).fillColor("#666").text("Sem funcionários/espelhos no período.", 40, 60); }
      prepared.forEach((p, i) => { if (i > 0) pdf.addPage(); this.drawEspelhoInto(pdf, p.esp, p.sig, p.hash, from, brand); });
      pdf.end();
    });
    return { buffer, filename: `espelhos-${from.slice(0, 7)}.pdf`, count: prepared.length };
  }

  /** Envia o lote de espelhos do mês ao e-mail da contabilidade (anexo PDF). */
  async sendEspelhosToAccountant(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { accountantEmail: true, razaoOuNome: true } }));
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true, logoUrl: true } })).catch(() => null);
    const to = cfg?.accountantEmail?.trim();
    if (!to) throw new AppError(ErrorCode.ValidationFailed, "Configure o e-mail da contabilidade no Empregador", 400);
    const { buffer, count, filename } = await this.espelhoBatchPdf(ctx, refMonth);
    if (!count) throw new AppError(ErrorCode.ValidationFailed, "Nenhum espelho para enviar neste mês", 400);
    const { first } = this.monthRange(refMonth);
    const comp = first.toISOString().slice(0, 7);
    const sm = await this.espelhoSignaturesMonth(ctx, refMonth);
    const html = buildBrandedEmail({
      bodyHtml: `<p>Segue em anexo o lote de espelhos de ponto da competência <b>${comp}</b> — ${cfg?.razaoOuNome || "empresa"}.</p><p>${sm.signed} de ${sm.total} assinados.</p>`,
      category: "info", brandName: org?.name || cfg?.razaoOuNome || "Empresa", logoUrl: org?.logoUrl ?? null,
    });
    const res = await this.email.sendForOrg(orgId, { to, subject: `Espelhos de ponto ${comp} — ${cfg?.razaoOuNome || ""}`.trim(), html, text: `Lote de espelhos de ponto ${comp}. ${sm.signed}/${sm.total} assinados.`, attachments: [{ filename, content: buffer, contentType: "application/pdf" }] }).catch((e: any) => { throw new AppError(ErrorCode.Internal, `Falha ao enviar: ${e?.message ?? "erro"}`, 500); });
    return { ok: true, to, count, source: res.source };
  }

  async reviewJustification(ctx: RequestContext, id: string, input: { approve: boolean; note?: string }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoJustification.update({
      where: { id }, data: { status: input.approve ? "approved" : "rejected", reviewedBy: ctx.userId ?? null, reviewedAt: new Date(), reviewNote: (input.note || "").slice(0, 500) || null },
      select: { id: true, employeeId: true, day: true, kind: true, status: true, reviewNote: true, proposed: true },
    }));
    // Ajuste de horário aprovado → cria as batidas propostas no espelho (antes só
    // mudava o status e o horário pedido nunca era aplicado).
    if (input.approve && row.kind === "ajuste" && row.proposed) {
      const p = row.proposed as Record<string, string>;
      const times = ["in", "break_in", "break_out", "out"].map((k) => p?.[k]).filter((t): t is string => /^\d{1,2}:\d{2}$/.test(String(t || "")));
      if (times.length) {
        const ymd = new Date(row.day).toISOString().slice(0, 10);
        await this.ponto.adminPunches(ctx, { employeeId: row.employeeId, days: [{ day: ymd, times }], motivo: "Ajuste de horário aprovado (solicitação do funcionário)" }).catch(() => undefined);
      }
    }
    // avisa o funcionário (WhatsApp/e-mail) sobre a decisão — best-effort.
    this.notifyDecision(orgId, row).catch(() => undefined);
    return { ok: true };
  }

  /** Notifica o funcionário sobre a decisão da justificativa (via funcionário do RH vinculado). */
  private async notifyDecision(orgId: string, j: { employeeId: string; day: Date; kind: string; status: string; reviewNote: string | null }) {
    const emp = await this.prisma.runWithContext({ orgId }, (tx) => tx.pontoEmployee.findFirst({ where: { id: j.employeeId }, select: { name: true, hrEmployeeId: true, storeId: true } }));
    if (!emp) return;
    let whatsapp: string | null = null, email: string | null = null;
    if (emp.hrEmployeeId) {
      const hr = await this.prisma.runWithContext({ orgId }, (tx) => tx.employee.findFirst({ where: { id: emp.hrEmployeeId! }, select: { whatsappPhone: true, phone: true, email: true } }));
      whatsapp = hr?.whatsappPhone || hr?.phone || null; email = hr?.email || null;
    }
    if (!whatsapp && !email) return;
    const dia = new Date(j.day).toLocaleDateString("pt-BR", { timeZone: "UTC" });
    const ok = j.status === "approved";
    const text = `Olá ${String(emp.name).split(" ")[0]}, sua solicitação de ponto de ${dia} foi ${ok ? "APROVADA ✅" : "RECUSADA ❌"}.${j.reviewNote ? ` Obs.: ${j.reviewNote}` : ""}`;
    await this.notifications.notify({
      organizationId: orgId, storeId: emp.storeId ?? "", whatsappPhone: whatsapp, email,
      subject: `Solicitação de ponto ${ok ? "aprovada" : "recusada"} — ${dia}`, text,
      templateCode: "ponto_justificativa_decisao",
      variables: { "funcionario.nome": emp.name, "funcionario.primeiro_nome": String(emp.name).split(" ")[0], dia, status: ok ? "aprovada" : "recusada", observacao: j.reviewNote ?? "" },
    });
  }
}
