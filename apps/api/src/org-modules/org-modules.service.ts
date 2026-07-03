import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/session.middleware";

@Injectable()
export class OrgModulesService {
  constructor(private readonly prisma: PrismaService) {}

  private requireMaster(ctx: RequestContext) {
    if (!ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas master", 403);
  }

  /** Grants da empresa + os módulos que o PLANO já cobre (baseline), pra UI do
   *  master mostrar "incluído no plano" vs "liberar à la carte/cortesia". */
  async list(ctx: RequestContext, organizationId: string) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const items = await tx.orgModuleGrant.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
      const org = await tx.organization.findFirst({ where: { id: organizationId }, select: { planCode: true } });
      let planModules: string[] = [];
      let planName: string | null = null;
      if (org?.planCode) {
        const plan = await tx.plan.findUnique({ where: { slug: org.planCode }, select: { name: true, features: true } });
        planName = plan?.name ?? org.planCode;
        planModules = Array.isArray(plan?.features) ? (plan!.features as unknown[]).filter((f): f is string => typeof f === "string") : [];
      }
      return { items, planModules, planName };
    });
  }

  async grant(
    ctx: RequestContext,
    organizationId: string,
    input: { moduleKey: string; kind: "trial" | "alacarte" | "courtesy"; priceCents?: number | null; days?: number | null; notes?: string | null },
  ) {
    this.requireMaster(ctx);
    if (input.kind === "trial" && !input.days) throw new AppError(ErrorCode.ValidationFailed, "Informe os dias do teste", 400);
    if (input.kind === "alacarte" && (input.priceCents == null)) throw new AppError(ErrorCode.ValidationFailed, "Informe o preço do à la carte", 400);

    const expiresAt =
      input.kind === "trial" ? new Date(Date.now() + input.days! * 86400_000)
      : input.kind === "alacarte" ? new Date(Date.now() + 3 * 86400_000) // prazo p/ pagar (3 dias)
      : null;

    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.upsert({
        where: { organizationId_moduleKey: { organizationId, moduleKey: input.moduleKey } },
        update: {
          kind: input.kind,
          priceCents: input.priceCents ?? null,
          expiresAt,
          blocked: false,
          notes: input.notes ?? null,
          createdByPlatformUserId: ctx.platformUserId ?? null,
        },
        create: {
          organizationId,
          moduleKey: input.moduleKey,
          kind: input.kind,
          priceCents: input.priceCents ?? null,
          expiresAt,
          notes: input.notes ?? null,
          createdByPlatformUserId: ctx.platformUserId ?? null,
        },
      }),
    );
  }

  async markPaid(ctx: RequestContext, organizationId: string, moduleKey: string) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.update({
        where: { organizationId_moduleKey: { organizationId, moduleKey } },
        data: { paid: true, paidAt: new Date(), blocked: false },
      }),
    );
  }

  async revoke(ctx: RequestContext, organizationId: string, moduleKey: string) {
    this.requireMaster(ctx);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.deleteMany({ where: { organizationId, moduleKey } }),
    );
    return { ok: true };
  }

  /** BLOQUEIA um módulo pra essa empresa (mesmo que o plano inclua). Cria/atualiza
   *  um grant blocked=true; o getMine remove esse módulo do enabledModules. */
  async block(ctx: RequestContext, organizationId: string, moduleKey: string, notes?: string | null) {
    this.requireMaster(ctx);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.upsert({
        where: { organizationId_moduleKey: { organizationId, moduleKey } },
        update: { blocked: true, notes: notes ?? null, createdByPlatformUserId: ctx.platformUserId ?? null },
        create: { organizationId, moduleKey, kind: "courtesy", blocked: true, notes: notes ?? null, createdByPlatformUserId: ctx.platformUserId ?? null },
      }),
    );
  }

  /** Desbloqueia: remove o grant (volta ao que o plano define). */
  async unblock(ctx: RequestContext, organizationId: string, moduleKey: string) {
    this.requireMaster(ctx);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.orgModuleGrant.deleteMany({ where: { organizationId, moduleKey, blocked: true } }),
    );
    return { ok: true };
  }

  // ---- Sub-módulos por empresa (Fase 2 + extensão) ------------------------
  // Overrides DEFAULT-ON no mapa genérico { "<modulo>.<sub>": false } —
  // esconde aquela aba/tela só dessa empresa. Vive em
  // call_center_settings.submodule_features.

  /** Mapa genérico atual de overrides (só o que foi desligado). {} = tudo ligado.
   *  Faz fallback pro legado da Produção se ainda não migrou. */
  async getSubmoduleFeatures(ctx: RequestContext, organizationId: string): Promise<Record<string, boolean>> {
    this.requireMaster(ctx);
    const row = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.callCenterSettings.findFirst({ where: { organizationId }, select: { submoduleFeatures: true, productionFeatures: true } }),
    );
    const out: Record<string, boolean> = {};
    const sf = (row as any)?.submoduleFeatures;
    if (sf && typeof sf === "object" && !Array.isArray(sf)) {
      for (const [k, v] of Object.entries(sf)) out[k] = v !== false ? true : false;
    } else {
      const pf = (row as any)?.productionFeatures;
      if (pf && typeof pf === "object" && !Array.isArray(pf)) for (const [k, v] of Object.entries(pf)) out[`producao.${k}`] = v !== false ? true : false;
    }
    return out;
  }

  /** Grava o mapa genérico (chaves "<modulo>.<sub>"). Normaliza: mantém só as
   *  chaves `false` (default-on) pra não inflar o JSON. */
  async setSubmoduleFeatures(ctx: RequestContext, organizationId: string, features: Record<string, boolean>) {
    this.requireMaster(ctx);
    const denied: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(features)) if (v === false) denied[k] = false;
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.callCenterSettings.upsert({
        where: { organizationId },
        update: { submoduleFeatures: denied },
        create: { organizationId, submoduleFeatures: denied },
      }),
    );
    return { ok: true, submoduleFeatures: denied };
  }

  // ---- back-compat: endpoint antigo só-Produção (chaves "soltas") ----------
  async getProductionFeatures(ctx: RequestContext, organizationId: string): Promise<Record<string, boolean>> {
    const all = await this.getSubmoduleFeatures(ctx, organizationId);
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith("producao.")) out[k.slice("producao.".length)] = v;
    return out;
  }
  async setProductionFeatures(ctx: RequestContext, organizationId: string, features: Record<string, boolean>) {
    // preserva overrides de OUTROS módulos e regrava só a fatia da Produção
    const current = await this.getSubmoduleFeatures(ctx, organizationId);
    const merged: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(current)) if (!k.startsWith("producao.") && v === false) merged[k] = false;
    for (const [k, v] of Object.entries(features)) if (v === false) merged[`producao.${k}`] = false;
    await this.setSubmoduleFeatures(ctx, organizationId, merged);
    return { ok: true };
  }
}
