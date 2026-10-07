import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { PontoSignService } from "./sign.service";
import { JornadaService } from "./jornada.service";
import { NotificationService } from "../notifications/notification.service";

type PortalActor = { organizationId: string; employeeId: string; ip?: string | null };
type RhCtx = { orgId?: string | null; userId?: string | null; isOrgAdmin?: boolean; isPlatformAdmin?: boolean };

const REST_MIN = 11 * 60;        // intervalo interjornada mínimo (CLT art. 66)
const ADVANCE_MS = 48 * 3600_000; // antecedência mínima para solicitar/aplicar

@Injectable()
export class ShiftSwapService {
  private readonly logger = new Logger("ShiftSwap");
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sign: PontoSignService,
    private readonly jornada: JornadaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Contexto org-scoped pra RLS (leitura/escrita). */
  private octx(orgId: string): any { return { orgId, isOrgAdmin: true }; }
  private iso(d: Date | string): string { return typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10); }
  private dt(isoDay: string): Date { return new Date(isoDay + "T00:00:00Z"); }

  // ---- minutos de um conjunto de segmentos ["HH:MM","HH:MM"] (trata virada de meia-noite) ----
  private hhmm(s: string): number { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); }
  private dayBounds(pairs: [string, string][]): { first: number; last: number } | null {
    if (!pairs || pairs.length === 0) return null;
    const first = this.hhmm(pairs[0]![0]);
    const lastPair = pairs[pairs.length - 1]!;
    let end = this.hhmm(lastPair[1]); const start = this.hhmm(lastPair[0]); if (end <= start) end += 1440;
    return { first, last: end };
  }

  // ============================ regras ============================
  /** Avalia regras da troca. Retorna { warnings, blocks }. blocks impedem aprovar/aplicar. */
  private async evaluateRules(orgId: string, swap: {
    requesterPontoId: string | null; colleaguePontoId: string | null;
    swapType: string; swapDate: string; counterpartDate: string | null;
    // segmentos resultantes que cada ponto_employee terá APÓS a troca, por data
    resultSegs: Record<string, Record<string, [string, string][]>>; // pontoId -> isoDay -> segs
  }): Promise<{ warnings: string[]; blocks: string[] }> {
    const warnings: string[] = []; const blocks: string[] = [];
    const now = Date.now();
    const dates = [swap.swapDate, ...(swap.counterpartDate ? [swap.counterpartDate] : [])];
    // 48h de antecedência
    for (const d of dates) {
      if (this.dt(d).getTime() - now < ADVANCE_MS) { blocks.push(`A data ${this.brDate(d)} não respeita a antecedência mínima de 48h.`); break; }
    }
    // 11h de intervalo interjornada + DSR semanal, por funcionário afetado
    const ctx = this.octx(orgId);
    for (const [pontoId, byDay] of Object.entries(swap.resultSegs)) {
      if (!pontoId) continue;
      for (const [day, segs] of Object.entries(byDay)) {
        const cur = this.dayBounds(segs);
        if (cur) {
          // dia anterior
          const prevIso = this.iso(new Date(this.dt(day).getTime() - 86400_000));
          const prevSegs = byDay[prevIso] ?? await this.jornada.rawSegmentsForDay(ctx, pontoId, prevIso).catch(() => []);
          const prev = this.dayBounds(prevSegs as [string, string][]);
          if (prev) { const gap = (1440 - prev.last) + cur.first; if (gap < REST_MIN) blocks.push(`Intervalo de descanso < 11h em ${this.brDate(day)} (entrada após a jornada anterior).`); }
          // dia seguinte
          const nextIso = this.iso(new Date(this.dt(day).getTime() + 86400_000));
          const nextSegs = byDay[nextIso] ?? await this.jornada.rawSegmentsForDay(ctx, pontoId, nextIso).catch(() => []);
          const next = this.dayBounds(nextSegs as [string, string][]);
          if (next) { const gap = (1440 - cur.last) + next.first; if (gap < REST_MIN) blocks.push(`Intervalo de descanso < 11h após ${this.brDate(day)}.`); }
        }
        // DSR: a semana (seg→dom) do dia precisa manter ao menos 1 folga
        const wk = this.weekDays(day);
        let folgas = 0;
        for (const wd of wk) {
          const s = byDay[wd] ?? await this.jornada.rawSegmentsForDay(ctx, pontoId, wd).catch(() => []);
          if (!s || (s as any[]).length === 0) folgas++;
        }
        if (folgas === 0) warnings.push(`Sem folga na semana de ${this.brDate(day)} — verifique o descanso semanal (DSR).`);
      }
    }
    return { warnings: [...new Set(warnings)], blocks: [...new Set(blocks)] };
  }
  private weekDays(isoDay: string): string[] {
    const dt = this.dt(isoDay); const dow = (dt.getUTCDay() + 6) % 7; const mon = new Date(dt.getTime() - dow * 86400_000);
    return Array.from({ length: 7 }, (_, i) => this.iso(new Date(mon.getTime() + i * 86400_000)));
  }
  private brDate(isoDay: string): string { const [y, m, d] = isoDay.split("-"); return `${d}/${m}/${y}`; }

  // ============================ assinatura ============================
  private async signAs(orgId: string, payload: Record<string, unknown>, label: string): Promise<{ hash: string; a1: boolean; p7sKey: string | null }> {
    const content = JSON.stringify(payload);
    const hash = createHash("sha256").update(content).digest("hex");
    const p7s = await this.sign.sign(orgId, Buffer.from(hash, "utf8")).catch(() => null);
    if (!p7s) return { hash, a1: false, p7sKey: null };
    const { key } = await this.storage.putPrivate({ keyPrefix: `ponto/swap/${orgId}`, contentType: "application/pkcs7-signature", body: p7s, originalName: `${label}.p7s` });
    return { hash, a1: true, p7sKey: key };
  }
  private sigPayload(swap: any, role: string): Record<string, unknown> {
    return { swapId: swap.id, role, type: swap.swapType, swapDate: this.iso(swap.swapDate), counterpartDate: swap.counterpartDate ? this.iso(swap.counterpartDate) : null, requester: swap.requesterEmployeeId, colleague: swap.colleagueEmployeeId };
  }

  // ============================ helpers de dados ============================
  private async emp(orgId: string, id: string) {
    return this.prisma.runWithContext(this.octx(orgId), (tx) => tx.employee.findFirst({ where: { id }, select: { id: true, name: true, leaderId: true, storeId: true, employerId: true, email: true, whatsappPhone: true, phone: true, status: true } }));
  }
  private async pontoIdOf(orgId: string, hrEmployeeId: string): Promise<string | null> {
    const r = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoEmployee.findFirst({ where: { hrEmployeeId }, select: { id: true } }));
    return r?.id ?? null;
  }
  private async notifyEmp(orgId: string, e: { storeId: string | null; email: string | null; whatsappPhone: string | null; phone: string | null } | null, subject: string, text: string) {
    if (!e || !e.storeId) return;
    try { await this.notifications.notify({ organizationId: orgId, storeId: e.storeId, whatsappPhone: e.whatsappPhone ?? e.phone ?? null, email: e.email ?? null, subject, text }); }
    catch (err: any) { this.logger.warn(`notify troca falhou: ${err?.message}`); }
  }

  // ============================ ciclo de vida ============================
  /** A solicita a troca a um colega B e assina. */
  async request(actor: PortalActor, input: { colleagueEmployeeId: string; swapType: "horario" | "folga"; swapDate: string; counterpartDate?: string | null; reason?: string | null }) {
    const orgId = actor.organizationId;
    if (!input.colleagueEmployeeId || input.colleagueEmployeeId === actor.employeeId) throw new AppError(ErrorCode.ValidationFailed, "Escolha um colega válido (diferente de você)", 400);
    if (!input.swapDate) throw new AppError(ErrorCode.ValidationFailed, "Data da troca obrigatória", 400);
    const type = input.swapType === "folga" ? "folga" : "horario";
    if (type === "folga" && !input.counterpartDate) throw new AppError(ErrorCode.ValidationFailed, "Troca de folga exige a data em que você cobre o colega", 400);
    const requester = await this.emp(orgId, actor.employeeId);
    const colleague = await this.emp(orgId, input.colleagueEmployeeId);
    if (!colleague || colleague.status !== "active") throw new AppError(ErrorCode.NotFound, "Colega não encontrado", 404);
    // troca só entre funcionários do MESMO empregador (CNPJ) — mesmo que sejam da mesma equipe
    if ((requester?.employerId ?? null) !== (colleague.employerId ?? null)) throw new AppError(ErrorCode.ValidationFailed, "Só é possível trocar com colega do mesmo empregador (CNPJ)", 400);
    const swapDate = this.iso(input.swapDate);
    const counterpartDate = type === "folga" ? this.iso(input.counterpartDate!) : null;
    // pré-avaliação (não bloqueia o pedido; só registra avisos)
    const preview = await this.previewResult(orgId, type, actor.employeeId, input.colleagueEmployeeId, swapDate, counterpartDate);
    const { warnings, blocks } = await this.evaluateRules(orgId, preview);
    if (blocks.length) throw new AppError(ErrorCode.ValidationFailed, blocks.join(" "), 400);

    const created = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.create({
      data: {
        organizationId: orgId, requesterEmployeeId: actor.employeeId, colleagueEmployeeId: input.colleagueEmployeeId,
        leaderEmployeeId: requester?.leaderId ?? null, swapType: type, swapDate: this.dt(swapDate), counterpartDate: counterpartDate ? this.dt(counterpartDate) : null,
        reason: input.reason ?? null, status: "pending_colleague", ruleWarnings: warnings as any,
      },
    }));
    const sig = await this.signAs(orgId, this.sigPayload(created, "requester"), `swap-${created.id}-A`);
    const swap = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({
      where: { id: created.id }, data: { requesterSignedAt: new Date(), requesterSigHash: sig.hash, requesterA1: sig.a1, requesterP7sKey: sig.p7sKey },
    }));
    await this.notifyEmp(orgId, colleague, "Pedido de troca de turno", `${requester?.name ?? "Um colega"} solicitou uma troca de ${type === "folga" ? "folga" : "turno"} em ${this.brDate(swapDate)}. Abra o portal para aceitar ou recusar.`);
    return swap;
  }

  /** Calcula os segmentos resultantes (por ponto_employee/dia) de uma troca — base das regras e da aplicação. */
  private async previewResult(orgId: string, type: string, requesterHrId: string, colleagueHrId: string, swapDate: string, counterpartDate: string | null) {
    const ctx = this.octx(orgId);
    const aId = await this.pontoIdOf(orgId, requesterHrId);
    const bId = await this.pontoIdOf(orgId, colleagueHrId);
    const resultSegs: Record<string, Record<string, [string, string][]>> = {};
    if (aId) resultSegs[aId] = {}; if (bId) resultSegs[bId] = {};
    const segOf = async (pid: string | null, day: string) => pid ? (await this.jornada.rawSegmentsForDay(ctx, pid, day).catch(() => [])) as [string, string][] : [];
    if (type === "horario") {
      const aSeg = await segOf(aId, swapDate); const bSeg = await segOf(bId, swapDate);
      if (aId) resultSegs[aId]![swapDate] = bSeg;  // A passa a fazer o turno de B
      if (bId) resultSegs[bId]![swapDate] = aSeg;  // B passa a fazer o turno de A
    } else {
      // folga: A folga no swapDate (B cobre) e A cobre no counterpartDate (B folga)
      const aSwap = await segOf(aId, swapDate);          // turno original de A no swapDate
      const bCounter = await segOf(bId, counterpartDate!); // turno original de B no counterpartDate
      if (aId) { resultSegs[aId]![swapDate] = []; resultSegs[aId]![counterpartDate!] = bCounter; }
      if (bId) { resultSegs[bId]![swapDate] = aSwap; resultSegs[bId]![counterpartDate!] = []; }
    }
    return { requesterPontoId: aId, colleaguePontoId: bId, swapType: type, swapDate, counterpartDate, resultSegs };
  }

  /** Colega aceita/recusa e assina. */
  async colleagueDecide(actor: PortalActor, id: string, accept: boolean, note?: string | null) {
    const orgId = actor.organizationId;
    const swap = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.findFirst({ where: { id } }));
    if (!swap) throw new AppError(ErrorCode.NotFound, "Troca não encontrada", 404);
    if (swap.colleagueEmployeeId !== actor.employeeId) throw new AppError(ErrorCode.Forbidden, "Você não é o colega desta troca", 403);
    if (swap.status !== "pending_colleague") throw new AppError(ErrorCode.Conflict, "Troca já decidida", 409);
    if (!accept) {
      const r = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({ where: { id }, data: { status: "rejected", rejectedBy: "colleague", rejectReason: note ?? null, colleagueNote: note ?? null, colleagueSignedAt: new Date() } }));
      await this.notifyEmp(orgId, await this.emp(orgId, swap.requesterEmployeeId), "Troca recusada", `Seu colega recusou a troca de ${this.brDate(this.iso(swap.swapDate))}.`);
      return r;
    }
    const sig = await this.signAs(orgId, this.sigPayload(swap, "colleague"), `swap-${id}-B`);
    const next = swap.leaderEmployeeId ? "pending_leader" : "pending_leader"; // sem líder => RH aprova (leaderEmployeeId null)
    const r = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({
      where: { id }, data: { status: next, colleagueSignedAt: new Date(), colleagueSigHash: sig.hash, colleagueA1: sig.a1, colleagueP7sKey: sig.p7sKey, colleagueNote: note ?? null },
    }));
    if (swap.leaderEmployeeId) await this.notifyEmp(orgId, await this.emp(orgId, swap.leaderEmployeeId), "Troca aguardando sua aprovação", `Há uma troca de turno da sua equipe aguardando aprovação (${this.brDate(this.iso(swap.swapDate))}). Abra o portal.`);
    return r;
  }

  /** Líder aprova/reprova e assina (no portal /rh). */
  async leaderDecide(actor: PortalActor, id: string, approve: boolean, note?: string | null) {
    const orgId = actor.organizationId;
    const swap = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.findFirst({ where: { id } }));
    if (!swap) throw new AppError(ErrorCode.NotFound, "Troca não encontrada", 404);
    if (swap.leaderEmployeeId !== actor.employeeId) throw new AppError(ErrorCode.Forbidden, "Você não é o líder desta troca", 403);
    if (swap.status !== "pending_leader") throw new AppError(ErrorCode.Conflict, "Troca não está aguardando o líder", 409);
    if (!approve) {
      const r = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({ where: { id }, data: { status: "rejected", rejectedBy: "leader", rejectReason: note ?? null, leaderNote: note ?? null, leaderSignedAt: new Date() } }));
      await this.notifyEmp(orgId, await this.emp(orgId, swap.requesterEmployeeId), "Troca reprovada pelo líder", `Sua troca de ${this.brDate(this.iso(swap.swapDate))} foi reprovada.`);
      return r;
    }
    await this.assertRules(orgId, swap);
    const sig = await this.signAs(orgId, this.sigPayload(swap, "leader"), `swap-${id}-L`);
    const r = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({
      where: { id }, data: { status: "approved", leaderSignedAt: new Date(), leaderSigHash: sig.hash, leaderA1: sig.a1, leaderP7sKey: sig.p7sKey, leaderNote: note ?? null },
    }));
    await this.notifyEmp(orgId, await this.emp(orgId, swap.requesterEmployeeId), "Troca aprovada pelo líder", `Sua troca de ${this.brDate(this.iso(swap.swapDate))} foi aprovada. O RH vai anexar o documento e efetivar.`);
    return r;
  }

  /** RH aprova no lugar do líder (quando não há líder direto). */
  async rhApprove(ctx: RhCtx, id: string, note?: string | null) {
    const orgId = this.reqOrg(ctx);
    const swap = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.findFirst({ where: { id } }));
    if (!swap) throw new AppError(ErrorCode.NotFound, "Troca não encontrada", 404);
    if (swap.status !== "pending_leader") throw new AppError(ErrorCode.Conflict, "Troca não está aguardando aprovação", 409);
    if (swap.leaderEmployeeId) throw new AppError(ErrorCode.ValidationFailed, "Esta troca tem líder direto — a aprovação é dele", 400);
    await this.assertRules(orgId, swap);
    const sig = await this.signAs(orgId, this.sigPayload(swap, "rh"), `swap-${id}-RH`);
    return this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({
      where: { id }, data: { status: "approved", approvedByRh: true, leaderSignedAt: new Date(), leaderSigHash: sig.hash, leaderA1: sig.a1, leaderP7sKey: sig.p7sKey, leaderNote: note ?? null, rhUserId: ctx.userId ?? null },
    }));
  }

  /** RH anexa documento e APLICA a troca (cria os overrides de escala). */
  async rhApply(ctx: RhCtx, id: string, input: { attachmentUrl?: string | null }) {
    const orgId = this.reqOrg(ctx);
    const swap = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.findFirst({ where: { id } }));
    if (!swap) throw new AppError(ErrorCode.NotFound, "Troca não encontrada", 404);
    if (swap.status !== "approved") throw new AppError(ErrorCode.Conflict, "Só dá pra aplicar trocas aprovadas", 409);
    const preview = await this.previewResult(orgId, swap.swapType, swap.requesterEmployeeId, swap.colleagueEmployeeId, this.iso(swap.swapDate), swap.counterpartDate ? this.iso(swap.counterpartDate) : null);
    const { blocks } = await this.evaluateRules(orgId, preview);
    if (blocks.length) throw new AppError(ErrorCode.ValidationFailed, `Não foi possível aplicar: ${blocks.join(" ")}`, 400);
    // grava os overrides
    for (const [pontoId, byDay] of Object.entries(preview.resultSegs)) {
      for (const [day, segs] of Object.entries(byDay)) {
        await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoScheduleOverride.upsert({
          where: { organizationId_employeeId_day: { organizationId: orgId, employeeId: pontoId, day: this.dt(day) } },
          update: { kind: segs.length ? "work" : "folga", segments: segs as any, source: "swap", sourceId: id, note: `Troca ${swap.swapType}` },
          create: { organizationId: orgId, employeeId: pontoId, day: this.dt(day), kind: segs.length ? "work" : "folga", segments: segs as any, source: "swap", sourceId: id, note: `Troca ${swap.swapType}` },
        }));
      }
    }
    const r = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({
      where: { id }, data: { status: "applied", appliedAt: new Date(), rhAttachmentUrl: input.attachmentUrl ?? swap.rhAttachmentUrl ?? null, rhUserId: ctx.userId ?? swap.rhUserId ?? null },
    }));
    const msg = `Troca de ${this.brDate(this.iso(swap.swapDate))} efetivada pelo RH. Sua escala foi atualizada.`;
    await this.notifyEmp(orgId, await this.emp(orgId, swap.requesterEmployeeId), "Troca efetivada", msg);
    await this.notifyEmp(orgId, await this.emp(orgId, swap.colleagueEmployeeId), "Troca efetivada", msg);
    return r;
  }

  /** Anexa documento sem aplicar (RH). */
  async rhAttach(ctx: RhCtx, id: string, attachmentUrl: string) {
    const orgId = this.reqOrg(ctx);
    return this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({ where: { id }, data: { rhAttachmentUrl: attachmentUrl } }));
  }

  /** Solicitante cancela enquanto não aplicada. */
  async cancel(actor: PortalActor, id: string) {
    const orgId = actor.organizationId;
    const swap = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.findFirst({ where: { id } }));
    if (!swap) throw new AppError(ErrorCode.NotFound, "Troca não encontrada", 404);
    if (swap.requesterEmployeeId !== actor.employeeId) throw new AppError(ErrorCode.Forbidden, "Só o solicitante cancela", 403);
    if (["applied", "rejected", "canceled"].includes(swap.status)) throw new AppError(ErrorCode.Conflict, "Troca não pode mais ser cancelada", 409);
    return this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.update({ where: { id }, data: { status: "canceled" } }));
  }

  private reqOrg(ctx: RhCtx): string { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem organização", 403); return ctx.orgId; }
  private async assertRules(orgId: string, swap: any) {
    const preview = await this.previewResult(orgId, swap.swapType, swap.requesterEmployeeId, swap.colleagueEmployeeId, this.iso(swap.swapDate), swap.counterpartDate ? this.iso(swap.counterpartDate) : null);
    const { blocks } = await this.evaluateRules(orgId, preview);
    if (blocks.length) throw new AppError(ErrorCode.ValidationFailed, blocks.join(" "), 400);
  }

  // ============================ consultas ============================
  private async decorate(orgId: string, rows: any[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.requesterEmployeeId, r.colleagueEmployeeId, r.leaderEmployeeId].filter(Boolean)))] as string[];
    const emps = ids.length ? await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) : [];
    const nm = new Map(emps.map((e) => [e.id, e.name]));
    return rows.map((r) => ({
      id: r.id, status: r.status, swapType: r.swapType,
      swapDate: this.iso(r.swapDate), counterpartDate: r.counterpartDate ? this.iso(r.counterpartDate) : null,
      reason: r.reason, ruleWarnings: r.ruleWarnings ?? [],
      requesterName: nm.get(r.requesterEmployeeId) ?? "—", colleagueName: nm.get(r.colleagueEmployeeId) ?? "—",
      leaderName: r.leaderEmployeeId ? (nm.get(r.leaderEmployeeId) ?? "—") : null,
      requesterSigned: !!r.requesterSignedAt, colleagueSigned: !!r.colleagueSignedAt, leaderSigned: !!r.leaderSignedAt,
      requesterA1: r.requesterA1, colleagueA1: r.colleagueA1, leaderA1: r.leaderA1, approvedByRh: r.approvedByRh,
      rhAttachmentUrl: r.rhAttachmentUrl, appliedAt: r.appliedAt, rejectedBy: r.rejectedBy, rejectReason: r.rejectReason,
      createdAt: r.createdAt,
    }));
  }
  async myRequests(actor: PortalActor) {
    const rows = await this.prisma.runWithContext(this.octx(actor.organizationId), (tx) => tx.pontoShiftSwap.findMany({ where: { requesterEmployeeId: actor.employeeId }, orderBy: { createdAt: "desc" }, take: 100 }));
    return this.decorate(actor.organizationId, rows);
  }
  async toAccept(actor: PortalActor) {
    const rows = await this.prisma.runWithContext(this.octx(actor.organizationId), (tx) => tx.pontoShiftSwap.findMany({ where: { colleagueEmployeeId: actor.employeeId, status: "pending_colleague" }, orderBy: { createdAt: "desc" }, take: 100 }));
    return this.decorate(actor.organizationId, rows);
  }
  async toApprove(actor: PortalActor) {
    const rows = await this.prisma.runWithContext(this.octx(actor.organizationId), (tx) => tx.pontoShiftSwap.findMany({ where: { leaderEmployeeId: actor.employeeId, status: "pending_leader" }, orderBy: { createdAt: "desc" }, take: 100 }));
    return this.decorate(actor.organizationId, rows);
  }
  /** RH: fila de trocas (aguardando RH/sem-líder, aprovadas a aplicar, e recentes aplicadas). */
  async rhList(ctx: RhCtx) {
    const orgId = this.reqOrg(ctx);
    const rows = await this.prisma.runWithContext(this.octx(orgId), (tx) => tx.pontoShiftSwap.findMany({
      where: { status: { in: ["pending_colleague", "pending_leader", "approved", "applied"] } }, orderBy: { createdAt: "desc" }, take: 200,
    }));
    const dec = await this.decorate(orgId, rows);
    return dec.map((d: any) => ({ ...d, needsRhApproval: d.status === "pending_leader" && !d.leaderName, readyToApply: d.status === "approved" }));
  }
  /** Colegas ativos da empresa (pra escolher na solicitação). */
  async coworkers(actor: PortalActor) {
    // só colegas do MESMO empregador (a troca é restrita ao mesmo CNPJ)
    const me = await this.prisma.runWithContext(this.octx(actor.organizationId), (tx) => tx.employee.findFirst({ where: { id: actor.employeeId }, select: { employerId: true } }));
    const rows = await this.prisma.runWithContext(this.octx(actor.organizationId), (tx) => tx.employee.findMany({ where: { status: "active", id: { not: actor.employeeId }, employerId: me?.employerId ?? null }, select: { id: true, name: true, roleTitle: true }, orderBy: { name: "asc" }, take: 500 }));
    return rows;
  }
}
