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

- **`SESSION_SQL`** — sessão do usuário, sessão do master e o vínculo da
  empresa impersonada, tudo junto. O `imp` depende de `psess`: só existe se
  houver master impersonando. Traz também o "precisa trocar a senha" e o nome
  da empresa impersonada — as duas coisas que o `/auth/me` buscava por conta
  própria (ver abaixo).
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
| `/api/auth/me` — usuário | 4 idas / 10 ms | **0 idas / 8 ms** |
| `/api/auth/me` — master | 9 idas / 10 ms | **0 idas / 7 ms** |
| `/api/auth/me` — usuário + master | 9 idas / 10 ms | **0 idas / 8 ms** |
| `/api/bootstrap` — usuário | 1 ida / 8 ms | 1 ida / 9 ms |
| `/api/bootstrap` — master | 10 idas / 10 ms | **1 ida / 8 ms** |
| `/api/bootstrap` — usuário + master | 10 idas / 11 ms | **1 ida / 9 ms** |

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

A resposta é **idêntica byte a byte** nos oito casos medidos (`/auth/me` e
`/bootstrap`, como usuário, como master, com os dois cookies ao mesmo tempo e
com o master impersonando) — tanto comparada com a versão anterior quanto
comparada com o mesmo build rodando de cache **desligado**
(`SESSION_CACHE_TTL_SECONDS=0`). O cache é transparente.

## O `/api/auth/me` parou de ir ao banco

Ele montava o retrato da sessão e, pra isso, buscava duas coisas que o guard
não trazia: "precisa trocar a senha" e o nome da empresa impersonada. Primeiro
eram duas transações; depois viraram uma consulta; agora são **zero**.

As duas passaram a vir na consulta da sessão, que já lê `sessions`,
`memberships`, `roles` e `platform_sessions` — juntar `users` e `organizations`
ali não custa ida nenhuma. E, como a sessão fica no cache do Redis, o
`/auth/me` responde **sem tocar no Postgres**.

De quebra a casca do painel encolheu: os dois CTEs que buscavam as mesmas
coisas saíram do `shell.sql.ts` (14 → 12 CTEs), e o `/bootstrap` também não
precisa mais passar o id da empresa impersonada como parâmetro.

Uma diferença de propósito: **o master não herda mais o "precisa trocar a
senha" de quem ele está emprestando.** Ao impersonar, o contexto vira o de um
usuário da empresa — e o valor lido era o daquele usuário, não o do master. O
front já ignorava (`&& !session.impersonating`), mas o payload mentia.

## O cache da sessão do master

A sessão do usuário já tinha cache no Redis. A do master não — por isso
ele pagava 2 idas onde o usuário pagava 1. Agora tem, e os dois lados são
consultados de forma independente: **com os dois cookies quentes, a requisição
não vai ao banco nenhuma vez**; basta um lado faltar para valer a consulta, que
traz os dois.

A sessão do master é diferente da do usuário em uma coisa: ela **muda por fora**
com muito mais frequência, e às vezes por mão alheia. Por isso o cache dela cai
na hora em cinco situações:

| o que aconteceu | por que não pode esperar o TTL |
| --- | --- |
| master **entra** numa empresa | o painel inteiro muda de dono |
| master **sai** da empresa | volta a ser master; empresa fantasma seria confuso |
| master faz **logout** | quem clicou em "sair" não pode continuar dentro |
| outro owner **inativa** o master | é revogação de acesso |
| outro owner **troca o papel** (owner ⇄ support) | owner enxerga o que support não enxerga |

Os três primeiros têm o cookie em mãos e apagam pelo hash. Os dois últimos
**não têm** — quem revoga só conhece o id do master. Para esses, os hashes das
sessões ficam também num conjunto por master (`nv:msess:user:<id>`), e dá pra
apagar todas de uma vez. O conjunto é só um índice: membro que já expirou vira
um `DEL` inofensivo, e ele mesmo tem prazo de validade.

## O que continua igual

- **Sair invalida na hora**, dos dois lados.
- **Redis fora do ar não quebra login**: cai no banco, com um aviso no log —
  verificado derrubando o Redis com a sessão do master quente.
- **Trocar permissão de usuário** também vale na hora — ver
  [`permissoes-e-cache.md`](permissoes-e-cache.md).

## Um bug que apareceu no caminho

Testando a invalidação por "inativar um master", a chamada devolveu **500**.
Não era o cache: a API aceitava `status: "inactive"`, mas o `CHECK` da tabela
`platform_users` só conhece `active | suspended | disabled`. Ou seja, **inativar
um master nunca funcionou** — e o front ainda pintava o selo "inativo"
comparando com um valor que o banco jamais gravaria. Corrigido de ponta a
ponta: o valor gravado é `disabled`, `"inactive"` continua aceito na entrada
para não quebrar um front antigo, e o selo passou a ser "qualquer coisa que não
seja `active`".
