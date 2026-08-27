# Paginação de verdade

## O problema

As oito rotas de listagem respondiam `{ items: [...] }` com um teto fixo no
código — 500 vendas, 500 contas, 1.000 parcelas — e **não diziam que era um
teto**. A tela mostrava 500 e chamava de "500 vendas". Se havia 3.000, as outras
2.500 não existiam pra quem estava olhando.

Medido no banco de verdade (3.000 clientes, 2.000 produtos, 800 contas de
crediário, 400 parcelas a pagar, 220 pedidos de produção):

| tela | resposta antes | itens | resposta agora | itens | total real |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clientes | 245 kB | 300 | 41 kB | 50 | **3.000** |
| Produtos | 374 kB | 500 | 38 kB | 50 | **2.000** |
| Crediário | 343 kB | 500 | 34 kB | 50 | **800** |
| Orçamentos | 88 kB | 180 | 25 kB | 50 | 180 |
| Produção | 244 kB | 220 | 56 kB | 50 | 220 |
| Contas a pagar | 241 kB | 400 | 30 kB | 50 | 400 |
| Contas a receber | 111 kB | 188 | 29 kB | 50 | 188 |
| **soma** | **1.647 kB** | | **252 kB** | | |

**6,5x menos** trafegado na primeira carga — e, pela primeira vez, o número da
direita aparece na tela.

## A forma da resposta

```json
{ "items": [...], "total": 3000, "limit": 50, "offset": 0, "hasMore": true }
```

Montada por `apps/api/src/common/pagina.ts`. O `total` custa uma segunda
consulta (o `count`), na MESMA transação e no mesmo contexto RLS da primeira —
senão seria o total de outra empresa. É esse custo que compra o "mostrando 50 de
3.184".

Medido com `log_statement=all`, mínimo de 5:

| chamada | idas ao Postgres | tempo |
| --- | ---: | ---: |
| `/api/customers?limit=50` | 5 (era 4) | 18 ms |
| `/api/products?limit=50` | 5 (era 4) | 15 ms |
| `/api/payables?...&limit=50` | 6 (era 5) | 14 ms |

Uma ida a mais, e mais **rápido** que antes: 450 linhas a menos pra serializar
compensam com folga o `count`.

## A ordem estável (a parte que quase passou batido)

`offset` só funciona se duas consultas seguidas devolverem as linhas na mesma
ordem. `orderBy: { createdAt: "desc" }` **não garante isso**: os 180 orçamentos
de teste foram criados na mesma transação, têm o mesmo `created_at`, e o
Postgres desempata como quiser. A conferência pegou:

```
/api/quotes    total=180  mesma ordem em pedaços de 50: False
```

A página 2 repetia linhas da 1 e pulava outras. O conserto está dentro do
`paginar()`: toda consulta paginada ganha `id` como último critério de ordem —
é único, então não sobra empate pra ninguém desempatar. Depois:

```
/api/customers total=3000 mesma ordem: True   repetidos: 0
/api/products  total=2000 mesma ordem: True   repetidos: 0
/api/credit/accounts total=800 mesma ordem: True   repetidos: 0
/api/quotes    total= 180 mesma ordem: True   repetidos: 0
```

## Compatibilidade

Quem **não** pede `?limit=` recebe o mesmo pedaço de antes, na mesma ordem
(o `padrao` de cada rota é o teto antigo). Só ganha os campos novos. Nenhuma
tela quebrou por causa disto — o PDV, que carrega o catálogo inteiro pro
seletor, continua carregando.

## Do lado da tela

`apps/web/lib/useListaServidor.ts` é um hook só, que substituiu o
`useBuscaServidor`:

- mostra o primeiro pedaço (que a página trouxe do servidor);
- **carrega mais** emenda o próximo, sem repetir o que já está na tela;
- **busca** a partir de 2 letras troca a lista pelo resultado, e o "carregar
  mais" passa a paginar dentro da busca;
- `autoCarregar` pra telas que carregam no navegador (Contas a pagar/receber):
  busca a primeira página sozinha e recomeça quando a aba de filtro muda.

`components/CarregarMais.tsx` mostra "Mostrando 50 de 3.000 cliente(s)" e o
botão. Nas telas que também cortam em páginas de 50 (Produtos, Crediário,
Orçamentos), `useIrParaONovo` pula pro pedaço que acabou de chegar — senão
clicar em "carregar mais" parecia não fazer nada, porque os 50 novos entravam na
página 2 enquanto o usuário olhava a 1.

Conferido no navegador, nas oito telas:

```
CLIENTES    50 -> 100 linhas · /api/customers?limit=50&offset=50 · "Mostrando 100 de 3.000 cliente(s)"
PRODUTOS    página 1/1 "Armacao Quartzo 1008" -> página 2/2 "Armacao Solar 1016"
CREDIÁRIO   página 1/1 "Ana Crediario 104"    -> página 2/2 "Ana Crediario 472"
ORÇAMENTOS  página 1/1 "Contato 54"           -> página 2/2 "Contato 153"
A PAGAR     50 -> 100 linhas · trocar de aba recomeça em offset=0
A RECEBER   50 -> 100 linhas · "Mostrando 100 de 188 parcela(s)"
PRODUÇÃO    50 -> 100 pedidos carregados
VENDAS      o modal de notas/devolução começa com 50 e pede o resto
```

## Duas coisas que mudaram de significado

- **Contas a pagar/receber**: a linha "Total (aba): R$ ..." somava as parcelas
  carregadas. Com a lista paginada isso deixou de ser o total do filtro, então
  virou **"Soma na tela"**. O total de verdade continua nos cartões de resumo,
  que vêm do `/summary` do servidor.
- **A busca nas parcelas** ia ao banco buscar 1.000 e filtrava as 1.000 na
  memória do servidor — mesmo defeito das telas, do outro lado. Agora o filtro é
  do banco (fornecedor, descrição, número do documento).

## A conferência

`apps/api/src/__checks__/pagina.check.mts` (no `npm run check` da API) reprova:

- rota da lista que parou de usar `paginar()`;
- `take:` solto no método de listagem — é o teto silencioso voltando;
- controller que não aceita `?limit=`/`?offset=`;
- `paginar()` sem o desempate por `id` (ou com ele definido e não aplicado).

Do lado do web, `busca.check.mts` passou a exigir que toda tela que usa
`useListaServidor` mostre o `<CarregarMais>` — sem isso o usuário continua sem
saber que existe mais do que está vendo, que era exatamente o problema.

## O que ficou de fora

- **Transações** (`/api/payments/transactions`) junta três fontes em memória
  antes de responder; paginar isso exige unir as três no banco. Ela pagina no
  navegador (o item anterior) e continua com teto de 300 por fonte.
- **CSV e PDF** de contas a pagar/receber continuam com o teto de 1.000 que já
  tinham — não regrediram, mas também não ganharam paginação.
- O `count` roda em toda listagem. Em tabelas de milhões de linhas ele fica
  caro, e o caminho é `hasMore` por "pedir um a mais" e total aproximado.
