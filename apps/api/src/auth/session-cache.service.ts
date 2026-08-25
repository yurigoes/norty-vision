import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

/**
 * CACHE DA SESSÃO RESOLVIDA
 * ============================================================================
 * O guard resolve a sessão em TODA requisição: quem é, de qual empresa, qual
 * papel, quais permissões. Isso custava uma transação no Postgres com quatro
 * consultas (o `include` do Prisma vira uma consulta por tabela) — e o front
 * dispara várias requisições por tela. Quando o banco engasgava, o
 * `/api/auth/me` estourava o tempo limite e o usuário era deslogado no meio do
 * trabalho ("ao finalizar pedido o sistema desloga").
 *
 * O docblock do `SessionService` já prometia este cache ("Redis acelera
 * lookups; DB é fonte da verdade") — só que ele nunca existiu. Aqui está.
 *
 * DECISÕES:
 *
 * - **TTL curto** (10s por padrão, `SESSION_CACHE_TTL_SECONDS`). O que se
 *   ganha é absorver a rajada de requisições de UMA tela; o que se paga é uma
 *   troca de permissão levar até 10s pra valer. Com `0`, o cache desliga e
 *   tudo volta a bater no banco.
 * - **Redis fora do ar não quebra login.** Toda chamada aqui é best-effort:
 *   falhou, o guard segue pro banco como antes.
 * - **Logout invalida na hora** — quem some do sistema tem que sumir mesmo,
 *   sem esperar TTL.
 */
@Injectable()
export class SessionCacheService {
  private readonly log = new Logger("SessionCache");
  /** avisa uma vez só quando o Redis cai, pra não inundar o log */
  private avisou = false;

  constructor(private readonly redis: RedisService) {}

  private get ttl(): number {
    const raw = Number(process.env.SESSION_CACHE_TTL_SECONDS ?? 10);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 10;
  }

  private key(tokenHash: string): string {
    return `nv:sess:${tokenHash}`;
  }

  /** Contexto guardado, ou null (sem cache, expirado, ou Redis fora). */
  async get<T>(tokenHash: string): Promise<T | null> {
    if (this.ttl === 0) return null;
    try {
      const raw = await this.redis.client.get(this.key(tokenHash));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
      this.aviso(e);
      return null;
    }
  }

  async set(tokenHash: string, value: unknown): Promise<void> {
    if (this.ttl === 0) return;
    try {
      await this.redis.client.set(this.key(tokenHash), JSON.stringify(value), "EX", this.ttl);
    } catch (e) {
      this.aviso(e);
    }
  }

  /** Logout / revogação: some do cache imediatamente. */
  async drop(tokenHash: string): Promise<void> {
    try {
      await this.redis.client.del(this.key(tokenHash), this.seenKey(tokenHash));
    } catch (e) {
      this.aviso(e);
    }
  }

  private seenKey(tokenHash: string): string {
    return `nv:seen:${tokenHash}`;
  }

  /**
   * `last_seen_at` valia uma ESCRITA no Postgres a cada requisição — linha
   * quente, WAL e tupla morta por clique. O dado só serve pra dizer "esta
   * sessão está ativa", então uma vez a cada poucos minutos basta.
   *
   * `SET NX EX` decide isso numa ida ao Redis: se a chave foi criada, é hora
   * de escrever; se já existia, pula. Redis fora do ar → deixa escrever
   * (comportamento antigo).
   */
  async deveMarcarAtividade(tokenHash: string, janelaSegundos = 300): Promise<boolean> {
    try {
      const r = await this.redis.client.set(this.seenKey(tokenHash), "1", "EX", janelaSegundos, "NX");
      return r === "OK";
    } catch (e) {
      this.aviso(e);
      return true;
    }
  }

  private aviso(e: unknown) {
    if (this.avisou) return;
    this.avisou = true;
    this.log.warn(
      `Redis indisponível — seguindo direto no banco (auth continua funcionando): ${String(e)}`,
    );
  }
}
