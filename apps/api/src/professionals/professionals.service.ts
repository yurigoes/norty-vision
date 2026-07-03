import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

interface UpsertProfessionalInput {
  storeId?: string;
  name: string;
  displayName?: string | null;
  document?: string | null;
  registrationId?: string | null;
  registrationUf?: string | null;
  specialty?: string | null;
  bio?: string | null;
  email?: string | null;
  phone?: string | null;
  colorHex?: string | null;
  defaultAppointmentDurationMin?: number;
  defaultAppointmentCapacity?: number;
  acceptsWalkIn?: boolean;
  status?: "active" | "inactive" | "vacation" | "suspended";
  displayOrder?: number;
}

@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
  ) {}

  /**
   * Garante um usuario do sistema para o profissional (replica em Usuarios).
   * Find-or-create por email; senha inicial = documento (digitos) ou aleatoria;
   * cria membership com papel 'profissional'. Roda como platform-admin pois a
   * RLS de users so permite insert por platform-admin (autz ja feita no create).
   */
  private async ensureUserForProfessional(
    orgId: string,
    storeId: string,
    info: { email: string; name: string; document?: string | null; phone?: string | null },
  ): Promise<string | null> {
    const email = info.email.toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
    const pwd = (info.document ?? "").replace(/\D/g, "") || randomBytes(8).toString("hex");
    const passwordHash = await this.argon.hash(pwd);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        user = await tx.user.create({
          data: {
            email,
            name: info.name,
            passwordHash,
            phone: info.phone ?? null,
            status: "active",
            emailVerifiedAt: new Date(),
          },
        });
      }
      // papel 'profissional' (global ou da org), cria se nao existir
      let role = await tx.role.findFirst({
        where: { slug: "profissional", OR: [{ organizationId: null }, { organizationId: orgId }] },
      });
      if (!role) {
        role = await tx.role.create({
          data: { organizationId: orgId, slug: "profissional", name: "Profissional", permissions: {}, isSystem: false, isDefault: false },
        });
      }
      const existing = await tx.membership.findFirst({ where: { userId: user.id, organizationId: orgId } });
      if (!existing) {
        await tx.membership.create({
          data: { userId: user.id, organizationId: orgId, storeId, roleId: role.id, status: "active", acceptedAt: new Date() },
        });
      }
      return user.id;
    });
  }

  async list(ctx: RequestContext, opts?: { storeId?: string }) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.professional.findMany({
          where: {
            deletedAt: null,
            ...(opts?.storeId ? { storeId: opts.storeId } : {}),
          },
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const p = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) => tx.professional.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!p) throw new AppError(ErrorCode.NotFound, "Profissional nao encontrado", 404);
    return p;
  }

  /** Resolve a loja: dado -> contexto -> unica loja ativa da org. */
  private async resolveStoreId(ctx: RequestContext, given?: string): Promise<string> {
    if (given) return given;
    if (ctx.storeId) return ctx.storeId;
    const stores = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.store.findMany({
          where: { organizationId: ctx.orgId!, status: "active", deletedAt: null },
          select: { id: true },
          take: 2,
        }),
    );
    if (stores.length === 0) {
      throw new AppError(ErrorCode.ValidationFailed, "Crie uma loja antes de cadastrar profissionais", 400);
    }
    if (stores.length > 1) {
      throw new AppError(ErrorCode.ValidationFailed, "Selecione a loja do profissional", 400);
    }
    return stores[0]!.id;
  }

  async create(ctx: RequestContext, input: UpsertProfessionalInput) {
    if (!ctxCan(ctx, "professionals.manage")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar profissionais", 403);
    }
    const storeId = await this.resolveStoreId(ctx, input.storeId);
    // se tem email, replica em Usuarios (find-or-create + membership)
    let userId: string | null = null;
    if (input.email) {
      userId = await this.ensureUserForProfessional(ctx.orgId!, storeId, {
        email: input.email,
        name: input.name,
        document: input.document,
        phone: input.phone,
      });
    }
    return this.prisma.runWithContext(
      // store_id no contexto e obrigatorio: a RLS exige
      // store_id = current_store_id() no WITH CHECK do insert.
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true, storeId },
      (tx) =>
        tx.professional.create({
          data: {
            organizationId: ctx.orgId!,
            storeId,
            userId,
            name: input.name,
            displayName: input.displayName ?? null,
            document: input.document ?? null,
            registrationId: input.registrationId ?? null,
            registrationUf: input.registrationUf ?? null,
            specialty: input.specialty ?? null,
            bio: input.bio ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            colorHex: input.colorHex ?? null,
            defaultAppointmentDurationMin: input.defaultAppointmentDurationMin ?? 15,
            defaultAppointmentCapacity: input.defaultAppointmentCapacity ?? 1,
            acceptsWalkIn: input.acceptsWalkIn ?? false,
            status: input.status ?? "active",
            displayOrder: input.displayOrder ?? 0,
          },
        }),
    );
  }

  async update(ctx: RequestContext, id: string, input: Partial<UpsertProfessionalInput>) {
    if (!ctxCan(ctx, "professionals.manage")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar profissionais", 403);
    }
    // a RLS exige store_id = current_store_id(); usa a loja do proprio registro
    const current = await this.getById(ctx, id);
    const data: Record<string, unknown> = {};
    for (const k of [
      "name",
      "displayName",
      "document",
      "registrationId",
      "registrationUf",
      "specialty",
      "bio",
      "email",
      "phone",
      "colorHex",
      "defaultAppointmentDurationMin",
      "defaultAppointmentCapacity",
      "acceptsWalkIn",
      "status",
      "displayOrder",
    ] as const) {
      if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true, storeId: current.storeId },
      (tx) => tx.professional.update({ where: { id }, data }),
    );
  }

  async softDelete(ctx: RequestContext, id: string) {
    if (!ctxCan(ctx, "professionals.manage")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar profissionais", 403);
    }
    const current = await this.getById(ctx, id);
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true, storeId: current.storeId },
      (tx) =>
        tx.professional.update({
          where: { id },
          data: { deletedAt: new Date(), status: "inactive" },
        }),
    );
  }
}
