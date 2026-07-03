import { Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public } from "../auth/decorators";
import { loadEnv } from "../config";
import { ImpersonationService } from "./impersonation.service";

/**
 * Endpoints públicos no nível do guard (a autorização é feita lendo o cookie
 * do master direto no service), porque durante a impersonação o contexto da
 * request se comporta como a empresa — não como master.
 */
@Controller("platform/impersonate")
export class ImpersonationController {
  constructor(private readonly svc: ImpersonationService) {}

  @Public()
  @Post("stop")
  @HttpCode(200)
  async stop(@Req() req: FastifyRequest) {
    const env = loadEnv();
    return this.svc.stop(req.cookies?.[env.MASTER_COOKIE_NAME]);
  }

  @Public()
  @Post(":organizationId")
  @HttpCode(200)
  async start(@Req() req: FastifyRequest, @Param("organizationId") organizationId: string) {
    const env = loadEnv();
    return this.svc.start(req.cookies?.[env.MASTER_COOKIE_NAME], organizationId);
  }
}
