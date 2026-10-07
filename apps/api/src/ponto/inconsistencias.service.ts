import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { JornadaService } from "./jornada.service";
import type { RequestContext } from "../auth/session.middleware";

export type IncKind = "incompleta" | "falta" | "atraso" | "saida" | "extra" | "folga";

/**
 * FILA DE PONTOS INCONSISTENTES — portada do Norty RH.
 *
 * Só os funcionários (e os dias) que AINDA precisam de uma decisão do gestor.
 * Sai do MESMO espelho que a grade de ajuste usa, e desconta o que já foi
 * resolvido — abono aprovado, afastamento, lançamento no banco de horas
 * (BH+/BH−) e hora extra paga. É por isso que o funcionário desaparece da fila
 * quando termina de ser ajustado: não há estado "resolvido" guardado em lugar
 * nenhum, a pendência é derivada. Nada para sincronizar, nada para ficar velho.
 *
 * O DIA DE HOJE FICA DE FORA, de propósito: quem ainda não foi embora tem
 * batida ímpar, e isso não é erro — é alguém trabalhando. Incluir hoje faria a
 * fila acusar a empresa inteira toda manhã.
 *
 * DIFERENÇA EM RELAÇÃO AO RH: o filtro `isPromoter: false` saiu. Promotores são
 * do módulo de promotores do RH, que não foi portado — aqui todo funcionário
 * ativo entra na fila.
 */
@Injectable()
export class InconsistenciasService {
  constructor(private readonly prisma: PrismaService, private readonly jornada: JornadaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  async list(ctx: RequestContext, q: { from?: string; to?: string; storeId?: string }) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem empresa no contexto", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas gestor", 403);
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!iso.test(q?.from ?? "") || !iso.test(q?.to ?? "")) {
      throw new AppError(ErrorCode.ValidationFailed, "Informe o período (de / até)", 400);
    }
    const rls = this.rls(ctx);
    const cfg = await this.prisma
      .runWithContext(rls, (tx) => tx.pontoConfig.findFirst({ where: {}, select: { timezone: true } }))
      .catch(() => null);
    const tz = /^[+-]\d{4}$/.test(cfg?.timezone ?? "") ? cfg!.timezone! : "-0300";
    const off = (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
    const yesterday = new Date(Date.now() + off * 60000 - 86400000).toISOString().slice(0, 10);
    const from = q.from!;
    const to = q.to! > yesterday ? yesterday : q.to!;
    const empty = { from, to, yesterday, employees: [] as any[], totals: { employees: 0, days: 0, byKind: {} as Record<string, number> }, checked: 0 };
    if (to < from) return empty;
    // o espelho faz ~9 consultas por pessoa; 2 meses x empresa inteira já é o
    // limite do que cabe numa requisição sem estourar o timeout do front
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) {
      throw new AppError(ErrorCode.ValidationFailed, "Período de no máximo 2 meses", 400);
    }

    const emps = await this.prisma.runWithContext(rls, (tx) =>
      tx.pontoEmployee.findMany({
        where: { active: true, ...(q.storeId ? { storeId: q.storeId } : {}) },
        orderBy: { name: "asc" },
        select: { id: true, name: true, cargo: true, storeId: true },
      }),
    );
    if (!emps.length) return empty;

    const fromD = new Date(from + "T00:00:00Z"), toD = new Date(to + "T00:00:00Z");
    const moves = await this.prisma
      .runWithContext(rls, (tx) =>
        tx.pontoBankMovement.findMany({
          where: { employeeId: { in: emps.map((e) => e.id) }, day: { gte: fromD, lte: toD }, kind: { not: "expiry" } },
          select: { employeeId: true, day: true, minutes: true, kind: true },
        }),
      )
      .catch(() => [] as Array<{ employeeId: string; day: Date; minutes: number; kind: string }>);
    // "emp|dia" → quanto já foi lançado no banco/HE, e para que lado
    const used = new Map<string, { neg: number; pos: number }>();
    for (const m of moves) {
      const k = `${m.employeeId}|${new Date(m.day).toISOString().slice(0, 10)}`;
      const u = used.get(k) ?? { neg: 0, pos: 0 };
      if (m.kind === "he" || m.minutes > 0) u.pos += Math.abs(m.minutes);
      else u.neg += Math.abs(m.minutes);
      used.set(k, u);
    }

    const out: any[] = [];
    const byKind: Record<string, number> = {};
    let days = 0;
    const LOTE = 10;
    for (let i = 0; i < emps.length; i += LOTE) {
      const chunk = emps.slice(i, i + LOTE);
      const results = await Promise.all(
        chunk.map((e) => this.jornada.espelho(ctx, { employeeId: e.id, from, to }).catch(() => null)),
      );
      results.forEach((esp: any, idx) => {
        if (!esp) return;
        const e = chunk[idx]!;
        const list: any[] = [];
        const counts: Record<string, number> = {};
        for (const d of esp.days as any[]) {
          if (d.leave || d.future) continue;
          const u = used.get(`${e.id}|${d.day}`) ?? { neg: 0, pos: 0 };
          // faltaMin/lateMin/earlyMin já chegam descontados do abono aprovado
          const neg = Math.max(0, (d.faltaMin || 0) + (d.lateMin || 0) + (d.earlyMin || 0) - u.neg);
          // sem escala nenhuma pro dia, TODO minuto trabalhado vira "extra" —
          // isso é escala faltando no cadastro, não erro de ponto
          const pos = d.scheduleOrigin === "sem_escala" ? 0 : Math.max(0, (d.extraMin || 0) - u.pos);
          const kinds: IncKind[] = [];
          if (d.incomplete && !d.justified) kinds.push("incompleta");
          if (neg > 0) {
            if (d.faltaMin > 0) kinds.push("falta");
            if (d.lateMin > 0) kinds.push("atraso");
            if (d.earlyMin > 0) kinds.push("saida");
          }
          if (pos > 0) kinds.push(d.isWorkDay ? "extra" : "folga");
          if (!kinds.length) continue;
          for (const k of kinds) { counts[k] = (counts[k] ?? 0) + 1; byKind[k] = (byKind[k] ?? 0) + 1; }
          list.push({
            day: d.day, wd: d.wd, kinds, punches: d.punches,
            previsto: (d.expectedSegs ?? []).map((s: string[]) => `${s[0]}–${s[1]}`).join(" · "),
            negMin: neg, posMin: pos,
          });
        }
        if (!list.length) return;
        days += list.length;
        out.push({ id: e.id, name: e.name, cargo: e.cargo, storeId: e.storeId, semEscala: !esp.schedule, days: list, counts });
      });
    }
    return { from, to, yesterday, employees: out, totals: { employees: out.length, days, byKind }, checked: emps.length };
  }
}
