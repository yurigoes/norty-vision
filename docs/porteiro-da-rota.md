# O porteiro: esconder do menu virou barrar a rota

## O problema

Rodando o passo 9 do roteiro manual, o resultado foi meio bom e meio ruim.
Desligar `producao.costureiras` no master tirava a aba **e** o item do menu —
mas isto continuava abrindo:

```
/app/producao/costureiras   →   a tela inteira, funcionando
```

Quem tinha o link salvo seguia usando um sub-módulo que a empresa não
contratou. E abrindo o devtools dava pra ir mais longe: os endpoints das
costureiras não checavam nada.

Não era falha de isolamento — o RLS e as permissões continuavam valendo sobre
os dados, e nenhuma empresa via dado de outra. Era falha de **porteiro**: o
bloqueio existia só no menu.

## O conserto, nos dois lados

### Na tela

`apps/web/lib/acesso.ts` — a MESMA conta que monta o menu decide se a rota
abre. Mesma tabela (`nav.ts`), mesmos quatro filtros:

| filtro | o que acontece |
| --- | --- |
| módulo fora do plano | vai pra `/app/modulos/<key>`, a página que explica e **vende** o módulo |
| nicho não usa | tela explicando, com "voltar ao painel" e "falar com o suporte" |
| sub-módulo desligado | idem, dizendo que quem administra desligou |
| sem a permissão | idem, dizendo onde liberar (Usuários & papéis) |

O caminho vem do header `x-nv-path`, que o middleware já publicava (era o que
mandava quem perdeu a sessão pro login da empresa com `?next=`). O layout do
`/app` lê, decide, e mostra o bloqueio no lugar do conteúdo — antes da página
rodar.

Três coisas que precisavam ser verdade, e são:

- **casa por prefixo, e pelo mais específico.** `/app/crediario/<id>` cai junto
  com o Crediário; `/app/producao/costureiras` casa com o item das costureiras,
  não com o `/app/producao` que vem antes na lista.
- **a casca nunca é barrada.** `/app`, `/app/conta`, `/app/suporte`,
  `/app/perfil/seguranca` e a própria `/app/modulos/<key>` passam mesmo com
  tudo desligado — senão o bloqueio vira armadilha sem saída.
- **o master puro passa direto.** O painel dele é outro. Impersonando, aí sim
  vale o que a empresa contratou.

### Na API

`apps/api/src/common/submodulo.guard.ts` — `@RequireSubmodule("producao.costureiras")`
no controller ou na rota. Aplicado nos sete sub-módulos que a tela sabe
desligar.

Já existia um `assertSubmodule` dentro da Produção, chamado à mão em sete
lugares — e **esquecido justamente nos das costureiras**, que eram os da tela
que acabamos de fechar. Guarda que se aplica por decorador não tem como ser
esquecida no meio de um controller.

Medido depois:

```
LIGADOS                                          DESLIGADOS
/api/production/by-supplier/x/pending   200      403
/api/payables?limit=1                   200      403
/api/prospector/campaigns               200      403
{"error":{"code":"FORBIDDEN","message":"Este recurso está desligado para a sua empresa"}}

o que NÃO foi desligado segue aberto: production, receivables, macros, customers → 200
master puro → 200 · master impersonando a Acme → 403 (vale a regra dela)
```

## Uma decisão que vale explicar

`GET /api/inbox/macros` ficou **de fora** de propósito. Ele alimenta duas
telas: a de administrar macros (que o sub-módulo desliga) e o seletor de macros
**dentro do atendimento**. Guardar o GET fecharia o atendimento junto. Então o
sub-módulo fecha a tela de administrar e as escritas (`POST macros`,
`POST macros/:id/delete`); usar as macros que já existem continua funcionando.

## Custo

A guarda faz uma consulta a mais por requisição guardada (o
`submodule_features` da empresa). Medido, mínimo de 6:

| rota | tempo |
| --- | ---: |
| `/api/customers?limit=1` (sem guarda) | 18 ms |
| `/api/payables?limit=1` (com guarda) | 21 ms |

Três milissegundos. Se um dia incomodar, o caminho é o mesmo do resto: esse
dado já vem no bootstrap e cabe no cache de sessão do Redis.

## As conferências

**`apps/web/lib/__checks__/acesso.check.mts`** — reprova se:
- uma tela do menu com `key`/`subMod`/`perm` não for encontrável pelo porteiro
  (rota nova esquecida no `nav.ts` fica invisível **e** aberta);
- o casamento deixar de ser o mais específico;
- alguma tela de casca puder ser barrada;
- algum dos quatro filtros parar de barrar (ou passar a barrar demais);
- o layout parar de chamar o porteiro, de ler `x-nv-path`, ou de passar a
  MESMA lista do menu;
- o middleware parar de publicar `x-nv-path` — o porteiro fica cego.

**`apps/api/src/__checks__/submodulo.check.mts`** — lê as chaves direto do
`nav.ts` do web e exige que cada uma tenha pelo menos um endpoint com
`@RequireSubmodule`, ou esteja declarada com o motivo de fechar só a tela.
Também confere que a guarda está registrada como `APP_GUARD` (importar sem
registrar transforma os decoradores em enfeite) e que ela deixa o master puro
passar.

Hoje: 44 telas cobertas pelo porteiro, 7 sub-módulos fechados dos dois lados.
Cada regra foi testada quebrando o código de propósito.
