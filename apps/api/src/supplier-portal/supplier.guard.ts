import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@yugo/shared";
import { SupplierAuthService } from "./supplier-auth.service";
import { loadEnv } from "../config";

@Injectable()
export class SupplierGuard implements CanActivate {
  constructor(private readonly auth: SupplierAuthService) {}

  async canActivate(execCtx: ExecutionContext): Promise<boolean> {
    const req = execCtx.switchToHttp().getRequest<FastifyRequest>();
    const env = loadEnv();
    const token = req.cookies?.[env.SUPPLIER_COOKIE_NAME];
    if (!token) throw new AppError(ErrorCode.Unauthorized, "Faça login no portal", 401);
    const ctx = await this.auth.resolveSession(token);
    if (!ctx) throw new AppError(ErrorCode.Unauthorized, "Sessão expirada", 401);
    req.supplier = ctx;
    return true;
  }
}
