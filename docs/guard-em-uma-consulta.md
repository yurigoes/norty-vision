# O guard em uma consulta

> O código que roda em toda requisição do sistema — e o que ele custava.

## O que o guard faz

Em **toda** requisição, antes de qualquer handler: lê os cookies, descobre quem
é a pessoa, de qual empresa, com qual papel e quais permissões, e pendura isso
no request. É o caminho mais quente do sistema inteiro.

## O que ele custava

```ts
sessions.findUnique({ include: { activeMembership:
  { include: { role: true, store: true, organization: true } } } })
```

Um `include` do Prisma vira **uma consulta por tabela** — sessão, membership,
papel, loja, empresa — tudo dentro de uma transação (mais `BEGIN`, os GUCs e
`COMMIT`). E não parava aí:

| peça | quando | transações |
| --- | --- | --- |
| sessão do usuário | cookie de sessão | 1 (5 consultas dentro) |
| `last_seen_at` do usuário | a cada 5 min | 1 |
| sessão do master | cookie de master | 1 (2 consultas) |
| `last_seen_at` do master | **toda requisição** | 1 |
| membership representativo | impersonando | 1 |
| `must_reset_password` + empresa impersonada | `/auth/me` | 2 |
| fase do cancelamento | toda escrita | 1 |

## O que passou a ser

Três consultas escritas à mão (`apps/api/src/auth/guard.sql.ts`), cada uma em
uma instrução, pela mesma construção da casca do painel (ver
[`casca-em-uma-consulta.md`](casca-em-uma-consulta.md) — inclusive a trava
`OFFSET 0`, que foi descoberta justamente escrevendo esta):

- **`SESSION_SQL`** — sessão do usuário, sessão do master e o membership da
  empresa impersonada, tudo junto. O `imp` depende de `psess`: só existe se
  houver master impersonando.
- **`SNAPSHOT_SQL`** — as duas leituras extras do `/api/auth/me`.
- **`CANCELLATION_SQL`** — a fase do cancelamento da assinatura, lida em toda
  requisição de escrita.

O contexto é `is_platform_admin = true` do começo ao fim, sem elevação no meio:
era exatamente assim que as leituras já eram feitas
(`runWithContext({ isPlatformAdmin: true })`), porque ninguém consegue ler a
própria sessão antes de a sessão existir.

Duas coisas saíram de graça:

- **`store` e `organization` saíram do `include`.** O guard nunca leu nada
  delas além do id, que já vem no membership. Eram duas consultas por
  requisição para nada.
- **`last_seen_at` do master virou throttled.** O do usuário já era escrito no
  máximo a cada 5 min; o do master era escrito a **cada requisição**, numa
  linha quente. Agora seguem a mesma regra.

## Os números

Postgres 16 e Redis de verdade, API compilada, `log_statement=all`. Cada número
é o **menor de 12–15 medidas**, para descartar o ruído dos jobs de fundo.

Com a sessão **no cache** do Redis (o caso comum):

| requisição | antes | depois |
| --- | ---: | ---: |
| `/api/auth/me` — usuário | 4 idas / 10 ms | **1 ida / 8 ms** |
| `/api/auth/me` — master | 9 idas / 10 ms | **2 idas / 9 ms** |
| `/api/auth/me` — usuário + master | 9 idas / 10 ms | **2 idas / 9 ms** |
| `/api/bootstrap` — usuário | 1 ida / 8 ms | 1 ida / 9 ms |
| `/api/bootstrap` — master | 10 idas / 10 ms | **2 idas / 9 ms** |
| `/api/bootstrap` — usuário + master | 10 idas / 11 ms | **2 idas / 10 ms** |

Com a sessão **fora do cache** (primeira requisição, ou TTL vencido):

| requisição | antes | depois |
| --- | ---: | ---: |
| `/api/auth/me` — usuário | 16 idas / 17 ms | **6 idas / 10 ms** |
| `/api/auth/me` — usuário + master | 21 idas / 14 ms | **6 idas / 9 ms** |
| `/api/bootstrap` — usuário | 13 idas / 16 ms | **6 idas / 10 ms** |
| `/api/bootstrap` — usuário + master | 22 idas / 15 ms | **6 idas / 10 ms** |

Das 6 idas do caso frio, **4 são a escrita do `last_seen_at`** — que aqui era
forçada a cada medida porque limpar o Redis também limpa o contador dos 5
minutos. Em produção, quem já esteve ativo nos últimos 5 min paga 2.

A resposta é **idêntica byte a byte** à de antes nos oito casos medidos:
`/auth/me` e `/bootstrap`, como usuário, como master, com os dois cookies ao
mesmo tempo, e com o master impersonando uma empresa.

## O que continua igual

- **O cache do Redis** (10s) segue absorvendo a rajada de requisições de uma
  tela. Ele só não vale quando há cookie de master: a sessão do master nunca
  foi cacheada, e é ela que decide a impersonação.
- **Sair invalida na hora.** `revoke()` limpa o cache junto.
- **Redis fora do ar não quebra login**: cai no banco, com um aviso no log.

## O que ainda dá pra melhorar

A sessão do **master** não é cacheada — por isso ele paga 2 idas onde o usuário
paga 1. Cachear exige cuidado com a impersonação (trocar de empresa tem que
valer na hora), então ficou de fora por ora.
