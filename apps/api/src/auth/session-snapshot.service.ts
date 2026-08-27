import { Injectable } from "@nestjs/common";
import type { RequestContext } from "./session.middleware";

export interface SessionSnapshot {
  authenticated: boolean;
  user: {
    id: string;
    membershipId: string | null;
    orgId: string | null;
    storeId: string | null;
    role: string | null;
    isOrgAdmin: boolean;
    permissions: Record<string, boolean> | undefined;
    mustResetPassword: boolean;
  } | null;
  master: {
    id: string | null;
    platformRole: string | null;
    techSpecsCategories: string[];
  } | null;
  impersonating: { orgId: string; orgName: string | null } | null;
}

/**
 * O retrato da sessão atual (o payload de `GET /api/auth/me`).
 *
 * NÃO VAI AO BANCO. Tudo que ele mostra já está no contexto que o guard
 * resolveu — inclusive "precisa trocar a senha" e o nome da empresa
 * impersonada, que antes custavam uma transação cada e depois viraram uma
 * consulta separada. Hoje vêm na mesma consulta da sessão, e com a sessão no
 * cache do Redis o `/auth/me` responde sem tocar no Postgres.
 *
 * Vive num serviço porque duas rotas montam o mesmo retrato: o próprio
 * `/auth/me` e o `/bootstrap`. Duplicar essa montagem era pedir pra elas
 * divergirem.
 */
@Injectable()
export class SessionSnapshotService {
  build(ctx: RequestContext): SessionSnapshot {
    return {
      authenticated: Boolean(ctx.userId || ctx.platformUserId),
      user: ctx.userId
        ? {
            id: ctx.userId,
            membershipId: ctx.membershipId,
            orgId: ctx.orgId,
            storeId: ctx.storeId,
            role: ctx.role,
            isOrgAdmin: ctx.isOrgAdmin,
            permissions: ctx.permissions,
            mustResetPassword: ctx.mustResetPassword,
          }
        : null,
      master: ctx.isPlatformAdmin
        ? {
            id: ctx.platformUserId,
            platformRole: ctx.platformRole,
            techSpecsCategories: ctx.techSpecsCategories,
          }
        : null,
      impersonating:
        ctx.impersonating && ctx.impersonatingOrgId
          ? { orgId: ctx.impersonatingOrgId, orgName: ctx.impersonatingOrgName }
          : null,
    };
  }
}
