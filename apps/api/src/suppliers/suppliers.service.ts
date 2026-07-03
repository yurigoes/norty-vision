import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

interface UpsertSupplierInput {
  type: "medico" | "laboratorio" | "costureira" | "outro";
  name: string;
  document?: string | null;
  councilNumber?: string | null;
  phone?: string | null;
  email?: string | null;
  payoutMode?: "fixed" | "percent";
  payoutFixedCents?: number | null;
  payoutPercent?: number | null;
  pixKey?: string | null;
  /** Costureira: valor único por peça (centavos). 0 = sem cálculo automático. */
  pricePerPieceCents?: number | null;
  status?: "active" | "inactive";
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private requireAdmin(ctx: RequestContext) {
    if (!ctxCan(ctx, "suppliers.manage")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar fornecedores", 403);
    }
  }

  async list(ctx: RequestContext, opts?: { type?: string; activeOnly?: boolean }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplier.findMany({
        where: {
          deletedAt: null,
          ...(opts?.type ? { type: opts.type } : {}),
          ...(opts?.activeOnly ? { status: "active" } : {}),
        },
        orderBy: [{ type: "asc" }, { name: "asc" }],
      }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const s = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplier.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!s) throw new AppError(ErrorCode.NotFound, "Fornecedor nao encontrado", 404);
    return s;
  }

  private validatePayout(input: { payoutMode?: string; payoutFixedCents?: number | null; payoutPercent?: number | null }) {
    if (input.payoutMode === "percent") {
      const p = input.payoutPercent;
      if (p == null || p < 0 || p > 100) {
        throw new AppError(ErrorCode.ValidationFailed, "Percentual de repasse invalido (0-100)", 400);
      }
    } else if (input.payoutMode === "fixed") {
      if (input.payoutFixedCents != null && input.payoutFixedCents < 0) {
        throw new AppError(ErrorCode.ValidationFailed, "Valor de repasse invalido", 400);
      }
    }
  }

  async create(ctx: RequestContext, input: UpsertSupplierInput) {
    this.requireAdmin(ctx);
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    this.validatePayout(input);
    const doc = input.document ? input.document.replace(/\D/g, "") || null : null;
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplier.create({
        data: {
          organizationId: ctx.orgId!,
          type: input.type,
          name: input.name,
          document: doc,
          councilNumber: input.councilNumber ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          payoutMode: input.payoutMode ?? "fixed",
          payoutFixedCents: input.payoutFixedCents != null ? BigInt(input.payoutFixedCents) : null,
          payoutPercent: input.payoutPercent ?? null,
          pixKey: input.pixKey ?? null,
          pricePerPieceCents: BigInt(Math.max(0, Math.round(input.pricePerPieceCents ?? 0))),
          status: input.status ?? "active",
        },
      }),
    );
  }

  async update(ctx: RequestContext, id: string, input: Partial<UpsertSupplierInput>) {
    this.requireAdmin(ctx);
    await this.getById(ctx, id);
    this.validatePayout(input);
    const data: Record<string, unknown> = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.name !== undefined) data.name = input.name;
    if (input.document !== undefined) data.document = input.document ? input.document.replace(/\D/g, "") || null : null;
    if (input.councilNumber !== undefined) data.councilNumber = input.councilNumber;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email;
    if (input.payoutMode !== undefined) data.payoutMode = input.payoutMode;
    if (input.payoutFixedCents !== undefined) data.payoutFixedCents = input.payoutFixedCents != null ? BigInt(input.payoutFixedCents) : null;
    if (input.payoutPercent !== undefined) data.payoutPercent = input.payoutPercent;
    if (input.pixKey !== undefined) data.pixKey = input.pixKey;
    if (input.pricePerPieceCents !== undefined) data.pricePerPieceCents = BigInt(Math.max(0, Math.round(input.pricePerPieceCents ?? 0)));
    if (input.status !== undefined) data.status = input.status;
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplier.update({ where: { id }, data }),
    );
  }

  async softDelete(ctx: RequestContext, id: string) {
    this.requireAdmin(ctx);
    await this.getById(ctx, id);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.supplier.update({ where: { id }, data: { deletedAt: new Date(), status: "inactive" } }),
    );
  }
}
