# Os seletores que erravam a resposta — e o cadastro no ato

## O problema

Três telas carregavam um pedaço de clientes ou produtos e procuravam **nesse
pedaço**, na memória do navegador:

| tela | seletor | carregava | tem no banco |
| --- | --- | ---: | ---: |
| PDV (Vendas) | clientes | 300 | 3.000 |
| PDV (Vendas) | produtos | 500 | 2.000 |
| Pedidos de lente | clientes | 300 | 3.000 |
| Atendimento (vender pelo chat) | produtos | o que coubesse | 2.000 |

Isso é o mesmo defeito que Clientes e Produtos já tinham, mas nos lugares onde
dói mais: **na frente do cliente**. Atender alguém cadastrado e receber
"nenhum cliente encontrado" era rotina — e o atendente então parava o
atendimento, ia pra tela de Clientes, cadastrava de novo (duplicado) e voltava.

Medido no banco de verdade:

```
PDV, buscando "Sofia"    → o servidor acha 8 · a tela antiga achava 0
PDV, buscando "Flanela"  → 250 resultado(s) · a tela antiga achava 0
Atendimento, "Flanela"   → Mostrando 30 de 250 · a tela antiga achava 0
```

## O conserto

Os quatro seletores usam `useListaServidor`: perguntam ao banco a partir de
duas letras, com a mesma espera de 300 ms e o mesmo aborto da busca anterior do
resto do sistema.

E as duas telas pararam de carregar clientes na abertura — eram 300 de 3.000
baixados só pra alimentar um seletor:

| | antes | agora |
| --- | ---: | ---: |
| PDV: catálogo | 374 kB | 75 kB |
| PDV: clientes | 245 kB | **0** |
| Pedidos de lente: clientes | 245 kB | **0** |

## O cadastro no ato (pedidos de lente)

Quando o cliente **realmente** não existe, a busca não dá mais um beco sem
saída. Ela oferece cadastrar ali mesmo:

```
Nenhum cliente com "Ziraldo Pereira Neto" — procurado em todos,
não só nos que a tela carregou.
+ Cadastrar agora e continuar
```

O formulário pede o mínimo — **nome, CPF/CNPJ e telefone** — e aproveita o que
já foi digitado: quem digitou letras vê o nome preenchido; quem digitou números
vê o CPF (até 11 dígitos) ou o telefone. Salvou, o cliente já fica escolhido no
pedido e **o pedido continua de onde parou**. O resto do cadastro (endereço,
nascimento, e-mail) o cliente completa no portal, ou alguém completa depois em
Clientes — está escrito na própria tela, pra ninguém achar que o cadastro ficou
pela metade por acidente.

Conferido no navegador, ponta a ponta:

```
digitar "Sofia"                → 1 requisição · 8 clientes (a tela antiga: 0)
digitar nome inexistente       → oferece cadastrar
o nome já vem preenchido       → "Ziraldo Pereira Neto"
cadastrar                      → POST /api/customers
                               → fica escolhido no pedido
                               → o formulário do pedido continua aberto
```

## A conferência

As três isenções que a conferência de busca carregava — PDV, atendimento e
pedidos de lente, cada uma com "dívida conhecida" escrita no motivo — foram
apagadas, porque a dívida foi paga. A própria conferência exigiu isso: ela
reprova isenção que não vale mais, e foi ela que apontou as três.
