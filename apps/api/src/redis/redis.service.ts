import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { loadEnv } from "../config";

/**
 * O CLIENTE DO REDIS, CONFIGURADO PRA FALHAR RÁPIDO
 * ============================================================================
 * O combinado é: se o Redis cair, o sistema segue direto no banco. Medido com
 * o Redis derrubado, o que acontecia era outra coisa:
 *
 *   com Redis de pé:   24ms · 21ms · 37ms
 *   com Redis fora:  7533ms · 15326ms · 22220ms · 24034ms   ← e crescendo
 *
 * Respondia 200, então "continuava funcionando" — em 24 segundos. Ninguém
 * espera 24 segundos; a pessoa recarrega, e a fila cresce.
 *
 * A culpa é do `enableOfflineQueue`, que vem LIGADO por padrão: comando
 * enviado com a conexão caída não falha, entra numa fila esperando a
 * reconexão. Como o `retryStrategy` padrão espera cada vez mais entre as
 * tentativas, cada requisição esperava mais que a anterior.
 *
 * Aqui o cliente é configurado pra dizer "não deu" na hora. Quem chama já
 * trata isso indo ao banco — que é o plano desde sempre.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly client: Redis;
  private readonly logger = new Logger("Redis");
  private avisou = false;

  constructor() {
    const env = loadEnv();
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      // uma tentativa por comando: cache é atalho, não fonte da verdade
      maxRetriesPerRequest: 1,
      // O QUE CONSERTA OS 24 SEGUNDOS: sem fila de espera. Comando enviado com
      // a conexão caída falha na hora, e quem chamou vai ao banco.
      enableOfflineQueue: false,
      // teto duro: conexão pendurada (rede boba, não "caiu") não segura ninguém
      commandTimeout: 250,
      // reconectar continua valendo a pena — mas em segundo plano, sem que
      // requisição nenhuma espere por isso
      retryStrategy: (tentativas) => Math.min(tentativas * 200, 3000),
    });

    // o `error` do ioredis é EventEmitter: sem ouvinte, derruba o processo
    this.client.on("error", (e) => {
      if (this.avisou) return;
      this.avisou = true;
      this.logger.warn(
        `Redis fora do ar — seguindo direto no banco (${e?.message ?? e}). ` +
          "Este aviso sai uma vez por queda.",
      );
    });
    this.client.on("ready", () => {
      if (!this.avisou) return;
      this.avisou = false;
      this.logger.log("Redis de volta — o cache voltou a ser usado.");
    });
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
