import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

interface CreateStoreInput {
  organizationId?: string;
  slug: string;
  name: string;
  document?: string | null;
  city?: string | null;
  state?: string | null;
  timezone?: string;
}

interface UpdateStoreInput {
  name?: string;
  document?: string | null;
  city?: string | null;
  state?: string | null;
  timezone?: string;
  status?: "active" | "paused" | "archived";
  themePrimaryColor?: string | null;
  themeSecondaryColor?: string | null;
  themeAccentColor?: string | null;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  faviconUrl?: string | null;
  themeMode?: "light" | "dark" | "system";
}

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, filter?: { organizationId?: string }) {
    if (ctx.isPlatformAdmin) {
      const orgId = filter?.organizationId;
      return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.store.findMany({
          where: {
            deletedAt: null,
            ...(orgId ? { organizationId: orgId } : {}),
          },
          orderBy: [{ organizationId: "asc" }, { name: "asc" }],
          include: { organization: { select: { id: true, slug: true, name: true } } },
        }),
      );
    }

    if (!ctx.orgId) {
      throw new AppError(ErrorCode.Forbidden, "Sem organizacao no contexto", 403);
    }

    return this.prisma.runWithContext(
      { orgId: ctx.orgId, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.store.findMany({
          where: { organizationId: ctx.orgId!, deletedAt: null },
          orderBy: { name: "asc" },
        }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const store = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : {
            orgId: ctx.orgId ?? undefined,
            userId: ctx.userId ?? undefined,
            isOrgAdmin: ctx.isOrgAdmin,
          },
      (tx) =>
        tx.store.findFirst({
          where: { id, deletedAt: null },
          include: { organization: { select: { id: true, slug: true, name: true } } },
        }),
    );
    if (!store) throw new AppError(ErrorCode.NotFound, "Loja nao encontrada", 404);
    return store;
  }

  async create(ctx: RequestContext, input: CreateStoreInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode criar loja", 403);
    }

    const targetOrgId = ctx.isPlatformAdmin
      ? input.organizationId
      : ctx.orgId;
    if (!targetOrgId) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "organizationId obrigatorio (master) ou contexto sem org (admin)",
        400,
      );
    }

    this.validateSlug(input.slug);

    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const existing = await tx.store.findFirst({
          where: { organizationId: targetOrgId, slug: input.slug },
        });
        if (existing) {
          throw new AppError(ErrorCode.Conflict, "Slug ja usado nessa org", 409);
        }
        return tx.store.create({
          data: {
            organizationId: targetOrgId,
            slug: input.slug,
            name: input.name,
            document: input.document ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            timezone: input.timezone ?? "America/Sao_Paulo",
            status: "active",
          },
        });
      },
    );
  }

  async update(ctx: RequestContext, id: string, input: UpdateStoreInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode editar loja", 403);
    }

    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const store = await tx.store.findFirst({
          where: { id, deletedAt: null },
        });
        if (!store) throw new AppError(ErrorCode.NotFound, "Loja nao encontrada", 404);
        if (!ctx.isPlatformAdmin && store.organizationId !== ctx.orgId) {
          throw new AppError(ErrorCode.Forbidden, "Loja nao pertence a sua org", 403);
        }
        const data: Record<string, unknown> = {};
        for (const k of [
          "name", "document", "city", "state", "timezone", "status",
          "themePrimaryColor", "themeSecondaryColor", "themeAccentColor",
          "logoUrl", "logoDarkUrl", "faviconUrl", "themeMode",
          "examPriceCents", "examPaymentNote",
        ] as const) {
          if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
        }
        return tx.store.update({ where: { id }, data });
      },
    );
  }

  async softDelete(ctx: RequestContext, id: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode arquivar loja", 403);
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const store = await tx.store.findFirst({
          where: { id, deletedAt: null },
        });
        if (!store) throw new AppError(ErrorCode.NotFound, "Loja nao encontrada", 404);
        if (!ctx.isPlatformAdmin && store.organizationId !== ctx.orgId) {
          throw new AppError(ErrorCode.Forbidden, "Loja nao pertence a sua org", 403);
        }
        return tx.store.update({
          where: { id },
          data: { deletedAt: new Date(), status: "archived" },
        });
      },
    );
  }

  private validateSlug(slug: string) {
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Slug deve ter 2-40 chars [a-z0-9-]",
        400,
      );
    }
  }
}
