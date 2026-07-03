import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@yugo/shared";
import { RedisService } from "./redis.service";

/**
 * Rate-limit simples baseado em Redis (janela fixa por chave).
 * Usado pra proteger endpoints públicos (vitrine/lead, portal do agendamento).
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Incrementa o contador da chave; retorna true se ainda dentro do limite. */
  async hit(key: string, limit: number, windowSec: number): Promise<boolean> {
    const k = `rl:${key}`;
    try {
      const n = await this.redis.client.incr(k);
      if (n === 1) await this.redis.client.expire(k, windowSec);
      return n <= limit;
    } catch {
      // Redis indisponível: não bloqueia o fluxo (fail-open).
      return true;
    }
  }

  /** Igual ao hit, mas lança 429 quando estoura. */
  async enforce(key: string, limit: number, windowSec: number): Promise<void> {
    const ok = await this.hit(key, limit, windowSec);
    if (!ok) {
      throw new AppError(ErrorCode.ValidationFailed, "Muitas tentativas. Aguarde alguns instantes e tente de novo.", 429);
    }
  }
}
