import { CONTEXT_CTE } from "../prisma/rls-context";

/**
 * A CASCA DO PAINEL EM UMA INSTRUÇÃO
 * ============================================================================
 * O `/api/bootstrap` já era UMA chamada HTTP, mas por dentro eram onze
 * transações — empresa, plano, aditivos, nicho, sub-módulos, loja, assinatura,
 * usuário, e mais três pra atalhos e widget. Cada transação custa quatro idas
 * ao Postgres (BEGIN, os GUCs, a consulta, COMMIT), e o `include` do Prisma
 * ainda vira uma consulta por tabela: 34 idas pra montar uma tela.
 *
 * Aqui é uma instrução só. O que garante a ordem é a dependência entre os
 * CTEs, não a sorte do planejador:
 *
 *   ctx  → seta os sete GUCs do RLS
 *   ↓ (LATERAL: avaliado por linha de ctx)
 *   org, org_flags, usr, st, sub, grants, ccs → leem com o contexto do usuário
 *   ↓ (niche_row depende de org.niche)
 *   tenant → junta tudo numa linha
 *   ↓
 *   adm  → só então eleva pra platform admin
 *   ↓
 *   platform → plano, integrações globais, nome da empresa impersonada
 *
 * SOBRE A ELEVAÇÃO: três leituras precisam de platform admin e já precisavam
 * antes — o código chamava `getByProvider({ isPlatformAdmin: true })` e
 * `runWithContext({ isPlatformAdmin: true })` pra elas. São exatamente: o plano
 * da própria empresa (pode estar inativo, e aí a policy de `plans` esconderia),
 * as duas integrações globais (Chatwoot/GLPI, `organization_id IS NULL`) e o
 * nome da empresa que o master está impersonando. Nada além disso é lido depois
 * do `adm`, e o SET LOCAL morre no fim da instrução.
 */

/**
 * Data no MESMO formato que o Prisma entregava: ISO em UTC, milissegundos, "Z".
 * Sem isto o Postgres devolveria `+00:00` e microssegundos — mesmo instante,
 * texto diferente, e quem compara string de `updatedAt` quebraria.
 */
const iso = (col: string) =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Campos da empresa — os MESMOS que `OrganizationsService.getMine` devolve. */
const ORG_COLS = `id, name, slug, status, niche,
             logo_url AS "logoUrl",
             primary_color AS "primaryColor",
             theme_mode AS "themeMode",
             portal_config AS "portalConfig",
             callcenter_config AS "callcenterConfig",
             plan_code AS "planCode",
             vitrine_headline AS "vitrineHeadline",
             vitrine_subheadline AS "vitrineSubheadline",
             vitrine_about AS "vitrineAbout",
             banner_image_url AS "bannerImageUrl",
             banner_link_url AS "bannerLinkUrl",
             banner_enabled AS "bannerEnabled",
             ${iso("banner_starts_at")} AS "bannerStartsAt",
             ${iso("banner_ends_at")} AS "bannerEndsAt",
             vitrine_address AS "vitrineAddress",
             vitrine_maps_url AS "vitrineMapsUrl",
             vitrine_hours AS "vitrineHours",
             social_instagram AS "socialInstagram",
             social_facebook AS "socialFacebook",
             social_whatsapp AS "socialWhatsapp",
             social_website AS "socialWebsite",
             product_skin AS "productSkin"`;

/** Loja inteira (o front lê branding; o resto vai junto como ia no Prisma). */
const STORE_COLS = `s0.id,
             s0.organization_id AS "organizationId",
             s0.slug, s0.name, s0.document, s0.city, s0.state, s0.timezone, s0.status,
             s0.whatsapp_instance_id AS "whatsappInstanceId",
             s0.theme_primary_color AS "themePrimaryColor",
             s0.theme_secondary_color AS "themeSecondaryColor",
             s0.theme_accent_color AS "themeAccentColor",
             s0.logo_url AS "logoUrl",
             s0.logo_dark_url AS "logoDarkUrl",
             s0.favicon_url AS "faviconUrl",
             s0.theme_mode AS "themeMode",
             s0.glpi_group_id AS "glpiGroupId",
             s0.catalog_enabled AS "catalogEnabled",
             s0.catalog_headline AS "catalogHeadline",
             s0.catalog_whatsapp AS "catalogWhatsapp",
             s0.exam_price_cents AS "examPriceCents",
             s0.exam_payment_note AS "examPaymentNote",
             s0.geo_lat AS "geoLat",
             s0.geo_lng AS "geoLng",
             s0.geo_radius_m AS "geoRadiusM",
             ${iso("s0.deleted_at")} AS "deletedAt",
             ${iso("s0.created_at")} AS "createdAt",
             ${iso("s0.updated_at")} AS "updatedAt"`;

const SUB_COLS = `sb.id,
             sb.organization_id AS "organizationId",
             sb.plan_id AS "planId",
             sb.status,
             ${iso("sb.current_period_start")} AS "currentPeriodStart",
             ${iso("sb.current_period_end")} AS "currentPeriodEnd",
             ${iso("sb.trial_ends_at")} AS "trialEndsAt",
             sb.mp_subscription_id AS "mpSubscriptionId",
             sb.mp_payer_email AS "mpPayerEmail",
             sb.mp_init_point AS "mpInitPoint",
             ${iso("sb.canceled_at")} AS "canceledAt",
             sb.cancel_reason AS "cancelReason",
             ${iso("sb.ends_at")} AS "endsAt",
             ${iso("sb.created_at")} AS "createdAt",
             ${iso("sb.updated_at")} AS "updatedAt"`;

/** Plano aninhado na assinatura (era o `include: { plan: true }`). */
const PLAN_JSON = `jsonb_build_object(
               'id', p.id, 'slug', p.slug, 'name', p.name,
               'description', p.description, 'highlight', p.highlight, 'niche', p.niche,
               'priceCents', p.price_cents, 'currency', p.currency, 'interval', p.interval,
               'trialDays', p.trial_days, 'maxStores', p.max_stores, 'maxUsers', p.max_users,
               'maxMessagesMonth', p.max_messages_month,
               'features', p.features, 'extraHighlights', p.extra_highlights,
               'isActive', p.is_active, 'displayOrder', p.display_order,
               'mpPlanId', p.mp_plan_id,
               'createdAt', ${iso("p.created_at")}, 'updatedAt', ${iso("p.updated_at")}
             )`;

/** Integração global, só os campos que a casca usa. */
const INTEGRATION_JSON = `jsonb_build_object(
                 'status', i.status,
                 'baseUrl', i.base_url,
                 'consoleUrl', i.console_url,
                 'config', i.config,
                 'embedEnabled', i.embed_enabled
               )`;

/** $8 = id da empresa impersonada (texto vazio quando não há). */
export const SHELL_SQL = `WITH ${CONTEXT_CTE},

  org AS MATERIALIZED (
    SELECT o.* FROM ctx, LATERAL (
      SELECT ${ORG_COLS}
        FROM organizations
       WHERE id = nullif(ctx.org_id, '')::uuid AND deleted_at IS NULL
    ) o
  ),

  org_flags AS MATERIALIZED (
    SELECT f.* FROM ctx, LATERAL (
      SELECT chatwoot_account_id AS "chatwootAccountId",
             glpi_entity_id AS "glpiEntityId"
        FROM organizations
       WHERE id = nullif(ctx.org_id, '')::uuid AND deleted_at IS NULL
    ) f
  ),

  usr AS MATERIALIZED (
    SELECT u.* FROM ctx, LATERAL (
      SELECT must_reset_password AS "mustResetPassword"
        FROM users
       WHERE id = nullif(ctx.user_id, '')::uuid
    ) u
  ),

  st AS MATERIALIZED (
    SELECT s.* FROM ctx, LATERAL (
      SELECT ${STORE_COLS},
             CASE WHEN o.id IS NULL THEN NULL
                  ELSE jsonb_build_object('id', o.id, 'slug', o.slug, 'name', o.name)
             END AS "organization"
        FROM stores s0
        LEFT JOIN organizations o ON o.id = s0.organization_id
       WHERE s0.id = nullif(ctx.store_id, '')::uuid AND s0.deleted_at IS NULL
    ) s
  ),

  sub AS MATERIALIZED (
    SELECT s.* FROM ctx, LATERAL (
      SELECT ${SUB_COLS},
             CASE WHEN p.id IS NULL THEN NULL ELSE ${PLAN_JSON} END AS "plan"
        FROM subscriptions sb
        LEFT JOIN plans p ON p.id = sb.plan_id
       WHERE sb.organization_id = nullif(ctx.org_id, '')::uuid
    ) s
  ),

  grants AS MATERIALIZED (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'moduleKey', g.module_key,
             'blocked', g.blocked,
             'paid', g.paid,
             'expiresAt', ${iso("g.expires_at")}
           )), '[]'::jsonb) AS items
      FROM ctx, LATERAL (
        SELECT module_key, blocked, paid, expires_at
          FROM org_module_grants
         WHERE organization_id = nullif(ctx.org_id, '')::uuid
      ) g
  ),

  ccs AS MATERIALIZED (
    SELECT c.* FROM ctx, LATERAL (
      SELECT submodule_features AS "submoduleFeatures",
             production_features AS "productionFeatures"
        FROM call_center_settings
       WHERE organization_id = nullif(ctx.org_id, '')::uuid
       LIMIT 1
    ) c
  ),

  niche_row AS MATERIALIZED (
    SELECT n.* FROM org, LATERAL (
      SELECT hidden_module_keys AS hidden
        FROM niches
       WHERE key = lower(org.niche)
       LIMIT 1
    ) n
  ),

  tenant AS MATERIALIZED (
    SELECT
      (SELECT to_jsonb(o) FROM org o)                AS organization,
      (SELECT to_jsonb(f) FROM org_flags f)          AS org_flags,
      (SELECT to_jsonb(s) FROM st s)                 AS store,
      (SELECT to_jsonb(s) FROM sub s)                AS subscription,
      (SELECT items FROM grants)                     AS grants,
      (SELECT to_jsonb(c) FROM ccs c)                AS ccs,
      (SELECT hidden FROM niche_row)                 AS niche_hidden,
      (SELECT "mustResetPassword" FROM usr)          AS must_reset_password,
      (SELECT "planCode" FROM org)                   AS plan_code
  ),

  adm AS MATERIALIZED (
    SELECT set_config('app.is_platform_admin', 'true', true) AS escalado,
           t.plan_code
      FROM tenant t
  ),

  platform AS MATERIALIZED (
    SELECT
      (SELECT p.features FROM plans p
        WHERE p.slug = a.plan_code LIMIT 1) AS plan_features,
      (SELECT ${INTEGRATION_JSON} FROM platform_integrations i
        WHERE i.provider = 'chatwoot' AND i.organization_id IS NULL
          AND a.escalado IS NOT NULL LIMIT 1) AS chatwoot,
      (SELECT ${INTEGRATION_JSON} FROM platform_integrations i
        WHERE i.provider = 'glpi' AND i.organization_id IS NULL
          AND a.escalado IS NOT NULL LIMIT 1) AS glpi,
      (SELECT o.name FROM organizations o
        WHERE o.id = nullif($8, '')::uuid
          AND a.escalado IS NOT NULL LIMIT 1) AS impersonating_org_name
      FROM adm a
  )

SELECT t.organization, t.org_flags, t.store, t.subscription, t.grants, t.ccs,
       t.niche_hidden, t.must_reset_password,
       p.plan_features, p.chatwoot, p.glpi, p.impersonating_org_name
  FROM tenant t, platform p`;

export interface PlatformIntegrationRow {
  status: string;
  baseUrl: string | null;
  consoleUrl: string | null;
  config: Record<string, unknown> | null;
  embedEnabled: boolean;
}

/** Uma linha, tudo que a casca precisa. */
export interface ShellRow {
  organization: Record<string, unknown> | null;
  org_flags: { chatwootAccountId: string | null; glpiEntityId: string | null } | null;
  store: Record<string, unknown> | null;
  subscription: Record<string, unknown> | null;
  grants: Array<{ moduleKey: string; blocked: boolean; paid: boolean; expiresAt: string | null }>;
  ccs: { submoduleFeatures: unknown; productionFeatures: unknown } | null;
  niche_hidden: unknown;
  must_reset_password: boolean | null;
  plan_features: unknown;
  chatwoot: PlatformIntegrationRow | null;
  glpi: PlatformIntegrationRow | null;
  impersonating_org_name: string | null;
}
