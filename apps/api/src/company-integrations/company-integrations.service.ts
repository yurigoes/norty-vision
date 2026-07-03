import { Injectable, Logger } from "@nestjs/common";
import { randomBytes } from "crypto";
import { AppError, ErrorCode } from "@yugo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { EvolutionAdapter } from "../integrations/adapters/evolution.adapter";
import type { RequestContext } from "../auth/session.middleware";
import { ctxCan } from "../auth/decorators";

/**
 * Integrações vistas pelo PAINEL DA EMPRESA. A instância WhatsApp (Evolution)
 * é POR EMPRESA, identificada pelo slug da org (ex.: 'zito-oticas'). Toda
 * notificação da empresa usa essa instância.
 */
@Injectable()
export class CompanyIntegrationsService {
  private readonly logger = new Logger("CompanyIntegrations");

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  private rls(ctx: RequestContext) {
    return ctx.isPlatformAdmin
      ? { isPlatformAdmin: true as const }
      : { orgId: ctx.orgId!, userId: ctx.userId ?? undefined, isOrgAdmin: ctx.isOrgAdmin };
  }

  private requireOrg(ctx: RequestContext): string {
    if (!ctx.orgId) throw new AppError(ErrorCode.Forbidden, "Sem org", 403);
    return ctx.orgId;
  }

  private requireAdmin(ctx: RequestContext) {
    if (!ctxCan(ctx, "integrations.manage")) {
      throw new AppError(ErrorCode.Forbidden, "Sem permissão para gerenciar integrações", 403);
    }
  }

  /** Dados da org (slug = instancia Evolution). */
  private async getOrg(ctx: RequestContext) {
    const orgId = this.requireOrg(ctx);
    const rows = await this.prisma.runWithContext(this.rls(ctx), (tx) =>
      tx.$queryRawUnsafe<
        Array<{ slug: string; name: string; chatwoot_account_id: string | null; glpi_entity_id: string | null; evolution_status: string | null; evolution_qr: string | null }>
      >(
        `SELECT slug, name, chatwoot_account_id, glpi_entity_id, evolution_status, evolution_qr
           FROM organizations WHERE id = $1::uuid`,
        orgId,
      ),
    );
    const o = rows[0];
    if (!o) throw new AppError(ErrorCode.NotFound, "Organizacao nao encontrada", 404);
    return { orgId, ...o };
  }

  private async setEvolutionStatus(ctx: RequestContext, status: string | null) {
    const orgId = this.requireOrg(ctx);
    await this.prisma
      .runWithContext(this.rls(ctx), (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE organizations SET evolution_status = $1 WHERE id = $2::uuid`,
          status,
          orgId,
        ),
      )
      .catch(() => undefined);
  }

  /** Status geral das integrações da empresa. */
  async status(ctx: RequestContext) {
    const org = await this.getOrg(ctx);
    return {
      chatwoot: { provisioned: !!org.chatwoot_account_id },
      glpi: { provisioned: !!org.glpi_entity_id },
      evolution: {
        instanceName: org.slug,
        status: org.evolution_status, // null = nunca conectado
      },
    };
  }

  /**
   * Atalhos de SSO/acesso rápido pros sistemas integrados da empresa
   * (Chatwoot, GLPI). Só retorna os que estão provisionados e ativos na
   * plataforma. O link abre o console do sistema (login no próprio sistema).
   */
  async shortcuts(ctx: RequestContext) {
    if (!ctx.orgId) return [] as Array<{ provider: string; label: string; url: string }>;
    const org = await this.getOrg(ctx);
    const out: Array<{ provider: string; label: string; url: string }> = [];

    if (org.chatwoot_account_id) {
      const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "chatwoot" });
      if (cfg && cfg.status === "active") {
        const config = (cfg.config ?? {}) as Record<string, unknown>;
        const base = (config.publicUrl as string) || (cfg as any).consoleUrl || cfg.baseUrl || "";
        if (base) out.push({ provider: "chatwoot", label: "Atendimento (Chatwoot)", url: `${base.replace(/\/$/, "")}/app/accounts/${org.chatwoot_account_id}/dashboard` });
      }
    }
    if (org.glpi_entity_id) {
      const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "glpi" });
      if (cfg && cfg.status === "active") {
        const config = (cfg.config ?? {}) as Record<string, unknown>;
        const base = (config.publicUrl as string) || (cfg as any).consoleUrl || cfg.baseUrl || "";
        if (base) out.push({ provider: "glpi", label: "Chamados (GLPI)", url: base.replace(/\/$/, "") });
      }
    }
    return out;
  }

  /** Alertas internos (banner): WhatsApp desconectado + estoque baixo. */
  async internalAlerts(ctx: RequestContext) {
    if (!ctx.orgId) return []; // master sem org -> sem alertas
    const out: Array<{ id: string; level: string; title: string; message: string; actionHref: string; actionLabel: string }> = [];

    const org = await this.getOrg(ctx);
    const st = org.evolution_status;
    if (st && st !== "connected") {
      const down = st === "disconnected" || st === "failed";
      out.push({
        id: "wpp",
        level: down ? "error" : "warning",
        title: down ? "WhatsApp desconectado" : "WhatsApp não conectado",
        message: down
          ? "O WhatsApp da empresa está desconectado. Reconecte para continuar enviando mensagens."
          : "Conecte o WhatsApp da empresa escaneando o QR code.",
        actionHref: "/app/integracoes",
        actionLabel: "Conectar",
      });
    }

    // estoque baixo: produtos com controle de estoque <= mínimo
    try {
      const low = await this.prisma.runWithContext(
        this.rls(ctx),
        (tx) => tx.product.count({ where: { deletedAt: null, isActive: true, trackStock: true, stockQty: { lte: tx.product.fields.minStockQty } } as any }),
      ).catch(() => 0);
      if (low > 0) {
        out.push({
          id: "low_stock",
          level: "warning",
          title: `${low} produto(s) com estoque baixo`,
          message: "Há produtos no/abaixo do estoque mínimo. Veja o relatório de estoque para repor.",
          actionHref: "/app/relatorios",
          actionLabel: "Ver estoque",
        });
      }
    } catch { /* best-effort */ }

    // produção (gráfica/uniformes): pedidos vencendo/atrasados sem terem sido finalizados.
    // Só aparece se houver pedidos de produção — implicitamente niche-aware.
    try {
      const soon = new Date(); soon.setHours(23, 59, 59, 999); soon.setDate(soon.getDate() + 2);
      const due = await this.prisma.runWithContext(
        this.rls(ctx),
        (tx) => tx.productionOrder.count({ where: { status: { notIn: ["finalizado", "cancelado"] }, dueDate: { not: null, lte: soon } } }),
      ).catch(() => 0);
      if (due > 0) {
        out.push({
          id: "production_due",
          level: "warning",
          title: `${due} pedido(s) de produção no prazo`,
          message: "Há pedidos vencendo em até 2 dias (ou atrasados) que ainda não foram finalizados. Priorize a produção.",
          actionHref: "/app/producao",
          actionLabel: "Ver produção",
        });
      }
    } catch { /* best-effort */ }

    // comprovantes de pagamento recebidos pelo WhatsApp aguardando conferência da equipe
    try {
      const proofs = await this.prisma.runWithContext(
        this.rls(ctx),
        (tx) => tx.productionOrder.count({ where: { paymentProofUrl: { not: null }, paymentStatus: { not: "paid" }, status: { notIn: ["finalizado", "cancelado"] } } }),
      ).catch(() => 0);
      if (proofs > 0) {
        out.push({
          id: "payment_proof",
          level: "info",
          title: `${proofs} comprovante(s) aguardando conferência`,
          message: "Clientes enviaram comprovante de pagamento pelo WhatsApp. Confira e dê baixa no pagamento.",
          actionHref: "/app/producao",
          actionLabel: "Conferir",
        });
      }
    } catch { /* best-effort */ }

    // contas a pagar: vencidas + a vencer nos próximos 3 dias
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const soon = new Date(today.getTime() + 3 * 86400_000); soon.setHours(23, 59, 59, 999);
      const [overdue, dueSoon] = await Promise.all([
        this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableInstallment.count({ where: { status: "a_pagar", dueDate: { lt: today } } })).catch(() => 0),
        this.prisma.runWithContext(this.rls(ctx), (tx) => tx.payableInstallment.count({ where: { status: "a_pagar", dueDate: { gte: today, lte: soon } } })).catch(() => 0),
      ]);
      if (overdue > 0 || dueSoon > 0) {
        out.push({
          id: "payables_due",
          level: overdue > 0 ? "error" : "warning",
          title: overdue > 0 ? `${overdue} conta(s) vencida(s)${dueSoon > 0 ? ` · ${dueSoon} a vencer` : ""}` : `${dueSoon} conta(s) a vencer em até 3 dias`,
          message: "Há contas a pagar próximas do vencimento ou vencidas. Pague e dê baixa para não acumular juros.",
          actionHref: "/app/financeiro/contas-a-pagar",
          actionLabel: "Ver contas",
        });
      }
    } catch { /* best-effort */ }

    return out;
  }

  private async evolutionAdapter(): Promise<EvolutionAdapter> {
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "evolution" });
    if (!cfg?.baseUrl || !cfg.apiKey) {
      throw new AppError(ErrorCode.Internal, "Evolution não configurado na plataforma", 500);
    }
    return new EvolutionAdapter({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
  }

  /** Cria a instância da empresa (nome = slug) com webhook apontando pra API. */
  async evolutionCreate(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const org = await this.getOrg(ctx);
    const adapter = await this.evolutionAdapter();
    // base INTERNA (mesma rede docker) — webhook nao sai pela internet/CF (502)
    const base = process.env.EVOLUTION_WEBHOOK_BASE ?? "http://api:3001";
    const r = await adapter.createInstance({
      instanceName: org.slug,
      integration: "WHATSAPP-BAILEYS",
      webhookUrl: `${base}/api/webhooks/evolution/${encodeURIComponent(org.slug)}`,
      qrcode: true,
    });
    if (!r.ok && r.status !== 403 && r.status !== 409) {
      // 403/409 normalmente = instancia ja existe; segue pro QR
      throw new AppError(ErrorCode.Internal, `Falha ao criar instância: ${r.error}`, 502);
    }
    await this.setEvolutionStatus(ctx, "qr_required");
    // liga a instância à conta Chatwoot da empresa (cria a inbox automaticamente).
    // best-effort: nunca quebra a criação da instância.
    await this.linkChatwootInbox(org.slug, org.chatwoot_account_id).catch(() => undefined);
    return { instanceName: org.slug, qrcode: (r.body as any)?.qrcode?.base64 ?? null };
  }

  /**
   * Liga a instância Evolution à conta Chatwoot da empresa para que o Evolution
   * crie a caixa de entrada (inbox) automaticamente. Como cada empresa tem a
   * SUA conta Chatwoot e só os usuários dela são membros, o acesso à inbox já
   * fica restrito à empresa. Best-effort.
   *
   * Token/URL ficam na config da integração Chatwoot do master (não no código):
   *  - config.inboxToken : User Access Token de um admin/agente da conta
   *  - config.publicUrl  : base do Chatwoot que o Evolution alcança (interna serve)
   */
  private async linkChatwootInbox(slug: string, chatwootAccountId: string | null) {
    if (!chatwootAccountId) return { skipped: "no_account" as const };
    const cfg = await this.integrations.getByProvider({ isPlatformAdmin: true, provider: "chatwoot" });
    if (!cfg || cfg.status !== "active") return { skipped: "chatwoot_inactive" as const };
    const config = (cfg.config ?? {}) as Record<string, unknown>;
    const token = (config.inboxToken as string) || cfg.apiToken || "";
    const url = (config.publicUrl as string) || cfg.consoleUrl || cfg.baseUrl || "";
    if (!token || !url) return { skipped: "no_token" as const };

    const adapter = await this.evolutionAdapter();
    // já ligada? não refaz (evita recriar inbox)
    const existing = await adapter.findChatwoot(slug).catch(() => null);
    if (existing?.ok && (existing.body as any)?.enabled) return { skipped: "already_linked" as const };

    const r = await adapter.setChatwoot(slug, {
      accountId: chatwootAccountId,
      token,
      url,
      nameInbox: slug,
    });
    this.logger.log(`linkChatwootInbox ${slug} -> account ${chatwootAccountId}: ${r.ok ? "ok" : r.error}`);
    return { ok: r.ok, status: r.status };
  }

  private async storeQr(ctx: RequestContext, base64: string | null) {
    const orgId = this.requireOrg(ctx);
    await this.prisma
      .runWithContext(this.rls(ctx), (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE organizations SET evolution_qr = $1 WHERE id = $2::uuid`,
          base64,
          orgId,
        ),
      )
      .catch(() => undefined);
  }

  /**
   * QR code pra conectar. Tenta o connect (gera/retorna QR de instancia
   * desconectada); se a instancia nao existe, cria. O base64 pode vir na
   * resposta HTTP OU pelo webhook QRCODE_UPDATED (guardado em evolution_qr).
   * Nunca lanca 502: retorna null e o front continua puxando.
   */
  async evolutionQr(ctx: RequestContext) {
    const org = await this.getOrg(ctx);
    const adapter = await this.evolutionAdapter();
    // base INTERNA (mesma rede docker) — webhook nao sai pela internet/CF (502)
    const base = process.env.EVOLUTION_WEBHOOK_BASE ?? "http://api:3001";
    const webhookUrl = `${base}/api/webhooks/evolution/${encodeURIComponent(org.slug)}`;

    let r = await adapter.getConnect(org.slug);
    // instancia nao existe -> cria (resposta do create ja pode trazer o QR)
    if (!r.ok && (r.status === 404 || r.status === 400)) {
      const created = await adapter.createInstance({
        instanceName: org.slug,
        integration: "WHATSAPP-BAILEYS",
        webhookUrl,
        qrcode: true,
      });
      const cb = created.body as any;
      const cBase64 = cb?.qrcode?.base64 ?? null;
      if (cBase64) {
        await this.storeQr(ctx, cBase64);
        await this.setEvolutionStatus(ctx, "qr_required");
        return { base64: cBase64, code: cb?.qrcode?.code ?? null };
      }
      r = await adapter.getConnect(org.slug);
    }

    const b = r.body as any;
    const httpBase64: string | null = b?.base64 ?? b?.qrcode?.base64 ?? null;
    const code: string | null = b?.code ?? b?.pairingCode ?? null;
    if (httpBase64) await this.storeQr(ctx, httpBase64);

    await this.setEvolutionStatus(ctx, "qr_required");
    // se o HTTP nao trouxe, usa o QR capturado via webhook (evolution_qr)
    return { base64: httpBase64 ?? org.evolution_qr ?? null, code };
  }

  /** Estado da conexão (poll). Persiste o status da empresa. */
  async evolutionState(ctx: RequestContext) {
    const org = await this.getOrg(ctx);
    const adapter = await this.evolutionAdapter();
    const r = await adapter.getConnectionState(org.slug);
    const raw = (r.body as any)?.instance?.state ?? (r.body as any)?.state ?? null;
    const connected = raw === "open";
    const status = connected ? "connected" : raw === "connecting" ? "qr_required" : "disconnected";
    await this.setEvolutionStatus(ctx, status);
    if (connected) await this.storeQr(ctx, null); // limpa QR ao conectar
    return { connected, status, raw };
  }

  /** Reinicia a instância (gera novo QR). */
  async evolutionRestart(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const org = await this.getOrg(ctx);
    const adapter = await this.evolutionAdapter();
    await adapter.restart(org.slug);
    await this.setEvolutionStatus(ctx, "qr_required");
    await this.storeQr(ctx, null); // QR antigo invalido apos restart
    return { ok: true };
  }

  /** Desconecta (logout) sem deletar. */
  async evolutionDisconnect(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const org = await this.getOrg(ctx);
    const adapter = await this.evolutionAdapter();
    await adapter.logout(org.slug);
    await this.setEvolutionStatus(ctx, "disconnected");
    await this.storeQr(ctx, null);
    return { ok: true };
  }

  /** Exclui a instância. */
  async evolutionDelete(ctx: RequestContext) {
    this.requireAdmin(ctx);
    const org = await this.getOrg(ctx);
    const adapter = await this.evolutionAdapter();
    await adapter.deleteInstance(org.slug);
    await this.setEvolutionStatus(ctx, null);
    await this.storeQr(ctx, null);
    return { ok: true };
  }

  // ============================== INSTÂNCIAS EXTRAS (multi-número) ==============================
  /** Lista a instância PRINCIPAL (slug, faz notificações) + as EXTRAS do call
   *  center, com o limite do plano (max_extra_whatsapp). */
  async listInstances(ctx: RequestContext) {
    const org = await this.getOrg(ctx);
    const orgRow = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: { id: org.orgId }, select: { maxExtraWhatsapp: true } }));
    const extras = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.findMany({ where: {}, orderBy: { createdAt: "asc" } }));
    return {
      principal: { name: org.slug, status: org.evolution_status, role: "principal" as const },
      extras: extras.map((e) => ({ id: e.id, name: e.name, label: e.label, status: e.status, inboxId: e.inboxId })),
      maxExtra: orgRow?.maxExtraWhatsapp ?? 0,
      canCreate: extras.length < (orgRow?.maxExtraWhatsapp ?? 0),
    };
  }

  private async getExtra(ctx: RequestContext, instanceId: string) {
    const inst = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.findFirst({ where: { id: instanceId } }));
    if (!inst) throw new AppError(ErrorCode.NotFound, "Instância não encontrada", 404);
    return inst;
  }
  private async setExtraStatus(ctx: RequestContext, instanceId: string, status: string | null, qr?: string | null) {
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.update({ where: { id: instanceId }, data: { status, ...(qr !== undefined ? { qr } : {}) } })).catch(() => undefined);
  }
  private webhookUrlFor(name: string): string {
    const base = process.env.EVOLUTION_WEBHOOK_BASE ?? "http://api:3001";
    return `${base}/api/webhooks/evolution/${encodeURIComponent(name)}`;
  }

  /** Cria uma instância EXTRA (call center). Respeita o limite do plano e cria
   *  uma inbox de WhatsApp já atrelada (channelRef = nome da instância). */
  async createExtraInstance(ctx: RequestContext, label?: string) {
    this.requireAdmin(ctx);
    const org = await this.getOrg(ctx);
    const orgRow = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.organization.findFirst({ where: { id: org.orgId }, select: { maxExtraWhatsapp: true } }));
    const count = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.count({ where: {} }));
    if (count >= (orgRow?.maxExtraWhatsapp ?? 0)) {
      throw new AppError(ErrorCode.Forbidden, "Limite de números do plano atingido. Fale com o suporte para liberar mais.", 403);
    }
    const name = `${org.slug}-${randomBytes(3).toString("hex")}`;
    const adapter = await this.evolutionAdapter();
    const r = await adapter.createInstance({ instanceName: name, integration: "WHATSAPP-BAILEYS", webhookUrl: this.webhookUrlFor(name), qrcode: true });
    if (!r.ok && r.status !== 403 && r.status !== 409) {
      throw new AppError(ErrorCode.Internal, `Falha ao criar instância: ${r.error}`, 502);
    }
    // inbox dedicada (o atendimento lê/responde por ela)
    const inbox = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inbox.create({ data: { organizationId: org.orgId, name: (label || `WhatsApp ${count + 2}`), channel: "whatsapp", channelRef: name, botEnabled: false } }));
    const inst = await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.create({ data: { organizationId: org.orgId, name, label: label ?? null, role: "inbound", status: "qr_required", inboxId: inbox.id } }));
    return { id: inst.id, name, qrcode: (r.body as any)?.qrcode?.base64 ?? null };
  }

  /** QR de uma instância extra. */
  async extraQr(ctx: RequestContext, instanceId: string) {
    const inst = await this.getExtra(ctx, instanceId);
    const adapter = await this.evolutionAdapter();
    let r = await adapter.getConnect(inst.name);
    if (!r.ok && (r.status === 404 || r.status === 400)) {
      const created = await adapter.createInstance({ instanceName: inst.name, integration: "WHATSAPP-BAILEYS", webhookUrl: this.webhookUrlFor(inst.name), qrcode: true });
      const cb = created.body as any;
      const cBase64 = cb?.qrcode?.base64 ?? null;
      if (cBase64) { await this.setExtraStatus(ctx, inst.id, "qr_required", cBase64); return { base64: cBase64, code: cb?.qrcode?.code ?? null }; }
      r = await adapter.getConnect(inst.name);
    }
    const b = r.body as any;
    const httpBase64: string | null = b?.base64 ?? b?.qrcode?.base64 ?? null;
    const code: string | null = b?.code ?? b?.pairingCode ?? null;
    await this.setExtraStatus(ctx, inst.id, "qr_required", httpBase64 ?? undefined);
    return { base64: httpBase64 ?? inst.qr ?? null, code };
  }

  /** Estado da conexão de uma instância extra. */
  async extraState(ctx: RequestContext, instanceId: string) {
    const inst = await this.getExtra(ctx, instanceId);
    const adapter = await this.evolutionAdapter();
    const r = await adapter.getConnectionState(inst.name);
    const raw = (r.body as any)?.instance?.state ?? (r.body as any)?.state ?? null;
    const connected = raw === "open";
    const status = connected ? "connected" : raw === "connecting" ? "qr_required" : "disconnected";
    await this.setExtraStatus(ctx, inst.id, status, connected ? null : undefined);
    return { connected, status, raw };
  }

  /** Renomeia/atrela rótulo da instância extra (e da inbox vinculada). */
  async updateExtra(ctx: RequestContext, instanceId: string, label: string) {
    this.requireAdmin(ctx);
    const inst = await this.getExtra(ctx, instanceId);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.update({ where: { id: inst.id }, data: { label } }));
    if (inst.inboxId) await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inbox.update({ where: { id: inst.inboxId! }, data: { name: label } })).catch(() => undefined);
    return { ok: true };
  }

  /** Exclui a instância extra (e a inbox vinculada). */
  async extraDelete(ctx: RequestContext, instanceId: string) {
    this.requireAdmin(ctx);
    const inst = await this.getExtra(ctx, instanceId);
    const adapter = await this.evolutionAdapter();
    await adapter.deleteInstance(inst.name).catch(() => undefined);
    if (inst.inboxId) await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.inbox.update({ where: { id: inst.inboxId! }, data: { isActive: false } })).catch(() => undefined);
    await this.prisma.runWithContext(this.rls(ctx), (tx) => tx.evolutionInstance.delete({ where: { id: inst.id } }));
    return { ok: true };
  }
}
