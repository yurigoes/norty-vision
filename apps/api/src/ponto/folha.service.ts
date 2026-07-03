import { Injectable } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { JornadaService } from "./jornada.service";
import { OrgAiService } from "../ai/org-ai.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Fase 4/5 — Banco de horas, Fechamento de folha, Dashboard em tempo real e IA de absenteísmo.
 */
@Injectable()
export class FolhaService {
  constructor(private readonly prisma: PrismaService, private readonly jornada: JornadaService, private readonly orgAi: OrgAiService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }

  // ----- BANCO DE HORAS -----
  async listBank(ctx: RequestContext, employeeId: string) {
    this.requireAdmin(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.findMany({ where: { employeeId }, orderBy: { day: "desc" }, take: 500 }));
    const balance = rows.reduce((s, r) => s + r.minutes, 0);
    // vencimento (CLT): créditos com mais de N meses ainda não compensados/expirados.
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { bankExpiryMonths: true } })).catch(() => null);
    const months = cfg?.bankExpiryMonths ?? 6;
    let expiringMin = 0; let cutoffIso: string | null = null;
    if (months > 0 && balance > 0) {
      const cutoff = new Date(); cutoff.setUTCHours(0, 0, 0, 0); cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
      cutoffIso = cutoff.toISOString().slice(0, 10);
      // FIFO simplificado: soma de créditos+débitos até o cutoff; se positivo, é o saldo "antigo" a vencer.
      const oldNet = rows.filter((r) => new Date(r.day) <= cutoff && r.kind !== "expiry").reduce((s, r) => s + r.minutes, 0);
      expiringMin = Math.max(0, Math.min(balance, oldNet));
    }
    return { items: rows, balanceMin: balance, expiringMin, expiryMonths: months, cutoff: cutoffIso };
  }

  /** Baixa por vencimento: lança um débito (expiry) zerando o saldo antigo vencido. */
  async expireBank(ctx: RequestContext, employeeId: string) {
    this.requireAdmin(ctx);
    const { expiringMin } = await this.listBank(ctx, employeeId);
    if (!expiringMin || expiringMin <= 0) throw new AppError(ErrorCode.ValidationFailed, "Nada a vencer", 400);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.create({
      data: { organizationId: ctx.orgId!, employeeId, day: new Date(), minutes: -expiringMin, kind: "expiry", reason: "baixa por vencimento (CLT)", createdByUserId: ctx.userId ?? null },
    }));
    return { id: row.id, expiredMin: expiringMin };
  }
  async addBank(ctx: RequestContext, input: { employeeId: string; day: string; minutes: number; kind?: string; reason?: string }) {
    this.requireAdmin(ctx);
    if (!input.employeeId || !input.day || !Number.isFinite(input.minutes) || input.minutes === 0) throw new AppError(ErrorCode.ValidationFailed, "employeeId, day e minutos (≠0) obrigatórios", 400);
    const kind = ["inclusion", "compensation", "expiry"].includes(input.kind ?? "") ? input.kind! : (input.minutes >= 0 ? "inclusion" : "compensation");
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.create({
      data: { organizationId: ctx.orgId!, employeeId: input.employeeId, day: new Date(input.day), minutes: Math.round(input.minutes), kind, reason: (input.reason || "").slice(0, 300) || null, createdByUserId: ctx.userId ?? null },
    }));
    return { id: row.id };
  }
  async removeBank(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.delete({ where: { id } }));
    return { ok: true };
  }

  // ----- FÉRIAS -----
  /** Data de admissão do ponto-employee (via funcionário do RH vinculado). */
  private async admissionDate(ctx: RequestContext, employeeId: string): Promise<Date | null> {
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: employeeId }, select: { hrEmployeeId: true } }));
    if (!emp?.hrEmployeeId) return null;
    const hr = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.findFirst({ where: { id: emp.hrEmployeeId! }, select: { admissionDate: true } }));
    return hr?.admissionDate ?? null;
  }

  /** Saldo de férias: a cada 12 meses de admissão = 30 dias; menos os dias agendados/gozados. */
  async vacationBalance(ctx: RequestContext, employeeId: string) {
    this.requireAdmin(ctx);
    const adm = await this.admissionDate(ctx, employeeId);
    const vacs = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.findMany({ where: { employeeId, status: { not: "canceled" } }, select: { days: true } }));
    const usedDays = vacs.reduce((s, v) => s + v.days, 0);
    if (!adm) return { admissionDate: null, completedPeriods: 0, accruedDays: null, usedDays, balanceDays: null, nextPeriodStart: null };
    const now = new Date();
    const months = (now.getUTCFullYear() - adm.getUTCFullYear()) * 12 + (now.getUTCMonth() - adm.getUTCMonth()) - (now.getUTCDate() < adm.getUTCDate() ? 1 : 0);
    const completedPeriods = Math.max(0, Math.floor(months / 12));
    const accruedDays = completedPeriods * 30;
    const next = new Date(Date.UTC(adm.getUTCFullYear() + completedPeriods + 1, adm.getUTCMonth(), adm.getUTCDate()));
    return { admissionDate: adm.toISOString().slice(0, 10), completedPeriods, accruedDays, usedDays, balanceDays: accruedDays - usedDays, nextPeriodStart: next.toISOString().slice(0, 10) };
  }

  async listVacations(ctx: RequestContext, employeeId: string) {
    this.requireAdmin(ctx);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.findMany({ where: { employeeId }, orderBy: { startDate: "desc" }, take: 200 }));
    return { items };
  }

  async createVacation(ctx: RequestContext, input: { employeeId: string; startDate: string; days?: number; thirteenthAdvance?: boolean; notes?: string }) {
    this.requireAdmin(ctx);
    if (!input.employeeId || !input.startDate) throw new AppError(ErrorCode.ValidationFailed, "Funcionário e início obrigatórios", 400);
    const days = Math.max(1, Math.min(30, Math.trunc(Number(input.days) || 30)));
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.create({
      data: { organizationId: ctx.orgId!, employeeId: input.employeeId, startDate: new Date(input.startDate + "T00:00:00Z"), days, thirteenthAdvance: !!input.thirteenthAdvance, notes: (input.notes || "").slice(0, 500) || null, createdBy: ctx.userId ?? null },
    }));
    return { id: row.id };
  }

  async setVacationStatus(ctx: RequestContext, id: string, status: "scheduled" | "taken" | "canceled") {
    this.requireAdmin(ctx);
    const st = ["scheduled", "taken", "canceled"].includes(status) ? status : "scheduled";
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.update({ where: { id }, data: { status: st, updatedAt: new Date() } }));
    return { ok: true };
  }

  async removeVacation(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.deleteMany({ where: { id } }));
    return { ok: true };
  }

  /** Recibo de férias em PDF (aviso + recibo simples). */
  async vacationReceiptPdf(ctx: RequestContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
    this.requireAdmin(ctx);
    const v = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoVacation.findFirst({ where: { id } }));
    if (!v) throw new AppError(ErrorCode.NotFound, "Férias não encontradas", 404);
    const [emp, cfg, org] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: v.employeeId }, select: { name: true, cpf: true, matricula: true, cargo: true } })),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { razaoOuNome: true } })),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: {}, select: { name: true } })),
    ]);
    const start = new Date(v.startDate); const end = new Date(start); end.setUTCDate(end.getUTCDate() + v.days - 1);
    const ret = new Date(end); ret.setUTCDate(ret.getUTCDate() + 1);
    const d = (x: Date) => x.toLocaleDateString("pt-BR", { timeZone: "UTC" });
    const employer = cfg?.razaoOuNome || org?.name || "Empresa";
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = []; pdf.on("data", (c) => chunks.push(c as Buffer)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
      pdf.font("Helvetica-Bold").fontSize(15).fillColor("#111").text(employer, { align: "center" });
      pdf.moveDown(0.3).fontSize(13).text("Aviso e Recibo de Férias", { align: "center" });
      pdf.moveDown(1).font("Helvetica").fontSize(11).fillColor("#222");
      pdf.text(`Empregado(a): ${emp?.name ?? ""}${emp?.cargo ? ` — ${emp.cargo}` : ""}`);
      if (emp?.cpf) pdf.text(`CPF: ${emp.cpf}`);
      if (emp?.matricula) pdf.text(`Matrícula: ${emp.matricula}`);
      pdf.moveDown(0.8);
      pdf.text(`Comunicamos que suas férias serão concedidas conforme abaixo, nos termos da CLT:`);
      pdf.moveDown(0.5).font("Helvetica-Bold");
      pdf.text(`Período de gozo: ${d(start)} a ${d(end)} (${v.days} dias)`);
      pdf.text(`Retorno ao trabalho: ${d(ret)}`);
      if (v.thirteenthAdvance) pdf.text(`Com adiantamento da 1ª parcela do 13º salário.`);
      pdf.font("Helvetica").moveDown(1.2);
      pdf.text("Declaro estar ciente do período de férias acima e do recebimento da respectiva remuneração.", { align: "justify" });
      pdf.moveDown(3);
      pdf.text("__________________________________________", { align: "center" });
      pdf.text(`${emp?.name ?? "Empregado(a)"}`, { align: "center" });
      pdf.moveDown(0.5).fontSize(9).fillColor("#666").text(`Emitido em ${new Date().toLocaleString("pt-BR")}`, { align: "center" });
      pdf.end();
    });
    return { buffer, filename: `recibo-ferias-${start.toISOString().slice(0, 10)}.pdf` };
  }
  /** Joga o saldo de cada dia do período (balanceMin do espelho) no banco de horas. */
  async sweepPeriodToBank(ctx: RequestContext, input: { from: string; to: string; employeeId?: string }) {
    this.requireAdmin(ctx);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true, ...(input.employeeId ? { id: input.employeeId } : {}) }, select: { id: true } }));
    let created = 0;
    for (const e of emps) {
      const esp = await this.jornada.espelho(ctx, { employeeId: e.id, from: input.from, to: input.to });
      for (const d of esp.days as any[]) {
        if (!d.balanceMin || d.balanceMin === 0) continue;
        await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.create({
          data: { organizationId: ctx.orgId!, employeeId: e.id, day: new Date(d.day), minutes: d.balanceMin, kind: d.balanceMin >= 0 ? "inclusion" : "compensation", reason: "saldo do dia (apuração)", createdByUserId: ctx.userId ?? null },
        }));
        created++;
      }
    }
    return { created };
  }

  // ----- FECHAMENTO DE FOLHA -----
  private monthFirst(ref: string) { const [y, m] = ref.split("-").map(Number); return new Date(Date.UTC(y!, (m! - 1), 1)); }
  private monthRange(ref: string) {
    const f = this.monthFirst(ref); const to = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { from: iso(f), to: iso(to), first: f };
  }

  async listClosings(ctx: RequestContext) {
    this.requireAdmin(ctx);
    return { items: await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.findMany({ where: {}, orderBy: { refMonth: "desc" }, take: 24 })) };
  }
  /** Calcula o resumo do mês (totais por funcionário) — base do fechamento e do export. */
  async summary(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const { from, to } = this.monthRange(refMonth);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, select: { id: true, name: true, cpf: true, matricula: true, matEsocial: true } }));
    const rows: any[] = [];
    for (const e of emps) {
      const esp = await this.jornada.espelho(ctx, { employeeId: e.id, from, to });
      const t = esp.totals as any;
      const bank = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.findMany({ where: { employeeId: e.id }, select: { minutes: true } }));
      rows.push({
        employeeId: e.id, name: e.name, cpf: e.cpf, matricula: e.matricula, matEsocial: e.matEsocial,
        expectedMin: t.expectedMin, workedMin: t.workedMin, extraMin: t.extraMin, nightMin: t.nightMin,
        lateMin: t.lateMin, faltaMin: t.faltaMin, balanceMin: t.balanceMin, bankBalanceMin: bank.reduce((s, b) => s + b.minutes, 0),
      });
    }
    return { refMonth, from, to, rows };
  }
  async getClosing(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const { first } = this.monthRange(refMonth);
    const c = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.findFirst({ where: { refMonth: first } }));
    return c ?? { status: "open", refMonth: first };
  }
  /** Avança o fechamento: open→manager (gestor) →closed (RH). Tira snapshot do resumo. */
  async advanceClosing(ctx: RequestContext, refMonth: string, to: "manager" | "closed") {
    this.requireAdmin(ctx);
    const { first } = this.monthRange(refMonth);
    const sum = await this.summary(ctx, refMonth);
    const data: any = { summary: sum as any, updatedAt: new Date() };
    if (to === "manager") { data.status = "manager"; data.managerAt = new Date(); data.managerBy = ctx.userId ?? null; }
    if (to === "closed") { data.status = "closed"; data.hrAt = new Date(); data.hrBy = ctx.userId ?? null; }
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.upsert({
      where: { organizationId_refMonth: { organizationId: ctx.orgId!, refMonth: first } },
      update: data, create: { organizationId: ctx.orgId!, refMonth: first, ...data },
    }));
    return this.getClosing(ctx, refMonth);
  }
  async reopenClosing(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const { first } = this.monthRange(refMonth);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoClosing.update({ where: { organizationId_refMonth: { organizationId: ctx.orgId!, refMonth: first } }, data: { status: "open", updatedAt: new Date() } }));
    return this.getClosing(ctx, refMonth);
  }

  /** Export genérico CSV do fechamento (importável; layouts TOTVS/Domínio/Senior são adaptadores futuros). */
  async exportCsv(ctx: RequestContext, refMonth: string): Promise<string> {
    const sum = await this.summary(ctx, refMonth);
    const hm = (m: number) => `${m < 0 ? "-" : ""}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
    const head = ["cpf", "matricula", "mat_esocial", "nome", "previstas", "trabalhadas", "extras", "noturnas", "atrasos", "faltas", "saldo_mes", "banco_horas"].join(";");
    const lines = sum.rows.map((r: any) => [r.cpf ?? "", r.matricula ?? "", r.matEsocial ?? "", r.name, hm(r.expectedMin), hm(r.workedMin), hm(r.extraMin), hm(r.nightMin), hm(r.lateMin), hm(r.faltaMin), hm(r.balanceMin), hm(r.bankBalanceMin)].join(";"));
    return [head, ...lines].join("\r\n");
  }

  // ----- DASHBOARD EM TEMPO REAL -----
  /** Quem está trabalhando agora, atrasos do dia e feed das últimas marcações. */
  async realtime(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, select: { id: true, name: true } }));
    const nameOf = new Map(emps.map((e) => [e.id, e.name]));
    const todays = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findMany({ where: { punchedAt: { gte: dayStart } }, orderBy: { punchedAt: "asc" }, select: { employeeId: true, punchedAt: true, origin: true } }));
    const byEmp = new Map<string, Date[]>();
    for (const p of todays) (byEmp.get(p.employeeId) ?? byEmp.set(p.employeeId, []).get(p.employeeId)!).push(p.punchedAt);
    const present: { id: string; name: string; since: Date }[] = [];
    for (const [id, list] of byEmp) if (list.length % 2 === 1) present.push({ id, name: nameOf.get(id) ?? "—", since: list[list.length - 1]! });
    const last = [...todays].reverse().slice(0, 20).map((p) => ({ name: nameOf.get(p.employeeId) ?? "—", at: p.punchedAt, origin: p.origin }));
    return {
      totalActive: emps.length,
      presentCount: present.length,
      present: present.sort((a, b) => b.since.getTime() - a.since.getTime()),
      absentCount: emps.length - byEmp.size, // ninguém bateu hoje
      lastPunches: last,
    };
  }

  // ----- IA DE ABSENTEÍSMO -----
  /** Estatística de faltas/atrasos do período + leitura da IA (best-effort). */
  async absenteismo(ctx: RequestContext, refMonth: string) {
    this.requireAdmin(ctx);
    const sum = await this.summary(ctx, refMonth);
    const ranked = [...sum.rows].map((r: any) => ({ name: r.name, faltaMin: r.faltaMin, lateMin: r.lateMin })).sort((a, b) => (b.faltaMin + b.lateMin) - (a.faltaMin + a.lateMin));
    const totalFaltaMin = ranked.reduce((s, r) => s + r.faltaMin, 0);
    const totalLateMin = ranked.reduce((s, r) => s + r.lateMin, 0);
    let insight: string | null = null;
    if (ranked.length) {
      const top = ranked.slice(0, 8).map((r) => `${r.name}: ${Math.round(r.faltaMin / 60)}h falta, ${r.lateMin}min atraso`).join("; ");
      insight = await this.orgAi.complete(
        ctx.orgId!,
        "Você é um analista de RH. Em português do Brasil, escreva uma leitura curta (até 4 frases) sobre absenteísmo da equipe no mês: aponte padrões/risco e 1 ação prática. Seja objetivo e respeitoso.",
        `Mês ${refMonth}. Total faltas ${Math.round(totalFaltaMin / 60)}h, atrasos ${totalLateMin}min. Por pessoa: ${top}.`,
      ).catch(() => null);
    }
    return { refMonth, totalFaltaMin, totalLateMin, ranked, insight };
  }
}
