import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { CustomerAuthService } from "./customer-auth.service";
import { loadEnv } from "../config";

/**
 * Guard das rotas do portal do cliente. Resolve o cookie de sessao do cliente
 * e anexa req.customer. As rotas tambem sao @Public() pro AuthGuard global
 * deixar passar (a autorizacao real e este guard).
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly auth: CustomerAuthService) {}

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    const req = execCtx.switchToHttp().getRequest<FastifyRequest>();
    const env = loadEnv();
    const token = req.cookies?.[env.CUSTOMER_COOKIE_NAME];
    if (!token) {
      throw new AppError(ErrorCode.Unauthorized, "Faça login no painel", 401);
    }
    const ctx = await this.auth.resolveSession(token);
    if (!ctx) {
      throw new AppError(ErrorCode.Unauthorized, "Sessão expirada", 401);
    }
    req.customer = ctx;
    return true;
  }
}
