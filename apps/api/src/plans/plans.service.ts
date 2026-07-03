import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";

interface UpsertPlanInput {
  slug: string;
  name: string;
  description?: string | null;
  highlight?: string | null;
  niche?: string | null;
  priceCents: number;
  currency?: string;
  interval?: "monthly" | "yearly";
  trialDays?: number;
  maxStores?: number | null;
  maxUsers?: number | null;
  maxMessagesMonth?: number | null;
  features: string[];
  extraHighlights?: string[];
  isActive?: boolean;
  displayOrder?: number;
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Publica: lista planos ativos (RLS abre is_active=true). Opcional: filtra por nicho. */
  async listActive(niche?: string | null) {
    const n = (niche ?? "").toLowerCase().trim();
    return this.prisma.runWithContext({}, (tx) =>
      tx.plan.findMany({
        where: { isActive: true, ...(n ? { OR: [{ niche: null }, { niche: n }] } : {}) },
        orderBy: { displayOrder: "asc" },
      }),
    );
  }

  /** Planos visíveis para a empresa: só a mensalidade do nicho dela (+ genéricos). */
  async listForOrg(orgId?: string | null) {
    if (!orgId) return this.listActive();
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({ where: { id: orgId }, select: { niche: true } }),
    ).catch(() => null);
    return this.listActive(org?.niche ?? null);
  }

  /** Publica: detalhe de plano por slug (so se ativo). */
  async getBySlug(slug: string) {
    const p = await this.prisma.runWithContext({}, (tx) =>
      tx.plan.findFirst({ where: { slug, isActive: true } }),
    );
    if (!p) throw new AppError(ErrorCode.NotFound, "Plano nao encontrado", 404);
    return p;
  }

  /** Master: lista todos os planos (inclui inativos). */
  async listAll() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.plan.findMany({ orderBy: { displayOrder: "asc" } }),
    );
  }

  async create(input: UpsertPlanInput) {
    if (!/^[a-z0-9-]{3,40}$/.test(input.slug)) {
      throw new AppError(ErrorCode.ValidationFailed, "Slug invalido. Use 3-40 caracteres, somente letras minusculas, numeros e hifen.", 400);
    }
    // Checa colisão de slug ANTES do create — o Prisma joga `Unique constraint
    // failed on the (not available)` em alguns ambientes (sem nome de constraint
    // mapeado), deixando o usuário sem pista do que conflitou. Lookup explícito
    // dá mensagem clara apontando o slug.
    const existing = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.plan.findFirst({ where: { slug: input.slug }, select: { id: true, name: true, isActive: true } }),
    );
    if (existing) {
      throw new AppError(ErrorCode.Conflict, `Já existe um plano com o slug "${input.slug}" (${existing.name}${existing.isActive ? "" : " — inativo"}). Edite o existente ou escolha outro slug.`, 409);
    }
    try {
      return await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.plan.create({
          data: {
            slug: input.slug,
            name: input.name,
            description: input.description ?? null,
            highlight: input.highlight ?? null,
            niche: input.niche ? input.niche.toLowerCase().trim() : null,
            priceCents: input.priceCents,
            currency: input.currency ?? "BRL",
            interval: input.interval ?? "monthly",
            trialDays: input.trialDays ?? 14,
            maxStores: input.maxStores ?? null,
            maxUsers: input.maxUsers ?? null,
            maxMessagesMonth: input.maxMessagesMonth ?? null,
            features: input.features as any,
            extraHighlights: (input.extraHighlights ?? []) as any,
            isActive: input.isActive ?? true,
            displayOrder: input.displayOrder ?? 0,
          },
        }),
      );
    } catch (e: any) {
      // Safety net: se mesmo assim cair em race condition ou outra unique
      // constraint não prevista, devolve mensagem mais útil que o "(not available)".
      if (e?.code === "P2002") {
        const target = Array.isArray(e?.meta?.target) ? e.meta.target.join(", ") : (e?.meta?.target ?? "campo único");
        throw new AppError(ErrorCode.Conflict, `Conflito de unicidade ao criar o plano (${target}). Verifique o slug e tente novamente.`, 409);
      }
      throw e;
    }
  }

  async update(id: string, input: Partial<UpsertPlanInput>) {
    const data: Record<string, unknown> = {};
    if (input.niche !== undefined) data.niche = input.niche ? String(input.niche).toLowerCase().trim() : null;
    for (const k of [
      "name",
      "description",
      "highlight",
      "priceCents",
      "currency",
      "interval",
      "trialDays",
      "maxStores",
      "maxUsers",
      "maxMessagesMonth",
      "features",
      "extraHighlights",
      "isActive",
      "displayOrder",
    ] as const) {
      if ((input as any)[k] !== undefined) data[k] = (input as any)[k];
    }
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.plan.update({ where: { id }, data }),
    );
  }
}
