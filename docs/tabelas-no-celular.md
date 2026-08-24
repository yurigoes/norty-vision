# Tabelas no celular

> Por que arrastar a tabela pro lado não era resposta, e como as 34 telas com
> tabela passaram a caber no telefone.

## O que acontecia

Toda tabela do painel vivia dentro de um `overflow-x-auto`. No telefone, ler a
última coluna significava arrastar pro lado — e, ao chegar lá, a primeira
coluna (o nome, quase sempre) já tinha saído da tela. A pessoa ia e voltava
para cruzar duas informações da mesma linha.

## O que acontece agora

Abaixo de **768px** cada linha vira um cartão empilhado: o nome da coluna à
esquerda, o valor à direita, tudo visível de uma vez. De 768px pra cima nada
muda — a tabela continua tabela.

**Na impressão a tabela continua tabela**, mesmo em papel estreito: a regra é
`@media screen and (max-width: 767px)`, não só `max-width`.

## Como, sem reescrever 34 telas

O CSS (`.table-cards`, em `globals.css`) precisa do nome da coluna em cada
célula, via `data-label`. Escrever isso à mão seriam centenas de células em 34
arquivos — e ainda daria errado nas tabelas com célula condicional, onde a
posição real da coluna só existe em tempo de execução.

Então quem escreve é o `components/TableCards.tsx`, montado uma vez no layout
do painel: lê o `<thead>` e copia o rótulo para o `data-label` de cada `<td>`,
usando o `cellIndex` do próprio DOM — que já sabe a coluna certa. Um
`MutationObserver` refaz o trabalho quando as linhas mudam (filtro, paginação,
recarga); ele observa só `childList`, e escrever atributo não dispara o
observador, então não há laço.

Nas telas, a mudança foi **uma classe por tabela**:

```diff
- <table className="w-full text-sm">
+ <table className="w-full text-sm table-cards">
```

Célula que atravessa colunas (`colSpan`, "nenhum resultado", linha de total)
fica sem rótulo e ocupa a linha inteira do cartão.

O contêiner que existia só pra rolar a tabela é neutralizado no celular com
`:has()` — senão o cartão ficaria dentro de uma caixa, com borda dupla.

É melhoria progressiva: sem JS, a tabela segue tabela e rola como antes.

## O que ficou de fora, e por quê

| Tela | Motivo |
| --- | --- |
| `agenda/relatorio` | folha de relatório impresso — na tela também é "papel" |
| `caixa/relatorio` | idem |
| `/c/pedidos` (portal do cliente) | não é tabela de dados: é uma grade de **campos** para digitar nome e tamanho por jogador. Em cartão, perderia o alinhamento que faz a digitação funcionar |

## Conferência

```bash
node --experimental-strip-types apps/web/lib/__checks__/tableCards.check.mts
```

Falha se alguma tabela do painel ficar sem a classe. As exceções estão
declaradas no próprio arquivo, com o motivo — pra serem decisão, não
esquecimento.
