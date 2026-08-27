# Linhas magras, exports inteiros

Dois consertos pequenos que estavam na mesma lista.

## As linhas gordas

Três listagens mandavam relações inteiras pra mostrar **um número**:

| rota | mandava | a tela mostrava |
| --- | --- | --- |
| `/api/sales` | `include: { items: true }` | "3 item(ns)" |
| `/api/quotes` | `include: { items: true }` | "3 item(ns)" |
| `/api/production` | `include: { items: true, files: true }` | "3 item(ns)" |

Trocado por `_count`. Medido com 3 itens por venda:

```
listagem de 50 vendas agora:      26 kB
os itens dessas 50 vendas pesavam: 50 kB
a resposta antiga seria ~76 kB — 2,9x maior
```

Produção mandava também **todos os anexos** de cada pedido — arte, arquivos do
cliente, comprovantes de pagamento — numa lista que mostra nome, valor e prazo.
O detalhe (`getById`) continua trazendo tudo, que é onde isso é usado.

## Os exports que saíam cortados

O CSV e o PDF de contas a pagar/receber chamavam a listagem e recebiam o teto
dela: 1.000 parcelas. Quem exportava um ano de contas recebia um arquivo
truncado **sem nenhum aviso** — e ia conferir contra o contador com um número
errado.

`todasAsPaginas()` percorre a lista em pedaços até acabar. O teto de 50.000
existe pra que uma empresa enorme não derrube a API; quando ele é alcançado,
`truncado` volta `true` e o arquivo é **obrigado** a dizer isso:

```
;;;;;;;;;;ATENCAO: arquivo cortado em 50000 de 137412 parcelas
```

Truncar acontece. Truncar calado é que não pode.

Medido com 1.500 parcelas no banco (o teto antigo era 1.000):

```
GET /api/payables/export  →  1.500 linhas no arquivo
GET /api/payables?limit=50 →  items 50, total 1500, hasMore true
```

## A conferência

`pagina.check.mts` ganhou duas partes:

- um teste de comportamento do `todasAsPaginas` contra uma fonte que respeita
  `limit`/`offset` como o banco: sem teto traz tudo e não marca truncado; com
  teto para no teto **e avisa**;
- a regra de que `exportCsv` e `reportPdf` das duas telas precisam usá-lo e
  precisam mencionar `truncado` — voltar a chamar a listagem direto reprova.

Consertei também um furo no extrator de corpo de método da conferência: ele
pegava o primeiro `{` depois dos parâmetros, que num método com tipo de retorno
`): Promise<{ buffer: Buffer }> {` é o **do tipo**, não o do corpo. As quatro
regras acima nasceram falhando por causa disso.
