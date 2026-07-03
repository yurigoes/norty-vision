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

  /** Branding da org (nome, logoUrl, cor primária). Usado no PDF do espelho. */
  private async brandingFor(ctx: RequestContext): Promise<{ name: string; logoUrl: string | null; primaryColor: string | null }> {
    if (!ctx.orgId) return { name: "", logoUrl: null, primaryColor: null };
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({ where: { id: ctx.orgId! }, select: { name: true, logoUrl: true, primaryColor: true } }),
    ).catch(() => null);
    return { name: org?.name ?? "", logoUrl: org?.logoUrl ?? null, primaryColor: org?.primaryColor ?? null };
  }

  /** Baixa o logo da org como Buffer (PDFKit não aceita URL direto). null se falhar. */
  private async fetchLogoBytes(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(url, { signal: ctl.signal }); clearTimeout(t);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return Buffer.from(ab);
    } catch { return null; }
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
  async upsertSchedule(ctx: RequestContext, input: { id?: string; code: string; name: string; kind?: string; toleranceMin?: number; nightStart?: string; nightEnd?: string; pattern?: any; active?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    if (!input.code?.trim() || !input.name?.trim()) throw new AppError(ErrorCode.ValidationFailed, "Código e nome obrigatórios", 400);
    const data: any = {
      code: input.code.trim(), name: input.name.trim(),
      kind: ["12x36", "plantao", "intermitente", "home_office"].includes(input.kind ?? "") ? input.kind! : "fixa",
      toleranceMin: Math.max(0, Math.min(60, input.toleranceMin ?? 10)),
      nightStart: input.nightStart || "22:00", nightEnd: input.nightEnd || "05:00",
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
    const kind = input.kind === "facultativo" ? "facultativo" : "feriado";
    const data: any = { day: new Date(input.day + "T00:00:00Z"), name: input.name.trim().slice(0, 120), kind, recurring: !!input.recurring, storeId: input.storeId ?? null };
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
    const p = (schedule?.pattern ?? {}) as any;
    const kind = schedule?.kind;
    if (kind === "intermitente") return []; // sem jornada fixa — só conta o que bater (não há falta)
    if (kind === "home_office") return []; // flexível — esperado vem de durMin (tratado no espelho), sem horário fixo
    if (kind === "12x36") {
      const anchor = p.anchor ? new Date(p.anchor + "T00:00:00Z") : null;
      if (!anchor) return [];
      const days = Math.floor((new Date(dayIso + "T00:00:00Z").getTime() - anchor.getTime()) / 86400000);
      if (((days % 2) + 2) % 2 !== 0) return []; // trabalha em dias pares desde a âncora
      return (p.segments ?? []).map((s: [string, string]) => this.seg(s));
    }
    if (kind === "plantao") {
      // ciclo: onDays trabalhados + offDays de folga, a partir de uma âncora
      const anchor = p.anchor ? new Date(p.anchor + "T00:00:00Z") : null;
      const on = Math.max(1, Number(p.onDays) || 1), off = Math.max(0, Number(p.offDays) || 0);
      if (!anchor || on + off === 0) return [];
      const days = Math.floor((new Date(dayIso + "T00:00:00Z").getTime() - anchor.getTime()) / 86400000);
      const pos = (((days % (on + off)) + (on + off)) % (on + off));
      if (pos >= on) return []; // dia de folga no ciclo
      return (p.segments ?? []).map((s: [string, string]) => this.seg(s));
    }
    const arr = p[String(wd)] ?? [];
    return arr.map((s: [string, string]) => this.seg(s));
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
    const extraMin = isWorkDay ? Math.max(0, workedMin - expectedMin - tol) : workedMin; // dia de folga: tudo é extra
    const faltaMin = isWorkDay && !hasPunches ? expectedMin : 0;
    const balanceMin = workedMin - expectedMin;
    return { expectedMin, workedMin, nightMin, nightReducedMin, nightFictaMin, lateMin, earlyMin, extraMin, faltaMin, balanceMin, incomplete, isWorkDay, hasPunches };
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
    // Se o caller mandar from > to (ex.: usuário trocou só o `to` no front pra um mês passado),
    // a gente normaliza pra não devolver espelho vazio silenciosamente. Sem isso o
    // loop `for (let t = fromD; t <= toD; ...)` nunca executa e o usuário acha que "sumiu".
    let fromIso = opts.from, toIso = opts.to;
    if (fromIso > toIso) { const tmp = fromIso; fromIso = toIso; toIso = tmp; }
    const fromD = new Date(fromIso + "T00:00:00Z"); const toD = new Date(toIso + "T23:59:59Z");
    // Filtra anuladas (voided=false) quando a migration 186 já está aplicada;
    // ambientes antigos sem a coluna fariam o Prisma quebrar — graceful fallback
    // pra query sem o filtro (todas as batidas, sem distinção) pra não devolver
    // espelho vazio só por causa de schema desatualizado.
    const punchWhere = { employeeId: emp.id, punchedAt: { gte: new Date(fromD.getTime() - 86400000), lte: new Date(toD.getTime() + 86400000) } };
    let punches: { punchedAt: Date }[];
    try {
      punches = await this.prisma.runWithContext(rls, (tx) =>
        tx.pontoPunch.findMany({ where: { ...punchWhere, voided: false }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }),
      );
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (/voided/i.test(msg) || /column .* does not exist/i.test(msg) || e?.code === "P2022") {
        // schema antigo (sem coluna voided) — segue sem o filtro
        punches = await this.prisma.runWithContext(rls, (tx) =>
          tx.pontoPunch.findMany({ where: punchWhere, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }),
        );
      } else { throw e; }
    }
    const justs = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoJustification.findMany({ where: { employeeId: emp.id, day: { gte: fromD, lte: toD } }, select: { day: true, kind: true, status: true, reason: true, proposed: true } }),
    );
    // feriados (aplicáveis: gerais OU da loja do funcionário). Recorrentes batem por dia/mês.
    const holidayRows = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoHoliday.findMany({ where: { OR: [{ storeId: null }, ...(emp.storeId ? [{ storeId: emp.storeId } as any] : [])] }, select: { day: true, name: true, kind: true, recurring: true } }),
    ).catch(() => [] as any[]);
    const holidayByDay = new Map<string, string>();  // "YYYY-MM-DD" → rótulo (Feriado/Facultativo: nome)
    const holidayByMd = new Map<string, string>();    // "MM-DD" (recorrente) → rótulo
    for (const h of holidayRows) {
      const iso = new Date(h.day).toISOString().slice(0, 10);
      const label = `${(h as any).kind === "facultativo" ? "Ponto facultativo" : "Feriado"}${h.name ? `: ${h.name}` : ""}`;
      if (h.recurring) holidayByMd.set(iso.slice(5), label); else holidayByDay.set(iso, label);
    }
    // agrupa marcações por dia local
    const byDay = new Map<string, number[]>();
    for (const p of punches) { const l = this.local(p.punchedAt, tz); (byDay.get(l.day) ?? byDay.set(l.day, []).get(l.day)!).push(l.min); }
    const ns = this.hhmm(schedule?.nightStart ?? "22:00"), ne = this.hhmm(schedule?.nightEnd ?? "05:00");
    const tol = schedule?.toleranceMin ?? 10;
    // Dia de HOJE no fuso da empresa: dias DEPOIS de hoje (futuro) ainda não
    // aconteceram → não podem ser "falta" nem entrar no relatório. Só contam os
    // dias até a data atual.
    const todayIso = this.local(new Date(), tz).day;
    const days: any[] = [];
    const tot = { expectedMin: 0, workedMin: 0, nightMin: 0, nightReducedMin: 0, nightFictaMin: 0, lateMin: 0, earlyMin: 0, extraMin: 0, faltaMin: 0, abonoMin: 0, balanceMin: 0, restDays: 0, dsrLostWeeks: 0 };
    for (let t = fromD.getTime(); t <= toD.getTime(); t += 86400000) {
      const d = new Date(t); const dayIso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const wd = d.getUTCDay();
      const isFuture = dayIso > todayIso;
      const holidayName = holidayByDay.get(dayIso) ?? holidayByMd.get(dayIso.slice(5)) ?? null;
      const dayJusts = justs.filter((j) => this.local(j.day, "+0000").day === dayIso);
      // "justified" = dia inteiro coberto (falta/abono full-day/feriado). Abono
      // PARCIAL de horas (kind abono com proposed.abonoMinutes) NÃO conta aqui —
      // ele abate o déficit em horas (tratado mais abaixo via abonoMin).
      const justified = dayJusts.some((j) => j.status === "approved" && !(j.kind === "abono" && (j.proposed as any)?.abonoMinutes));
      // DIA ESPECIAL ABONADO: feriado cadastrado OU folga premium / ponto
      // facultativo / feriado lançado aprovado → esperado vira 0 (não é falta,
      // não desconta); o que bater conta como extra.
      const specialOff = !!holidayName || dayJusts.some((j) => j.status === "approved" && ["feriado", "facultativo", "folga_premium"].includes(j.kind));
      const specialReason = holidayName ?? (dayJusts.find((j) => j.status === "approved" && ["feriado", "facultativo", "folga_premium"].includes(j.kind))?.reason ?? null);
      const segs = specialOff ? [] : this.expectedSegments(schedule, dayIso, wd);
      const c = this.computeDay(segs, byDay.get(dayIso) ?? [], tol, ns, ne, specialOff ? 0 : this.flexTarget(schedule, wd), nightRed);
      // ABONO PARCIAL DE HORAS: ex.: trabalhou 08–13 e o resto do dia foi abonado.
      // Os minutos abonados (proposed.abonoMinutes de justificativas abono
      // aprovadas) PAGAM o déficit do dia → abatem saída antecipada/atraso e o
      // saldo, e entram no total de abono (vai pra folha). Limitado ao déficit.
      const deficitMin = Math.max(0, c.expectedMin - c.workedMin);
      const abonoMin = Math.min(deficitMin, dayJusts
        .filter((j) => j.status === "approved" && j.kind === "abono" && (j.proposed as any)?.abonoMinutes)
        .reduce((s, j) => s + Math.max(0, Math.trunc(Number((j.proposed as any).abonoMinutes) || 0)), 0));
      const adjEarly = Math.max(0, c.earlyMin - abonoMin);                          // abono cobre 1º a saída antecipada
      const adjLate = Math.max(0, c.lateMin - Math.max(0, abonoMin - c.earlyMin));  // sobra cobre o atraso
      const adjBalance = c.balanceMin + abonoMin;
      // Futuro NÃO entra nos totais (nem esperado, nem falta) e nunca é vermelho.
      if (!isFuture) {
        if (!c.isWorkDay) tot.restDays++;
        tot.expectedMin += c.expectedMin; tot.workedMin += c.workedMin; tot.nightMin += c.nightMin;
        tot.nightReducedMin += c.nightReducedMin; tot.nightFictaMin += c.nightFictaMin;
        tot.lateMin += adjLate; tot.earlyMin += adjEarly; tot.extraMin += c.extraMin;
        tot.faltaMin += justified ? 0 : c.faltaMin; tot.balanceMin += adjBalance; tot.abonoMin += abonoMin;
      }
      days.push({
        day: dayIso, wd, punches: (byDay.get(dayIso) ?? []).sort((a, b) => a - b).map((m) => this.fmtHM(m)),
        shiftStart: segs.length ? this.fmtClock(segs[0]![0]) : null, shiftEnd: segs.length ? this.fmtClock(segs[segs.length - 1]![1]) : null,
        ...c, isFuture, special: specialOff, specialReason, faltaMin: isFuture ? 0 : c.faltaMin,
        lateMin: adjLate, earlyMin: adjEarly, balanceMin: adjBalance, abonoMin,
        justified, justifications: dayJusts, dsrLost: false,
        unjustifiedFalta: !isFuture && !justified && c.faltaMin > 0,
        divergence: !isFuture && !justified && (c.faltaMin > 0 || c.incomplete || adjLate > 0 || adjEarly > 0 || c.extraMin > 0),
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
      employer: cfg?.razaoOuNome ?? "",
      branding: await this.brandingFor(ctx),
      schedule: schedule ? { code: schedule.code, name: schedule.name, kind: schedule.kind } : null,
      period: { from: fromIso, to: toIso },
      days: days.map((d) => ({ ...d, hm: fmt({ expectedMin: d.expectedMin, workedMin: d.workedMin, extraMin: d.extraMin, lateMin: d.lateMin, earlyMin: d.earlyMin, faltaMin: d.faltaMin, abonoMin: d.abonoMin, nightMin: d.nightMin, nightReducedMin: d.nightReducedMin, balanceMin: d.balanceMin }) })),
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
  async createJustification(ctx: RequestContext, input: { employeeId: string; day: string; kind: string; reason: string; attachmentUrl?: string; proposed?: Record<string, string> | null; approve?: boolean }) {
    this.requireOrg(ctx);
    const orgId = ctx.orgId!;
    if (!input.employeeId || !input.day || !input.reason?.trim()) throw new AppError(ErrorCode.ValidationFailed, "employeeId, day e motivo obrigatórios", 400);
    // "ajuste" = ajuste de horário (esqueceu de bater): guarda os horários propostos
    // e, ao aprovar, vira batida no espelho.
    const kinds = ["atraso", "falta", "saida_antecipada", "abono", "feriado", "facultativo", "folga_premium", "extra", "ajuste", "outro"];
    // approve = lançamento direto do ADMIN (no editar-dia): já entra aprovado,
    // justificando o dia na hora. Pedido do funcionário NUNCA passa approve.
    const approved = input.approve === true;
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoJustification.create({
      data: {
        organizationId: orgId, employeeId: input.employeeId, day: new Date(input.day),
        kind: kinds.includes(input.kind) ? input.kind : "outro", reason: input.reason.trim(),
        proposed: (input.proposed ?? undefined) as any, attachmentUrl: input.attachmentUrl ?? null,
        requestedBy: ctx.userId ?? null,
        ...(approved ? { status: "approved", reviewedBy: ctx.userId ?? null, reviewedAt: new Date() } : {}),
      },
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
    // orderBy signedAt DESC: defensivo. A unique constraint
    // (organizationId, employeeId, refMonth) garante 1 linha só, mas se por
    // algum motivo houver duplicata histórica (ex.: data com tz diferente),
    // sempre devolve a MAIS RECENTE — não a primeira que o engine encontra.
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoEspelhoSignature.findFirst({ where: { employeeId, refMonth: first }, orderBy: { signedAt: "desc" } }),
    );
    return row;
  }
  /** Assina o espelho do mês: A1 (ICP-Brasil) se houver; senão assinatura eletrônica de CONTINGÊNCIA (hash). */
  async signEspelho(ctx: RequestContext, input: { employeeId: string; refMonth: string; signatureImageUrl?: string | null; ip?: string | null }) {
    this.requireOrg(ctx);
    const orgId = ctx.orgId!;
    const { from, to, first } = this.monthRange(input.refMonth);
    // GATE: só permite assinar quando o RH FECHOU o mês.
    // O funcionário assina o mês anterior (fechado). Mês corrente está
    // aberto até o RH rodar `advanceClosing(to: "closed")`. Antes desse
    // gate, dava pra assinar qualquer mês — e o funcionário acabou
    // assinando junho enquanto só maio estava fechado.
    const closing = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.pontoClosing.findFirst({ where: { refMonth: first }, select: { status: true } }),
    ).catch(() => null);
    const status = closing?.status ?? "open";
    if (status !== "closed") {
      const monthLabel = input.refMonth.slice(0, 7);
      throw new AppError(
        ErrorCode.Conflict,
        `Mês ${monthLabel} ainda não foi fechado pelo RH (status: ${status}). A folha precisa estar fechada para você assinar — você só assina meses já encerrados.`,
        409,
      );
    }
    const esp = await this.espelho(ctx, { employeeId: input.employeeId, from, to });
    const hash = this.espelhoHash(esp);
    let a1Signed = false, a1Subject: string | null = null, p7sKey: string | null = null;
    const p7s = await this.sign.sign(orgId, Buffer.from(hash, "utf8")).catch(() => null);
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
  /** Desenha UM espelho COMPACTO no PDF — caber em UMA página A4.
   *
   *  Layout:
   *  - Linha colorida fininha (3px) no topo da página (não faixa grande)
   *  - Cabeçalho discreto: logo pequeno + nome da empresa de um lado, título
   *    do espelho + competência do outro (1 linha cada)
   *  - Bloco compacto de identificação do funcionário (2 linhas)
   *  - Tabela densa: header pequeno, linha de 12px, font 8pt
   *  - Totais em 1 linha
   *  - Carimbo de assinatura em 3 linhas
   *
   *  IMPORTANTE: muda só APRESENTAÇÃO. Os dados que entram no `espelhoHash`
   *  (d.day, d.punches, hm.workedMin/faltaMin/extraMin, totals) não mudam —
   *  assinatura existente continua válida.
   */
  private drawEspelhoInto(pdf: any, esp: any, sig: any, hashNow: string, from: string, logoBytes?: Buffer | null) {
    const M = 36, right = pdf.page.width - M, pageW = pdf.page.width, pageH = pdf.page.height;
    const brand = (esp.branding?.primaryColor as string) || "#7c3aed";
    const ink = "#111";
    const text = "#1f2937";
    const muted = "#6b7280";
    const stripeBg = "#f3f4f6";

    // ---- LINHA fininha no topo (3px) — não usa faixa grande pra não engolir o logo ----
    pdf.rect(0, 0, pageW, 3).fillColor(brand).fill();

    // ---- Cabeçalho discreto (logo + nome empresa à esquerda, título à direita) ----
    // Todas as coordenadas Y são absolutas e o pdf.y final é setado explicitamente
    // pra evitar o efeito colateral de pdf.text() (que move pdf.y mesmo com lineBreak:false).
    const headerY = 14;
    const logoSize = 28;
    let leftX = M;
    if (logoBytes) {
      try { pdf.image(logoBytes, M, headerY, { fit: [logoSize, logoSize] }); leftX = M + logoSize + 8; } catch { /* sem logo */ }
    }
    pdf.fillColor(ink).font("Helvetica-Bold").fontSize(11).text(esp.branding?.name || esp.employer || "Empregador", leftX, headerY + (logoBytes ? 3 : 0), { width: 280, lineBreak: false });
    if (esp.employer && esp.employer !== esp.branding?.name) {
      pdf.fillColor(muted).font("Helvetica").fontSize(8).text(esp.employer, leftX, headerY + 17, { width: 280, lineBreak: false });
    }
    // Lado direito: título + competência
    pdf.fillColor(brand).font("Helvetica-Bold").fontSize(13).text("Espelho de Ponto", M, headerY, { width: right - M, align: "right", lineBreak: false });
    pdf.fillColor(muted).font("Helvetica").fontSize(9).text(`Competência ${from.slice(0, 7)}`, M, headerY + 18, { width: right - M, align: "right", lineBreak: false });

    // Linha divisória cinza
    const dividerY = headerY + logoSize + 8;
    pdf.moveTo(M, dividerY).lineTo(right, dividerY).strokeColor("#e5e7eb").lineWidth(0.5).stroke();

    // ---- Identificação compacta (2 linhas) ----
    const idY1 = dividerY + 8;
    pdf.fillColor(ink).font("Helvetica-Bold").fontSize(10).text(esp.employee.name, M, idY1, { width: right - M, lineBreak: false });
    const idY2 = idY1 + 13;
    const idLine = [
      esp.employee.cargo ? esp.employee.cargo : null,
      esp.employee.cpf ? `CPF ${esp.employee.cpf}` : null,
      esp.employee.matricula ? `Matr. ${esp.employee.matricula}` : null,
      `Escala ${esp.schedule?.name ?? "—"}`,
    ].filter(Boolean).join("  ·  ");
    pdf.font("Helvetica").fontSize(8).fillColor(muted).text(idLine, M, idY2, { width: right - M, lineBreak: false });
    pdf.y = idY2 + 14;

    // ---- TABELA compacta ----
    const tableW = right - M;
    const cols = [
      { t: "Dia",        w: 60 },
      { t: "Marcações",  w: 240 },
      { t: "Trab.",      w: 55 },
      { t: "Extra",      w: 55 },
      { t: "Falta",      w: 55 },
    ];
    // ajusta a largura da coluna Marcações pra preencher exatamente tableW
    const fixedW = cols[0]!.w + cols[2]!.w + cols[3]!.w + cols[4]!.w;
    cols[1]!.w = tableW - fixedW;

    const ROW_H = 12;
    const NOTE_H = 10;
    const HEAD_H = 14;

    // Header da tabela: linha colorida fina + texto
    // IMPORTANTE: PDFKit `text()` ATUALIZA pdf.y mesmo com lineBreak:false
    // (move pra y + lineHeight). Se a gente não congelar pdf.y, os 5 textos
    // empilham incrementos e a linha cresce 5x — resultado: PDF de 11 páginas
    // em vez de 1. Sempre salvar o Y do início do bloco e resetar no fim.
    const tableTopY = pdf.y;
    const headStartY = pdf.y;
    pdf.rect(M, headStartY, tableW, HEAD_H).fillColor(brand).fill();
    pdf.fillColor("#fff").font("Helvetica-Bold").fontSize(7.5);
    let hx = M;
    for (const c of cols) {
      pdf.text(c.t.toUpperCase(), hx + 4, headStartY + 4, { width: c.w - 8, lineBreak: false });
      hx += c.w;
    }
    pdf.y = headStartY + HEAD_H;

    const KIND_LABEL: Record<string, string> = {
      atraso: "atraso", falta: "falta", saida_antecipada: "saída antecipada",
      abono: "abono", extra: "extra", outro: "outro",
    };

    pdf.font("Helvetica").fontSize(8);
    let rowIdx = 0;
    for (const d of esp.days as any[]) {
      const hasPunches = (d.punches?.length ?? 0) > 0;
      const isFolga = !d.isWorkDay && !hasPunches;
      const justified: boolean = !!d.justified;
      const just: any = (d.justifications ?? []).find((j: any) => j.status === "approved") ?? (d.justifications ?? [])[0] ?? null;
      const hasNote = justified && just?.reason;

      // Congela o Y do começo da linha — TODOS os 5 textos da linha são desenhados
      // nessa Y, e no fim resetamos pdf.y = rowStartY + ROW_H. Sem isso, cada
      // pdf.text() empurra pdf.y, e a "linha" cresce vertical descontroladamente.
      const rowStartY = pdf.y;

      // Zebra
      if (rowIdx % 2 === 1) {
        pdf.rect(M, rowStartY, tableW, ROW_H).fillColor(stripeBg).fill();
      }

      const showRed = d.divergence && !justified;
      const rowColor = showRed ? "#b91c1c" : text;

      const wd = new Date(d.day + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short", timeZone: "UTC" });
      let marcLabel: string;
      if (isFolga) {
        marcLabel = d.dsrLost ? "FOLGA (DSR perdido)" : "FOLGA";
      } else if (justified && !hasPunches) {
        marcLabel = `ABONO — ${KIND_LABEL[just?.kind as string] ?? just?.kind ?? "abonado"}`;
      } else {
        marcLabel = (d.punches || []).join("  ") || "—";
      }
      const trabTxt = isFolga ? "" : (d.hm?.workedMin ?? "");
      const extraTxt = isFolga ? "" : (d.hm?.extraMin ?? "");
      const faltaTxt = (isFolga || justified) ? "" : (d.hm?.faltaMin ?? "");

      const marcColor = isFolga ? muted : (justified && !hasPunches ? "#0e7490" : rowColor);
      const marcFont = (isFolga || (justified && !hasPunches)) ? "Helvetica-Oblique" : "Helvetica";

      const yText = rowStartY + 2.5;
      let cx = M;
      pdf.fillColor(rowColor).font("Helvetica").text(wd, cx + 4, yText, { width: cols[0]!.w - 8, lineBreak: false }); cx += cols[0]!.w;
      pdf.fillColor(marcColor).font(marcFont).text(marcLabel, cx + 4, yText, { width: cols[1]!.w - 8, lineBreak: false }); cx += cols[1]!.w;
      pdf.fillColor(rowColor).font("Helvetica").text(trabTxt, cx + 4, yText, { width: cols[2]!.w - 8, lineBreak: false }); cx += cols[2]!.w;
      pdf.text(extraTxt, cx + 4, yText, { width: cols[3]!.w - 8, lineBreak: false }); cx += cols[3]!.w;
      pdf.fillColor(showRed ? "#b91c1c" : rowColor).text(faltaTxt, cx + 4, yText, { width: cols[4]!.w - 8, lineBreak: false });

      pdf.y = rowStartY + ROW_H;

      // Motivo do abono — em 1 linha super compacta
      if (hasNote) {
        const noteStartY = pdf.y;
        pdf.font("Helvetica-Oblique").fontSize(6.5).fillColor(muted);
        pdf.text(`abono: ${String(just.reason).slice(0, 120)}`, M + cols[0]!.w + 4, noteStartY + 0.5, { width: cols[1]!.w + cols[2]!.w + cols[3]!.w + cols[4]!.w - 8, lineBreak: false });
        pdf.font("Helvetica").fontSize(8).fillColor(rowColor);
        pdf.y = noteStartY + NOTE_H;
      }
      rowIdx++;
    }

    // Borda fininha em volta da tabela inteira (header + linhas)
    const tableEndY = pdf.y;
    pdf.rect(M, tableTopY, tableW, tableEndY - tableTopY).strokeColor("#e5e7eb").lineWidth(0.5).stroke();

    pdf.y += 8;

    // ---- TOTAIS em 1 linha ----
    const totalsY = pdf.y;
    pdf.rect(M, totalsY, tableW, 22).fillColor(stripeBg).fill();
    pdf.fillColor(brand).font("Helvetica-Bold").fontSize(8).text("TOTAIS DO PERÍODO", M + 6, totalsY + 4, { width: 100, lineBreak: false });
    pdf.fillColor(text).font("Helvetica").fontSize(8.5).text(
      `Trab. ${esp.totals.hm.workedMin}   ·   Extra ${esp.totals.hm.extraMin}   ·   Falta ${esp.totals.hm.faltaMin}   ·   Abono ${esp.totals.hm.abonoMin ?? "00:00"}   ·   Not. ${esp.totals.hm.nightReducedMin ?? esp.totals.hm.nightMin ?? "00:00"}   ·   Saldo ${esp.totals.hm.balanceMin}`,
      M + 6, totalsY + 13, { width: tableW - 12, lineBreak: false },
    );
    pdf.y = totalsY + 28;

    // ---- ASSINATURA compacta ----
    const sigY = pdf.y;
    if (sig) {
      const integ = sig.contentHash === hashNow;
      const sigColor = integ ? "#047857" : "#b91c1c";
      pdf.fillColor(sigColor).font("Helvetica-Bold").fontSize(9).text(
        integ ? "✓ Espelho ASSINADO pelo funcionário" : "⚠ ATENÇÃO: o espelho foi alterado após a assinatura",
        M, sigY, { width: tableW, lineBreak: false },
      );
      pdf.fillColor(text).font("Helvetica").fontSize(7.5);
      const sigLine1 = `Assinado em ${new Date(sig.signedAt).toLocaleString("pt-BR")}${sig.signerIp ? ` · IP ${sig.signerIp}` : ""}`;
      const sigLine2 = sig.a1Signed
        ? `Assinatura digital ICP-Brasil (A1)${sig.a1Subject ? ` — ${sig.a1Subject}` : ""} · PKCS#7 anexo (.p7s)`
        : `Assinatura eletrônica (contingência) — MP 2.200-2/2001. Integridade por hash SHA-256.`;
      pdf.text(sigLine1, M, sigY + 12, { width: tableW, lineBreak: false });
      pdf.text(sigLine2, M, sigY + 22, { width: tableW, lineBreak: false });
      pdf.fontSize(6.5).fillColor(muted).text(`SHA-256: ${sig.contentHash}`, M, sigY + 32, { width: tableW, lineBreak: false });
      pdf.y = sigY + 42;
    } else {
      pdf.font("Helvetica-Oblique").fontSize(8.5).fillColor(muted).text("Espelho ainda não assinado pelo funcionário.", M, sigY, { width: tableW, lineBreak: false });
      pdf.y = sigY + 14;
    }
  }

  /** PDF do espelho do mês com carimbo de assinatura (A1 ou contingência) + hash de integridade. */
  async espelhoSignedPdf(ctx: RequestContext, employeeId: string, refMonth: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireOrg(ctx);
    const { from, to } = this.monthRange(refMonth);
    const esp = await this.espelho(ctx, { employeeId, from, to });
    const sig = await this.espelhoSignature(ctx, employeeId, refMonth);
    const hashNow = this.espelhoHash(esp);
    const logoBytes = await this.fetchLogoBytes(esp.branding?.logoUrl ?? null);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      this.drawEspelhoInto(pdf, esp, sig, hashNow, from, logoBytes);
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
  async espelhoBatchPdf(ctx: RequestContext, refMonth: string, opts?: { onlySigned?: boolean }): Promise<{ buffer: Buffer; filename: string; count: number }> {
    this.requireOrg(ctx);
    const { from, to, first } = this.monthRange(refMonth);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true } }));
    const prepared: Array<{ esp: any; sig: any; hash: string }> = [];
    for (const e of emps) {
      const esp = await this.espelho(ctx, { employeeId: e.id, from, to }).catch(() => null);
      if (!esp) continue;
      const sig = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEspelhoSignature.findFirst({ where: { employeeId: e.id, refMonth: first } })).catch(() => null);
      if (opts?.onlySigned && !sig) continue;
      prepared.push({ esp, sig, hash: this.espelhoHash(esp) });
    }
    // 1 fetch só por logo (todos os funcionários compartilham a mesma org)
    const logoBytes = prepared[0]?.esp?.branding?.logoUrl ? await this.fetchLogoBytes(prepared[0]!.esp.branding.logoUrl) : null;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 40 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      if (!prepared.length) { pdf.font("Helvetica").fontSize(11).fillColor("#666").text("Sem funcionários/espelhos no período.", 40, 60); }
      prepared.forEach((p, i) => { if (i > 0) pdf.addPage(); this.drawEspelhoInto(pdf, p.esp, p.sig, p.hash, from, logoBytes); });
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
