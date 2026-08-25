# Paginação no navegador

## O problema

Três telas montavam **todas** as linhas que o servidor mandava, de uma vez:

| tela | o que renderizava |
| --- | --- |
| Crediário | `initialAccounts.map(...)` — todas as contas, mais duas abas iguais |
| Orçamentos | `initial.map(...)` — todos os orçamentos |
| Transações | `shown.map(...)` — tudo, sem corte |

Produtos já cortava em páginas de 50. As outras não.

Medido no navegador (Chromium a 375 px, CPU 4x mais lenta — perto de um celular
mediano), na tela de Crediário com **800 contas** no banco:

| | tudo de uma vez | página de 50 |
| --- | --- | --- |
| linhas montadas | 500 | 50 |
| nós no DOM | 5.222 | 726 |
| recálculo de layout | **67,9 ms** | **5,5 ms** |
| altura da página | 123.960 px (159 telas de celular) | 12.893 px (17 telas) |

Esses 68 ms não são pagos uma vez: são pagos a cada relayout — abrir o teclado,
girar o telefone, um `hover` que muda tamanho. E 159 telas de rolagem não é
lista, é labirinto.

(Repare no "500": a tela pediu 800 contas e o servidor mandou 500. O teto
silencioso continua lá — é o item da paginação de verdade, com total e
"carregar mais".)

## O conserto

`apps/web/components/Paginacao.tsx` — uma peça só, usada agora pelas quatro
telas:

- `usePaginacao(itens, 50)` → `{ pagina, total, paginaAtual, totalPaginas, ... }`
- `<PorPagina p={pag} />` → o seletor 10 / 50 / 100 / Todas
- `<Paginacao p={pag} />` → `‹ Anterior · 2 / 5 · Próxima ›`, que some sozinho
  quando só existe uma página

Produtos, que tinha a sua própria cópia disso solta no meio do arquivo, passou
a usar a peça — para existir **uma** implementação, não quatro.

Detalhes que importam:

- **o relatório impresso de Transações continua com tudo.** Papel não rola:
  quem manda imprimir quer as 240 transações, não as 50 da página. Só a tabela
  da tela pagina.
- **mudar o filtro volta pra página 1.** Estar na página 4 de "Todas" e filtrar
  "Pendentes" mostrava uma página vazia.
- **"Todas" continua disponível**, pra quem quer Ctrl+F na tela inteira.

## Conferido no navegador

Com 800 contas, 180 orçamentos e 240 transações no banco de verdade:

```
CREDIÁRIO    50 linhas por página · 5.222 -> 726 nós · layout 67,9 -> 5,5 ms
ORÇAMENTOS   180 orçamento(s) · mostrando 50 · página 1/4 · "Próxima" leva pra 2/4
             com "Todas": 180 cartões e os controles somem
TRANSAÇÕES   240 transação(ões) · mostrando 50 · página 1/5
             tabela de impressão: 240 linhas (tudo, como tem que ser)
             filtrar "Pendentes" -> 80 transação(ões) · página 1/2
```

## A conferência

`apps/web/lib/__checks__/paginacao.check.mts` (no `npm run check` do web)
reprova:

- tela da lista obrigatória que não usa `usePaginacao`, ou que usa e não mostra
  os controles;
- tela que volta a renderizar a lista inteira (`initialAccounts.map(`,
  `rows.map(`, ...) no lugar da fatia;
- qualquer tela que chame `usePaginacao` e nunca renderize `.pagina`.
