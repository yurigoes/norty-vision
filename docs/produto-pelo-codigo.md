# Achar a lente pelo código — e cadastrar sem largar o pedido

No pedido de lente, armação e lente eram dois `<select>` montados sobre a lista
de produtos que a página tinha baixado. Três problemas, todos do mesmo tipo.

## 1. `<select>` não busca

Com centenas de produtos, achar a lente certa era rolar a lista inteira
procurando com o olho. E quem atende não procura pelo nome: procura pelo
**código**, que é o que está impresso na caixa da lente.

O código não aparecia em lugar nenhum da lista.

## 2. O teto silencioso, outra vez

A página chamava `/api/products?activeOnly=true`, que devolve no máximo 500.
Medido na instalação de teste, com 521 produtos:

```
a lista que a tela baixava a cada abertura: 378,5 kB — 500 produtos de 521
```

**21 produtos eram inescolhíveis.** Não apareciam no `<select>`, e não havia
como procurá-los — porque `<select>` não busca. O atendente concluía que o
produto não estava cadastrado.

Este é o mesmo defeito que a busca de clientes tinha, com um agravante: lá o
filtro na memória ao menos existia e devolvia "nenhum resultado". Aqui não há
filtro nenhum, então nem a resposta errada aparecia.

## 3. Não achou, e agora?

Produto que falta trava o pedido. O caminho era sair da tela, ir em Produtos,
cadastrar, e voltar — quando voltava, o pedido tinha se perdido.

## O conserto

`components/SeletorProduto.tsx`, o mesmo desenho do `SeletorCliente` — de
propósito, para quem aprendeu a buscar cliente já saber buscar produto.

Digita-se qualquer pedaço do código, do nome ou da categoria, e a busca vai ao
banco inteiro (`/api/products?q=` já procurava em `sku`, `name` e `category`; o
servidor não precisou mudar). O código aparece primeiro em cada resultado, em
fonte monoespaçada, porque é por ele que se procura.

Quando não acha, oferece **cadastrar ali mesmo** — código, nome, categoria,
preço e custo do laboratório. O que foi digitado na busca já vem preenchido: se
parecia código, vai pro campo de código; se parecia nome, vai pro nome. A
categoria vem pronta ("Lente" ou "Armação", conforme o campo).

Cadastrou, o produto já fica escolhido e preço e custo entram no pedido — sem
sair da tela e sem perder o que já estava preenchido.

## Medido

| | antes | depois |
| --- | ---: | ---: |
| ao abrir a tela | 378,5 kB de produtos | **0 kB** (não baixa lista) |
| uma busca por código | não existia | **0,8 kB** |
| produtos alcançáveis | 500 de 521 | **todos** |

São **464× menos dados** para escolher um produto — e, mais importante, os 21
que sumiam passaram a existir.

Conferido no navegador, com 400 lentes e 120 armações no banco:

- `LT-0037` acha pelo começo do código;
- `0299` acha pelo **meio** do código (o `<select>` jamais acharia);
- escolher preenche preço e custo sozinho;
- cadastrar `LT-TRANSITIONS-9X` no ato: veio escolhido, com preço e custo, sem
  sair de `/app/pedidos-lente`, gravado no banco, e a busca passa a achá-lo.

## A rede

`apps/web/lib/__checks__/busca.check.mts` ganhou uma terceira regra: nenhuma
tela pode montar `<option>` a partir de `products` ou `customers`.

Era o furo que deixou isso passar tanto tempo — a conferência procurava filtro
na memória, e `<select>` não filtra. Cadastro que cresce se escolhe pelo
seletor que pergunta ao servidor. Médico e laboratório seguem em `<select>`:
são dezenas, vêm inteiros, e não crescem sozinhos.

Testada quebrando o código de propósito: com o `<select>` de volta, reprova
nomeando a tela e a lista.
