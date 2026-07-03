import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";
import { CEST_CSV, LC116_CSV } from "./fiscal-ref-seed";

/**
 * Tabelas de referência fiscal (globais): NCM (Siscomex), CEST×NCM (Conv. 142/18)
 * e serviços da LC 116/03. Importação só do master; consulta liberada (auto-
 * preenchimento do cadastro de produto). Reduz erro fiscal.
 */
@Injectable()
export class FiscalRefService {
  private readonly logger = new Logger("FiscalRef");
  constructor(private readonly prisma: PrismaService) {}

  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
  }
  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private digits(s?: string | null) { return (s ?? "").replace(/\D/g, ""); }

  // ===================== IMPORTAÇÃO (master) =====================
  /** Importa a tabela NCM oficial (JSON Siscomex: { Nomenclaturas: [{Codigo,Descricao}] }). */
  async importNcm(ctx: RequestContext, jsonText: string): Promise<{ ok: true; count: number }> {
    this.requireMaster(ctx);
    let parsed: any;
    try { parsed = JSON.parse(jsonText); } catch { throw new AppError(ErrorCode.ValidationFailed, "JSON inválido", 400); }
    const arr: any[] = parsed?.Nomenclaturas ?? parsed?.nomenclaturas ?? (Array.isArray(parsed) ? parsed : []);
    if (!arr.length) throw new AppError(ErrorCode.ValidationFailed, "JSON sem Nomenclaturas", 400);
    const seen = new Set<string>();
    const rows: { codigo: string; descricao: string }[] = [];
    for (const it of arr) {
      const codigo = this.digits(it?.Codigo ?? it?.codigo);
      const descricao = String(it?.Descricao ?? it?.descricao ?? "").trim();
      if (!codigo || !descricao || seen.has(codigo)) continue;
      seen.add(codigo);
      rows.push({ codigo, descricao: descricao.slice(0, 600) });
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      await tx.ncm.deleteMany({});
      for (let i = 0; i < rows.length; i += 2000) {
        await tx.ncm.createMany({ data: rows.slice(i, i + 2000), skipDuplicates: true });
      }
    });
    this.logger.log(`NCM importado: ${rows.length}`);
    return { ok: true, count: rows.length };
  }

  /** Semeia CEST e LC116 a partir das tabelas oficiais embutidas no build. */
  async seedCestLc116(ctx: RequestContext): Promise<{ ok: true; cest: number; servicos: number }> {
    this.requireMaster(ctx);
    const cestRows: { cest: string; ncm: string | null; descricao: string | null }[] = [];
    for (const line of CEST_CSV.split("\n").slice(1)) {
      const [cest, ncm, ...rest] = line.split(";");
      if (!cest) continue;
      cestRows.push({ cest: this.digits(cest), ncm: this.digits(ncm) || null, descricao: (rest.join(";") || "").trim() || null });
    }
    const servRows: { codigo: string; descricao: string }[] = [];
    for (const line of LC116_CSV.split("\n").slice(1)) {
      const idx = line.indexOf(";");
      if (idx < 0) continue;
      const codigo = line.slice(0, idx).trim();
      const descricao = line.slice(idx + 1).trim();
      if (codigo && descricao) servRows.push({ codigo, descricao: descricao.slice(0, 600) });
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      await tx.cest.deleteMany({});
      for (let i = 0; i < cestRows.length; i += 2000) await tx.cest.createMany({ data: cestRows.slice(i, i + 2000), skipDuplicates: true });
      await tx.servicoLc116.deleteMany({});
      for (let i = 0; i < servRows.length; i += 2000) await tx.servicoLc116.createMany({ data: servRows.slice(i, i + 2000), skipDuplicates: true });
    });
    this.logger.log(`CEST=${cestRows.length} LC116=${servRows.length}`);
    return { ok: true, cest: cestRows.length, servicos: servRows.length };
  }

  async counts(ctx: RequestContext): Promise<any> {
    const [ncm, cest, servicos] = await Promise.all([
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.ncm.count()),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.cest.count()),
      this.prisma.runWithContext(this.rls(ctx), (tx) => tx.servicoLc116.count()),
    ]);
    return { ncm, cest, servicos };
  }

  // ===================== CONSULTA (auto-preenchimento) =====================
  /** Busca NCM por código (prefixo) ou por descrição. */
  async searchNcm(ctx: RequestContext, q: string): Promise<any> {
    const term = (q ?? "").trim();
    if (term.length < 2) return { items: [] };
    const d = this.digits(term);
    const where = d.length >= 2 && d.length === term.replace(/\s/g, "").length
      ? { codigo: { startsWith: d } }
      : { descricao: { contains: term, mode: "insensitive" as const } };
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.ncm.findMany({ where, orderBy: { codigo: "asc" }, take: 20, select: { codigo: true, descricao: true } }));
    return { items };
  }

  /** CEST sugeridos para um NCM (o NCM informado "começa com" o prefixo cadastrado). */
  async cestForNcm(ctx: RequestContext, ncm: string): Promise<any> {
    const d = this.digits(ncm);
    if (d.length < 2) return { items: [] };
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.$queryRaw`SELECT DISTINCT cest, descricao FROM cest WHERE ${d} LIKE ncm || '%' ORDER BY cest LIMIT 12`,
    ).catch(() => []);
    return { items };
  }

  async searchServicos(ctx: RequestContext, q: string): Promise<any> {
    const term = (q ?? "").trim();
    if (term.length < 2) return { items: [] };
    const where = /^\d/.test(term)
      ? { codigo: { startsWith: term } }
      : { descricao: { contains: term, mode: "insensitive" as const } };
    const items = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.servicoLc116.findMany({ where, orderBy: { codigo: "asc" }, take: 20, select: { codigo: true, descricao: true } }));
    return { items };
  }
}
