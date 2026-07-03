import { Injectable } from "@nestjs/common";
import { randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "./integrations.service";
import { ChatwootAdapter } from "./adapters/chatwoot.adapter";
import { GlpiAdapter } from "./adapters/glpi.adapter";
import { EvolutionAdapter } from "./adapters/evolution.adapter";
import { MercadoPagoAdapter } from "../subscriptions/mercadopago.adapter";
import type { AdapterCredentials } from "./adapters/types";

/**
 * ProvisioningService: orquestra criacao/sync nos 3 sistemas externos.
 *
 * Padrao: sempre tolerante a falha parcial - cada chamada e independente
 * e gera linha em external_provisioning_log. Reconciliacao posterior pode
 * re-tentar via re-chamar este service.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  // ==========================================================================
  // Teste de conexao
  // ==========================================================================
  async testConnection(opts: {
    isPlatformAdmin: boolean;
    provider: string;
  }): Promise<{ ok: boolean; status: number; error?: string; detail?: unknown }> {
    const cfg = await this.integrations.getByProvider({
      isPlatformAdmin: opts.isPlatformAdmin,
      provider: opts.provider,
    });
    if (!cfg) {
      throw new AppError(ErrorCode.NotFound, "Integracao nao configurada", 404);
    }

    // Mercado Pago (assinaturas/master) usa o adapter de preapproval: ping em /users/me.
    let res: { ok: boolean; status: number; error?: string; rawBody?: unknown };
    if (opts.provider === "mercadopago") {
      const p = await new MercadoPagoAdapter({ accessToken: cfg.apiToken ?? "" }).ping();
      res = { ok: p.ok, status: p.status, error: p.message };
    } else {
      const adapter = this.adapterFor(opts.provider, this.credsFrom(cfg));
      res = await adapter.ping();
    }

    // log
    await this.prisma.runWithContext(
      { isPlatformAdmin: opts.isPlatformAdmin },
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO external_provisioning_log
            (provider, action, status, http_status, error_message)
           VALUES ($1, $2, $3, $4, $5)`,
          opts.provider,
          "ping",
          res.ok ? "success" : "failed",
          res.status,
          res.error ?? null,
        ),
    );

    // mesmo fluxo da empresa: o teste atualiza o status da integração
    await this.prisma.runWithContext(
      { isPlatformAdmin: opts.isPlatformAdmin },
      (tx) =>
        tx.platformIntegration.updateMany({
          where: { provider: opts.provider, organizationId: null },
          data: {
            status: res.ok ? "active" : "error",
            lastPingAt: new Date(),
            lastPingStatus: res.ok ? "success" : "failed",
          },
        }),
    );

    return {
      ok: res.ok,
      status: res.status,
      error: res.error,
      detail: res.rawBody,
    };
  }

  // ==========================================================================
  // Provisionar uma organizacao recem-criada nos 3 sistemas
  // ==========================================================================
  async provisionOrganization(opts: {
    isPlatformAdmin: boolean;
    organizationId: string;
    platformUserId?: string | null;
  }) {
    const org = await this.prisma.runWithContext(
      { isPlatformAdmin: opts.isPlatformAdmin },
      (tx) =>
        tx.organization.findUnique({
          where: { id: opts.organizationId },
          include: { stores: true, memberships: { include: { user: true, role: true } } },
        }),
    );
    if (!org) throw new AppError(ErrorCode.NotFound, "Organizacao nao encontrada", 404);

    const results = {
      chatwoot: await this.provisionChatwoot(opts.isPlatformAdmin, org, opts.platformUserId ?? null),
      glpi:     await this.provisionGlpi(opts.isPlatformAdmin, org),
      evolution: await this.provisionEvolution(opts.isPlatformAdmin, org),
    };
    return results;
  }

  // ==========================================================================
  // Chatwoot
  // ==========================================================================
  private async provisionChatwoot(isPlatformAdmin: boolean, org: any, platformUserId?: string | null) {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin, provider: "chatwoot" });
    if (!cfg || cfg.status !== "active") return { skipped: "not_active" };

    const adapter = new ChatwootAdapter(this.credsFrom(cfg));

    // 1. cria account se nao existe
    let accountId: string | null = org.chatwootAccountId ?? null;
    if (!accountId) {
      const r = await adapter.createAccount({ name: org.name, locale: "pt_BR" });
      await this.logAction("chatwoot", "create_account", org.id, null, null, r);
      if (!r.ok || !r.body?.id) return { error: r.error ?? "createAccount falhou" };
      accountId = String(r.body.id);
      await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.organization.update({
          where: { id: org.id },
          data: { chatwootAccountId: accountId },
        }),
      );
    }

    // 2. cria users e adiciona a account
    const userResults: any[] = [];
    for (const m of org.memberships ?? []) {
      const user = m.user;
      if (!user) continue;
      let chatwootUserId: string | null = user.chatwootUserId ?? null;
      if (!chatwootUserId) {
        // senha aleatoria pra Chatwoot (login real via SSO)
        const pwd = randomBytes(24).toString("base64url");
        const cr = await adapter.createUser({
          name: user.name,
          email: user.email,
          password: pwd,
        });
        await this.logAction("chatwoot", "create_user", org.id, null, user.id, cr);
        const newCwId =
          cr.body?.id ??
          (cr.rawBody as any)?.id ??
          (cr.rawBody as any)?.payload?.id ??
          (cr.rawBody as any)?.data?.id;
        if (cr.ok && newCwId) {
          chatwootUserId = String(newCwId);
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE users SET chatwoot_user_id=$1 WHERE id=$2::uuid`,
              chatwootUserId, user.id,
            ),
          );
        } else {
          userResults.push({ userId: user.id, error: cr.error });
          continue;
        }
      }
      const ar = await adapter.addUserToAccount({
        accountId: accountId!,
        userId: chatwootUserId!,
        role: ["owner", "admin"].includes(m.role?.slug) ? "administrator" : "agent",
      });
      await this.logAction("chatwoot", "add_user_to_account", org.id, null, user.id, ar);
      userResults.push({ userId: user.id, chatwootUserId, status: ar.status });
    }

    // master vira ADMINISTRATOR desta conta (gerencia todas as empresas)
    if (platformUserId) {
      await this.ensureMasterInAccount(adapter, accountId!, platformUserId).catch(() => undefined);
    }

    return { accountId, users: userResults };
  }

  /**
   * Garante que o usuário master tenha um usuário Chatwoot e seja
   * ADMINISTRATOR da conta — assim ele acessa/gerencia todas as empresas.
   */
  private async ensureMasterInAccount(adapter: ChatwootAdapter, accountId: string, platformUserId: string) {
    const pu = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.findUnique({
        where: { id: platformUserId },
        select: { email: true, name: true, chatwootUserId: true },
      }),
    );
    if (!pu) return;
    let cwId = pu.chatwootUserId;
    if (!cwId) {
      const cr = await adapter.createUser({
        name: pu.name,
        email: pu.email,
        password: randomBytes(24).toString("base64url"),
      });
      const newId = cr.body?.id ?? (cr.rawBody as any)?.id ?? (cr.rawBody as any)?.payload?.id;
      if (cr.ok && newId) {
        cwId = String(newId);
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.platformUser.update({ where: { id: platformUserId }, data: { chatwootUserId: cwId } }),
        );
      }
    }
    if (cwId) {
      await adapter.addUserToAccount({ accountId, userId: cwId, role: "administrator" }).catch(() => undefined);
    }
  }

  // ==========================================================================
  // GLPI
  // ==========================================================================
  private async provisionGlpi(isPlatformAdmin: boolean, org: any) {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin, provider: "glpi" });
    if (!cfg || cfg.status !== "active") return { skipped: "not_active" };

    const adapter = new GlpiAdapter(this.credsFrom(cfg));
    try {
      // 1. Entity por org
      let entityId: number | null = org.glpiEntityId ? Number(org.glpiEntityId) : null;
      if (!entityId) {
        const r = await adapter.createEntity({ name: org.name });
        await this.logAction("glpi", "create_entity", org.id, null, null, r);
        entityId = r.body?.id ?? null;
        // fallback: se falhou por duplicidade (entidade órfã de tentativa
        // anterior), reaproveita a existente pelo nome em vez de quebrar.
        if (!entityId) {
          entityId = await adapter.findEntityByName(org.name).catch(() => null);
        }
        if (!entityId) return { error: r.error ?? "createEntity falhou" };
        await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE organizations SET glpi_entity_id=$1 WHERE id=$2::uuid`,
            String(entityId), org.id,
          ),
        );
      }

      // 2. Group por store
      for (const store of org.stores ?? []) {
        if (store.glpiGroupId) continue;
        const r = await adapter.createGroup({
          name: store.name,
          entityId: entityId!,
          comment: `Loja ${store.slug}`,
        });
        await this.logAction("glpi", "create_group", org.id, store.id, null, r);
        if (r.ok && r.body?.id) {
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE stores SET glpi_group_id=$1 WHERE id=$2::uuid`,
              String(r.body!.id), store.id,
            ),
          );
        }
      }

      // 3. Users — owner/admin = perfil admin; demais = perfil "abre e
      // acompanha os próprios chamados" (Self-Service por padrão).
      const ADMIN_PROFILE = Number(process.env.GLPI_ADMIN_PROFILE_ID ?? 4); // Super-Admin
      const MEMBER_PROFILE = Number(process.env.GLPI_MEMBER_PROFILE_ID ?? 1); // Self-Service
      for (const m of org.memberships ?? []) {
        const user = m.user;
        if (!user || user.glpiUserId) continue;
        const isAdmin = ["owner", "admin"].includes(m.role?.slug ?? "");
        const pwd = randomBytes(24).toString("base64url");
        const r = await adapter.createUser({
          name: user.email,           // login GLPI = email
          firstname: user.name,
          email: user.email,
          password: pwd,
          entityId: entityId!,
          profileId: isAdmin ? ADMIN_PROFILE : MEMBER_PROFILE,
          groupId: org.stores?.[0]?.glpiGroupId ? Number(org.stores[0].glpiGroupId) : undefined,
        });
        await this.logAction("glpi", "create_user", org.id, null, user.id, r);
        if (r.ok && r.body?.id) {
          await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
            tx.$executeRawUnsafe(
              `UPDATE users SET glpi_user_id=$1 WHERE id=$2::uuid`,
              String(r.body!.id), user.id,
            ),
          );
        }
      }

      return { entityId };
    } finally {
      await adapter.killSession();
    }
  }

  // ==========================================================================
  // Evolution — UMA instância POR EMPRESA (= slug da org), igual ao painel da
  // empresa. Só cria se ainda não existir (evita instância duplicada brigando).
  // ==========================================================================
  private async provisionEvolution(isPlatformAdmin: boolean, org: any) {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin, provider: "evolution" });
    if (!cfg || cfg.status !== "active") return { skipped: "not_active" };

    const adapter = new EvolutionAdapter(this.credsFrom(cfg));
    const instanceName = String(org.slug).toLowerCase();

    // já existe? não recria nem gera novo QR — mas garante a inbox no Chatwoot.
    const state = await adapter.getConnectionState(instanceName);
    if (state.ok) {
      await this.linkChatwootInbox(isPlatformAdmin, adapter, instanceName, org.chatwootAccountId ?? null).catch(() => undefined);
      return { instanceName, status: "already_exists" };
    }

    const webhookBase = process.env.EVOLUTION_WEBHOOK_BASE ?? "http://api:3001";
    const webhookUrl = `${webhookBase}/api/webhooks/evolution/${encodeURIComponent(instanceName)}`;
    const r = await adapter.createInstance({
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      webhookUrl,
      qrcode: true,
    });
    await this.logAction("evolution", "create_instance", org.id, null, null, r);
    // cria a inbox no Chatwoot da empresa (best-effort).
    const inbox = await this.linkChatwootInbox(isPlatformAdmin, adapter, instanceName, org.chatwootAccountId ?? null).catch(() => undefined);
    return { instanceName, created: r.ok, error: r.ok ? undefined : r.error, chatwootInbox: inbox };
  }

  /**
   * Re-aplica o webhook do Evolution em TODAS as instâncias existentes (org
   * principal + instâncias extras do call center). Usado pra consertar
   * instâncias criadas com o payload v1.x (snake_case) — quando o Evolution
   * v2.x ignora os campos antigos e a instância fica conectada mas sem eventos
   * registrados, então não recebe nem confirma envio de mensagens.
   */
  async resyncEvolutionWebhooks(opts: { isPlatformAdmin: boolean }) {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin: opts.isPlatformAdmin, provider: "evolution" });
    if (!cfg || cfg.status !== "active") throw new AppError(ErrorCode.Conflict, "Integração Evolution não ativa", 409);
    const adapter = new EvolutionAdapter(this.credsFrom(cfg));
    const webhookBase = process.env.EVOLUTION_WEBHOOK_BASE ?? "http://api:3001";

    // 1) instância principal = slug da org
    const orgs = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ id: string; slug: string }>>`SELECT id, slug FROM organizations WHERE deleted_at IS NULL`,
    );
    // 2) instâncias extras (call center multi-número)
    const extras = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRaw<Array<{ name: string; organization_id: string }>>`SELECT name, organization_id FROM evolution_instances`,
    ).catch(() => [] as Array<{ name: string; organization_id: string }>);

    const targets = [
      ...orgs.map((o) => ({ instanceName: String(o.slug).toLowerCase(), organizationId: o.id, kind: "main" as const })),
      ...extras.map((e) => ({ instanceName: e.name, organizationId: e.organization_id, kind: "extra" as const })),
    ];

    const results: Array<{ instanceName: string; kind: string; ok: boolean; status: number; error?: string }> = [];
    for (const t of targets) {
      // verifica se a instância de fato existe no Evolution (instância "fantasma" da org sem WhatsApp ligado é skip)
      const state = await adapter.getConnectionState(t.instanceName).catch(() => null);
      if (!state?.ok) { results.push({ instanceName: t.instanceName, kind: t.kind, ok: false, status: state?.status ?? 0, error: "instância não existe no Evolution" }); continue; }
      const webhookUrl = `${webhookBase}/api/webhooks/evolution/${encodeURIComponent(t.instanceName)}`;
      const r = await adapter.setWebhook(t.instanceName, webhookUrl);
      await this.logAction("evolution", "resync_webhook", t.organizationId, null, null, r).catch(() => undefined);
      results.push({ instanceName: t.instanceName, kind: t.kind, ok: r.ok, status: r.status, error: r.ok ? undefined : r.error });
    }
    const okCount = results.filter((r) => r.ok).length;
    return { total: results.length, ok: okCount, failed: results.length - okCount, items: results };
  }

  /**
   * Liga a instância Evolution à conta Chatwoot da empresa (Evolution cria a
   * inbox automaticamente). Acesso já restrito à empresa pela conta isolada.
   * Token/URL vêm da config da integração Chatwoot (config.inboxToken/publicUrl).
   */
  private async linkChatwootInbox(
    isPlatformAdmin: boolean,
    adapter: EvolutionAdapter,
    instanceName: string,
    chatwootAccountId: string | null,
  ) {
    if (!chatwootAccountId) return { skipped: "no_account" as const };
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin, provider: "chatwoot" });
    if (!cfg || cfg.status !== "active") return { skipped: "chatwoot_inactive" as const };
    const config = (cfg.config ?? {}) as Record<string, unknown>;
    const token = (config.inboxToken as string) || cfg.apiToken || "";
    const url = (config.publicUrl as string) || cfg.consoleUrl || cfg.baseUrl || "";
    if (!token || !url) return { skipped: "no_token" as const };

    const existing = await adapter.findChatwoot(instanceName).catch(() => null);
    if (existing?.ok && (existing.body as any)?.enabled) return { skipped: "already_linked" as const };

    const r = await adapter.setChatwoot(instanceName, {
      accountId: chatwootAccountId,
      token,
      url,
      nameInbox: instanceName,
    });
    return { ok: r.ok, status: r.status };
  }

  // ==========================================================================
  // SSO — login transparente nos sistemas externos pra um usuario da org
  // ==========================================================================

  /**
   * Gera uma URL de login transparente no Chatwoot para o usuario yugo dado
   * (usa o chatwoot_user_id provisionado). A URL e de uso unico/curta duracao.
   */
  async chatwootSsoUrl(userId: string): Promise<{ url: string } | null> {
    const rows = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.$queryRawUnsafe<Array<{ chatwoot_user_id: string | null }>>(
        `SELECT chatwoot_user_id FROM users WHERE id = $1::uuid`,
        userId,
      ),
    );
    const cwId = rows[0]?.chatwoot_user_id;
    if (!cwId) return null;
    return this.chatwootSsoForCwUser(cwId);
  }

  /** SSO do master: usa o chatwoot_user_id do platform_user. */
  async chatwootSsoUrlForPlatformUser(platformUserId: string): Promise<{ url: string } | null> {
    const pu = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.platformUser.findUnique({ where: { id: platformUserId }, select: { chatwootUserId: true } }),
    );
    if (!pu?.chatwootUserId) return null;
    return this.chatwootSsoForCwUser(pu.chatwootUserId);
  }

  /**
   * Sincroniza a senha do usuário do painel nos sistemas externos (Chatwoot +
   * GLPI), pra um único login valer em todos. Best-effort: não quebra o fluxo
   * do painel se algum sync falhar.
   */
  async syncUserPassword(userId: string, newPassword: string): Promise<void> {
    const u = await this.prisma.runWithContext({ isPlatformAdmin: true }, (tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { chatwootUserId: true, glpiUserId: true } }),
    );
    if (!u) return;
    if (u.chatwootUserId) {
      try {
        const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "chatwoot" });
        if (cfg?.status === "active") {
          await new ChatwootAdapter(this.credsFrom(cfg)).updateUser({ id: u.chatwootUserId, password: newPassword });
        }
      } catch { /* best-effort */ }
    }
    if (u.glpiUserId) {
      try {
        const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "glpi" });
        if (cfg?.status === "active") {
          const a = new GlpiAdapter(this.credsFrom(cfg));
          try { await a.updateUserPassword(u.glpiUserId, newPassword); } finally { await a.killSession(); }
        }
      } catch { /* best-effort */ }
    }
  }

  private async chatwootSsoForCwUser(cwId: string): Promise<{ url: string } | null> {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "chatwoot" });
    if (!cfg || cfg.status !== "active") return null;
    const adapter = new ChatwootAdapter(this.credsFrom(cfg));
    const r = await adapter.ssoLoginUrl(cwId);
    const url = (r.body as any)?.url ?? (r.rawBody as any)?.url;
    if (!r.ok || !url) return null;
    return { url };
  }

  /**
   * GLPI nao expoe SSO por token na API REST sem configurar auth externa, entao
   * retornamos o console (o usuario provisionado faz login com email/senha).
   */
  async glpiConsoleUrl(): Promise<{ url: string } | null> {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "glpi" });
    if (!cfg) return null;
    const url = cfg.consoleUrl || cfg.baseUrl;
    return url ? { url } : null;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================
  private credsFrom(cfg: any): AdapterCredentials {
    return {
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      apiToken: cfg.apiToken,
      username: cfg.username,
      password: cfg.password,
    };
  }

  private adapterFor(provider: string, creds: AdapterCredentials) {
    switch (provider) {
      case "chatwoot": return new ChatwootAdapter(creds);
      case "glpi":     return new GlpiAdapter(creds);
      case "evolution":return new EvolutionAdapter(creds);
      default:
        throw new AppError(ErrorCode.NotFound, `Provider desconhecido: ${provider}`, 404);
    }
  }

  private async logAction(
    provider: string,
    action: string,
    organizationId: string | null,
    storeId: string | null,
    userId: string | null,
    res: { ok: boolean; status: number; error?: string; rawBody?: unknown },
  ) {
    await this.prisma
      .runWithContext({ isPlatformAdmin: true }, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO external_provisioning_log
            (provider, action, status, http_status, error_message,
             organization_id, store_id, user_id, response_body)
           VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::jsonb)`,
          provider,
          action,
          res.ok ? "success" : "failed",
          res.status,
          res.error ?? null,
          organizationId,
          storeId,
          userId,
          JSON.stringify(res.rawBody ?? null),
        ),
      )
      .catch(() => undefined);
  }
}
