import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { PontoSignService } from "./sign.service";
import { JornadaService } from "./jornada.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Gerador do AEJ (Arquivo Eletrônico de Jornada) — Portaria 671.
 * Texto ISO-8859-1, campos separados por "|", linhas CRLF, sem pipe no fim.
 * Registros: 01 cabeçalho | 02 REPs | 03 vínculos | 04 horário contratual |
 * 05 marcações | 06 matrícula eSocial | 07 ausências/banco de horas | 08 PTRP | 99 trailer.
 * Assinado em arquivo .p7s (cert A1) — igual ao AFD.
 *
 * CONFORMIDADE: produz o arquivo estruturado conforme o leiaute; validar no
 * verificador oficial + contador na homologação (sobretudo DSR e horário contratual).
 */
@Injectable()
export class AejService {
  constructor(private readonly prisma: PrismaService, private readonly sign: PontoSignService, private readonly jornada: JornadaService) {}

  private requireAdmin(ctx: RequestContext) { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403); if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403); }
  private rls(ctx: RequestContext) { return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, isOrgAdmin: ctx.isOrgAdmin }; }
  private digits(s?: string | null) { return (s ?? "").replace(/\D/g, ""); }
  private offMin(tz: string) { const sign = tz.startsWith("-") ? -1 : 1; return sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))); }
  private fmtD(date: Date, tz: string) { const d = new Date(date.getTime() + this.offMin(tz) * 60000); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`; }
  private fmtDH(date: Date, tz: string) { const d = new Date(date.getTime() + this.offMin(tz) * 60000); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00${tz}`; }
  private hhmmToHM(s: string) { const [h, m] = (s || "00:00").split(":").map(Number); return `${String(h ?? 0).padStart(2, "0")}${String(m ?? 0).padStart(2, "0")}`; }
  private minToHM(min: number) { return `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`; }

  /** Segmentos representativos de uma escala (pares entrada/saída em "HH:MM"). */
  private scheduleSegments(schedule: any): { pairs: [string, string][]; durMin: number } {
    const p = (schedule?.pattern ?? {}) as any;
    let segs: [string, string][] = [];
    if (schedule?.kind === "12x36") segs = (p.segments ?? []) as [string, string][];
    else { for (let wd = 1; wd <= 6; wd++) { if (Array.isArray(p[String(wd)]) && p[String(wd)].length) { segs = p[String(wd)]; break; } } }
    const durMin = segs.reduce((s, [a, b]) => { const [ah, am] = a.split(":").map(Number); const [bh, bm] = b.split(":").map(Number); let d = (bh! * 60 + bm!) - (ah! * 60 + am!); if (d < 0) d += 1440; return s + d; }, 0);
    return { pairs: segs, durMin };
  }

  async generate(ctx: RequestContext, opts: { from: string; to: string }): Promise<{ content: string; counts: Record<string, number>; signed: boolean; p7s: string | null; missing: string[] }> {
    this.requireAdmin(ctx);
    if (!opts.from || !opts.to) throw new AppError(ErrorCode.ValidationFailed, "from e to obrigatórios", 400);
    const orgId = ctx.orgId!;
    const fromD = new Date(opts.from + "T00:00:00Z"), toD = new Date(opts.to + "T23:59:59Z");
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {} }));
    const tz = cfg?.timezone ?? "-0300";
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, cpf: true, matEsocial: true, scheduleCode: true } }));
    const schedules = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoSchedule.findMany({ where: {} }));
    const schedByCode = new Map(schedules.map((s) => [s.code, s]));
    // índice de horário contratual (1..30) por código de escala usado
    const usedCodes = [...new Set(emps.map((e) => e.scheduleCode).filter(Boolean) as string[])];
    const codeIdx = new Map<string, number>(); usedCodes.forEach((c, i) => codeIdx.set(c, i + 1));
    const empVinc = new Map<string, number>(); emps.forEach((e, i) => empVinc.set(e.id, i + 1));

    const counts: Record<string, number> = { t01: 0, t02: 0, t03: 0, t04: 0, t05: 0, t06: 0, t07: 0, t08: 0 };
    const lines: string[] = [];
    const push = (t: string, fields: (string | number)[]) => { lines.push(fields.join("|")); counts[t] = (counts[t] ?? 0) + 1; };

    // 01 — cabeçalho
    push("t01", ["01", cfg?.tpIdtEmpregador ?? 1, this.digits(cfg?.idtEmpregador), this.digits(cfg?.caepf), this.digits(cfg?.cno), (cfg?.razaoOuNome ?? "").slice(0, 150), this.fmtD(fromD, tz), this.fmtD(toD, tz), this.fmtDH(new Date(), tz), "001"]);
    // 02 — REP-A (1 só)
    const nrRep = this.digits(cfg?.repAProcesso) ? this.digits(cfg?.repAProcesso).padStart(17, "0").slice(-17) : "9".repeat(17);
    push("t02", ["02", 1, 2, nrRep]);
    // 03 — vínculos
    for (const e of emps) push("t03", ["03", empVinc.get(e.id)!, this.digits(e.cpf).padStart(11, "0").slice(-11), (e.name ?? "").slice(0, 150)]);
    // 04 — horários contratuais (um por código de escala usado)
    for (const code of usedCodes) {
      const seg = this.scheduleSegments(schedByCode.get(code));
      const pairs = seg.pairs.length ? seg.pairs : [["00:00", "00:00"] as [string, string]];
      const f: (string | number)[] = ["04", codeIdx.get(code)!, seg.durMin];
      for (const [a, b] of pairs) { f.push(this.hhmmToHM(a)); f.push(this.hhmmToHM(b)); }
      push("t04", f);
    }
    // 05 — marcações (por funcionário, por dia, alternando E/S)
    for (const e of emps) {
      const vinc = empVinc.get(e.id)!;
      const codHor = e.scheduleCode && codeIdx.has(e.scheduleCode) ? codeIdx.get(e.scheduleCode)! : (usedCodes.length ? 1 : 0);
      const punches = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoPunch.findMany({ where: { employeeId: e.id, punchedAt: { gte: fromD, lte: toD } }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }));
      // agrupa por dia local p/ sequenciar entrada/saída
      const byDay = new Map<string, Date[]>();
      for (const p of punches) { const day = this.fmtD(p.punchedAt, tz); (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(p.punchedAt); }
      for (const [, list] of byDay) {
        list.sort((a, b) => a.getTime() - b.getTime());
        list.forEach((dt, i) => {
          const tpMarc = i % 2 === 0 ? "E" : "S";
          const seq = String(Math.floor(i / 2) + 1).padStart(3, "0");
          const f: (string | number)[] = ["05", vinc, this.fmtDH(dt, tz), 1, tpMarc, seq, "O"];
          if (tpMarc === "E" && seq === "001" && codHor) f.push(codHor);
          push("t05", f);
        });
      }
    }
    // 06 — matrícula eSocial
    for (const e of emps) if (e.matEsocial) push("t06", ["06", empVinc.get(e.id)!, e.matEsocial.slice(0, 30)]);
    // 07 — ausências e banco de horas
    for (const e of emps) {
      const vinc = empVinc.get(e.id)!;
      // banco de horas (tipo 3)
      const bank = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoBankMovement.findMany({ where: { employeeId: e.id, day: { gte: fromD, lte: toD } }, orderBy: { day: "asc" } }));
      for (const b of bank) push("t07", ["07", vinc, 3, this.fmtD(b.day, tz), Math.abs(b.minutes), b.minutes >= 0 ? 1 : 2]);
      // faltas não justificadas (tipo 2) — do espelho
      const esp = await this.jornada.espelho(ctx, { employeeId: e.id, from: opts.from, to: opts.to });
      for (const d of esp.days as any[]) if (d.faltaMin > 0 && !d.justified) push("t07", ["07", vinc, 2, d.day]);
    }
    // 08 — PTRP (desenvolvedor = yugochat)
    push("t08", ["08", "yugo-ponto", "1.0.0", cfg?.devTpIdt ?? 1, this.digits(cfg?.devIdt), "yugochat", "contato@yugochat.com.br"]);
    // 99 — trailer
    lines.push(["99", counts.t01, counts.t02, counts.t03, counts.t04, counts.t05, counts.t06, counts.t07, counts.t08].join("|"));

    const content = lines.join("\r\n");
    const p7s = await this.sign.sign(orgId, Buffer.from(content, "latin1")).catch(() => null);
    return {
      content, counts, signed: !!p7s, p7s: p7s ? p7s.toString("base64") : null,
      missing: ["validar DSR/horário contratual + leiaute no verificador oficial (homologação)", ...(p7s ? [] : ["assinatura A1 (.p7s) — configure o certificado"])],
    };
  }
}
