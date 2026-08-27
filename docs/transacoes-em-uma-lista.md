# Transações: três fontes, uma lista, um total

## O problema

A tela de Transações junta pagamentos do PDV (`sale_payments`), parcelas de
crediário (`credit_installments`) e links da InfinitePay. Isso era feito assim:

```ts
const [sps, insts, ipLinks] = await Promise.all([
  tx.salePayment.findMany({ ..., take: 300 }),
  tx.creditInstallment.findMany({ ..., take: 300 }),
  tx.infinitepayLink.findMany({ ..., take: 300 }),
]);
return [...sps, ...insts, ...ipLinks].sort(por data);
```

Três defeitos de uma vez:

1. **o teto era por fonte, não pela lista.** 300 + 300 + 300 = 900 registros que
   podem ser todos do mesmo mês.
2. **a ordenação era mentira.** Ordenar por data *depois* de cortar cada fonte
   em 300 não dá as transações mais recentes: dá as mais recentes **de cada
   fonte**, misturadas.
3. **não dava pra paginar.** Sem uma ordem única sobre o conjunto, `offset` não
   significa nada.

O defeito 2 não é teórico. Medido, com 400 pagamentos do PDV espalhados nas
últimas semanas e 240 links de um ano atrás:

```
lista de verdade: 640 transações
a antiga montava: 540

invisíveis pra tela antiga: 100
  a mais recente das invisíveis: PDV de 2026-08-14
  a mais VELHA que ela mostrava: InfinitePay (link) de 2025-07-22
  → escondia transação mais NOVA e mostrava mais VELHA
  posição delas na lista real: 301 a 400
```

Cem transações do PDV **de agosto de 2026** não apareciam, enquanto links **de
julho de 2025** apareciam. Para quem estava conferindo o caixa, elas
simplesmente não existiam.

## O conserto

`apps/api/src/payments/transactions.sql.ts`: as três fontes viram um
`UNION ALL` no banco, com as mesmas colunas e um critério de ordem só
(`at DESC, id`). Aí `LIMIT`/`OFFSET` passam a valer e o `count` sobre o mesmo
`UNION` dá o total de verdade.

A consulta segue a mesma trava do resto do sistema — cada leitura entra por
`FROM ctx, LATERAL (...) OFFSET 0`, com canário e checagem por consequência —
e entrou na conferência de SQL junto com a casca e o guard.

Medido depois:

```
total=640  ·  em pedaços de 50: 640, mesma ordem que de uma vez, 0 repetidos
status=paid     total=347
status=pending  total=213
status=failed   total=80
```

O filtro por status também deixou de ser de mentira: ele ia ao pedaço que a
tela tinha baixado; agora vai ao banco, e o total muda junto.

Na tela: "Mostrando 50 de 640 transações", com "carregar mais". Trocar de aba
recomeça em `offset=0`.

## O que ficou de fora

A tabela de impressão continua com o que estiver carregado, não com as 640 —
imprimir tudo exigiria uma rota própria de relatório, que não existe hoje.
