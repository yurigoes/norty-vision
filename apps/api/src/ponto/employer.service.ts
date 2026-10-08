import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Empregadores (CNPJs) de uma conta. Vários empregadores podem bater ponto na
 * mesma matriz; cada um é uma entidade legal (Fase 2+: NSR/hash/AFD/A1 próprios).
 */
@Injectable()
export class EmployerService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  private requireOrg(ctx: RequestContext): string { if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem empresa", 403); return ctx.orgId; }
  private requireAdmin(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem empresa", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
  }

  /** Lista os empregadores com a contagem de funcionários de cada um. */
  async list(ctx: RequestContext) {
    this.requireOrg(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.findMany({ where: {}, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }));
    const counts = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.groupBy({ by: ["employerId"], where: { status: "active" }, _count: { _all: true } })).catch(() => [] as any[]);
    const byId = new Map<string, number>();
    for (const c of counts as any[]) if (c.employerId) byId.set(c.employerId, c._count._all);
    return {
      items: rows.map((e) => ({
        id: e.id, name: e.name, tpIdtEmpregador: e.tpIdtEmpregador, idtEmpregador: e.idtEmpregador, caepf: e.caepf, cnae: e.cnae,
        tpRep: e.tpRep, active: e.active, isDefault: e.isDefault, employees: byId.get(e.id) ?? 0,
      })),
    };
  }

  async upsert(ctx: RequestContext, input: { id?: string; name: string; tpIdtEmpregador?: number; idtEmpregador?: string | null; caepf?: string | null; cnae?: string | null; tpRep?: number; active?: boolean }) {
    this.requireAdmin(ctx);
    const orgId = this.requireOrg(ctx);
    const name = (input.name || "").trim();
    if (!name) throw new AppError(ErrorCode.ValidationFailed, "Nome/razão social obrigatório", 400);
    const data = {
      name,
      tpIdtEmpregador: input.tpIdtEmpregador ?? 1,
      idtEmpregador: (input.idtEmpregador || "").replace(/\D/g, "") || null,
      caepf: input.caepf?.trim() || null,
      cnae: input.cnae?.trim() || null,
      tpRep: input.tpRep ?? 3,
      active: input.active ?? true,
    };
    if (input.id) {
      const ex = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.findFirst({ where: { id: input.id }, select: { id: true } }));
      if (!ex) throw new AppError(ErrorCode.NotFound, "Empregador não encontrado", 404);
      await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.update({ where: { id: input.id }, data: { ...data, updatedAt: new Date() } }));
      return { id: input.id };
    }
    const r = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.create({ data: { organizationId: orgId, ...data } }));
    return { id: r.id };
  }

  /**
   * Nome e CNPJ do empregador que TIMBRA um documento do funcionário.
   *
   * Portado do RH, onde conserta um defeito que o Vision também tinha: o
   * espelho de ponto e o holerite usavam `ponto_config.razaoOuNome` — o nome
   * comercial da CONTA. Com multi-CNPJ (ponto_employer), quem está sob um
   * empregador diferente do padrão recebia espelho e holerite timbrados com a
   * empresa errada. São documentos que vão pra fiscalização do trabalho.
   *
   * Sem employerId, ou empregador inexistente, cai no `isDefault` — que é o
   * comportamento certo pra empresa de um CNPJ só.
   *
   * (O RH devolve também a cidade, de `ponto_employer.local_prestacao`. Aqui a
   * coluna não existe e nenhum dos dois usos precisa dela; quando precisar, ela
   * vem junto com a migration.)
   */
  async resolveBrand(ctx: RequestContext, employerId?: string | null): Promise<{ name: string; cnpj: string | null } | null> {
    const rls = this.rls(ctx);
    const campos = { name: true, idtEmpregador: true } as const;
    const row = employerId
      ? await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployer.findFirst({ where: { id: employerId }, select: campos })).catch(() => null)
      : null;
    const r = row ?? await this.prisma.runWithContext(rls, (tx) => tx.pontoEmployer.findFirst({ where: { isDefault: true }, select: campos })).catch(() => null);
    if (!r) return null;
    return { name: r.name, cnpj: r.idtEmpregador ? this.fmtCnpj(r.idtEmpregador) : null };
  }
  private fmtCnpj(d: string) {
    const s = (d || "").replace(/\D/g, "");
    return s.length === 14 ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : d;
  }

  async remove(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.findFirst({ where: { id }, select: { id: true, isDefault: true } }));
    if (!emp) throw new AppError(ErrorCode.NotFound, "Empregador não encontrado", 404);
    if (emp.isDefault) throw new AppError(ErrorCode.Conflict, "Não dá pra excluir o empregador padrão", 409);
    const count = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.employee.count({ where: { employerId: id } }));
    if (count > 0) throw new AppError(ErrorCode.Conflict, `Há ${count} funcionário(s) neste empregador — mova-os antes de excluir`, 409);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployer.delete({ where: { id } }));
    return { ok: true };
  }
}
