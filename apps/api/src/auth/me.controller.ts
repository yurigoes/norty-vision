import { Controller, Get } from "@nestjs/common";
import { CurrentContext, Public } from "./decorators";
import type { RequestContext } from "./session.middleware";
import { SessionSnapshotService } from "./session-snapshot.service";

@Controller("auth")
export class MeController {
  constructor(private readonly snapshot: SessionSnapshotService) {}

  /**
   * GET /api/auth/me
   *
   * Endpoint publico (sem AuthGuard) que retorna o contexto atual.
   * - Anonimo: { authenticated: false }
   * - User: { authenticated: true, user: {...}, master: null }
   * - Master: { authenticated: true, master: {...} }
   * - Ambos: ambos preenchidos
   *
   * O front do painel usa `GET /api/bootstrap`, que já devolve isto junto com
   * empresa, loja, assinatura e atalhos. Este endpoint continua pra quem só
   * precisa saber quem está logado.
   */
  @Public()
  @Get("me")
  async me(@CurrentContext() ctx: RequestContext) {
    return this.snapshot.build(ctx);
  }
}
