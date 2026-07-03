import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";

/**
 * Autenticação da API de licenciamento do Norty: header
 * `Authorization: Bearer <NORTY_LICENSE_TOKEN>` (token estático em env).
 * Nunca aceita chamada sem o token.
 */
@Injectable()
export class NortyLicenseGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const auth = String(req?.headers?.authorization ?? "");
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const expected = (process.env.NORTY_LICENSE_TOKEN ?? "").trim();
    if (!expected || !token || token !== expected) {
      throw new AppError(ErrorCode.Unauthorized, "Token de licença inválido", 401);
    }
    return true;
  }
}
