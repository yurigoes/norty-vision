import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationService } from "../notifications/notification.service";
import { JornadaService } from "./jornada.service";

const ADMIN = { isPlatformAdmin: true as const };

/**
 * Alertas automáticos de ponto (roda de hora em hora):
 *   • avisa o funcionário que NÃO registrou a entrada (passado start+60min) ou
 *     que registrou entrada mas NÃO a saída (passado end+60min) — 1x/dia/tipo;
 *   • envia ao gestor um RESUMO diário de divergências (após a hora configurada);
 *   • às segundas, alerta hora extra da semana anterior acima do limite.
 * Dedupe por ponto_alert_log; resumo via ponto_config.alertSummaryLast.
 */
@Injectable()
export class PontoAlertsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("PontoAlerts");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationService, private readonly jornada: JornadaService) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "1") return;
    setTimeout(() => this.tick(), 260_000);
    this.timer = setInterval(() => this.tick(), 60 * 60_000);
    this.logger.log("PontoAlerts iniciado (tick 1h)");
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private offMin(tz: string) { const s = tz.startsWith("-") ? -1 : 1; return s * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))); }
  private hhmm(s: string): number { const [h, m] = (s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try { await this.run(); }
    catch (e: any) { this.logger.error(`tick falhou: ${e?.message}`); }
    finally { this.running = false; }
  }

  private async run() {
    const configs = await this.prisma.runWithContext(ADMIN, (tx) => tx.pontoConfig.findMany({
      where: { alertsEnabled: true },
      select: { organizationId: true, timezone: true, alertWhatsapp: true, alertEmail: true, alertSummaryHour: true, overtimeWeeklyAlertMin: true, alertSummaryLast: true, razaoOuNome: true },
    })).catch(() => [] as any[]);
    for (const c of configs) {
      try { await this.runOrg(c); } catch (e: any) { this.logger.warn(`org ${c.organizationId} falhou: ${e?.message}`); }
    }
  }

  private async runOrg(c: any) {
    const orgId: string = c.organizationId;
    const orgCtx: any = { orgId, isOrgAdmin: true };
    const off = this.offMin(c.timezone || "-0300");
    const localNow = new Date(Date.now() + off * 60000);
    const todayIso = localNow.toISOString().slice(0, 10);
    const nowMin = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
    const nowHour = localNow.getUTCHours();
    const weekday = localNow.getUTCDay(); // 0=dom

    const emps = await this.prisma.runWithContext(orgCtx, (tx) => tx.pontoEmployee.findMany({
      where: { active: true, scheduleCode: { not: null } },
      select: { id: true, name: true, hrEmployeeId: true },
    })).catch(() => [] as any[]);
    if (!emps.length) return;

    // punches de hoje (janela ampla em UTC, agrupada por dia local)
    const winStart = new Date(Date.now() - 36 * 3600_000);
    const punches = await this.prisma.runWithContext(orgCtx, (tx) => tx.pontoPunch.findMany({
      where: { punchedAt: { gte: winStart } }, select: { employeeId: true, punchedAt: true },
    })).catch(() => [] as any[]);
    const countToday = new Map<string, number>();
    for (const p of punches) {
      const l = new Date(p.punchedAt.getTime() + off * 60000).toISOString().slice(0, 10);
      if (l === todayIso) countToday.set(p.employeeId, (countToday.get(p.employeeId) ?? 0) + 1);
    }

    // ---- alertas por funcionário (não bateu entrada / esqueceu saída) ----
    for (const e of emps) {
      const shifts = await this.jornada.scheduleShifts(orgCtx, e.id, todayIso, todayIso).catch(() => []);
      if (!shifts.length) continue; // folga hoje
      const startMin = this.hhmm(shifts[0]!.startTime);
      const endMin = this.hhmm(shifts[shifts.length - 1]!.endTime);
      const n = countToday.get(e.id) ?? 0;
      if (n === 0 && nowMin >= startMin + 60) {
        await this.fire(orgId, e, todayIso, "miss_in", `Olá ${this.first(e.name)}, notamos que você ainda não registrou a ENTRADA de hoje (escala ${shifts[0]!.startTime}). Se já trabalhou, registre o ponto ou abra uma justificativa no portal.`);
      } else if (n % 2 === 1 && nowMin >= endMin + 60) {
        await this.fire(orgId, e, todayIso, "miss_out", `Olá ${this.first(e.name)}, sua jornada de hoje está sem a SAÍDA registrada. Registre o ponto ou abra uma justificativa no portal.`);
      }
    }

    // ---- resumo diário ao gestor ----
    const summaryLast = c.alertSummaryLast ? new Date(c.alertSummaryLast).toISOString().slice(0, 10) : null;
    if (nowHour >= (c.alertSummaryHour ?? 20) && summaryLast !== todayIso && (c.alertWhatsapp || c.alertEmail)) {
      const div = await this.jornada.divergencias(orgCtx, { from: todayIso, to: todayIso }).catch(() => ({ items: [] as any[] }));
      const items: any[] = div.items ?? [];
      const faltas = items.filter((d) => d.faltaMin && d.faltaMin !== "00:00").length;
      const atrasos = items.filter((d) => d.lateMin && d.lateMin !== "00:00").length;
      const incompletas = items.filter((d) => d.incomplete).length;
      let text = `📋 Resumo do ponto de hoje (${todayIso.split("-").reverse().join("/")}) — ${c.razaoOuNome || "empresa"}:\n`;
      text += `• Faltas: ${faltas}\n• Atrasos: ${atrasos}\n• Marcações incompletas: ${incompletas}`;
      if (items.length === 0) text += `\n\nSem divergências hoje ✅`;
      else {
        const top = items.slice(0, 12).map((d) => `- ${d.employeeName}: ${[d.faltaMin && d.faltaMin !== "00:00" ? "falta" : "", d.lateMin && d.lateMin !== "00:00" ? `atraso ${d.lateMin}` : "", d.incomplete ? "incompleta" : ""].filter(Boolean).join(", ")}`).join("\n");
        text += `\n\n${top}`;
      }
      // hora extra semanal (segundas): semana anterior
      if (weekday === 1) {
        const last = await this.weeklyOvertime(orgCtx, todayIso, c.overtimeWeeklyAlertMin ?? 600).catch(() => [] as string[]);
        if (last.length) text += `\n\n⏱️ Hora extra acima do limite na semana passada:\n${last.join("\n")}`;
      }
      await this.notifications.notify({ organizationId: orgId, storeId: "", whatsappPhone: c.alertWhatsapp || null, email: c.alertEmail || null, subject: `Resumo do ponto — ${todayIso}`, text, templateCode: "ponto_resumo_gestor", variables: { data: todayIso.split("-").reverse().join("/"), faltas: String(faltas), atrasos: String(atrasos), incompletas: String(incompletas), empresa: c.razaoOuNome || "" } }).catch(() => undefined);
      await this.prisma.runWithContext(orgCtx, (tx) => tx.pontoConfig.update({ where: { organizationId: orgId }, data: { alertSummaryLast: new Date(todayIso + "T00:00:00Z") } })).catch(() => undefined);
    }
  }

  /** Soma de hora extra por funcionário na semana anterior (seg→dom); retorna linhas acima do limite. */
  private async weeklyOvertime(orgCtx: any, todayIso: string, limitMin: number): Promise<string[]> {
    const monday = new Date(todayIso + "T00:00:00Z"); monday.setUTCDate(monday.getUTCDate() - 7); // segunda passada
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    const from = monday.toISOString().slice(0, 10), to = sunday.toISOString().slice(0, 10);
    const div = await this.jornada.divergencias(orgCtx, { from, to });
    const byEmp = new Map<string, { name: string; min: number }>();
    const toMin = (hm: string) => { const neg = hm.startsWith("-"); const [h, m] = hm.replace("-", "").split(":").map(Number); const v = (h || 0) * 60 + (m || 0); return neg ? -v : v; };
    for (const d of (div.items ?? []) as any[]) {
      if (!d.extraMin || d.extraMin === "00:00") continue;
      const cur = byEmp.get(d.employeeId) ?? { name: d.employeeName, min: 0 };
      cur.min += toMin(d.extraMin); byEmp.set(d.employeeId, cur);
    }
    const fmt = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
    return [...byEmp.values()].filter((e) => e.min >= limitMin).map((e) => `- ${e.name}: ${fmt(e.min)}`);
  }

  private first(name: string) { return String(name || "").split(" ")[0]; }

  /** Notifica o funcionário (via HR vinculado) e registra no log (dedupe por dia/tipo). */
  private async fire(orgId: string, emp: any, dayIso: string, kind: string, text: string) {
    const orgCtx: any = { orgId, isOrgAdmin: true };
    // dedupe: tenta logar; se já existir (unique), não reenvia.
    try {
      await this.prisma.runWithContext(orgCtx, (tx) => tx.pontoAlertLog.create({ data: { organizationId: orgId, employeeId: emp.id, day: new Date(dayIso + "T00:00:00Z"), kind } }));
    } catch { return; } // já enviado hoje
    let whatsapp: string | null = null, email: string | null = null, storeId = "";
    if (emp.hrEmployeeId) {
      const hr = await this.prisma.runWithContext(orgCtx, (tx) => tx.employee.findFirst({ where: { id: emp.hrEmployeeId }, select: { whatsappPhone: true, phone: true, email: true, storeId: true } })).catch(() => null);
      whatsapp = hr?.whatsappPhone || hr?.phone || null; email = hr?.email || null; storeId = hr?.storeId ?? "";
    }
    if (!whatsapp && !email) return;
    await this.notifications.notify({
      organizationId: orgId, storeId, whatsappPhone: whatsapp, email, subject: "Aviso de ponto", text,
      templateCode: "ponto_falta_marcacao",
      variables: { "funcionario.nome": emp.name, "funcionario.primeiro_nome": this.first(emp.name), tipo: kind === "miss_in" ? "entrada" : "saída" },
    }).catch(() => undefined);
  }
}
