import { Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { ProvisioningService } from "../integrations/provisioning.service";
import type { RequestContext } from "../auth/session.middleware";

interface FirstUserInput {
  email: string;
  name: string;
  password: string;
}

interface FirstStoreInput {
  slug: string;
  name: string;
  city?: string | null;
  state?: string | null;
  timezone?: string;
}

interface CreateOrgInput {
  slug: string;
  name: string;
  legalName?: string | null;
  document?: string | null;
  documentType?: "cnpj" | "cpf" | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** nicho/segmento: define os presets de módulo (call center + portal) */
  niche?: string | null;
  firstUser: FirstUserInput;
  firstStore: FirstStoreInput;
  /** se true, dispara provisioning nos sistemas externos depois de criar */
  autoProvision?: boolean;
}

/**
 * Catálogo de nichos + presets de módulo. Ao criar a empresa com um nicho, já
 * ligamos os botões do call center e os recursos do portal típicos do segmento
 * (o admin/master pode ajustar depois em Configurações). Adicionar nicho novo =
 * só estender este mapa. Chaves devem casar com CALLCENTER_BUTTONS/PORTAL_FEATURES
 * do controller.
 */
export const NICHE_PRESETS: Record<string, { label: string; callcenter: string[]; portal: string[] | null }> = {
  otica: { label: "Ótica", callcenter: ["vender", "agenda"], portal: ["crediario", "os", "contratos"] },
  grafica: { label: "Gráfica/Uniformes", callcenter: ["vender"], portal: ["pedidos", "os", "contratos"] },
  generico: { label: "Genérico", callcenter: ["vender"], portal: null },
};

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger("Organizations");

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly provisioning: ProvisioningService,
  ) {}

  /**
   * Lista todas as organizacoes (master only).
   */
  async listAll() {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        include: {
          _count: { select: { stores: true, memberships: true } },
        },
      }),
    );
  }

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  /**
   * Branding da organizacao atual (logo do contratante + cor principal).
   * Qualquer usuario autenticado da org pode ler.
   */
  async getMine(ctx: RequestContext) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.findFirst({
        where: { id: ctx.orgId!, deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          niche: true,
          logoUrl: true,
          primaryColor: true,
          themeMode: true,
          portalConfig: true,
          callcenterConfig: true,
          planCode: true,
          vitrineHeadline: true,
          vitrineSubheadline: true,
          vitrineAbout: true,
          bannerImageUrl: true,
          bannerLinkUrl: true,
          bannerEnabled: true,
          bannerStartsAt: true,
          bannerEndsAt: true,
          vitrineAddress: true,
          vitrineMapsUrl: true,
          vitrineHours: true,
          socialInstagram: true,
          socialFacebook: true,
          socialWhatsapp: true,
          socialWebsite: true,
          productSkin: true,
        },
      }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Organizacao nao encontrada", 404);

    // módulos habilitados pelo plano (features). Convenção: features é uma lista
    // de chaves de módulo. Vazio/sem plano = null → tudo liberado (sem cadeado).
    let enabledModules: string[] | null = null;
    if (org.planCode) {
      const plan = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.plan.findUnique({ where: { slug: org.planCode! }, select: { features: true } }),
      );
      const feats = plan?.features;
      if (Array.isArray(feats) && feats.length > 0) {
        enabledModules = feats.filter((f): f is string => typeof f === "string");
      }
    }

    // aditivos à la carte: módulos liberados fora do plano (trial/alacarte/cortesia).
    // Ativo = não bloqueado E (pago OU sem expiração OU ainda dentro do prazo).
    if (enabledModules !== null) {
      const now = new Date();
      const grants = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
        tx.orgModuleGrant.findMany({ where: { organizationId: ctx.orgId! } }),
      );
      const active = grants
        .filter((g) => !g.blocked && (g.paid || g.expiresAt == null || g.expiresAt > now))
        .map((g) => g.moduleKey);
      if (active.length) enabledModules = [...new Set([...enabledModules, ...active])];
      // BLOQUEIO por empresa: grant com blocked=true REMOVE o módulo mesmo que o
      // plano inclua (override do master pra empresa específica). Só funciona
      // quando o plano restringe (enabledModules != null) — plano sem features
      // libera tudo e a UI avisa pra definir os módulos do plano antes.
      const blockedKeys = grants.filter((g) => g.blocked).map((g) => g.moduleKey);
      if (blockedKeys.length) enabledModules = enabledModules.filter((k) => !blockedKeys.includes(k));
    }

    // Deny-list de módulos do NICHO da empresa (tabela `niches`, editável no
    // master). Módulos aqui não aparecem pra esse nicho — o front filtra por isto
    // em vez do antigo mapa MODULE_NICHES chumbado. [] se nicho desconhecido.
    let nicheHiddenModules: string[] = [];
    if (org.niche) {
      const nicheRow = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.niche.findFirst({ where: { key: org.niche!.toLowerCase() }, select: { hiddenModuleKeys: true } }),
      ).catch(() => null);
      const h = nicheRow?.hiddenModuleKeys;
      if (Array.isArray(h)) nicheHiddenModules = h.filter((x): x is string => typeof x === "string");
    }

    // Sub-módulos por empresa (Fase 2 + extensão): overrides do master no mapa
    // genérico submodule_features { "<modulo>.<sub>": false } — ausência = ligado
    // (default-on). `productionFeatures` é mantido (chaves "soltas") por
    // compatibilidade com o gating já existente da Produção.
    let submoduleFeatures: Record<string, boolean> = {};
    let productionFeatures: Record<string, boolean> = {};
    const ccs = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.callCenterSettings.findFirst({ where: { organizationId: ctx.orgId! }, select: { submoduleFeatures: true, productionFeatures: true } }),
    ).catch(() => null);
    const sf = (ccs as any)?.submoduleFeatures;
    if (sf && typeof sf === "object" && !Array.isArray(sf)) {
      for (const [k, v] of Object.entries(sf)) {
        const on = v !== false;
        submoduleFeatures[k] = on;
        if (k.startsWith("producao.")) productionFeatures[k.slice("producao.".length)] = on;
      }
    }
    // fallback: se ainda não migrou pro mapa genérico, lê o legado da Produção
    const pf = (ccs as any)?.productionFeatures;
    if (!sf && pf && typeof pf === "object" && !Array.isArray(pf)) {
      for (const [k, v] of Object.entries(pf)) {
        const on = v !== false;
        productionFeatures[k] = on;
        submoduleFeatures[`producao.${k}`] = on;
      }
    }

    return { ...org, enabledModules, nicheHiddenModules, productionFeatures, submoduleFeatures };
  }

  /**
   * Branding/identidade pública de uma empresa pelo slug.
   * Sem auth — usado pela vitrine (subdomínio), landing da loja e telas de
   * login com marca (portal do cliente/funcionário/fornecedor por slug).
   */
  async getPublicBySlug(slug: string) {
    const org = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findFirst({
        where: { slug, deletedAt: null, status: { not: "canceled" } },
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          primaryColor: true,
          themeMode: true,
          productSkin: true,
          planCode: true,
          vitrineHeadline: true,
          vitrineSubheadline: true,
          vitrineAbout: true,
          bannerImageUrl: true,
          bannerLinkUrl: true,
          bannerEnabled: true,
          bannerStartsAt: true,
          bannerEndsAt: true,
          vitrineAddress: true,
          vitrineMapsUrl: true,
          vitrineHours: true,
          socialInstagram: true,
          socialFacebook: true,
          socialWhatsapp: true,
          socialWebsite: true,
        },
      }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Empresa não encontrada", 404);

    const stores = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.store.findMany({
        where: { organizationId: org.id, status: "active", deletedAt: null },
        select: {
          slug: true,
          name: true,
          city: true,
          state: true,
          catalogEnabled: true,
          catalogHeadline: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    );

    // mesma convenção do getMine: features do plano = chaves de módulo.
    let enabledModules: string[] | null = null;
    if (org.planCode) {
      const plan = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.plan.findUnique({ where: { slug: org.planCode! }, select: { features: true } }),
      );
      const feats = plan?.features;
      if (Array.isArray(feats) && feats.length > 0) {
        enabledModules = feats.filter((f): f is string => typeof f === "string");
      }
    }
    if (enabledModules !== null) {
      const now = new Date();
      const grants = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.orgModuleGrant.findMany({ where: { organizationId: org.id } }),
      );
      const active = grants
        .filter((g) => !g.blocked && (g.paid || g.expiresAt == null || g.expiresAt > now))
        .map((g) => g.moduleKey);
      if (active.length) enabledModules = [...new Set([...enabledModules, ...active])];
    }

    const catalogStore = stores.find((s) => s.catalogEnabled) ?? null;

    // nível de satisfação: média das notas (npsScore 0–10) que os clientes deram.
    // Só exibe com amostra mínima (>= 3) pra não parecer forjado.
    const sat = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.satisfactionSurvey.aggregate({
        where: { organizationId: org.id, npsScore: { not: null } },
        _avg: { npsScore: true },
        _count: { _all: true },
      }),
    );
    const satCount = sat._count._all;
    const satAvg = sat._avg.npsScore;
    const satisfaction =
      satCount >= 3 && satAvg != null
        ? { avg: Math.round(satAvg * 10) / 10, count: satCount }
        : null;

    // banner promocional ativo: habilitado, com imagem e dentro da janela.
    const now = new Date();
    const bannerActive =
      org.bannerEnabled &&
      !!org.bannerImageUrl &&
      (org.bannerStartsAt == null || org.bannerStartsAt <= now) &&
      (org.bannerEndsAt == null || org.bannerEndsAt >= now);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      themeMode: org.themeMode ?? "system",
      productSkin: org.productSkin,
      enabledModules,
      catalogSlug: catalogStore?.slug ?? null,
      // headline da vitrine (org) tem prioridade; cai pro headline do catálogo da loja.
      headline: org.vitrineHeadline ?? catalogStore?.catalogHeadline ?? null,
      subheadline: org.vitrineSubheadline ?? null,
      about: org.vitrineAbout ?? null,
      banner: bannerActive
        ? { imageUrl: org.bannerImageUrl, linkUrl: org.bannerLinkUrl ?? null }
        : null,
      satisfaction,
      address: org.vitrineAddress ?? null,
      mapsUrl: org.vitrineMapsUrl ?? null,
      hours: org.vitrineHours ?? null,
      social: {
        instagram: org.socialInstagram ?? null,
        facebook: org.socialFacebook ?? null,
        whatsapp: org.socialWhatsapp ?? null,
        website: org.socialWebsite ?? null,
      },
      stores: stores.map((s) => ({
        slug: s.slug,
        name: s.name,
        city: s.city,
        state: s.state,
        catalogEnabled: s.catalogEnabled,
      })),
    };
  }

  /** Atualiza a vitrine/landing da empresa (admin da empresa ou master). */
  async updateVitrine(
    ctx: RequestContext,
    input: {
      vitrineHeadline?: string | null;
      vitrineSubheadline?: string | null;
      vitrineAbout?: string | null;
      bannerImageUrl?: string | null;
      bannerLinkUrl?: string | null;
      bannerEnabled?: boolean;
      bannerStartsAt?: string | null;
      bannerEndsAt?: string | null;
      vitrineAddress?: string | null;
      vitrineMapsUrl?: string | null;
      vitrineHours?: string | null;
      socialInstagram?: string | null;
      socialFacebook?: string | null;
      socialWhatsapp?: string | null;
      socialWebsite?: string | null;
    },
  ) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const data: Record<string, unknown> = {};
    if (input.vitrineHeadline !== undefined) data.vitrineHeadline = input.vitrineHeadline;
    if (input.vitrineSubheadline !== undefined) data.vitrineSubheadline = input.vitrineSubheadline;
    if (input.vitrineAbout !== undefined) data.vitrineAbout = input.vitrineAbout;
    if (input.bannerImageUrl !== undefined) data.bannerImageUrl = input.bannerImageUrl;
    if (input.bannerLinkUrl !== undefined) data.bannerLinkUrl = input.bannerLinkUrl;
    if (input.bannerEnabled !== undefined) data.bannerEnabled = input.bannerEnabled;
    if (input.bannerStartsAt !== undefined)
      data.bannerStartsAt = input.bannerStartsAt ? new Date(input.bannerStartsAt) : null;
    if (input.bannerEndsAt !== undefined)
      data.bannerEndsAt = input.bannerEndsAt ? new Date(input.bannerEndsAt) : null;
    if (input.vitrineAddress !== undefined) data.vitrineAddress = input.vitrineAddress;
    if (input.vitrineMapsUrl !== undefined) data.vitrineMapsUrl = input.vitrineMapsUrl;
    if (input.vitrineHours !== undefined) data.vitrineHours = input.vitrineHours;
    if (input.socialInstagram !== undefined) data.socialInstagram = input.socialInstagram;
    if (input.socialFacebook !== undefined) data.socialFacebook = input.socialFacebook;
    if (input.socialWhatsapp !== undefined) data.socialWhatsapp = input.socialWhatsapp;
    if (input.socialWebsite !== undefined) data.socialWebsite = input.socialWebsite;

    const org = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.update({
        where: { id: ctx.orgId! },
        data,
        select: {
          vitrineHeadline: true,
          vitrineSubheadline: true,
          vitrineAbout: true,
          bannerImageUrl: true,
          bannerLinkUrl: true,
          bannerEnabled: true,
          bannerStartsAt: true,
          bannerEndsAt: true,
          vitrineAddress: true,
          vitrineMapsUrl: true,
          vitrineHours: true,
          socialInstagram: true,
          socialFacebook: true,
          socialWhatsapp: true,
          socialWebsite: true,
        },
      }),
    );
    return org;
  }

  /**
   * Atualiza branding da org (logo + cor). Apenas admin da propria empresa
   * ou master.
   */
  async updateBranding(
    ctx: RequestContext,
    input: { logoUrl?: string | null; primaryColor?: string | null; themeMode?: string },
  ) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const data: Record<string, unknown> = {};
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
    if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;
    if (input.themeMode !== undefined) data.themeMode = input.themeMode;
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.update({
        where: { id: ctx.orgId! },
        data,
        select: { id: true, name: true, logoUrl: true, primaryColor: true, themeMode: true },
      }),
    );
  }

  /** Configura os recursos do portal do cliente (null = padrão, mostra todos). */
  async updatePortal(ctx: RequestContext, features: string[] | null) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.update({
        where: { id: ctx.orgId! },
        data: { portalConfig: features === null ? null : (features as any) },
        select: { id: true, portalConfig: true },
      }),
    );
  }

  /** Configura os botões do call center (null = padrão, segue os módulos). */
  async updateCallcenter(ctx: RequestContext, buttons: string[] | null) {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (!ctx.isOrgAdmin && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    return this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.organization.update({
        where: { id: ctx.orgId! },
        data: { callcenterConfig: buttons === null ? null : (buttons as any) },
        select: { id: true, callcenterConfig: true },
      }),
    );
  }

  /**
   * Atualiza dados gerais da organização (master only). Edita tudo: dados
   * cadastrais, plano, status, branding.
   */
  async updateById(
    id: string,
    input: {
      name?: string;
      legalName?: string | null;
      document?: string | null;
      documentType?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      status?: string;
      planCode?: string;
      defaultLocale?: string;
      defaultTimezone?: string;
      logoUrl?: string | null;
      primaryColor?: string | null;
      themeMode?: string;
      portalConfig?: string[] | null;
      callcenterConfig?: string[] | null;
      slug?: string;
      maxExtraWhatsapp?: number;
      niche?: string | null;
      productSkin?: string | null;
    },
  ) {
    const data: Record<string, unknown> = {};
    for (const k of [
      "name", "legalName", "document", "documentType", "contactEmail",
      "contactPhone", "status", "planCode", "defaultLocale", "defaultTimezone",
      "logoUrl", "primaryColor", "themeMode", "portalConfig", "callcenterConfig", "slug", "maxExtraWhatsapp", "niche", "productSkin",
    ] as const) {
      if (input[k] !== undefined) data[k] = input[k];
    }
    // slug é único: normaliza
    if (typeof data.slug === "string") {
      data.slug = (data.slug as string).trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    }
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.update({ where: { id }, data }),
    );
  }

  /**
   * Detalha uma organizacao por ID (master only).
   */
  async getById(id: string) {
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.organization.findUnique({
        where: { id },
        include: {
          stores: {
            where: { deletedAt: null },
            orderBy: { name: "asc" },
          },
          _count: { select: { stores: true, memberships: true } },
        },
      }),
    );
  }

  /**
   * Cria organizacao + primeiro store + primeiro user (owner) + membership.
   * Tudo numa transacao. Opcionalmente dispara provisioning externo.
   */
  async create(opts: { platformUserId: string; input: CreateOrgInput }) {
    const input = opts.input;
    this.validateInput(input);

    const passwordHash = await this.argon.hash(input.firstUser.password);

    // checagem de unicidade rapida
    const existsOrg = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) => tx.organization.findUnique({ where: { slug: input.slug } }),
    );
    if (existsOrg) {
      throw new AppError(ErrorCode.Conflict, "Slug de organizacao ja existe", 409);
    }
    const existsUser = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.user.findUnique({
          where: { email: input.firstUser.email.toLowerCase().trim() },
        }),
    );
    if (existsUser) {
      throw new AppError(
        ErrorCode.Conflict,
        "Email do primeiro usuario ja existe",
        409,
      );
    }

    // pega o role 'owner' (template global)
    const ownerRole = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.role.findFirst({
          where: { slug: "owner", organizationId: null },
        }),
    );
    if (!ownerRole) {
      throw new AppError(
        ErrorCode.Internal,
        "Role 'owner' template nao seedado",
        500,
      );
    }

    // tx unica: organization + store + user + membership
    const result = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      async (tx) => {
        // nicho + preset de módulos (se reconhecido). Nicho desconhecido grava o
        // valor mas não aplica preset (deixa o admin configurar manualmente).
        const niche = input.niche?.trim() || null;
        const preset = niche ? NICHE_PRESETS[niche] : undefined;
        const org = await tx.organization.create({
          data: {
            slug: input.slug,
            name: input.name,
            legalName: input.legalName ?? null,
            document: input.document ?? null,
            documentType: input.documentType ?? null,
            contactEmail: input.contactEmail ?? null,
            contactPhone: input.contactPhone ?? null,
            niche,
            callcenterConfig: preset ? (preset.callcenter as any) : undefined,
            portalConfig: preset && preset.portal ? (preset.portal as any) : undefined,
            status: "active",
          },
        });

        const store = await tx.store.create({
          data: {
            organizationId: org.id,
            slug: input.firstStore.slug,
            name: input.firstStore.name,
            city: input.firstStore.city ?? null,
            state: input.firstStore.state ?? null,
            timezone: input.firstStore.timezone ?? "America/Sao_Paulo",
            status: "active",
          },
        });

        const user = await tx.user.create({
          data: {
            email: input.firstUser.email.toLowerCase().trim(),
            name: input.firstUser.name,
            passwordHash,
            status: "active",
            emailVerifiedAt: new Date(),
          },
        });

        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: org.id,
            storeId: store.id,
            roleId: ownerRole.id,
            status: "active",
            isPrimary: true,
            acceptedAt: new Date(),
          },
        });

        return { org, store, user, membership };
      },
    );

    this.logger.log(
      `org criada: ${result.org.slug} (${result.org.id}) + store ${result.store.slug} + owner ${result.user.email}`,
    );

    // provisioning best-effort em background (nao bloqueia o response)
    let provisioningResult: any = null;
    if (input.autoProvision) {
      try {
        provisioningResult = await this.provisioning.provisionOrganization({
          isPlatformAdmin: true,
          organizationId: result.org.id,
        });
      } catch (e: any) {
        this.logger.error(`provisioning falhou: ${e?.message}`);
        provisioningResult = { error: e?.message ?? "falhou" };
      }
    }

    return {
      organization: result.org,
      store: result.store,
      user: { id: result.user.id, email: result.user.email, name: result.user.name },
      provisioning: provisioningResult,
    };
  }

  private validateInput(input: CreateOrgInput) {
    if (!/^[a-z0-9-]{3,40}$/.test(input.slug)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Slug deve ter 3-40 chars [a-z0-9-]",
        400,
      );
    }
    if (!/^[a-z0-9-]{3,40}$/.test(input.firstStore.slug)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Slug do store deve ter 3-40 chars [a-z0-9-]",
        400,
      );
    }
    if (input.firstUser.password.length < 12) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Senha precisa de no minimo 12 caracteres",
        400,
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.firstUser.email)) {
      throw new AppError(ErrorCode.ValidationFailed, "Email invalido", 400);
    }
  }
}
