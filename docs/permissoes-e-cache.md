# Permissões e cache: por que o TTL pôde crescer

> O cache da sessão valia 10 segundos. Agora vale 5 minutos — e a troca de
> permissão passou a valer *na hora*, não "em até um TTL".

## O que segurava o TTL em 10 segundos

O cache guarda o contexto da sessão: quem é, de qual empresa, qual papel, quais
permissões. Nada disso muda sozinho — muda quando um admin mexe. E o cache não
tinha como saber que alguém mexeu.

Sem invalidação, o TTL vira o mecanismo: quanto maior, mais tempo uma permissão
revogada continua valendo. Dez segundos era o preço que dava para pagar — e o
custo era ir ao banco resolver a sessão a cada dez segundos, para sempre, para
cada pessoa logada.

Era o mecanismo errado. Corrigido: o TTL virou o que devia ser desde o começo,
**um limite de segurança**, e quem muda o contexto passou a apagar o cache.

## Apagar sem ter o cookie

O problema prático: quem troca a permissão de alguém — ou edita um **papel** que
trinta pessoas usam — não tem o cookie de ninguém em mãos. Só o id.

Por isso cada hash de sessão entra também em dois conjuntos no Redis:

```
nv:sess:user:<userId>    → todas as sessões daquela pessoa
nv:sess:role:<roleId>    → todas as sessões de quem usa aquele papel
```

Editar o papel "Balcão" apaga a sessão de todos os balconistas de uma vez. É o
mesmo mecanismo do lado do master (`nv:msess:user:<id>`, ver
[`guard-em-uma-consulta.md`](guard-em-uma-consulta.md)).

Os conjuntos são só índices: vivem mais que as chaves que indexam, e apagar um
membro que já expirou é um `DEL` inofensivo.

## O que derruba o cache

| o que mudou | o que é apagado |
| --- | --- |
| permissões de um usuário (override no vínculo) | as sessões dele |
| papel do usuário | as sessões dele |
| vínculo revogado | as sessões dele — **e o vínculo** (ver abaixo) |
| vínculo novo | as sessões dele |
| **permissões de um papel** | as sessões de **todos** que usam o papel |
| papel removido | as sessões de quem usava |
| senha redefinida pelo próprio usuário | as sessões dele |
| logout | a sessão dele |

E há escritas que **não** derrubam nada, porque não mexem no que o guard
guarda: o apelido no inbox, a comissão do vendedor, o vínculo de um usuário
recém-criado. Cada uma dessas está marcada no código com `// cache-ok: <motivo>`
— o motivo fica escrito ali, e a conferência executável aceita a marca.

## Um bug que apareceu no caminho

Testando "revogar o acesso", a pessoa **continuava trabalhando normalmente**.
Não era o cache: com o cache desligado acontecia igual. Duas coisas faltavam, e
faltavam desde sempre:

1. o guard **nunca olhava o status do vínculo** — ele lia `active_membership_id`
   e seguia em frente, revogado ou não;
2. revogar o vínculo **não encerrava as sessões** abertas nele.

Ou seja: tirar o acesso de alguém não tirava nada até o cookie vencer — **30
dias**. Corrigido dos dois lados: a consulta do guard agora só aceita vínculo
`active` (a mesma regra que as policies de RLS já usavam), e `revokeMembership`
encerra as sessões daquele vínculo.

## Quanto isso custa no banco

30 requisições em 30 segundos, uma por segundo, contando quantas vezes o guard
foi ao Postgres resolver a sessão:

| TTL | idas ao banco |
| --- | ---: |
| 10s (antes) | 6 |
| 300s (agora) | 2 |

Numa jornada de trabalho a diferença é essa multiplicada por dezenas de
milhares de requisições. E a resposta é **idêntica byte a byte** com o cache
ligado e desligado — conferido nos oito casos (`/auth/me` e `/bootstrap`, como
usuário, como master, com os dois cookies e com o master impersonando).

## O que confere isso

`pnpm --filter @yugo/api check` roda `src/__checks__/cache.check.mts`: ele varre
a API atrás de escritas em `memberships`, `roles`, `sessions` e
`platform_sessions` e **reprova qualquer método que mexa nisso sem apagar o
cache** — a não ser que a linha traga um `// cache-ok:` com o motivo. Hoje são
28 escritas: 16 apagam, 12 dispensadas com motivo escrito.

É o que impede o problema de voltar por descuido: método novo que troca papel e
esquece de invalidar não passa da conferência.
