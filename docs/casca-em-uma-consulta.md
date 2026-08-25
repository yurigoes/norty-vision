# A casca do painel em uma consulta

> Como `/api/bootstrap` saiu de 34 idas ao Postgres para 1 — e por que a ordem
> dentro de uma única instrução SQL não é sorte.

## O que já tinha sido feito

O layout do `/app` é `force-dynamic`: roda inteiro a cada navegação. Ele
buscava sessão, integrações, empresa, atalhos, loja e assinatura em **seis
chamadas HTTP em série**. Isso virou uma só, o `GET /api/bootstrap`, com as
peças resolvidas em paralelo dentro da API (ver `bootstrap-da-casca.md`).

## O que ainda estava caro

Uma chamada HTTP não é uma ida ao banco. Por dentro, aquele endpoint fazia
**onze transações**:

| peça | transações |
| --- | --- |
| `must_reset_password` + empresa impersonada | 2 |
| empresa (`getMine`): empresa, plano, aditivos, nicho, sub-módulos | 5 |
| loja | 1 |
| assinatura | 1 |
| atalhos: empresa + Chatwoot + GLPI | 3 |

Cada transação custa quatro idas ao Postgres — `BEGIN`, os GUCs do RLS, a
consulta, `COMMIT` — e o `include` do Prisma ainda vira uma consulta por
tabela. Medido com `log_statement=all`: **34 idas** para montar uma tela (46
quando a pessoa é admin da empresa e os atalhos entram).

## O que passou a ser

Uma instrução (`apps/api/src/bootstrap/shell.sql.ts`). O que garante a ordem é
a **dependência entre os CTEs**, não o palpite do planejador:

```
ctx        seta os sete GUCs do RLS
 ↓          (LATERAL: avaliado por linha de ctx)
org, org_flags, usr, st, sub, grants, ccs      leem com o contexto do usuário
 ↓          (niche_row depende de org.niche)
tenant     junta tudo numa linha
 ↓
adm        só então eleva para platform admin
 ↓
platform   plano, integrações globais, nome da empresa impersonada
```

O detalhe que faz isso funcionar é o `LATERAL`:

```sql
org AS MATERIALIZED (
  SELECT o.* FROM ctx, LATERAL (
    SELECT ... FROM organizations WHERE id = nullif(ctx.org_id, '')::uuid
  ) o
)
```

O lado `LATERAL` é avaliado **por linha de `ctx`**, então `set_config` já
rodou quando o `organizations` é lido. Um `FROM organizations, ctx` comum não
daria essa garantia: o planejador poderia varrer a tabela antes. No plano real
isso aparece como `Nested Loop` com `CTE Scan on ctx` do lado de fora.

Fora de transação explícita, cada instrução é a sua própria transação — então
`set_config(..., true)` (SET LOCAL) morre junto com ela. Nada vaza para a
próxima requisição que pegar a mesma conexão do pool. Conferido: antes da
consulta o usuário enxerga 0 linhas em `platform_integrations`; depois dela,
0 de novo.

### A elevação no meio da instrução

Três leituras precisam de platform admin — e **já precisavam antes**, com o
código chamando `getByProvider({ isPlatformAdmin: true })` e
`runWithContext({ isPlatformAdmin: true })`:

1. o plano da própria empresa (pode estar inativo, e aí a policy de `plans` o
   esconderia);
2. as duas integrações globais (Chatwoot/GLPI, `organization_id IS NULL`);
3. o nome da empresa que o master está impersonando.

O CTE `adm` faz `set_config('app.is_platform_admin', 'true', true)` e só é
alcançado depois que `tenant` já produziu sua linha. Nada além dessas três
leituras acontece depois dele — e a conferência executável reprova qualquer
tabela nova que apareça ali.

## A rede de segurança

A ordem acima depende de o planejador respeitar a dependência do `LATERAL`. Se
algum dia uma versão do Postgres mudar isso, o sintoma é o RLS barrar tudo: a
consulta volta **vazia** — falha fechada, nunca com dado de outra empresa.

Quando isso acontece com empresa no contexto, o `ShellLoader` refaz a MESMA
instrução por dentro de `runWithContext()` (quatro idas, GUCs setados antes) e
registra um aviso. É o mesmo SQL nos dois modos, então não há um segundo
caminho para divergir.

## Os números

Postgres 16 e Redis de verdade, API compilada, `log_statement=all`, sessão
quente no cache:

| requisição | antes | depois |
| --- | --- | --- |
| `GET /api/bootstrap` (usuário comum) | 34 idas / 30 ms | **1 ida / 16 ms** |
| `GET /api/bootstrap` (admin da empresa) | 46 idas / 30 ms | **1 ida / 17 ms** |
| `GET /api/organizations/me` | 20 idas / 26 ms | **1 ida / 18 ms** |

A resposta é **idêntica byte a byte** à de antes nos quatro casos medidos
(bootstrap e `organizations/me`, como usuário comum e como admin). Inclusive as
datas: o Postgres devolveria `+00:00` e microssegundos, então elas passam por
`to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` para sair no mesmo formato que o
Prisma entregava — mesmo instante e mesmo texto, senão quem compara string de
`updatedAt` quebraria.

Quando a sessão **não** está no cache do Redis, a requisição custa ~11 idas: o
guard de autenticação resolve a sessão pelo Prisma. É o próximo alvo, pelo
mesmo método.

## Uma conta só, em um lugar só

`GET /api/organizations/me` e a casca do painel calculam os mesmos módulos
liberados. Isso estava escrito duas vezes; agora `getMine()` lê do mesmo
`ShellLoader`, e a regra mora em `organizations/org-modules.ts`, aceitando
tanto o formato do Prisma (`Date`) quanto o da consulta única (texto ISO).

## O que confere isso

`pnpm --filter @yugo/api check` (`src/bootstrap/__checks__/shell.check.mts`),
sem banco e sem Prisma Client gerado:

1. cada coluna e apelido do SQL bate com o `schema.prisma` — renomear uma
   coluna no schema e esquecer o SQL reprova;
2. toda tabela com RLS é lida pendurada em `ctx`;
3. a elevação a platform admin acontece uma vez, no `adm`, e depois dela só se
   lê `plans`, `platform_integrations` e `organizations`.
