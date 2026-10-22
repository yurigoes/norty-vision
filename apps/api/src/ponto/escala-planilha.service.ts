import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { JornadaService } from "./jornada.service";
import { ctxCan } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";

/** Linha da planilha como a tela manda (datas/horas já em texto; quem valida é o servidor). */
export type PlanilhaRow = {
  line: number; quem?: string; empresa?: string; cargo?: string; inicio?: string; fim?: string; dias?: string;
  /** entrada, saída lanche 1, volta lanche 1, saída lanche 2, volta lanche 2, saída */
  h?: string[]; folga?: string | boolean; obs?: string;
};
type Emp = { id: string; name: string; cpf: string | null; matricula: string | null; matEsocial: string | null; cargo: string | null; storeId: string | null; employerId: string | null; scheduleCode: string | null };
type Rule = { line: number; rank: number; empIds: string[]; from: string; to: string | null; wds: number[]; segs: [string, string][]; note: string | null; alvo: string };

const WD_NAMES: Record<string, number> = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6 };
const WD_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MAX_ROWS = 3000;

/**
 * Escala em massa por planilha. Cada linha diz QUEM (um funcionário pelo CPF/matrícula, ou todo
 * mundo de uma empresa/loja e/ou cargo), A PARTIR DE QUANDO (com antecedência mínima configurável),
 * em QUAIS dias da semana, e o horário: entrada, 2 lanches opcionais e saída — ou folga.
 * Nada é gravado sem passar pela conferência (`preview`), e toda aplicação vira um lote que dá pra
 * desfazer. O cálculo do espelho passa a usar essas linhas (JornadaService.planFor).
 */
@Injectable()
export class EscalaPlanilhaService {
  constructor(private readonly prisma: PrismaService, private readonly jornada: JornadaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  /**
   * O porteiro deste service. No RH era `isOrgAdmin` cru — e tela aberta por
   * permissão respondia 403: vazia, sem explicação. Aqui é a chave do catálogo
   * (`ctxCan` já devolve true pra master e pra owner/admin da org, então isto
   * só ALARGA). Piso: `ponto.adjust`, porque subir escala MUDA o previsto de
   * todo mundo; as LEITURAS (conferir, histórico, grade) passam `ponto.view`.
   */
  private requireAdmin(ctx: RequestContext, chave: string = "ponto.adjust") {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctxCan(ctx, chave)) throw new AppError(ErrorCode.Forbidden, `Seu perfil nao tem a permissao: ${chave}`, 403);
  }
  private norm(s: unknown): string { return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
  private br(iso: string): string { return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`; }
  private addDays(iso: string, n: number): string { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  private min(hm: string): number { const [h, m] = hm.split(":").map(Number); return (h || 0) * 60 + (m || 0); }

  /** "2026-10-07" ou "07/10/2026" (ou "7/10/26") → ISO; null se não for data. */
  private parseDate(v: unknown): string | null {
    const s = String(v ?? "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    let y = 0, mo = 0, d = 0;
    if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; }
    else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s))) { d = +m[1]!; mo = +m[2]!; y = +m[3]!; if (y < 100) y += 2000; }
    else return null;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 2020 || y > 2100) return null;
    return dt.toISOString().slice(0, 10);
  }
  /** "07:00", "7:00", "7h", "7h30", "07.30", "0730", "7" → "HH:MM"; "" = vazio; null = não é hora. */
  private parseTime(v: unknown): string | null {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s || s === "-" || s === "—") return "";
    let h = -1, mi = 0;
    let m = /^(\d{1,2})\s*[:h.]\s*(\d{2})(?::\d{2})?$/.exec(s);
    if (m) { h = +m[1]!; mi = +m[2]!; }
    else if ((m = /^(\d{1,2})\s*h?$/.exec(s))) { h = +m[1]!; }
    else if ((m = /^(\d{2})(\d{2})$/.exec(s))) { h = +m[1]!; mi = +m[2]!; }
    else return null;
    if (h > 23 || mi > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  }
  /** "seg-sex", "seg a sáb", "seg, qua, sex", "todos", "" → dias da semana (0=dom…6=sáb); null = não entendi. */
  private parseWeekdays(v: unknown): number[] | null {
    const s = this.norm(v).replace(/-feira/g, "").replace(/\bate\b/g, " a ");
    if (!s || ["todos", "todos os dias", "todas", "diario", "*"].includes(s)) return [0, 1, 2, 3, 4, 5, 6];
    if (s === "uteis" || s === "dias uteis") return [1, 2, 3, 4, 5];
    const out = new Set<number>();
    for (const part of s.split(/[,;\/]|\be\b/).map((x) => x.trim()).filter(Boolean)) {
      const r = /^([a-z]+)\s*(?:-|–|\ba\b)\s*([a-z]+)$/.exec(part);
      if (r) {
        const a = WD_NAMES[r[1]!], b = WD_NAMES[r[2]!];
        if (a == null || b == null) return null;
        for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
      } else {
        const a = WD_NAMES[part];
        if (a == null) return null;
        out.add(a);
      }
    }
    return out.size ? [...out].sort() : null;
  }

  // ----- configuração (antecedência mínima) -----
  private async leadDays(ctx: RequestContext): Promise<number> {
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRawUnsafe<Array<{ lead_days: number }>>(`SELECT lead_days FROM ponto_schedule_settings WHERE organization_id = $1::uuid`, ctx.orgId!));
    return r[0]?.lead_days ?? 1;
  }
  private async today(ctx: RequestContext): Promise<string> {
    const cfg = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoConfig.findFirst({ where: {}, select: { timezone: true } })).catch(() => null);
    const tz = /^[+-]\d{4}$/.test(cfg?.timezone ?? "") ? cfg!.timezone! : "-0300";
    const off = (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
    return new Date(Date.now() + off * 60000).toISOString().slice(0, 10);
  }
  async config(ctx: RequestContext) {
    this.requireAdmin(ctx, "ponto.view");
    const lead = await this.leadDays(ctx); const today = await this.today(ctx);
    return { leadDays: lead, today, minDay: this.addDays(today, lead) };
  }
  async saveConfig(ctx: RequestContext, b: { leadDays?: number }) {
    this.requireAdmin(ctx);
    const n = Math.round(Number(b?.leadDays));
    if (!Number.isFinite(n) || n < 0 || n > 60) throw new AppError(ErrorCode.ValidationFailed, "Antecedência entre 0 e 60 dias", 400);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$executeRawUnsafe(
      `INSERT INTO ponto_schedule_settings (organization_id, lead_days, updated_by) VALUES ($1::uuid, $2, $3::uuid)
       ON CONFLICT (organization_id) DO UPDATE SET lead_days = EXCLUDED.lead_days, updated_by = EXCLUDED.updated_by, updated_at = now()`, ctx.orgId!, n, ctx.userId ?? null));
    return this.config(ctx);
  }

  /** Empresas/lojas e cargos válidos — vão na 2ª aba do modelo, pra copiar e colar sem errar o nome. */
  async referencias(ctx: RequestContext) {
    this.requireAdmin(ctx, "ponto.view");
    const { emps, stores, employers } = await this.base(ctx);
    const storeName = new Map(stores.map((x) => [x.id, x.name] as const)); const emprName = new Map(employers.map((x) => [x.id, x.name] as const));
    return {
      empresas: [...new Set([...stores.map((x) => x.name), ...employers.map((x) => x.name)])].sort((a, b) => a.localeCompare(b, "pt-BR")),
      cargos: [...new Set(emps.map((e) => (e.cargo ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
      funcionarios: emps.map((e) => ({ id: e.id, nome: e.name, cpf: e.cpf, matricula: e.matricula, cargo: e.cargo, loja: e.storeId ? storeName.get(e.storeId) ?? "" : "", empresa: e.employerId ? emprName.get(e.employerId) ?? "" : "", storeId: e.storeId, temEscala: !!e.scheduleCode })),
    };
  }
  /**
   * Funcionários, lojas e empregadores que a planilha pode endereçar.
   *
   * Dois filtros do RH caíram aqui, e os dois por causa da MESMA feature que
   * não foi portada (promotores, migração 243 de lá):
   *   · `isPromoter: false` — a coluna não existe neste schema. Lá ela separa o
   *     promotor de merchandising do funcionário de loja; aqui todo mundo em
   *     `ponto_employee` é funcionário, então não há o que filtrar.
   *   · `kind: "employer"` em `ponto_employer` — lá a mesma tabela guarda
   *     empregador E fornecedor de promotor (`kind: "supplier"`); aqui ela
   *     guarda só empregador.
   * O `tsc` recusou as duas na hora do port, que é o certo: filtro por coluna
   * inexistente não é detalhe, é consulta que não roda.
   */
  private async base(ctx: RequestContext) {
    const rls = this.rls(ctx);
    const emps = (await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployee.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, cpf: true, matricula: true, matEsocial: true, cargo: true, storeId: true, employerId: true, scheduleCode: true } }))) as Emp[];
    const stores = await this.prisma.runWithContext(rls, (tx) => tx.store.findMany({ where: {}, select: { id: true, name: true } })).catch(() => [] as Array<{ id: string; name: string }>);
    const employers = await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployer.findMany({ where: {}, select: { id: true, name: true } })).catch(() => [] as Array<{ id: string; name: string }>);
    return { emps, stores, employers };
  }

  // ----- conferência -----
  /** Valida a planilha inteira SEM gravar: o que cada linha faz, o que está errado e os alertas. */
  async preview(ctx: RequestContext, b: { rows?: PlanilhaRow[] }) {
    this.requireAdmin(ctx, "ponto.view");
    const r = await this.analyze(ctx, b?.rows ?? []);
    return { ...r.report, plans: undefined };
  }

  private async analyze(ctx: RequestContext, rowsIn: PlanilhaRow[]) {
    const rows = (Array.isArray(rowsIn) ? rowsIn : []).filter((r) => r && typeof r === "object");
    if (!rows.length) throw new AppError(ErrorCode.ValidationFailed, "A planilha não tem nenhuma linha preenchida", 400);
    if (rows.length > MAX_ROWS) throw new AppError(ErrorCode.ValidationFailed, `Planilha grande demais (${rows.length} linhas; o limite é ${MAX_ROWS})`, 400);
    const lead = await this.leadDays(ctx); const today = await this.today(ctx); const minDay = this.addDays(today, lead);
    const { emps, stores, employers } = await this.base(ctx);
    const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
    const byCpf = new Map<string, Emp[]>(); const byMat = new Map<string, Emp[]>();
    for (const e of emps) {
      const c = digits(e.cpf); if (c) (byCpf.get(c) ?? byCpf.set(c, []).get(c)!).push(e);
      for (const m of [e.matricula, e.matEsocial]) { const k = this.norm(m); if (k) (byMat.get(k) ?? byMat.set(k, []).get(k)!).push(e); }
    }
    const storeBy = new Map(stores.map((x) => [this.norm(x.name), x.id] as const)); const emprBy = new Map(employers.map((x) => [this.norm(x.name), x.id] as const));
    const cargoSet = new Set(emps.map((e) => this.norm(e.cargo)).filter(Boolean));

    const lines: Array<{ line: number; status: "ok" | "erro"; msg: string; alvo: string; funcionarios: number; periodo: string; horario: string }> = [];
    const rules: Rule[] = [];
    const warn: Record<string, { n: number; ex: string[] }> = {};
    const addWarn = (k: string, ex: string) => { const w = (warn[k] ??= { n: 0, ex: [] }); w.n++; if (w.ex.length < 5 && !w.ex.includes(ex)) w.ex.push(ex); };

    for (const row of rows) {
      const line = Number(row.line) || 0;
      const fail = (msg: string) => { lines.push({ line, status: "erro", msg, alvo: String(row.quem || row.empresa || row.cargo || "").slice(0, 60), funcionarios: 0, periodo: "", horario: "" }); };
      // --- quem ---
      const quem = String(row.quem ?? "").trim(); const empresa = this.norm(row.empresa); const cargo = this.norm(row.cargo);
      let targets: Emp[] = []; let rank = 0; let alvo = "";
      if (quem) {
        const dg = digits(quem);
        let found = byMat.get(this.norm(quem)) ?? [];
        if (!found.length && dg.length >= 9 && dg.length <= 11) found = byCpf.get(dg.padStart(11, "0")) ?? [];
        if (!found.length) { fail(`Não achei funcionário ativo com CPF ou matrícula "${quem}"`); continue; }
        if (found.length > 1) { fail(`"${quem}" bate com ${found.length} funcionários (${found.slice(0, 3).map((e) => e.name).join(", ")}) — use o CPF`); continue; }
        targets = found; rank = 4; alvo = found[0]!.name;
      } else {
        if (!empresa && !cargo) { fail("Preencha o CPF/matrícula, ou a empresa/loja, ou o cargo"); continue; }
        const todos = ["todos", "todas", "*", "empresa toda", "geral"].includes(empresa);
        let sid: string | undefined, eid: string | undefined;
        if (empresa && !todos) {
          sid = storeBy.get(empresa); eid = emprBy.get(empresa);
          if (!sid && !eid) { fail(`Não existe empresa/loja "${row.empresa}" (veja a aba "Listas" do modelo, ou use TODOS)`); continue; }
        }
        if (cargo && !cargoSet.has(cargo)) { fail(`Nenhum funcionário ativo com o cargo "${row.cargo}" (veja a aba "Listas" do modelo)`); continue; }
        targets = emps.filter((e) => (!empresa || todos || (sid && e.storeId === sid) || (eid && e.employerId === eid)) && (!cargo || this.norm(e.cargo) === cargo));
        if (!targets.length) { fail("Nenhum funcionário ativo nessa combinação de empresa/loja e cargo"); continue; }
        rank = cargo && empresa && !todos ? 3 : cargo ? 2 : todos ? 0 : 1;
        alvo = [cargo ? String(row.cargo).trim() : "", empresa ? (todos ? "todos" : String(row.empresa).trim()) : ""].filter(Boolean).join(" · ");
      }
      // --- quando ---
      const from = this.parseDate(row.inicio);
      if (!from) { fail(row.inicio ? `Data de início inválida: "${row.inicio}" (use DD/MM/AAAA)` : "Falta a data de início"); continue; }
      let to: string | null = null;
      if (String(row.fim ?? "").trim()) {
        to = this.parseDate(row.fim);
        if (!to) { fail(`Data de fim inválida: "${row.fim}" (use DD/MM/AAAA ou deixe em branco)`); continue; }
        if (to < from) { fail("A data de fim é antes da data de início"); continue; }
      }
      if (from < minDay) { fail(`Início em ${this.br(from)} está fora do prazo: a escala precisa ser enviada com ${lead} dia(s) de antecedência (a partir de ${this.br(minDay)})`); continue; }
      if (from > this.addDays(today, 370)) { fail("Início a mais de um ano de hoje — confira a data"); continue; }
      const wdsAll = this.parseWeekdays(row.dias);
      if (!wdsAll) { fail(`Não entendi os dias da semana: "${row.dias}" (ex.: seg-sex · seg, qua, sex · sáb · todos)`); continue; }
      let wds = wdsAll;
      if (to) { // só os dias da semana que existem dentro do período
        const inRange = new Set<number>();
        for (let d = from, i = 0; d <= to && i < 7; d = this.addDays(d, 1), i++) inRange.add(new Date(d + "T00:00:00Z").getUTCDay());
        wds = wdsAll.filter((w) => inRange.has(w));
        if (!wds.length) { fail("Nenhum dos dias da semana informados cai dentro do período"); continue; }
      }
      // --- horário ---
      const folga = ["s", "sim", "x", "folga", "true", "1"].includes(this.norm(row.folga));
      const raw = Array.from({ length: 6 }, (_, i) => (row.h ?? [])[i] ?? "");
      const tm = raw.map((v) => this.parseTime(v));
      const bad = tm.findIndex((t) => t === null);
      if (bad >= 0) { fail(`Hora inválida em "${["Entrada", "Saída lanche 1", "Volta lanche 1", "Saída lanche 2", "Volta lanche 2", "Saída"][bad]}": "${raw[bad]}" (use HH:MM)`); continue; }
      const t = tm as string[];
      let segs: [string, string][] = [];
      if (folga) {
        if (t.some(Boolean)) { fail("Linha marcada como FOLGA não pode ter horário"); continue; }
      } else {
        const [ent, s1, v1, s2, v2, sai] = t as [string, string, string, string, string, string];
        if (!ent || !sai) { fail("Preencha Entrada e Saída (ou marque Folga)"); continue; }
        if (!!s1 !== !!v1) { fail("Lanche 1: preencha a saída E a volta (ou deixe as duas em branco)"); continue; }
        if (!!s2 !== !!v2) { fail("Lanche 2: preencha a saída E a volta (ou deixe as duas em branco)"); continue; }
        const breaks: [string, string][] = []; if (s1) breaks.push([s1, v1]); if (s2) breaks.push([s2, v2]);
        // sequência no relógio; só a ÚLTIMA saída pode passar da meia-noite (turno noturno)
        const seq = [ent, ...breaks.flat(), sai].map((x) => this.min(x));
        let ok = true;
        for (let i = 1; i < seq.length; i++) if (seq[i]! <= seq[i - 1]! && !(i === seq.length - 1)) ok = false;
        if (!ok) { fail("Horários fora de ordem: entrada < saída lanche 1 < volta lanche 1 < saída lanche 2 < volta lanche 2 < saída"); continue; }
        if (seq[seq.length - 1] === seq[seq.length - 2]) { fail("A saída é igual ao horário anterior"); continue; }
        const pts = [ent, ...breaks.flat(), sai];
        for (let i = 0; i + 1 < pts.length; i += 2) segs.push([pts[i]!, pts[i + 1]!]);
        // alertas de jornada (não bloqueiam): CLT arts. 59, 66 e 71
        const last = seq[seq.length - 1]! <= seq[seq.length - 2]! ? seq[seq.length - 1]! + 1440 : seq[seq.length - 1]!;
        const span = last - seq[0]!;
        const pausas = breaks.map(([a, c]) => this.min(c) - this.min(a));
        const worked = span - pausas.reduce((x, y) => x + y, 0);
        const ex = `linha ${line} (${alvo})`;
        if (worked > 600) addWarn("Jornada acima de 10 h no dia", ex);
        if (worked > 360 && Math.max(0, ...pausas) < 60) addWarn("Mais de 6 h de trabalho sem intervalo de pelo menos 1 h", ex);
        else if (worked > 240 && worked <= 360 && Math.max(0, ...pausas) < 15) addWarn("Mais de 4 h de trabalho sem intervalo de 15 min", ex);
        if (span > 780 && wds.length > 1) addWarn("Menos de 11 h de descanso entre um dia e o seguinte", ex);
      }
      rules.push({ line, rank, empIds: targets.map((e) => e.id), from, to, wds, segs, note: String(row.obs ?? "").trim().slice(0, 200) || null, alvo });
      lines.push({
        line, status: "ok", msg: "", alvo, funcionarios: targets.length,
        periodo: `${this.br(from)} ${to ? (to === from ? "(só este dia)" : `até ${this.br(to)}`) : "em diante"} · ${wds.length === 7 ? "todos os dias" : wds.map((w) => WD_SHORT[w]).join(", ")}`,
        horario: folga ? "FOLGA" : segs.map((x) => `${x[0]}–${x[1]}`).join("  ·  "),
      });
    }

    // --- por funcionário: junta as linhas e garante que a mais específica vence ---
    const byEmp = new Map<string, Rule[]>();
    for (const ru of rules) for (const id of ru.empIds) (byEmp.get(id) ?? byEmp.set(id, []).get(id)!).push(ru);
    const plans: Array<{ e: string; f: string; t: string; p: Record<string, [string, string][]>; n: string; o: number; k: number }> = [];
    const empName = new Map(emps.map((e) => [e.id, e.name] as const));
    let order = 0;
    for (const [empId, list] of byEmp) {
      // o motor decide por: linha de um dia só > mais específica (rank) > início mais recente > subida por último
      for (const ru of [...list].sort((a, c) => a.line - c.line)) plans.push({ e: empId, f: ru.from, t: ru.to ?? "", p: Object.fromEntries(ru.wds.map((w) => [String(w), ru.segs])), n: ru.note ?? "", o: order++, k: ru.rank });
      // carga semanal e folga, olhando só o que esta planilha define (a linha mais específica de cada dia da semana)
      const wk: Record<number, [string, string][]> = {};
      for (const ru of [...list].sort((a, c) => a.rank - c.rank || a.line - c.line)) if (!ru.to || ru.to >= this.addDays(ru.from, 6)) for (const w of ru.wds) wk[w] = ru.segs;
      const defined = Object.keys(wk).length;
      if (defined) {
        const total = Object.values(wk).reduce((s, sg) => s + sg.reduce((x, [a, c]) => { let d = this.min(c) - this.min(a); if (d <= 0) d += 1440; return x + d; }, 0), 0);
        if (total > 44 * 60) addWarn("Mais de 44 h na semana", `${empName.get(empId)} (${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")})`);
        if (defined === 7 && Object.values(wk).every((sg) => sg.length)) addWarn("7 dias seguidos de trabalho, sem folga na semana", empName.get(empId) ?? "");
      }
    }
    // --- quem fica de fora ---
    const semEscala = emps.filter((e) => !e.scheduleCode && !byEmp.has(e.id));
    const jaTinha = semEscala.length ? await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRawUnsafe<Array<{ employee_id: string }>>(
      `SELECT DISTINCT employee_id::text AS employee_id FROM ponto_schedule_plan WHERE to_day IS NULL OR to_day >= $1::date`, today)).catch(() => [] as Array<{ employee_id: string }>) : [];
    const comPlano = new Set(jaTinha.map((x) => x.employee_id));
    const fora = semEscala.filter((e) => !comPlano.has(e.id));
    const okLines = lines.filter((l) => l.status === "ok").length; const errLines = lines.length - okLines;
    const froms = rules.map((x) => x.from).sort(); const tos = rules.map((x) => x.to).filter(Boolean).sort() as string[];
    const report = {
      leadDays: lead, today, minDay,
      total: lines.length, validas: okLines, erros: errLines,
      funcionarios: byEmp.size, registros: plans.length,
      de: froms[0] ?? null, ate: rules.some((x) => !x.to) ? null : tos[tos.length - 1] ?? null,
      linhas: lines.sort((a, c) => (a.status === c.status ? a.line - c.line : a.status === "erro" ? -1 : 1)).slice(0, 400),
      alertas: Object.entries(warn).map(([k, v]) => ({ tipo: k, quantos: v.n, exemplos: v.ex })),
      semEscala: { quantos: fora.length, nomes: fora.slice(0, 12).map((e) => e.name) },
    };
    return { report, plans, rules };
  }

  // ----- aplicar -----
  async aplicar(ctx: RequestContext, b: { rows?: PlanilhaRow[]; fileName?: string; note?: string; ignorarErros?: boolean }) {
    this.requireAdmin(ctx);
    const { report, plans } = await this.analyze(ctx, b?.rows ?? []);
    if (report.erros && !b?.ignorarErros) throw new AppError(ErrorCode.ValidationFailed, `A planilha tem ${report.erros} linha(s) com erro — corrija ou aplique só as válidas`, 400, { erros: report.erros });
    if (!plans.length) throw new AppError(ErrorCode.ValidationFailed, "Nenhuma linha válida para aplicar", 400);
    const rls = this.rls(ctx); const orgId = ctx.orgId!;
    const who = ctx.userId ? await this.prisma.runWithContext(rls, (tx) => tx.user.findFirst({ where: { id: ctx.userId! }, select: { name: true, email: true } })).catch(() => null) : null;
    const summary = { validas: report.validas, erros: report.erros, alertas: report.alertas.map((a) => ({ tipo: a.tipo, quantos: a.quantos })) };
    const created = await this.prisma.runWithContext(rls, (tx) => tx.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO ponto_schedule_import (organization_id, status, file_name, note, from_day, to_day, row_count, employee_count, plan_count, summary, created_by, created_by_name)
       VALUES ($1::uuid, 'applying', $2, $3, $4::date, $5::date, $6, $7, $8, $9::jsonb, $10::uuid, $11) RETURNING id::text AS id`,
      orgId, String(b?.fileName ?? "").slice(0, 200) || null, String(b?.note ?? "").slice(0, 300) || null, report.de, report.ate, report.validas, report.funcionarios, plans.length, JSON.stringify(summary), ctx.userId ?? null, (who as any)?.name || (who as any)?.email || null));
    const importId = created[0]!.id;
    try {
      for (let i = 0; i < plans.length; i += 400) {
        const chunk = plans.slice(i, i + 400);
        await this.prisma.runWithContext(rls, (tx) => tx.$executeRawUnsafe(
          `INSERT INTO ponto_schedule_plan (organization_id, employee_id, import_id, from_day, to_day, pattern, note, rank)
           SELECT $1::uuid, x.e::uuid, $2::uuid, x.f::date, NULLIF(x.t, '')::date, x.p, NULLIF(x.n, ''), x.k
             FROM jsonb_to_recordset($3::jsonb) AS x(e text, f text, t text, p jsonb, n text, o int, k int) ORDER BY x.o`,
          orgId, importId, JSON.stringify(chunk)));
      }
      await this.prisma.runWithContext(rls, (tx) => tx.$executeRawUnsafe(`UPDATE ponto_schedule_import SET status = 'applied' WHERE id = $1::uuid`, importId));
    } catch (e) {
      // meio lote não pode ficar valendo: apaga o que entrou e marca a falha
      await this.prisma.runWithContext(rls, (tx) => tx.$executeRawUnsafe(`DELETE FROM ponto_schedule_plan WHERE import_id = $1::uuid`, importId)).catch(() => undefined);
      await this.prisma.runWithContext(rls, (tx) => tx.$executeRawUnsafe(`UPDATE ponto_schedule_import SET status = 'failed' WHERE id = $1::uuid`, importId)).catch(() => undefined);
      throw new AppError(ErrorCode.Internal, `Não consegui gravar a escala — nada foi aplicado. (${(e as Error).message.slice(0, 160)})`, 500);
    }
    return { ok: true, importId, funcionarios: report.funcionarios, linhas: report.validas, ignoradas: report.erros, de: report.de, ate: report.ate };
  }

  // ----- histórico / desfazer -----
  async historico(ctx: RequestContext) {
    this.requireAdmin(ctx, "ponto.view");
    const today = await this.today(ctx);
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.$queryRawUnsafe<any[]>(
      `SELECT i.id::text AS id, i.status, i.file_name AS "fileName", i.note, to_char(i.from_day, 'YYYY-MM-DD') AS de, to_char(i.to_day, 'YYYY-MM-DD') AS ate,
              i.row_count AS linhas, i.employee_count AS funcionarios, i.summary, i.created_by_name AS "porQuem", i.created_at AS "em", i.undone_at AS "desfeitaEm",
              (SELECT count(*)::int FROM ponto_schedule_plan p WHERE p.import_id = i.id AND p.from_day <= $1::date) AS "jaEmVigor",
              (SELECT count(*)::int FROM ponto_schedule_plan p WHERE p.import_id = i.id AND p.from_day > $1::date) AS "futuras"
         FROM ponto_schedule_import i WHERE i.status IN ('applied', 'undone') ORDER BY i.created_at DESC LIMIT 40`, today));
    return { items, today };
  }
  /**
   * Desfaz uma planilha aplicada. O que ainda não começou a valer é apagado; o que já está em vigor
   * NÃO some do passado (o espelho dos dias já trabalhados não muda) — para de valer a partir de amanhã.
   */
  async desfazer(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    const rls = this.rls(ctx); const today = await this.today(ctx);
    const imp = await this.prisma.runWithContext(rls, (tx) => tx.$queryRawUnsafe<Array<{ status: string }>>(`SELECT status FROM ponto_schedule_import WHERE id = $1::uuid`, id));
    if (!imp[0]) throw new AppError(ErrorCode.NotFound, "Importação não encontrada", 404);
    if (imp[0].status !== "applied") throw new AppError(ErrorCode.Conflict, "Essa importação já foi desfeita", 409);
    const r = await this.prisma.runWithContext(rls, async (tx) => {
      const removidas = await tx.$executeRawUnsafe(`DELETE FROM ponto_schedule_plan WHERE import_id = $1::uuid AND from_day > $2::date`, id, today);
      const encerradas = await tx.$executeRawUnsafe(`UPDATE ponto_schedule_plan SET to_day = $2::date WHERE import_id = $1::uuid AND from_day <= $2::date AND (to_day IS NULL OR to_day > $2::date)`, id, today);
      await tx.$executeRawUnsafe(`UPDATE ponto_schedule_import SET status = 'undone', undone_at = now(), undone_by = $2::uuid WHERE id = $1::uuid`, id, ctx.userId ?? null);
      return { removidas, encerradas };
    });
    return { ok: true, ...r };
  }

  // ----- escala planejada (grade pra conferir) -----
  async planejada(ctx: RequestContext, q: { from?: string; days?: string; storeId?: string; cargo?: string; q?: string }) {
    this.requireAdmin(ctx, "ponto.view");
    const today = await this.today(ctx);
    const from = this.parseDate(q?.from) ?? today;
    const n = Math.max(1, Math.min(14, Number(q?.days) || 7));
    const to = this.addDays(from, n - 1);
    const { emps, stores } = await this.base(ctx);
    const cargo = this.norm(q?.cargo); const busca = this.norm(q?.q);
    const list = emps.filter((e) => (!q?.storeId || e.storeId === q.storeId) && (!cargo || this.norm(e.cargo) === cargo) && (!busca || this.norm(e.name).includes(busca)));
    const grid = await this.jornada.plannedGrid(ctx, list.map((e) => ({ id: e.id, scheduleCode: e.scheduleCode, storeId: e.storeId })), from, to);
    const storeName = new Map(stores.map((x) => [x.id, x.name] as const));
    const dias: Array<{ day: string; wd: number }> = [];
    for (let d = from; d <= to; d = this.addDays(d, 1)) dias.push({ day: d, wd: new Date(d + "T00:00:00Z").getUTCDay() });
    return {
      from, to, today, dias,
      funcionarios: list.map((e) => ({ id: e.id, nome: e.name, cargo: e.cargo, loja: e.storeId ? storeName.get(e.storeId) ?? "" : "", dias: (grid[e.id] ?? []).map((d) => ({ segs: d.segs, origin: d.origin, feriado: d.holidayName })) })),
    };
  }
}
