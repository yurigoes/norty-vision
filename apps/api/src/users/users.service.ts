import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ArgonService } from "../auth/argon.service";
import { ProvisioningService } from "../integrations/provisioning.service";
import { NotificationService } from "../notifications/notification.service";
import type { RequestContext } from "../auth/session.middleware";

interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  phone?: string | null;
  organizationId?: string;
  storeId?: string | null;
  roleSlug: string;
  alsoProfessional?: boolean;
}

interface UpdateUserInput {
  name?: string;
  email?: string;
  phone?: string | null;
  status?: "active" | "suspended" | "invited";
  password?: string;
}

interface CreateMembershipInput {
  organizationId?: string;
  storeId?: string | null;
  roleSlug: string;
}

interface UpsertRoleInput {
  slug?: string;
  name: string;
  description?: string | null;
  permissions: Record<string, boolean>;
}

/**
 * Catalogo de permissoes configuraveis por papel. Cada item vira um checkbox
 * na UI de papeis e pode ser exigido via @RequirePermission("chave").
 * owner/admin tem acesso total e ignoram este mapa.
 *
 * Convenção: chaves planas no formato "<modulo>.<acao>". Granular o suficiente
 * pra delegação real, sem virar 200 checkboxes (~70 itens em ~17 módulos).
 */
export const PERMISSION_CATALOG: Array<{
  group: string;
  items: Array<{ key: string; label: string }>;
}> = [
  {
    group: "Agenda",
    items: [
      { key: "agenda.view", label: "Ver agenda" },
      { key: "agenda.create", label: "Marcar consulta/serviço" },
      { key: "agenda.edit", label: "Editar/remarcar" },
      { key: "agenda.cancel", label: "Cancelar marcação" },
      { key: "agenda.view_others", label: "Ver agenda de outros profissionais" },
    ],
  },
  {
    group: "Profissionais",
    items: [
      { key: "professionals.view", label: "Ver profissionais" },
      { key: "professionals.manage", label: "Cadastrar/editar profissionais" },
    ],
  },
  {
    group: "Clientes",
    items: [
      { key: "customers.view", label: "Ver clientes" },
      { key: "customers.create", label: "Cadastrar cliente" },
      { key: "customers.edit", label: "Editar cliente" },
      { key: "customers.delete", label: "Excluir cliente" },
      { key: "customers.export", label: "Exportar lista" },
    ],
  },
  {
    group: "Vendas & PDV",
    items: [
      { key: "sales.view", label: "Ver vendas" },
      { key: "sales.create", label: "Registrar venda" },
      { key: "sales.discount", label: "Aplicar desconto" },
      { key: "sales.cancel", label: "Cancelar venda" },
      { key: "sales.refund", label: "Estornar venda" },
    ],
  },
  {
    group: "Produtos & Estoque",
    items: [
      { key: "products.view", label: "Ver produtos" },
      { key: "products.create", label: "Cadastrar produto" },
      { key: "products.edit", label: "Editar produto" },
      { key: "products.delete", label: "Excluir produto" },
      { key: "products.price", label: "Alterar preço/promo" },
      { key: "products.stock", label: "Movimentar estoque" },
      { key: "products.import", label: "Importar produtos" },
    ],
  },
  {
    group: "Produção (gráfica/ótica)",
    items: [
      { key: "production.view", label: "Ver pedidos em produção" },
      { key: "production.create", label: "Criar pedido de produção" },
      { key: "production.update_status", label: "Avançar status" },
      { key: "production.assign", label: "Atribuir designer/laboratório/costureira" },
      { key: "production.cancel", label: "Cancelar produção" },
    ],
  },
  {
    group: "Fiscal (NF)",
    items: [
      { key: "fiscal.nfce.emit", label: "Emitir NFC-e" },
      { key: "fiscal.nfce.cancel", label: "Cancelar NFC-e" },
      { key: "fiscal.nfe.emit", label: "Emitir NF-e" },
      { key: "fiscal.nfe.cancel", label: "Cancelar NF-e" },
      { key: "fiscal.nfse.emit", label: "Emitir NFS-e" },
      { key: "fiscal.nfse.cancel", label: "Cancelar NFS-e" },
      { key: "fiscal.config", label: "Configurar fiscal (certificado, CSC)" },
    ],
  },
  {
    group: "Crediário & Cobrança",
    items: [
      { key: "credit.view", label: "Ver crediário" },
      { key: "credit.approve", label: "Aprovar limite/parcelamento" },
      { key: "credit.collect", label: "Cobrança ativa" },
      { key: "credit.write_off", label: "Dar baixa/perda" },
    ],
  },
  {
    group: "Caixa & Financeiro",
    items: [
      { key: "cashbox.open", label: "Abrir caixa" },
      { key: "cashbox.close", label: "Fechar caixa" },
      { key: "cashbox.adjust", label: "Sangria/suprimento" },
      { key: "cashbox.view_all", label: "Ver caixa de outros" },
      { key: "payments.config", label: "Configurar gateways de pagamento" },
    ],
  },
  {
    group: "Leads & CRM",
    items: [
      { key: "leads.view", label: "Ver leads" },
      { key: "leads.create", label: "Criar lead" },
      { key: "leads.assign", label: "Atribuir/transferir lead" },
      { key: "crm.pipeline_manage", label: "Configurar pipeline e tabulações" },
      { key: "crm.supervise", label: "Supervisão (ver tudo da equipe)" },
    ],
  },
  {
    group: "Atendimento (chat + telefonia)",
    items: [
      { key: "chat.respond", label: "Responder chats do WhatsApp" },
      { key: "chat.view_all", label: "Ver chats de todos os operadores" },
      { key: "voip.call_internal", label: "Ligar para ramais (interno)" },
      { key: "voip.call_external", label: "Ligar para externos (PSTN)" },
      { key: "voip.admin", label: "Configurar trunks/DIDs/grupos/IVR" },
    ],
  },
  {
    group: "Marketing & Disparos",
    items: [
      { key: "broadcast.view", label: "Ver mala direta" },
      { key: "broadcast.send", label: "Enviar mala direta" },
      { key: "templates.manage", label: "Modelos de mensagem" },
    ],
  },
  {
    group: "Relatórios & BI",
    items: [
      { key: "reports.sales", label: "Relatório de vendas" },
      { key: "reports.financial", label: "Relatório financeiro" },
      { key: "reports.commission", label: "Comissões dos vendedores" },
      { key: "reports.production", label: "Relatório de produção" },
      { key: "reports.bi_panel", label: "Painel BI (kiosk)" },
    ],
  },
  {
    group: "Ótica (nicho)",
    items: [
      { key: "lens.orders", label: "Pedidos de lente" },
      { key: "lens.batches", label: "Lotes do laboratório" },
      { key: "payouts.manage", label: "Repasses (médico/lab)" },
      { key: "suppliers.manage", label: "Fornecedores" },
    ],
  },
  {
    group: "Contratos & Documentos",
    items: [
      { key: "contracts.view", label: "Ver contratos" },
      { key: "contracts.manage", label: "Gerenciar contratos" },
      { key: "contracts.sign", label: "Coletar assinatura" },
    ],
  },
  {
    group: "Configuração da empresa",
    items: [
      { key: "stores.manage", label: "Lojas (matriz/filiais)" },
      { key: "users.manage", label: "Usuários e permissões" },
      { key: "roles.manage", label: "Criar/editar papéis customizados" },
      { key: "integrations.manage", label: "Integrações (WhatsApp, EvoAPI, MP)" },
      { key: "settings.org", label: "Dados da empresa" },
    ],
  },
  {
    group: "Suporte ao sistema",
    items: [
      { key: "tickets.create", label: "Abrir chamados ao master" },
      { key: "tickets.view", label: "Ver chamados da empresa" },
    ],
  },
];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: ArgonService,
    private readonly provisioning: ProvisioningService,
    private readonly notifications: NotificationService,
  ) {}

  async list(ctx: RequestContext, filter?: { organizationId?: string }) {
    if (ctx.isPlatformAdmin) {
      const orgId = filter?.organizationId;
      return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.user.findMany({
          where: orgId
            ? { memberships: { some: { organizationId: orgId } } }
            : {},
          orderBy: { name: "asc" },
          include: {
            memberships: {
              where: orgId ? { organizationId: orgId } : {},
              include: {
                organization: { select: { id: true, slug: true, name: true } },
                store: { select: { id: true, slug: true, name: true } },
                role: { select: { slug: true, name: true, permissions: true } },
              },
            },
          },
        }),
      );
    }

    if (!ctx.orgId) {
      throw new AppError(ErrorCode.Forbidden, "Sem organizacao no contexto", 403);
    }
    if (!ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode listar usuarios", 403);
    }

    return this.prisma.runWithContext(
      { orgId: ctx.orgId, userId: ctx.userId!, isOrgAdmin: true },
      (tx) =>
        tx.user.findMany({
          where: { memberships: { some: { organizationId: ctx.orgId! } } },
          orderBy: { name: "asc" },
          include: {
            memberships: {
              where: { organizationId: ctx.orgId! },
              include: {
                store: { select: { id: true, slug: true, name: true } },
                role: { select: { slug: true, name: true, permissions: true } },
              },
            },
          },
        }),
    );
  }

  async getById(ctx: RequestContext, id: string) {
    const user = await this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: ctx.isOrgAdmin },
      (tx) =>
        tx.user.findUnique({
          where: { id },
          include: {
            memberships: {
              include: {
                organization: { select: { id: true, slug: true, name: true } },
                store: { select: { id: true, slug: true, name: true } },
                role: { select: { slug: true, name: true, permissions: true } },
              },
            },
          },
        }),
    );
    if (!user) throw new AppError(ErrorCode.NotFound, "Usuario nao encontrado", 404);
    if (
      !ctx.isPlatformAdmin &&
      !user.memberships.some((m) => m.organizationId === ctx.orgId)
    ) {
      throw new AppError(ErrorCode.Forbidden, "Usuario fora da sua org", 403);
    }
    return user;
  }

  async create(ctx: RequestContext, input: CreateUserInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode criar usuario", 403);
    }

    const targetOrgId = ctx.isPlatformAdmin ? input.organizationId : ctx.orgId;
    if (!targetOrgId) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "organizationId obrigatorio (master) ou contexto sem org (admin)",
        400,
      );
    }

    this.validatePassword(input.password);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
      throw new AppError(ErrorCode.ValidationFailed, "Email invalido", 400);
    }

    const role = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.role.findFirst({
          where: {
            slug: input.roleSlug,
            OR: [{ organizationId: null }, { organizationId: targetOrgId }],
          },
        }),
    );
    if (!role) {
      throw new AppError(ErrorCode.NotFound, `Role ${input.roleSlug} nao existe`, 404);
    }

    const passwordHash = await this.argon.hash(input.password);

    // RLS de users bloqueia insert que nao seja platform-admin; a autorizacao
    // (admin da org + targetOrgId == ctx.orgId) ja foi validada acima.
    const result = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      async (tx) => {
        const existingUser = await tx.user.findUnique({
          where: { email: input.email.toLowerCase().trim() },
        });
        if (existingUser) {
          throw new AppError(ErrorCode.Conflict, "Email ja cadastrado", 409);
        }
        const user = await tx.user.create({
          data: {
            email: input.email.toLowerCase().trim(),
            name: input.name,
            passwordHash,
            phone: input.phone ?? null,
            status: "active",
            emailVerifiedAt: new Date(),
            mustResetPassword: true, // troca obrigatória no 1º acesso
          },
        });
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: targetOrgId,
            storeId: input.storeId ?? null,
            roleId: role.id,
            status: "active",
            isPrimary: true,
            acceptedAt: new Date(),
          },
        });
        return { user, membership };
      },
    );

    // papeis clinicos viram profissional da agenda automaticamente (mesmo sem
    // marcar "também é profissional") — ex.: medico criado aparece na agenda.
    const CLINICAL = ["medico", "médico", "doctor", "optometrista", "oftalmologista", "profissional"];
    const isClinical = CLINICAL.some((s) => input.roleSlug?.toLowerCase().includes(s));
    // replica em Profissionais (agenda) se pedido OU papel clinico, e ainda nao existir
    if ((input.alsoProfessional || isClinical) && result.user) {
      await this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
        let storeId = input.storeId ?? result.membership.storeId ?? null;
        if (!storeId) {
          const s = await tx.store.findFirst({
            where: { organizationId: targetOrgId, status: "active", deletedAt: null },
            select: { id: true },
          });
          storeId = s?.id ?? null;
        }
        if (!storeId) return; // sem loja, nao da pra criar profissional
        const exists = await tx.professional.findFirst({
          where: { organizationId: targetOrgId, userId: result.user.id, deletedAt: null },
        });
        if (!exists) {
          await tx.professional.create({
            data: {
              organizationId: targetOrgId,
              storeId,
              userId: result.user.id,
              name: input.name,
              email: input.email.toLowerCase().trim(),
              phone: input.phone ?? null,
              status: "active",
            },
          });
        }
      }).catch(() => undefined);
    }

    return result;
  }

  async update(ctx: RequestContext, id: string, input: UpdateUserInput) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode editar usuario", 403);
    }
    const target = await this.getById(ctx, id);

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
        throw new AppError(ErrorCode.ValidationFailed, "Email invalido", 400);
      }
      data.email = input.email.toLowerCase().trim();
    }
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.status !== undefined) data.status = input.status;
    if (input.password !== undefined) {
      this.validatePassword(input.password);
      data.passwordHash = await this.argon.hash(input.password);
    }

    // autorizacao ja feita acima (guard admin/master + getById confirma que o
    // alvo e da org do admin). A RLS de users so permite self-update, entao a
    // escrita roda como platform-admin apos a checagem no app.
    const updated = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.update({ where: { id: target.id }, data }),
    );
    // se a senha mudou, sincroniza no Chatwoot + GLPI (best-effort)
    if (input.password !== undefined) {
      await this.provisioning.syncUserPassword(target.id, input.password).catch(() => undefined);
    }
    return updated;
  }

  /**
   * Desativa o 2FA de um usuario (admin da org ou master). Forca novo setup
   * no proximo login. Util quando o usuario perde o app autenticador.
   */
  async disableMfa(ctx: RequestContext, id: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode desativar 2FA", 403);
    }
    const target = await this.getById(ctx, id); // confirma org do alvo
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.update({
        where: { id: target.id },
        data: { mfaEnabled: false, mfaSecret: null },
      }),
    );
  }

  async addMembership(
    ctx: RequestContext,
    userId: string,
    input: CreateMembershipInput,
  ) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode adicionar acesso", 403);
    }
    const targetOrgId = ctx.isPlatformAdmin ? input.organizationId : ctx.orgId;
    if (!targetOrgId) {
      throw new AppError(ErrorCode.ValidationFailed, "organizationId obrigatorio", 400);
    }

    const role = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.role.findFirst({
          where: {
            slug: input.roleSlug,
            OR: [{ organizationId: null }, { organizationId: targetOrgId }],
          },
        }),
    );
    if (!role) {
      throw new AppError(ErrorCode.NotFound, `Role ${input.roleSlug} nao existe`, 404);
    }

    return this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.membership.create({
          data: {
            userId,
            organizationId: targetOrgId,
            storeId: input.storeId ?? null,
            roleId: role.id,
            status: "active",
            acceptedAt: new Date(),
          },
        }),
    );
  }

  async revokeMembership(ctx: RequestContext, membershipId: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode revogar acesso", 403);
    }
    return this.prisma.runWithContext(
      { isPlatformAdmin: true },
      async (tx) => {
        const m = await tx.membership.findUnique({ where: { id: membershipId } });
        if (!m) throw new AppError(ErrorCode.NotFound, "Membership nao encontrado", 404);
        if (!ctx.isPlatformAdmin && m.organizationId !== ctx.orgId) {
          throw new AppError(ErrorCode.Forbidden, "Fora da sua org", 403);
        }
        return tx.membership.update({
          where: { id: membershipId },
          data: { status: "revoked", revokedAt: new Date() },
        });
      },
    );
  }

  async listRoles(ctx: RequestContext, orgIdFilter?: string) {
    const orgId = ctx.isPlatformAdmin ? (orgIdFilter ?? null) : ctx.orgId;
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.role.findMany({
        where: { OR: [{ organizationId: null }, { organizationId: orgId ?? undefined }] },
        orderBy: { name: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          isSystem: true,
          isActive: true,
          organizationId: true,
          permissions: true,
        },
      }),
    );
  }

  /** Catalogo de permissoes pra montar a UI de papeis. */
  permissionCatalog() {
    return PERMISSION_CATALOG;
  }

  /** Lista vendedores (usuarios ativos da org) — pro seletor do PDV + comissao. */
  async listSellers(ctx: RequestContext) {
    if (!ctx.orgId && !ctx.isPlatformAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    }
    const users = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.findMany({
        where: {
          status: "active",
          // só quem é marcado como vendedor na org
          memberships: { some: { organizationId: ctx.orgId ?? undefined, status: "active", isSeller: true } },
        },
        select: {
          id: true,
          name: true,
          memberships: {
            where: { organizationId: ctx.orgId ?? undefined },
            select: { commissionPct: true, isSeller: true },
            take: 1,
          },
        },
        orderBy: { name: "asc" },
        take: 500,
      }),
    );
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      commissionPct: u.memberships[0]?.commissionPct != null ? Number(String(u.memberships[0].commissionPct)) : null,
    }));
  }

  /** Define a comissao (%) do vendedor no membership da org. Admin only. */
  async setCommission(ctx: RequestContext, userId: string, pct: number | null) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    if (pct != null && (pct < 0 || pct > 100)) {
      throw new AppError(ErrorCode.ValidationFailed, "Percentual invalido (0-100)", 400);
    }
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const m = await tx.membership.findFirst({ where: { userId, organizationId: ctx.orgId! } });
      if (!m) throw new AppError(ErrorCode.NotFound, "Usuario sem vinculo nesta org", 404);
      await tx.membership.update({ where: { id: m.id }, data: { commissionPct: pct } });
      return { ok: true };
    });
  }

  /**
   * Reseta a senha de um usuário (admin da org ou master). Gera uma senha
   * temporária, força a troca no próximo acesso e retorna a temporária pra
   * o admin repassar.
   */
  async resetPassword(ctx: RequestContext, userId: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    // org-admin só pode resetar usuário da própria org
    if (!ctx.isPlatformAdmin) {
      const member = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.membership.findFirst({ where: { userId, organizationId: ctx.orgId ?? undefined } }),
      );
      if (!member) throw new AppError(ErrorCode.Forbidden, "Usuário fora da sua org", 403);
    }
    const temp = "Yg" + randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) + "9!";
    const passwordHash = await this.argon.hash(temp);
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.update({ where: { id: userId }, data: { passwordHash, mustResetPassword: true } }),
    );
    // sincroniza a senha temporária no Chatwoot + GLPI (best-effort)
    await this.provisioning.syncUserPassword(userId, temp).catch(() => undefined);
    return { tempPassword: temp };
  }

  /**
   * Desbloqueia a conta: zera o lock por tentativas (failedLoginCount/lockedUntil)
   * e reativa o usuário (status=active). Admin da org ou master.
   */
  async unblock(ctx: RequestContext, userId: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    if (!ctx.isPlatformAdmin) {
      const member = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.membership.findFirst({ where: { userId, organizationId: ctx.orgId ?? undefined } }),
      );
      if (!member) throw new AppError(ErrorCode.Forbidden, "Usuário fora da sua org", 403);
    }
    await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.update({ where: { id: userId }, data: { status: "active", failedLoginCount: 0, lockedUntil: null } }),
    );
    return { ok: true };
  }

  /** Marca/desmarca o membro como vendedor na org. Admin only. */
  async setSeller(ctx: RequestContext, userId: string, isSeller: boolean) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      const m = await tx.membership.findFirst({ where: { userId, organizationId: ctx.orgId! } });
      if (!m) throw new AppError(ErrorCode.NotFound, "Usuario sem vinculo nesta org", 404);
      await tx.membership.update({ where: { id: m.id }, data: { isSeller } });
      return { ok: true };
    });
  }

  /** Garante que o admin só mexe em membership da própria org. */
  private async loadMembershipForAdmin(ctx: RequestContext, membershipId: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    const m = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.membership.findUnique({ where: { id: membershipId } }),
    );
    if (!m) throw new AppError(ErrorCode.NotFound, "Vínculo não encontrado", 404);
    if (!ctx.isPlatformAdmin && m.organizationId !== ctx.orgId) {
      throw new AppError(ErrorCode.Forbidden, "Vínculo fora da sua org", 403);
    }
    return m;
  }

  /** Troca o papel (role) de um vínculo. */
  async setMembershipRole(ctx: RequestContext, membershipId: string, roleSlug: string) {
    const m = await this.loadMembershipForAdmin(ctx, membershipId);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, async (tx) => {
      // papel da org ou padrão global; precisa estar ativo
      const role = await tx.role.findFirst({
        where: {
          slug: roleSlug,
          isActive: true,
          OR: [{ organizationId: m.organizationId }, { organizationId: null }],
        },
        orderBy: { organizationId: "desc" }, // prioriza o da org
      });
      if (!role) throw new AppError(ErrorCode.NotFound, "Papel não encontrado/ativo", 404);
      await tx.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
      return { ok: true };
    });
  }

  /** Overrides de permissão por usuário (sobre o papel). */
  async setMembershipPermissions(ctx: RequestContext, membershipId: string, permissions: Record<string, boolean>) {
    const m = await this.loadMembershipForAdmin(ctx, membershipId);
    return this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.membership.update({
        where: { id: m.id },
        data: { permissions: this.sanitizePermissions(permissions) as any },
        select: { id: true, permissions: true },
      }),
    );
  }

  /**
   * Envia as credenciais de acesso (login + senha) por email e WhatsApp.
   * A senha vem do admin (recém gerada/definida) — não armazenamos plaintext.
   */
  async sendCredentials(ctx: RequestContext, userId: string, opts: { password?: string | null }) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin", 403);
    }
    if (!ctx.orgId && !ctx.isPlatformAdmin) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    const orgId = ctx.orgId ?? undefined;
    const user = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, phone: true, memberships: { where: orgId ? { organizationId: orgId } : {}, select: { organizationId: true, storeId: true }, take: 1 } },
      }),
    );
    if (!user) throw new AppError(ErrorCode.NotFound, "Usuário não encontrado", 404);
    const m = user.memberships[0];
    if (!ctx.isPlatformAdmin && (!m || m.organizationId !== ctx.orgId)) {
      throw new AppError(ErrorCode.Forbidden, "Usuário fora da sua org", 403);
    }
    const domain = process.env.DOMAIN ?? "yugochat.com.br";
    const loginUrl = `https://${domain}/login`;
    const first = (user.name ?? "").split(" ")[0];
    const pwLine = opts.password ? `🔑 Senha: ${opts.password}\n` : "";
    const text =
      `Olá ${first}! Seu acesso ao sistema:\n\n` +
      `🌐 Acesse: ${loginUrl}\n` +
      `👤 Login (email): ${user.email}\n` +
      pwLine +
      `\nNo 1º acesso será pedido pra trocar a senha. Qualquer dúvida, fale com seu gestor.`;
    const r = await this.notifications.notify({
      organizationId: m?.organizationId ?? orgId!,
      storeId: m?.storeId ?? (orgId as any),
      whatsappPhone: user.phone ?? null,
      email: user.email,
      subject: "Suas credenciais de acesso",
      text,
      templateCode: "credenciais_acesso",
    }).catch(() => ({ whatsapp: false, email: false }));
    return { ok: true, sent: r };
  }

  /** Cria um papel customizado da org (admin/owner ou master). */
  async createRole(ctx: RequestContext, input: UpsertRoleInput, orgIdParam?: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode criar papeis", 403);
    }
    const targetOrgId = ctx.isPlatformAdmin ? orgIdParam : ctx.orgId;
    if (!targetOrgId) {
      throw new AppError(ErrorCode.ValidationFailed, "organizationId obrigatorio", 400);
    }
    const slug =
      (input.slug?.trim() ||
        input.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")) || `papel-${Date.now()}`;

    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const dup = await tx.role.findFirst({
          where: { organizationId: targetOrgId, slug },
        });
        if (dup) throw new AppError(ErrorCode.Conflict, "Ja existe um papel com esse slug", 409);
        return tx.role.create({
          data: {
            organizationId: targetOrgId,
            slug,
            name: input.name,
            description: input.description ?? null,
            permissions: this.sanitizePermissions(input.permissions),
            isSystem: false,
            isDefault: false,
          },
        });
      },
    );
  }

  /** Atualiza um papel customizado (nao permite editar templates de sistema). */
  async updateRole(ctx: RequestContext, roleId: string, input: Partial<UpsertRoleInput>) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode editar papeis", 403);
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const role = await tx.role.findUnique({ where: { id: roleId } });
        if (!role) throw new AppError(ErrorCode.NotFound, "Papel nao encontrado", 404);
        if (role.isSystem || role.organizationId === null) {
          throw new AppError(ErrorCode.Forbidden, "Papeis padrao do sistema nao podem ser editados", 403);
        }
        if (!ctx.isPlatformAdmin && role.organizationId !== ctx.orgId) {
          throw new AppError(ErrorCode.Forbidden, "Papel fora da sua org", 403);
        }
        const data: Record<string, unknown> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.description !== undefined) data.description = input.description;
        if ((input as any).isActive !== undefined) data.isActive = (input as any).isActive;
        if (input.permissions !== undefined) {
          data.permissions = this.sanitizePermissions(input.permissions);
        }
        return tx.role.update({ where: { id: roleId }, data });
      },
    );
  }

  /** Remove um papel customizado que nao esteja em uso. */
  async deleteRole(ctx: RequestContext, roleId: string) {
    if (!ctx.isPlatformAdmin && !ctx.isOrgAdmin) {
      throw new AppError(ErrorCode.Forbidden, "Apenas admin/owner pode remover papeis", 403);
    }
    return this.prisma.runWithContext(
      ctx.isPlatformAdmin
        ? { isPlatformAdmin: true }
        : { orgId: ctx.orgId!, userId: ctx.userId!, isOrgAdmin: true },
      async (tx) => {
        const role = await tx.role.findUnique({ where: { id: roleId } });
        if (!role) throw new AppError(ErrorCode.NotFound, "Papel nao encontrado", 404);
        if (role.isSystem || role.organizationId === null) {
          throw new AppError(ErrorCode.Forbidden, "Papeis padrao nao podem ser removidos", 403);
        }
        if (!ctx.isPlatformAdmin && role.organizationId !== ctx.orgId) {
          throw new AppError(ErrorCode.Forbidden, "Papel fora da sua org", 403);
        }
        const inUse = await tx.membership.count({ where: { roleId, status: "active" } });
        if (inUse > 0) {
          throw new AppError(ErrorCode.Conflict, `Papel em uso por ${inUse} usuario(s)`, 409);
        }
        await tx.role.delete({ where: { id: roleId } });
        return { ok: true };
      },
    );
  }

  /**
   * Mantem so chaves do catalogo, valores booleanos true. Ignora silenciosamente
   * qualquer chave fora do catalogo OU valor que nao seja boolean true — isso
   * tolera papeis legados que tinham permissions em formato aninhado
   * ({"appointments":{"read":"store"}}) sem estourar o request inteiro.
   */
  private sanitizePermissions(perms: Record<string, unknown>): Record<string, boolean> {
    const valid = new Set(
      PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key)),
    );
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(perms ?? {})) {
      if (valid.has(k) && v === true) out[k] = true;
    }
    return out;
  }

  private validatePassword(password: string) {
    if (password.length < 12) {
      throw new AppError(ErrorCode.ValidationFailed, "Senha precisa de no minimo 12 chars", 400);
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        "Senha deve ter maiuscula, minuscula e numero",
        400,
      );
    }
  }
}
