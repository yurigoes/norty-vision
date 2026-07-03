import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CurrentContext, Public } from "../auth/decorators";
import type { RequestContext } from "../auth/session.middleware";
import { KioskService } from "./kiosk.service";

@Controller("kiosk")
export class KioskController {
  constructor(private readonly svc: KioskService) {}

  /** Token do kiosk (admin) — pra montar o link do painel de TV. */
  @Get("token")
  getToken(@CurrentContext() ctx: RequestContext) { return this.svc.getToken(ctx); }
  @Post("token")
  @HttpCode(200)
  generateToken(@CurrentContext() ctx: RequestContext) { return this.svc.generateToken(ctx); }

  /** Painel de recepção (gráfica) — PÚBLICO, validado pelo token. */
  @Public()
  @Get("recepcao/:token")
  recepcao(@Param("token") token: string) { return this.svc.recepcao(token); }

  /** Painel de produção (gráfica) — PÚBLICO, validado pelo token. */
  @Public()
  @Get("producao/:token")
  producao(@Param("token") token: string) { return this.svc.producao(token); }

  /** Painel admin "tudo" — PÚBLICO, validado pelo token. */
  @Public()
  @Get("admin/:token")
  admin(@Param("token") token: string) { return this.svc.admin(token); }

  /** Painel admin ótica — PÚBLICO, validado pelo token. */
  @Public()
  @Get("otica/:token")
  otica(@Param("token") token: string) { return this.svc.otica(token); }
}
