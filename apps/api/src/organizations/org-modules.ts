/**
 * Quais módulos a empresa enxerga.
 *
 * Plano, aditivos à la carte, deny-list do nicho e sub-módulos: a conta que
 * decide o que aparece no menu e o que aparece com cadeado. Duas telas
 * dependem dela — `/api/organizations/me` e a casca do painel — e as duas
 * chegam aqui pelo mesmo `ShellLoader`, justamente pra nunca discordarem.
 *
 * `expiresAt` aceita `Date` ou texto ISO porque os aditivos chegam como jsonb
 * da consulta única; quem chamar pelo Prisma um dia continua funcionando.
 */

export interface ModuleGrant {
  moduleKey: string;
  blocked: boolean;
  paid: boolean;
  expiresAt: Date | string | null;
}

export interface OrgModulesInput {
  /** `plans.features` do plano da empresa (null = sem plano/sem features) */
  planFeatures: unknown;
  /** aditivos à la carte concedidos pelo master */
  grants: ModuleGrant[];
  /** `niches.hidden_module_keys` do nicho da empresa */
  nicheHidden: unknown;
  /** `call_center_settings.submodule_features` */
  submoduleFeatures: unknown;
  /** `call_center_settings.production_features` (legado da Produção) */
  productionFeatures: unknown;
  /** referência de tempo (injetável pra teste) */
  now?: Date;
}

export interface OrgModules {
  /** null = plano sem restrição: tudo liberado, sem cadeado */
  enabledModules: string[] | null;
  nicheHiddenModules: string[];
  submoduleFeatures: Record<string, boolean>;
  productionFeatures: Record<string, boolean>;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function resolveOrgModules(input: OrgModulesInput): OrgModules {
  const now = input.now ?? new Date();

  // módulos habilitados pelo plano (features). Convenção: features é uma lista
  // de chaves de módulo. Vazio/sem plano = null → tudo liberado (sem cadeado).
  let enabledModules: string[] | null = null;
  const feats = input.planFeatures;
  if (Array.isArray(feats) && feats.length > 0) enabledModules = strings(feats);

  // aditivos à la carte: módulos liberados fora do plano (trial/alacarte/cortesia).
  // Ativo = não bloqueado E (pago OU sem expiração OU ainda dentro do prazo).
  if (enabledModules !== null) {
    const expira = (g: ModuleGrant) => (g.expiresAt == null ? null : new Date(g.expiresAt));
    const active = input.grants
      .filter((g) => {
        const exp = expira(g);
        return !g.blocked && (g.paid || exp == null || exp > now);
      })
      .map((g) => g.moduleKey);
    if (active.length) enabledModules = [...new Set([...enabledModules, ...active])];

    // BLOQUEIO por empresa: grant com blocked=true REMOVE o módulo mesmo que o
    // plano inclua (override do master pra empresa específica). Só funciona
    // quando o plano restringe (enabledModules != null) — plano sem features
    // libera tudo e a UI avisa pra definir os módulos do plano antes.
    const blockedKeys = input.grants.filter((g) => g.blocked).map((g) => g.moduleKey);
    if (blockedKeys.length) enabledModules = enabledModules.filter((k) => !blockedKeys.includes(k));
  }

  // Deny-list de módulos do NICHO da empresa (tabela `niches`, editável no
  // master). Módulos aqui não aparecem pra esse nicho.
  const nicheHiddenModules = strings(input.nicheHidden);

  // Sub-módulos por empresa: overrides do master no mapa genérico
  // submodule_features { "<modulo>.<sub>": false } — ausência = ligado
  // (default-on). `productionFeatures` é mantido (chaves "soltas") por
  // compatibilidade com o gating já existente da Produção.
  const submoduleFeatures: Record<string, boolean> = {};
  const productionFeatures: Record<string, boolean> = {};
  const sf = input.submoduleFeatures;
  if (sf && typeof sf === "object" && !Array.isArray(sf)) {
    for (const [k, v] of Object.entries(sf as Record<string, unknown>)) {
      const on = v !== false;
      submoduleFeatures[k] = on;
      if (k.startsWith("producao.")) productionFeatures[k.slice("producao.".length)] = on;
    }
  }
  // fallback: se ainda não migrou pro mapa genérico, lê o legado da Produção
  const pf = input.productionFeatures;
  if (!sf && pf && typeof pf === "object" && !Array.isArray(pf)) {
    for (const [k, v] of Object.entries(pf as Record<string, unknown>)) {
      const on = v !== false;
      productionFeatures[k] = on;
      submoduleFeatures[`producao.${k}`] = on;
    }
  }

  return { enabledModules, nicheHiddenModules, submoduleFeatures, productionFeatures };
}
