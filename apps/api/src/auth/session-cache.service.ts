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
 * - **TTL de 5 minutos** (`SESSION_CACHE_TTL_SECONDS`, padrão 300). Começou em
 *   10s porque o TTL era a ÚNICA coisa que segurava uma troca de permissão:
 *   sem invalidação, cache longo = permissão velha valendo. Hoje toda mudança
 *   que mexe no contexto derruba o cache na hora (ver os índices abaixo), e o
 *   TTL virou o que devia ser desde o início: um limite de segurança, não o
 *   mecanismo. Com `0`, o cache desliga e tudo volta a bater no banco.
 * - **Índices para apagar sem ter o cookie.** Quem troca a permissão de um
 *   usuário, ou edita um PAPEL que dezenas de pessoas usam, não tem o token de
 *   ninguém em mãos — só o id. Por isso cada hash entra também em dois
 *   conjuntos: `nv:sess:user:<id>` e `nv:sess:role:<id>`. Editar o papel
 *   "vendedor" apaga a sessão de todos os vendedores de uma vez.
 * - **Redis fora do ar não quebra login.** Toda chamada aqui é best-effort:
 *   falhou, o guard segue pro banco como antes.
 * - **Logout invalida na hora** — quem some do sistema tem que sumir mesmo,
 *   sem esperar TTL.
 *
 * A sessão do MASTER tem o seu próprio par de métodos. Ela não é igual à do
 * usuário: além de logout, ela muda quando o master entra ou sai de uma
 * empresa (impersonação), e pode ser derrubada por OUTRO master (inativar,
 * resetar senha, trocar o papel) — que não tem o cookie em mãos, só o id.
 * Por isso os hashes ficam também num conjunto por master, e dá pra apagar
 * todas as sessões de alguém de uma vez.
 */
@Injectable()
export class SessionCacheService {
  private readonly log = new Logger("SessionCache");
  /** avisa uma vez só quando o Redis cai, pra não inundar o log */
  private avisou = false;

  constructor(private readonly redis: RedisService) {}

  private get ttl(): number {
    const raw = Number(process.env.SESSION_CACHE_TTL_SECONDS ?? 300);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 300;
  }

  /** Prazo dos conjuntos-índice: sobrevivem às chaves que indexam. */
  private get ttlIndice(): number {
    return Math.max(this.ttl * 2, 600);
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

  /**
   * Guarda o contexto e indexa o hash por usuário e por papel — é o que
   * permite apagar depois sem ter o cookie em mãos.
   */
  async set(
    tokenHash: string,
    value: unknown,
    indices?: { userId?: string | null; roleId?: string | null },
  ): Promise<void> {
    if (this.ttl === 0) return;
    try {
      const m = this.redis.client.multi();
      m.set(this.key(tokenHash), JSON.stringify(value), "EX", this.ttl);
      if (indices?.userId) {
        m.sadd(this.userKey(indices.userId), tokenHash).expire(this.userKey(indices.userId), this.ttlIndice);
      }
      if (indices?.roleId) {
        m.sadd(this.roleKey(indices.roleId), tokenHash).expire(this.roleKey(indices.roleId), this.ttlIndice);
      }
      await m.exec();
    } catch (e) {
      this.aviso(e);
    }
  }

  private userKey(userId: string): string {
    return `nv:sess:user:${userId}`;
  }

  private roleKey(roleId: string): string {
    return `nv:sess:role:${roleId}`;
  }

  /**
   * Apaga as sessões em cache de um usuário. Chamada quando muda o que o cache
   * guarda: papel, permissões, membership revogado, senha redefinida.
   */
  async dropByUser(userId: string): Promise<void> {
    await this.apagaConjunto(this.userKey(userId));
  }

  /**
   * Apaga as sessões em cache de TODO MUNDO que usa um papel. Editar as
   * permissões de "vendedor" muda o que dezenas de pessoas podem fazer — e
   * nenhuma delas está clicando no botão.
   */
  async dropByRole(roleId: string): Promise<void> {
    await this.apagaConjunto(this.roleKey(roleId));
  }

  private async apagaConjunto(conjunto: string): Promise<void> {
    try {
      const hashes = await this.redis.client.smembers(conjunto);
      const chaves = hashes.flatMap((h) => [this.key(h), this.seenKey(h)]);
      if (chaves.length) await this.redis.client.del(...chaves);
      await this.redis.client.del(conjunto);
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

  // ------------------------------------------------------------- master ----

  private masterKey(tokenHash: string): string {
    return `nv:msess:${tokenHash}`;
  }

  /** Conjunto com os hashes das sessões de um master, pra apagar todas. */
  private masterUserKey(platformUserId: string): string {
    return `nv:msess:user:${platformUserId}`;
  }

  async getMaster<T>(tokenHash: string): Promise<T | null> {
    if (this.ttl === 0) return null;
    try {
      const raw = await this.redis.client.get(this.masterKey(tokenHash));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
      this.aviso(e);
      return null;
    }
  }

  async setMaster(tokenHash: string, platformUserId: string, value: unknown): Promise<void> {
    if (this.ttl === 0) return;
    try {
      const conjunto = this.masterUserKey(platformUserId);
      await this.redis.client
        .multi()
        .set(this.masterKey(tokenHash), JSON.stringify(value), "EX", this.ttl)
        .sadd(conjunto, tokenHash)
        // o conjunto vive mais que as chaves: é só um índice, e membro que já
        // expirou vira DEL inofensivo
        .expire(conjunto, this.ttlIndice)
        .exec();
    } catch (e) {
      this.aviso(e);
    }
  }

  /** Logout do master, ou entrada/saída de empresa: some do cache na hora. */
  async dropMaster(tokenHash: string): Promise<void> {
    try {
      await this.redis.client.del(this.masterKey(tokenHash), this.seenKey(tokenHash));
    } catch (e) {
      this.aviso(e);
    }
  }

  /**
   * Derruba TODAS as sessões em cache de um master.
   *
   * É o caso em que quem revoga não tem o cookie: inativar um master, resetar
   * a senha dele, trocar o papel. Sem isto, a sessão dele continuaria de pé
   * até o TTL — dez segundos que numa ação dessas não deveriam existir.
   */
  async dropMasterByUser(platformUserId: string): Promise<void> {
    try {
      const conjunto = this.masterUserKey(platformUserId);
      const hashes = await this.redis.client.smembers(conjunto);
      const chaves = hashes.flatMap((h) => [this.masterKey(h), this.seenKey(h)]);
      if (chaves.length) await this.redis.client.del(...chaves);
      await this.redis.client.del(conjunto);
    } catch (e) {
      this.aviso(e);
    }
  }

  /** Nomes dos conjuntos-índice, pra quem precisa inspecionar em produção. */
  static readonly INDICES = {
    usuario: "nv:sess:user:<userId>",
    papel: "nv:sess:role:<roleId>",
    master: "nv:msess:user:<platformUserId>",
  } as const;

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
