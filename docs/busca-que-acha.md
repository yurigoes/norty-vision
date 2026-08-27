# A busca que acha o que existe

## O problema

As telas de listagem traziam um pedaço e filtravam esse pedaço na memória do
navegador:

| tela | tem no banco | a tela carregava | onde procurava |
| --- | --- | --- | --- |
| Clientes | 3.000 | 300 (`?limit=300`) | nos 300, com `.includes()` |
| Produtos | 2.000 | 500 (teto fixo da API) | nos 500, com `.includes()` |

Digitar o nome de um cliente que estivesse fora dos 300 devolvia **"Nenhum
cliente."** — que não é uma lista vazia, é uma **resposta errada**. O cliente
existe, está cadastrado, e o sistema diz que não existe.

Medido no banco de verdade, com 3.000 clientes e 2.000 produtos:

```
CLIENTES — buscando "Sofia"
  o servidor acha:                       100
  o filtro na memória achava:              0     <- todas as 100 fora do pedaço
PRODUTOS — buscando "Flanela"
  o servidor acha:                       250
  o filtro na memória achava:              0     <- todas as 250 fora do pedaço
PRODUTOS — buscando o SKU "SKU-01999"
  o servidor acha:  Flanela Prisma 1999
  o filtro na memória: nada
```

E a API **já sabia buscar**: `/api/customers?q=` e `/api/products?q=` procuram
no banco inteiro. O trabalho era ligar uma coisa na outra.

## O conserto

`apps/web/lib/useBuscaServidor.ts` — um hook que:

- **até 2 caracteres**, mostra a lista que a página já trouxe (o repouso da
  tela, sem chamada nenhuma);
- **a partir daí**, pergunta ao servidor, esperando 300 ms depois da última
  tecla — digitar "Sofia" (5 teclas) faz **1** requisição, não 5;
- **aborta a busca anterior** quando chega uma nova, e descarta resposta que
  chegue fora de ordem (um contador por chamada);
- devolve `doServidor`, pra tela poder dizer *de onde* veio o que está
  mostrando — "procurado em todos os clientes" ou "mostrando os 100 que a
  página trouxe".

Do lado da API, duas colunas entraram na busca porque a tela procurava nelas
quando filtrava na memória, e tirá-las seria uma perda silenciosa:

- clientes: `email`
- produtos: `category`

E `/api/products` passou a aceitar `?limit=` como `/api/customers` já aceitava
(teto continua 500).

## O que ficou de fora, de propósito

O filtro de produtos também casava os **centavos** do preço com os dígitos
digitados (`String(p.priceCashCents).includes("9900")`). Isso só funcionava nos
500 carregados, casava por substring de centavos (digitar `99` achava
`R$ 0,99`, `R$ 9,90`, `R$ 99,00` e `R$ 199,00`) e não tem equivalente no
servidor. Saiu. Nome, SKU e categoria vão ao banco.

## Custo

Medido com `log_statement=all`, mínimo de 5:

| chamada | idas ao Postgres | tempo |
| --- | --- | --- |
| `/api/customers?q=Sofia&limit=100` | 4 (BEGIN + GUC + SELECT + COMMIT) | 18 ms |
| `/api/products?q=Flanela&limit=500` | 4 | 20 ms |

O plano é um *seq scan* — o `OR` entre três colunas não usa o índice trigrama
que existe em `name`. A 2.000 linhas isso custa 3,4 ms e não importa; em
dezenas de milhares vai importar, e aí o caminho é um índice de expressão
cobrindo as colunas do `OR`.

## A conferência

`apps/web/lib/__checks__/busca.check.mts` (roda no `npm run check` do web) acha
todo filtro de **texto** feito na memória — um `.filter(` cujo corpo usa
`toLowerCase()` + `includes(` — e exige que a tela ou use o hook, ou esteja
declarada na tabela de isenções **com o motivo escrito**. Também reprova:

- tela que chama o hook e nunca lê `.itens` (a busca vai ao servidor e o
  resultado morre no caminho);
- tela que lê `.itens` mas nunca diz `doServidor` (o usuário não sabe se está
  vendo tudo ou um pedaço);
- isenção que não vale mais (a tela parou de filtrar na memória e a linha
  ficou lá).

Hoje: 2 telas perguntam ao servidor, 6 filtros isentos com motivo. As isenções
que ainda são dívida — PDV, atendimento e pedidos de lente, que filtram
produtos e clientes carregados — estão nomeadas lá, uma a uma.
