/**
 * SUBDOMÍNIOS QUE NÃO SÃO EMPRESA — uma lista só.
 * ============================================================================
 * Havia DUAS cópias disto, e elas divergiram:
 *
 *   lib/orgSlug.ts     (cliente)  tinha "vision", "norty", "sorva", "license"
 *   lib/orgBranding.ts (servidor) NÃO tinha nenhum deles
 *
 * Alguém consertou um lado e esqueceu o outro. O sintoma medido em produção:
 * `GET /api/organizations/public/by-slug/vision` → 404 "Empresa não
 * encontrada", repetido a cada render de página, porque o lado SERVIDOR
 * extraía `vision` como se fosse slug de empresa. (A empresa real tem slug
 * `zito-oticas`; `vision` é o domínio do produto.)
 *
 * E o 404 não voltava limpo: `getOrgBrandingFromHost` devolvia
 * `{ slug: "vision", name: "vision" }` mesmo sem achar — então o resto do app
 * passava a acreditar que o tenant era `vision`.
 *
 * `www` e amigos valem pros dois lados; os nomes de produto (`vision`,
 * `sorva`…) valem quando o ROOT_DOMAIN configurado é `norty.com.br` em vez de
 * `vision.norty.com.br`. Deixar os dois conjuntos juntos é o que torna a
 * resolução correta COM QUALQUER um dos dois configurado.
 */
export const SUBDOMINIOS_RESERVADOS: ReadonlySet<string> = new Set([
  // infraestrutura e serviços
  "www", "app", "api", "admin", "painel", "mail", "static", "cdn", "assets",
  "n8n", "chat", "chatwoot", "glpi", "evolution", "minio", "s3", "localhost",
  // nomes de PRODUTO sob norty.com.br — não são empresa nenhuma
  "vision", "norty", "sorva", "license", "app-sorva",
]);
