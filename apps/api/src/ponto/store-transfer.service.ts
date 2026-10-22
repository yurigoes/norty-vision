import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ctxCan } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";

/**
 * Transferência TEMPORÁRIA de loja (mesma empresa/CNPJ).
 * Ex.: "João (Loja 1) → Loja 2 até 15/07". Durante a janela ele só bate ponto
 * nos terminais da loja destino (a regra de bloqueio fica no kiosk/ponto-pwa).
 * Aqui é só o CRUD administrativo das transferências, mediado pela RLS por org.
 */
@Injectable()
export class StoreTransferService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin ? { isPlatformAdmin: true as const } : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }
  /**
   * Porteiro deste service. No RH era `isOrgAdmin` cru. Piso `rh.manage`:
   * mover alguém de loja é decisão de RH, não ajuste de marcação — é a mesma
   * barra da alocação/cessão (`allocation.service`). As LEITURAS passam
   * `ponto.view`, pra que quem só confere o ponto veja onde a pessoa está.
   */
  private requireAdmin(ctx: RequestContext, chave: string = "rh.manage") {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctxCan(ctx, chave)) throw new AppError(ErrorCode.Forbidden, `Seu perfil nao tem a permissao: ${chave}`, 403);
  }
  private day(s?: string | null): Date | null { if (!s) return null; const d = new Date(`${s}T00:00:00Z`); return isNaN(d.getTime()) ? null : d; }

  private async empNames(ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.pontoEmployee.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } }));
    return new Map(rows.map((r) => [r.id, r.name] as const));
  }
  private async storeNames(ids: string[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) => tx.store.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } }));
    return new Map(rows.map((r) => [r.id, r.name] as const));
  }

  /** Transferências da org (ativas/futuras e recentes), com nomes resolvidos e flag `active` (hoje dentro da janela). */
  async list(ctx: RequestContext) {
    this.requireAdmin(ctx, "ponto.view");
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoStoreTransfer.findMany({ where: { organizationId: ctx.orgId! }, orderBy: [{ status: "asc" }, { startsAt: "desc" }] }));
    const empMap = await this.empNames(rows.map((r) => r.pontoEmployeeId));
    const storeMap = await this.storeNames(rows.flatMap((r) => [r.toStoreId, r.fromStoreId].filter(Boolean) as string[]));
    const today = this.day(new Date().toISOString().slice(0, 10))!.getTime();
    return rows.map((r) => ({
      id: r.id,
      employeeName: empMap.get(r.pontoEmployeeId) ?? "—",
      fromStoreName: r.fromStoreId ? (storeMap.get(r.fromStoreId) ?? "—") : null,
      toStoreName: storeMap.get(r.toStoreId) ?? "—",
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      reason: r.reason,
      status: r.status,
      active: r.status === "active" && new Date(r.startsAt).getTime() <= today && today <= new Date(r.endsAt).getTime(),
    }));
  }

  /** Funcionários (ponto) ativos da org — para o dropdown de funcionário. */
  /**
   * Quem pode ser transferido. O `isPromoter: false` do RH saiu: a coluna vem
   * da feature de promotores (migração 243 de lá), que não foi portada — aqui
   * todo mundo em `ponto_employee` é funcionário de loja.
   */
  async employees(ctx: RequestContext) {
    this.requireAdmin(ctx, "ponto.view");
    const emps = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findMany({ where: { active: true }, select: { id: true, name: true, storeId: true }, orderBy: { name: "asc" } }));
    const storeMap = await this.storeNames(emps.map((e) => e.storeId).filter(Boolean) as string[]);
    return emps.map((e) => ({ id: e.id, name: e.name, storeId: e.storeId ?? null, storeName: e.storeId ? (storeMap.get(e.storeId) ?? "—") : null }));
  }

  /** Lojas ativas da org — para o dropdown de loja destino. */
  async stores(ctx: RequestContext) {
    this.requireAdmin(ctx, "ponto.view");
    return this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.findMany({ where: { status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }));
  }

  /** Cria uma transferência temporária de loja. Datas chegam como "YYYY-MM-DD". */
  async create(ctx: RequestContext, input: { pontoEmployeeId?: string; toStoreId?: string; startsAt?: string; endsAt?: string; reason?: string }) {
    this.requireAdmin(ctx);
    const orgId = ctx.orgId!;
    const empId = (input.pontoEmployeeId || "").trim();
    if (!empId) throw new AppError(ErrorCode.ValidationFailed, "Selecione o funcionário", 400);
    const toStoreId = (input.toStoreId || "").trim();
    if (!toStoreId) throw new AppError(ErrorCode.ValidationFailed, "Selecione a loja destino", 400);
    const emp = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoEmployee.findFirst({ where: { id: empId }, select: { id: true, storeId: true } }));
    if (!emp) throw new AppError(ErrorCode.NotFound, "Funcionário não encontrado nesta empresa", 404);
    const toStore = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.store.findFirst({ where: { id: toStoreId }, select: { id: true } }));
    if (!toStore) throw new AppError(ErrorCode.NotFound, "Loja destino não encontrada nesta empresa", 404);
    const startsAt = this.day(input.startsAt) ?? this.day(new Date().toISOString().slice(0, 10))!;
    const endsAt = this.day(input.endsAt);
    if (!endsAt) throw new AppError(ErrorCode.ValidationFailed, "Informe a data final", 400);
    if (endsAt < startsAt) throw new AppError(ErrorCode.ValidationFailed, "Data final antes da inicial", 400);
    const row = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoStoreTransfer.create({
      data: {
        organizationId: orgId, pontoEmployeeId: empId, fromStoreId: emp.storeId ?? null, toStoreId,
        startsAt, endsAt, reason: input.reason?.slice(0, 500) || null, status: "active",
      },
      select: { id: true },
    }));
    return { id: row.id };
  }

  /** Encerra/cancela uma transferência (valida que é da org). */
  async cancel(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.pontoStoreTransfer.updateMany({ where: { id, organizationId: ctx.orgId! }, data: { status: "cancelled", updatedAt: new Date() } }));
    return { ok: true };
  }
}
