import { Controller, Get } from "@nestjs/common";
import { CurrentContext, Public } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { BootstrapService } from "./bootstrap.service";

@Controller("bootstrap")
export class BootstrapController {
  constructor(private readonly svc: BootstrapService) {}

  /**
   * GET /api/bootstrap
   *
   * Sessão + empresa + loja + assinatura + atalhos + widget, numa resposta só.
   * Público como o `/auth/me`: anônimo recebe `session.authenticated = false` e
   * o resto vazio, pra que a casca do painel decida o redirecionamento em vez
   * de tratar um 401.
   */
  @Public()
  @Get()
  async bootstrap(@CurrentContext() ctx: RequestContext) {
    return this.svc.build(ctx);
  }
}
