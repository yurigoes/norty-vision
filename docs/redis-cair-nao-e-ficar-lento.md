# Redis cair não pode ser "ficar lento pra sempre"

O combinado sempre foi: o Redis é atalho, não fonte da verdade. Se cair, o
sistema segue direto no banco. E seguia — o passo 13 do roteiro manual conferia
isso a cada rodada, e passava: com o Redis derrubado, as requisições voltavam
**200**.

Só que o passo 13 conferia o **código** da resposta. Nunca o **tempo**.

## O que apareceu quando cronometrei

```
com Redis de pé:     24 ms ·    21 ms ·    37 ms
com Redis fora:   7.533 ms · 15.326 ms · 22.220 ms · 24.034 ms
```

Crescendo. Não é lentidão constante — é uma espera que aumenta a cada
requisição. "Continua funcionando" na teoria, inutilizável na prática: ninguém
espera 24 segundos, a pessoa recarrega, e a fila cresce.

## Por que

O `enableOfflineQueue` do ioredis vem **ligado por padrão**. Comando enviado com
a conexão caída não falha: entra numa fila esperando a reconexão. E o
`retryStrategy` padrão espera cada vez mais entre as tentativas. Somando os
dois, cada requisição esperava mais que a anterior — por um cache, que por
definição podia ter sido pulado.

## O conserto

```ts
new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,        // cache é atalho, não fonte da verdade
  enableOfflineQueue: false,      // ← o que conserta os 24 segundos
  commandTimeout: 250,            // conexão pendurada não segura ninguém
  retryStrategy: (n) => Math.min(n * 200, 3000),
});
```

Reconectar continua valendo a pena — mas em segundo plano, sem que requisição
nenhuma espere por isso. E o aviso no log sai **uma vez por queda**, não uma
por requisição, com um segundo aviso quando volta.

Todo lugar que fala com o Redis foi auditado: com o cliente falhando rápido, um
`redis.client.get()` solto passa a **estourar**, então cada um precisa tratar —
indo ao banco, que era o plano desde sempre.

## Depois

```
com Redis de pé:  15 ms · 10 ms · 12 ms
com Redis fora:   18 ms · 13 ms · 13 ms · 13 ms · 15 ms · 15 ms
```

**24.034 ms → 18 ms.** A tela de clientes abriu em 2,1 s com o Redis no chão.

## A exceção: o cofre falha FECHADO

Em todo lugar "não consegui falar com o Redis" significa "vai ao banco". No
cofre significa o contrário: **continua trancado**.

```ts
async isUnlocked(platformUserId: string): Promise<boolean> {
  try { return (await this.redis.client.get(this.redisKey(platformUserId))) === "1"; }
  catch { return false; }   // não deu pra saber = TRANCADO
}
```

O destrave mora no Redis. Sem conseguir gravar, dizer "destravei" seria mentira
— o próximo `isUnlocked` daria falso de qualquer jeito. Então `unlock` devolve
**503** em vez de fingir.

Medido com o Redis derrubado: `status` responde `unlocked=false`; destravar com
a senha **certa** devolve 503 em 45 ms; e quando o Redis volta, tudo normal.
Falhar aberto aqui entregaria senha de integração toda vez que o cache piscasse.

## A rede

`apps/api/src/__checks__/redis.check.mts`, no `npm run check`. Reprova se o
`enableOfflineQueue` voltar, se o `commandTimeout` sumir, se as retentativas por
comando aumentarem, se o ouvinte de `error` sair (no ioredis isso derruba o
processo), se algum uso do cliente ficar sem tratamento, ou se o cofre passar a
falhar aberto. As seis regras foram testadas quebrando o código de propósito.

E o passo 13 do roteiro agora tem cronômetro: teto de 1.500 ms com o Redis fora,
mais uma regra contra a espera crescer a cada requisição — que é o formato
exato do defeito que passou despercebido duas rodadas.
