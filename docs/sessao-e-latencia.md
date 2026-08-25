# Sessão e latência

> Por que o sistema deslogava sozinho, o que estava por trás e o que os
> números dizem agora.

## O sintoma

"Ao finalizar pedido o sistema desloga." O `router.refresh()` recarregava o
RSC, `/api/auth/me` demorava demais, o `redirect("/login")` disparava — e a
pessoa perdia o que estava fazendo.

O remendo era o **soft auth**: se a API não responde, o front mantém a sessão
com base no cookie em vez de expulsar. Continua ali, e é a coisa certa a se
fazer — mas ele escondia a causa em vez de resolver.

## A causa

`PrismaService.runWithContext()` é a porta de entrada de toda consulta com RLS.
Ela abria uma transação e mandava os sete GUCs **um por vez**:

```ts
for (const [key, value] of settings) {
  await tx.$executeRawUnsafe(`SELECT set_config($1, $2, true)`, key, value);
}
```

Sete idas e voltas ao Postgres antes de a consulta começar — dentro de uma
transação interativa, que **segura a conexão do pool** o tempo inteiro.

E o guard de autenticação chama `runWithContext` em **toda requisição**, mais
uma escrita de `last_seen_at` em transação separada — a cada clique, numa linha
quente.

Medido num Postgres 16 de verdade, com `log_statement=all`, um único
`GET /api/auth/me`: **33 idas ao banco**.

## O que foi feito

**1. Os sete GUCs numa instrução só.** `set_config` aceita várias chamadas no
mesmo `SELECT`. Cada `runWithContext` caiu de 10 idas para 4. Sem mudança de
comportamento.

**2. `last_seen_at` no máximo a cada 5 minutos.** O valor só serve pra dizer
"esta sessão está viva"; não precisa de uma escrita por clique. Quem decide é
um `SET NX EX` no Redis — uma ida ao Redis no lugar de uma transação no
Postgres.

**3. Cache do contexto da sessão no Redis** (`SessionCacheService`). Quem é, de
qual empresa, qual papel, quais permissões: 10s de TTL, o suficiente pra
absorver a rajada de requisições de uma tela. O `SessionService` já prometia
isso no comentário — "Redis acelera lookups; DB é fonte da verdade" — só que
nunca tinha sido escrito.

**4. O soft auth deixou rastro.** Continua sendo a rede de segurança, mas agora
grava um aviso quando dispara. Antes era silencioso: o sintoma chegava como "me
deslogou do nada", sem nada no log pra confirmar.

## Os números

Postgres 16 local, esquema completo (194 migrations), Redis, API compilada,
`GET /api/auth/me` autenticado, contando as linhas do log do banco:

| Cenário | Idas ao Postgres | Tempo |
| --- | ---: | ---: |
| Antes | 33 | 21 ms |
| Só os GUCs numa instrução | 15 | 14 ms |
| Primeira requisição (cache frio) | 16 | 34 ms |
| **Requisições seguintes (cache quente)** | **4** | **9 ms** |
| Depois do TTL de 10s | 15 | 23 ms |

O caminho quente — o que a pessoa vive depois do primeiro clique — caiu de
**33 idas para 4**.

## O que se paga por isso

- **Trocar uma permissão leva até 10s pra valer.** É o TTL. Ajustável em
  `SESSION_CACHE_TTL_SECONDS`; `0` desliga o cache e tudo volta a bater no
  banco.
- **`last_seen_at` tem até 5 minutos de atraso.** Só afeta a coluna "visto por
  último" da lista de sessões.

**Sair do sistema invalida na hora**, sempre — `revoke()` limpa o cache junto.
Não espera TTL nenhum: quem tem que sair, sai.

**Redis fora do ar não quebra login.** Toda chamada ao cache é best-effort: se
falhar, o guard vai ao banco como antes, e a API registra um aviso (uma vez, pra
não inundar o log).

## Como foi verificado

Tudo contra uma instalação real (Postgres 16 + Redis + API compilada), não em
teoria:

1. sessão autenticada respondendo `authenticated: true` com empresa e papel
   corretos;
2. `/api/bootstrap` (o que o painel usa) respondendo com a árvore completa;
3. **logout**: chave some do Redis e a requisição seguinte já vem
   `authenticated: false`;
4. **Redis derrubado no meio**: a requisição seguinte continua autenticada, com
   o aviso no log da API;
5. as medições da tabela acima, contadas no log do Postgres.

## O que ainda dá pra melhorar

`/api/bootstrap` custa 34 idas ao banco (cinco consultas em paralelo, e o
`include` do Prisma vira uma consulta por tabela). É uma requisição por
navegação, não por clique — mas é o próximo alvo, provavelmente com um
`SELECT` escrito à mão no lugar do `include`.
