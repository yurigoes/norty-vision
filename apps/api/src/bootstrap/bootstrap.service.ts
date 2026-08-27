import { Injectable } from "@nestjs/common";
import { SessionSnapshotService, type SessionSnapshot } from "../auth/session-snapshot.service";
import { ShellLoader, type OrgShortcut } from "./shell.loader";
import type { RequestContext } from "../auth/session.middleware";

export interface BootstrapPayload {
  session: SessionSnapshot;
  organization: unknown | null;
  store: unknown | null;
  subscription: unknown | null;
  shortcuts: OrgShortcut[];
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
 * Uma chamada HTTP, porém, não quer dizer uma ida ao banco: a primeira versão
 * disto resolvia as peças em paralelo, mas eram onze transações e 34 idas ao
 * Postgres. Agora é UMA consulta (`shell.sql.ts`) — e a sessão sai do mesmo
 * resultado, sem as duas leituras extras do `/auth/me`.
 *
 * Nenhuma peça derruba a resposta: o que falta vira `null`/`[]` e a casca
 * renderiza sem aquele pedaço, exatamente como fazia quando um dos endpoints
 * dava erro.
 */
@Injectable()
export class BootstrapService {
  constructor(
    private readonly snapshot: SessionSnapshotService,
    private readonly shell: ShellLoader,
  ) {}

  async build(ctx: RequestContext): Promise<BootstrapPayload> {
    // anônimo: nada a carregar além do "não autenticado"
    if (!ctx.userId && !ctx.platformUserId) {
      return {
        session: this.snapshot.build(ctx),
        organization: null,
        store: null,
        subscription: null,
        shortcuts: [],
        chatwoot: null,
      };
    }

    const shell = await this.shell.load(ctx);
    const session = this.snapshot.build(ctx);
    const isMaster = session.master !== null;

    return {
      session,
      organization: shell.organization,
      store: shell.store,
      // master não tem assinatura própria; o widget do Chatwoot é só dele
      subscription: isMaster ? null : shell.subscription,
      shortcuts: shell.shortcuts,
      chatwoot: isMaster ? shell.chatwoot : null,
    };
  }
}
