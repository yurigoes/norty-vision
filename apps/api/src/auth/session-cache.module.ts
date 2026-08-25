import { Global, Module } from "@nestjs/common";
import { SessionCacheService } from "./session-cache.service";
import { RedisModule } from "../redis/redis.module";

/**
 * O cache de sessão e de empresa é usado por quem MUDA as coisas — e quem muda
 * está espalhado: usuários, papéis, planos, nichos, módulos, assinaturas,
 * faturas, inbox, kiosk, licença. Global evita pendurar `AuthModule` em uma
 * dúzia de módulos que não têm nada a ver com autenticação.
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
