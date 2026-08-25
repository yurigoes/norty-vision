import { Injectable, Logger } from "@nestjs/common";
import { PrismaService, type RlsContext } from "../prisma/prisma.service";
import { resolveOrgModules } from "../organizations/org-modules";
import { SHELL_SQL, type ShellRow, type PlatformIntegrationRow } from "./shell.sql";
import type { RequestContext } from "../auth/session.middleware";

export interface OrgShortcut {
  provider: string;
  label: string;
  url: string;
}

/** As peças da casca, já no formato que a API sempre devolveu. */
export interface Shell {
  organization: Record<string, unknown> | null;
  store: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  shortcuts: OrgShortcut[];
  chatwoot: { baseUrl: string; websiteToken: string } | null;
  mustResetPassword: boolean;
  impersonatingOrgName: string | null;
}

const VAZIO: Shell = {
  organization: null,
  store: null,
  subscription: null,
  shortcuts: [],
  chatwoot: null,
  mustResetPassword: false,
  impersonatingOrgName: null,
};

/**
 * Carrega a casca do painel numa consulta só (ver `shell.sql.ts`).
 *
 * Quem monta a resposta — `/api/bootstrap` e `/api/organizations/me` — lê
 * daqui. São os mesmos campos, calculados pelo mesmo código: a versão anterior
 * tinha a montagem da empresa escrita duas vezes.
 */
@Injectable()
export class ShellLoader {
  private readonly logger = new Logger("Shell");
  private avisou = false;

  constructor(private readonly prisma: PrismaService) {}

  async load(ctx: RequestContext): Promise<Shell> {
    const row = await this.query(ctx);
    if (!row) return VAZIO;

    return {
      organization: this.organization(row),
      store: row.store,
      subscription: row.subscription,
      shortcuts: this.shortcuts(ctx, row),
      chatwoot: this.chatwoot(ctx, row),
      mustResetPassword: row.must_reset_password ?? false,
      impersonatingOrgName: row.impersonating_org_name,
    };
  }

  // ---------------------------------------------------------------- consulta

  private rls(ctx: RequestContext): RlsContext {
    return {
      orgId: ctx.orgId,
      storeId: ctx.storeId,
      userId: ctx.userId,
      role: ctx.role,
      isOrgAdmin: ctx.isOrgAdmin,
      isPlatformAdmin: ctx.isPlatformAdmin,
    };
  }

  private async query(ctx: RequestContext): Promise<ShellRow | null> {
    const rls = this.rls(ctx);
    const impersonando = ctx.impersonatingOrgId ?? "";

    const rows = await this.prisma.queryWithContext<ShellRow>(rls, SHELL_SQL, impersonando).catch((e) => {
      this.logger.error(`consulta da casca falhou: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });

    const row = rows?.[0] ?? null;
    // Falha fechada: sem os GUCs no lugar certo, o RLS não devolve linha
    // nenhuma — nunca a linha de outra empresa. Se isso acontecer com org no
    // contexto, refaz pelo caminho transacional (quatro idas) e avisa.
    if (row && (!ctx.orgId || row.organization)) return row;

    if (!this.avisou) {
      this.avisou = true;
      this.logger.warn(
        "a consulta única da casca voltou vazia com empresa no contexto — " +
          "refazendo dentro de transação. Se isto se repetir, confira o plano " +
          "da consulta (o LATERAL sobre `ctx` precisa rodar antes das tabelas).",
      );
    }

    const seguro = await this.prisma
      .queryWithContextInTransaction<ShellRow>(rls, SHELL_SQL, impersonando)
      .catch(() => null);
    return seguro?.[0] ?? row;
  }

  // ---------------------------------------------------------------- montagem

  /** Empresa + módulos liberados, exatamente como `/api/organizations/me`. */
  private organization(row: ShellRow): Record<string, unknown> | null {
    if (!row.organization) return null;
    const modules = resolveOrgModules({
      planFeatures: row.plan_features,
      grants: row.grants ?? [],
      nicheHidden: row.niche_hidden,
      submoduleFeatures: row.ccs?.submoduleFeatures ?? null,
      productionFeatures: row.ccs?.productionFeatures ?? null,
    });
    return { ...row.organization, ...modules };
  }

  /**
   * Atalhos de SSO pros sistemas integrados da empresa (Chatwoot, GLPI).
   * Só os provisionados pra empresa E ativos na plataforma.
   */
  private shortcuts(ctx: RequestContext, row: ShellRow): OrgShortcut[] {
    if (!ctx.isOrgAdmin || !ctx.orgId) return [];
    const out: OrgShortcut[] = [];

    const chatwootId = row.org_flags?.chatwootAccountId;
    if (chatwootId) {
      const base = consoleBase(row.chatwoot);
      if (base) {
        out.push({
          provider: "chatwoot",
          label: "Atendimento (Chatwoot)",
          url: `${base}/app/accounts/${chatwootId}/dashboard`,
        });
      }
    }

    if (row.org_flags?.glpiEntityId) {
      const base = consoleBase(row.glpi);
      if (base) out.push({ provider: "glpi", label: "Chamados (GLPI)", url: base });
    }

    return out;
  }

  /** Widget do Chatwoot embutido no painel do master. */
  private chatwoot(ctx: RequestContext, row: ShellRow): { baseUrl: string; websiteToken: string } | null {
    if (!ctx.isPlatformAdmin) return null;
    const cw = row.chatwoot;
    if (!cw || cw.status !== "active" || !cw.embedEnabled || !cw.baseUrl) return null;
    const token = (cw.config ?? {})["chatwootWebsiteToken"];
    if (typeof token !== "string" || !token) return null;
    return { baseUrl: cw.baseUrl, websiteToken: token };
  }
}

/** URL do console: `config.publicUrl` > `consoleUrl` > `baseUrl`, sem barra no fim. */
function consoleBase(i: PlatformIntegrationRow | null): string | null {
  if (!i || i.status !== "active") return null;
  const publicUrl = (i.config ?? {})["publicUrl"];
  const base = (typeof publicUrl === "string" && publicUrl) || i.consoleUrl || i.baseUrl || "";
  return base ? base.replace(/\/$/, "") : null;
}
