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

### A armadilha, e a trava

O que faz isso funcionar é o `LATERAL` — mas ele sozinho **não basta**:

```sql
org AS MATERIALIZED (
  SELECT o.* FROM ctx, LATERAL (
    SELECT ... FROM organizations WHERE id = nullif(ctx.org_id, '')::uuid
    OFFSET 0            -- <<< sem isto, nada disso vale
  ) o
)
```

São duas condições, juntas:

1. **o corpo do `LATERAL` tem que referenciar `ctx`** — senão não é
   dependência, é cross join;
2. **e terminar em `OFFSET 0`**.

A segunda foi aprendida do jeito difícil. A primeira versão desta consulta não
tinha `OFFSET 0` e funcionava — por sorte. Ao escrever a consulta do guard, com
três tabelas na junção (`sessions ⋈ memberships ⋈ roles`), o planejador
**achatou** o subselect no plano de junção e pôs o `ctx` do lado de DENTRO do
nested loop:

```
->  Nested Loop
      ->  Nested Loop Left Join          <- as tabelas, varridas primeiro
            ->  Index Scan on sessions
            ...
      ->  CTE Scan on ctx                <- o set_config, depois
```

Resultado: RLS barrou tudo, a consulta voltou vazia, e o guard não achou
sessão nenhuma. `OFFSET 0` é a trava de otimização clássica do Postgres:
impede o achatamento, e aí a dependência do `LATERAL` obriga o `ctx` a ser o
lado de fora. Com ela, o plano de todos os CTEs vira:

```
->  Nested Loop
      ->  CTE Scan on ctx                <- primeiro
      ->  Result                          <- a leitura, por linha de ctx
```

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

## As redes de segurança

A ordem acima é estrutural, não sorte — mas é uma afirmação sobre o executor do
Postgres, e o episódio acima mostra que dá pra errar. Então são duas redes, e
elas se cobrem:

1. **O canário.** Um CTE (`prova`) lê `current_setting(...)` pela mesma
   construção das outras leituras. Se os GUCs não valiam, volta `NULL`.
2. **A consequência.** Usuário com empresa no contexto sempre tem empresa; um
   cookie na mão sempre acha uma sessão ou não acha nada por um motivo real. Se
   o resultado não fecha, alguma coisa barrou.

Só o canário não bastaria: no episódio do guard, ele **passou** enquanto a
leitura da tabela já tinha sido varrida antes — porque `prova` roda no CTE
dele, com o plano dele.

Quando qualquer uma das duas acusa, refaz-se a MESMA instrução por dentro de
`runWithContext()` (quatro idas, GUCs setados antes, sem depender de plano
nenhum) e registra-se um aviso. É o mesmo SQL nos dois modos, então não há um
segundo caminho para divergir.

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

O guard de autenticação recebeu o mesmo tratamento — ver
[`guard-em-uma-consulta.md`](guard-em-uma-consulta.md).

## Uma conta só, em um lugar só

`GET /api/organizations/me` e a casca do painel calculam os mesmos módulos
liberados. Isso estava escrito duas vezes; agora `getMine()` lê do mesmo
`ShellLoader`, e a regra mora em `organizations/org-modules.ts`, aceitando
tanto o formato do Prisma (`Date`) quanto o da consulta única (texto ISO).

## O que confere isso

`pnpm --filter @yugo/api check` (`src/__checks__/sql.check.mts`), sem banco e
sem Prisma Client gerado:

1. cada coluna e apelido do SQL bate com o `schema.prisma` — renomear uma
   coluna no schema e esquecer o SQL reprova;
2. **todo `LATERAL` referencia a fonte e termina em `OFFSET 0`** — é a regra
   que teria evitado o episódio acima;
3. nenhuma tabela é lida fora de um `LATERAL` travado;
4. o canário está no `WITH` e no `SELECT` de cada consulta;
5. a elevação a platform admin acontece uma vez, no `adm`, e depois dela só se
   lê `plans`, `platform_integrations` e `organizations`.
