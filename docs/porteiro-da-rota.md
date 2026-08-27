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

`apps/api/src/common/modulo.guard.ts` — dois decoradores, uma guarda:

- `@RequireModule("crediario")` — o módulo precisa estar no **plano** da empresa
  e não pode estar escondido pelo **nicho**;
- `@RequireSubmodule("producao.costureiras")` — o master não pode ter desligado.

A conta é a **mesma da tela**: `resolveOrgModules()` através do `ShellLoader` —
plano + aditivos à la carte + deny-list do nicho + sub-módulos. Duas contas
diferentes discordariam no primeiro módulo novo.

Já existia um `assertSubmodule` dentro da Produção, chamado à mão em sete
lugares — e **esquecido justamente nos das costureiras**, que eram os da tela
que acabamos de fechar. Guarda que se aplica por decorador não tem como ser
esquecida no meio de um controller.

**Custo: praticamente zero.** A guarda lê do cache POR EMPRESA que o
`/api/organizations/me` já mantém — dez pessoas na loja compartilham a mesma
resposta. Medido: `/api/customers` (sem guarda) **19 ms**, `/api/credit/accounts`
(com guarda) **20 ms**. A versão anterior, que fazia a própria consulta, custava
3 ms; agora não custa ida nenhuma ao banco.

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


## O plano, cobrado no servidor

O porteiro da tela mandava quem não tem o módulo pra página que **vende** o
módulo. No servidor, nada: `GET /api/credit/accounts` respondia **200** para uma
empresa cujo plano não inclui Crediário. A promessa comercial não tinha porteiro
onde importa.

Medido depois de `@RequireModule`:

```
plano sem restrição:                 credit 200 · quotes 200 · production 200 · hr 200 · surveys 200 · payables 200
plano só com vendas+clientes:        403      · 403        · 403           · 403    · 403        · 403
  {"error":{"code":"FORBIDDEN","message":"Este módulo não faz parte do plano da sua empresa"}}
o que o plano inclui:                customers 200 · products 200

nicho "gráfica" (esconde pedidos_lente):
  /api/optical/orders → 403 {"message":"Este módulo não é do seu ramo"}
  /api/quotes (não escondido) → 200

master puro → 200 · master impersonando a Acme → 403 (vale a regra dela)
```

### Onde a guarda NÃO entra, e por quê

Nem toda API pertence a um módulo só. `/api/customers` serve o PDV, a agenda, o
crediário, o atendimento, os chamados e a produção — desligar a **tela** de
Clientes não pode cegar o PDV. A conferência exige que cada um desses esteja
declarado com **quem mais usa**, o que permite verificar se ainda é verdade:

| situação | quantos | exemplo |
| --- | ---: | --- |
| fechado inteiro | 12 | `crediario` → `/api/credit` |
| fechado em parte | 7 | `agenda` fecha `/api/exams`, `/api/nlu` e `/api/professionals`; `/api/appointments` fica aberto porque monta a agenda dentro do atendimento |
| API compartilhada | 14 | `clientes`, `produtos`, `fornecedores`, `vendas`, `caixa`, `fiscal`… |
| | **33/33** | todo módulo do menu está classificado |

Onde o compartilhamento é **consumo deliberado** do módulo, a guarda entra
mesmo assim: `/api/credit` é usado pelo PDV (crediário como forma de
pagamento), e se o plano não inclui Crediário o PDV também não deve oferecer.

## O que continua aberto, de propósito

- **`/api/payments`** — é o meio de cobrança do PDV, do crediário e da produção.
- **`/api/appointments` e `/api/schedule`** — a agenda também vive dentro do
  atendimento.
- **`/api/inbox`** — a produção usa pra avisar o cliente.
- **`GET /api/inbox/macros`** — alimenta o seletor de macros dentro do
  atendimento; o sub-módulo fecha a tela de administrar e as escritas.

Nenhum deles é vazamento entre empresas: o RLS continua onde estava. São APIs
que mais de um módulo consome, e fechá-las cegaria uma tela contratada.
