import { Injectable } from "@nestjs/common";
import { SessionSnapshotService, type SessionSnapshot } from "../auth/session-snapshot.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { StoresService } from "../stores/stores.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CompanyIntegrationsService } from "../company-integrations/company-integrations.service";
import { IntegrationsService } from "../integrations/integrations.service";
import type { RequestContext } from "../auth/session.middleware";

export interface BootstrapPayload {
  session: SessionSnapshot;
  organization: unknown | null;
  store: unknown | null;
  subscription: unknown | null;
  shortcuts: Array<{ provider: string; label: string; url: string }>;
  chatwoot: { baseUrl: string; websiteToken: string } | null;
}

/**
 * Tudo que a casca do painel precisa, numa requisição só.
 *
 * O layout do `/app` buscava sessão, empresa, loja, assinatura, atalhos e
 * integrações em chamadas HTTP separadas e SEQUENCIAIS — seis idas e voltas
 * a cada troca de tela (o layout é `force-dynamic`, então isso rodava em toda
 * navegação). Era o que fazia o sistema "pensar" entre as páginas.
 *
 * Aqui as peças são resolvidas em paralelo dentro da própria API, do lado de
 * dentro da rede, e voltam juntas.
 *
 * Nenhuma peça derruba a resposta: quem falha vira `null`/`[]` e a casca
 * renderiza sem aquele pedaço, exatamente como fazia quando um dos endpoints
 * dava erro.
 */
@Injectable()
export class BootstrapService {
  constructor(
    private readonly snapshot: SessionSnapshotService,
    private readonly organizations: OrganizationsService,
    private readonly stores: StoresService,
    private readonly subscriptions: SubscriptionsService,
    private readonly companyIntegrations: CompanyIntegrationsService,
    private readonly integrations: IntegrationsService,
  ) {}

  async build(ctx: RequestContext): Promise<BootstrapPayload> {
    const session = await this.snapshot.build(ctx);

    // anônimo: nada a carregar além do "não autenticado"
    if (!session.authenticated) {
      return { session, organization: null, store: null, subscription: null, shortcuts: [], chatwoot: null };
    }

    const isMaster = session.master !== null;
    const hasOrg = Boolean(ctx.orgId);

    const [organization, store, subscription, shortcuts, chatwoot] = await Promise.all([
      hasOrg ? soft(() => this.organizations.getMine(ctx)) : null,
      ctx.storeId ? soft(() => this.stores.getById(ctx, ctx.storeId!)) : null,
      hasOrg && !isMaster ? soft(() => this.subscriptions.current(ctx)) : null,
      ctx.isOrgAdmin ? softList(() => this.companyIntegrations.shortcuts(ctx)) : [],
      isMaster ? this.chatwootEmbed(ctx) : null,
    ]);

    return { session, organization, store, subscription, shortcuts, chatwoot };
  }

  /**
   * Config do widget Chatwoot pro master. Antes o front baixava a lista
   * inteira de integrações da plataforma (com config) só pra achar um token.
   */
  private async chatwootEmbed(
    ctx: RequestContext,
  ): Promise<{ baseUrl: string; websiteToken: string } | null> {
    if (!ctx.isPlatformAdmin) return null;
    const cw = await soft(() =>
      this.integrations.getByProvider({ isPlatformAdmin: true, provider: "chatwoot" }),
    );
    if (!cw || cw.status !== "active" || !cw.embedEnabled) return null;
    const cfg = (cw.config ?? {}) as { chatwootWebsiteToken?: string };
    if (!cfg.chatwootWebsiteToken) return null;
    return { baseUrl: cw.baseUrl, websiteToken: cfg.chatwootWebsiteToken };
  }
}

/** Falhou? Vira null — a casca continua de pé sem aquele pedaço. */
async function soft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
async function softList<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}
