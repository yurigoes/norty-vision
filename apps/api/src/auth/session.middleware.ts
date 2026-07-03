/**
 * Tipo do contexto da sessao. A logica de resolucao e autorizacao
 * vive em auth.guard.ts.
 *
 * (Em NestJS + Fastify middlewares com forRoutes('*') nao executam
 * confiavelmente, entao usamos um Guard global no APP_GUARD.)
 */
export interface RequestContext {
  // sempre algum:
  userId: string | null;
  platformUserId: string | null;

  // se logado como user normal
  membershipId: string | null;
  orgId: string | null;
  storeId: string | null;
  role: string | null;
  isOrgAdmin: boolean;
  // permissoes do papel do membership ativo (configuravel pelo admin da org).
  // owner/admin tem acesso total e ignoram este mapa.
  permissions: Record<string, boolean>;

  // se logado como master
  isPlatformAdmin: boolean;
  // 'owner' = dono do SaaS (tudo); 'support' = suporte master (qualquer
  // empresa, exceto a config do dono). null quando nao for master.
  platformRole: "owner" | "support" | null;
  techSpecsCategories: string[];

  // IMPERSONAÇÃO: quando o master está "dentro" de uma empresa, o contexto
  // se comporta como um usuário da org (orgId/role/isOrgAdmin preenchidos e
  // isPlatformAdmin=false), mas guardamos quem é o master por trás pra auditar
  // e exibir o banner / botão de sair.
  impersonating: boolean;
  impersonatingOrgId: string | null;
  impersonatorPlatformUserId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    yugo?: RequestContext;
  }
}
