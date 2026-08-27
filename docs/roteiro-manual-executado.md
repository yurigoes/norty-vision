# O roteiro manual, executado

Os 18 passos do roteiro do PR #1, rodados contra uma instalação real (Postgres
16 + Redis + a API compilada + o Next compilado), com duas empresas, um master,
um dono e duas balconistas no mesmo papel.

## Resultado

| # | passo | resultado |
| --- | --- | --- |
| 1 | hub `/e/<slug>`, entrar e sair | ✅ os quatro portais aparecem; Sair volta pra `/e/acme/login` |
| 2 | sessão expirada devolve onde estava | ✅ cai na porta **da empresa** com `?next=/app/agenda` e volta pra agenda |
| 3 | `/login` vai pra empresa, `?global=1` abre o master | ✅ com memória de empresa vai pra `/e/acme/login`; sem ela, `/login` é a porta do master (correto) |
| 4 | celular: gaveta e favorito | ✅ abre, escolhe, fecha sozinha, Esc fecha, a estrela fixa no toque |
| 5 | Ctrl+K com perfil restrito | ✅ dono 55 telas, Balcão 21; 8 buscas por módulos escondidos, **zero vazamentos**; as estrelas também só cobrem o menu dela |
| 6 | fixar numa aba, a outra atualiza | ✅ sem recarregar |
| 7 | esqueleto sim, overlay não | ✅ com CPU 6× mais lenta: esqueleto apareceu, "Processando…" não acendeu |
| 8 | celular: filtro mantém o rótulo do cartão | ✅ mesmo rótulo antes e depois |
| 9 | master desliga sub-módulo | ✅ aba e menu somem — e desde `38d39bc` a **rota também é barrada**, com a API em 403 |
| 10 | trocar permissão de UMA pessoa | ✅ vale no clique seguinte (403 → 200), e só pra ela |
| 11 | editar o PAPEL | ✅ as duas balconistas mudaram juntas |
| 12 | revogar acesso de quem está logado | ✅ a sessão morreu na hora (401); a colega seguiu em 200 |
| 13 | Redis fora do ar | ✅ agora **com cronômetro**: 18 ms na pior espera (eram 24 s) — ver abaixo |
| 14 | imprimir os dois relatórios | ✅ depois do conserto do menu no papel |
| 15 | impersonar e voltar | ✅ banner "Acme Óticas (modo master)", dados dela, e `stop` devolve o master puro — que **volta a não ver cliente nenhum** |
| 16 | os dois cookies ao mesmo tempo | ✅ o guard reconhece o master e descarta o contexto da empresa |
| 17 | inativar um master | ✅ HTTP 200 (era 500) com `inactive` e com `disabled`; a sessão dele morre na hora |
| 18 | marcadores no log | ✅ zero marcador e **zero 5xx** numa varredura de 278 rotas (eram 12 respostas 500) |

## O defeito que o roteiro achou (passo 14)

Imprimir `/app/agenda/relatorio` ou `/app/caixa/relatorio` levava **o menu
inteiro para o papel**: 240px de navegação na margem esquerda, em toda folha.
As duas telas cuidam da própria impressão (`@page { margin: 0 }`, esconder a
barra de ações), mas nenhuma delas podia esconder a casca — ela é do
`AppShell`, e o `AppShell` não tinha regra de impressão nenhuma.

Consertado no `AppShell`: `print:hidden` na gaveta, na barra superior do
celular e no fundo escuro. Conferido depois: a sidebar mede **0px** em
`media: print` nas duas folhas, e as tabelas continuam tabelas (não viram
cartão no papel).

## Duas ressalvas honestas

**~~O passo 9 é cosmético.~~** *(consertado — ver `docs/porteiro-da-rota.md`.)*
Desligar `producao.costureiras` tirava a aba e o item do menu, mas
`/app/producao/costureiras` continuava abrindo pela URL. Hoje a rota é barrada
e a API responde 403 nos endpoints do sub-módulo.

**O passo 18 não pode ser feito aqui.** Ele pede para observar o log de
produção por um dia. O que dá pra afirmar: em **844 requisições** deste run,
zero ocorrências de "não convence" e zero de "os GUCs do RLS não valiam" — e
zero respostas 5xx.

Mas "zero" só significa alguma coisa se a linha de log funcionar. Então forcei:
troquei a condição de saída do `ShellLoader` para sempre cair na rede de
segurança, recompilei e chamei `/api/bootstrap`. O aviso saiu:

```
WARN [Shell] a consulta única da casca não convence (canário=true, empresa=true)
— refazendo dentro de transação. Se isto se repetir, confira o plano: cada
LATERAL precisa referenciar `ctx` e terminar em OFFSET 0.
```

E a resposta continuou certa (`organization: Acme Óticas`, autenticado) — a
rede assumiu sem o usuário perceber, que é exatamente o combinado. O
forçamento foi revertido e recompilado.

## Segunda passada (depois do porteiro)

O roteiro foi rodado de novo depois do conserto do passo 9, pra ver se o
porteiro tinha quebrado alguma coisa. Não quebrou: os 18 passaram de novo, com
os mesmos números (dono 55 telas, Balcão 21, zero vazamentos na busca, as duas
balconistas mudando juntas, a sessão revogada morrendo na hora).

E achou **outro defeito**, este dos bons.

### O 5xx que apareceu no passo 18

O passo 18 é justamente "olhe o log atrás de coisa estranha". Apareceu uma:

```
500 GET /api/credit/accounts/uma-conta-qualquer
```

Um `:id` que não é uuid fazia o Prisma estourar, e o filtro global devolvia
**500 com isto no corpo da resposta**:

```json
{"error":{"code":"INTERNAL_ERROR","message":"\nInvalid `tx.creditAccount.findFirst()`
invocation in\n/home/user/norty-vision/apps/api/dist/credit/credit.service.js:79:94..."}}
```

Caminho do arquivo, nome do método e trecho da consulta, para qualquer um que
digitasse um id torto na URL. A causa era uma linha no filtro global:

```ts
} else if (exception instanceof Error) {
  message = exception.message;   // ← a intimidade do servidor, no navegador
}
```

Consertado nas duas pontas:

- **id mal formado é pedido malfeito**: 500 → **400 "Identificador inválido"**.
  Um uuid válido que não existe continua 404.
- **erro inesperado nunca repassa a própria mensagem**: o cliente recebe "Erro
  interno", e o erro inteiro vai pro log — inclusive quando fomos NÓS que
  traduzimos ele pra 4xx. Esconder do cliente não é esconder de você.

Conferido em quatro rotas (`credit/accounts`, `customers`, `products`,
`quotes`): 400 limpo no cliente, `PrismaClientKnownRequestError` completo no
log.

`apps/api/src/__checks__/vazamento.check.mts` segura isso: reprova se o filtro
voltar a repassar `exception.message`, se parar de mandar o erro pro log, se
perder o reconhecimento do id mal formado, ou se colocar esse teste **depois**
do ramo genérico (onde ele nunca rodaria).

## Terceira passada (a que achou as coisas grandes)

Rodado de novo do zero, no mesmo Postgres 16 + Redis + API compilada + Next
compilado. Os 18 passaram — e três defeitos apareceram, dois deles sérios.

### 1. Com o Redis fora, tudo respondia 200… em 24 segundos

O passo 13 dizia "o Redis cair não pode derrubar o sistema", e o sistema de
fato respondia 200. Só que eu nunca tinha **cronometrado**. Cronometrando:

| | 1ª | 2ª | 3ª | 4ª |
| --- | --- | --- | --- | --- |
| Redis de pé | 24 ms | 21 ms | 37 ms | — |
| Redis fora | **7.533 ms** | **15.326 ms** | **22.220 ms** | **24.034 ms** |

Crescendo a cada requisição. "Continua funcionando" na teoria; inutilizável na
prática — ninguém espera 24 segundos, a pessoa recarrega, e a fila cresce.

A culpa é do `enableOfflineQueue`, que vem **ligado por padrão** no ioredis:
comando enviado com a conexão caída não falha, entra numa fila esperando a
reconexão. Como o `retryStrategy` padrão espera cada vez mais entre tentativas,
cada requisição esperava mais que a anterior.

O cliente foi reconfigurado pra dizer "não deu" na hora — `enableOfflineQueue:
false`, `commandTimeout: 250`, uma tentativa por comando, `retryStrategy` com
teto — e todo lugar que fala com o Redis passou a tratar a queda indo direto ao
banco, que era o plano desde sempre. Depois:

```
com Redis de pé:  15 ms · 10 ms · 12 ms
com Redis fora:   18 ms · 13 ms · 13 ms · 13 ms · 15 ms · 15 ms
```

**24.034 ms → 18 ms.** A tela de clientes abriu em 2,1 s com o Redis no chão.

E tem uma exceção que **precisa** continuar sendo exceção: o cofre. Em todo
lugar "Redis fora" significa "vai ao banco"; no cofre significa **trancado**.
Medido: com o Redis fora, `status` responde `unlocked=false`, e destravar com a
senha certa devolve **503** em 45 ms — não "destravei" em cima de uma gravação
que não aconteceu.

`apps/api/src/__checks__/redis.check.mts` segura as duas pontas.

### 2. O master lia cliente de todas as empresas sem entrar em nenhuma

Esta é a maior. O master logado no painel do SaaS, **sem ter impersonado
ninguém**, chamava `GET /api/customers` e recebia:

```
121 clientes de 2 empresas — Acme e Zito — na mesma lista
```

O RLS abre tudo pro platform admin (é o que faz o painel do SaaS funcionar),
então sem `orgId` a consulta não tinha por onde filtrar. O efeito colateral é o
que incomoda: a **impersonação**, que é o caminho que deixa rastro no
`platform_audit`, virava opcional. Dava pra ler dado de cliente sem rastro
nenhum.

Varrendo as 278 rotas GET com o cookie do master puro: **160 respondiam 200**.

O padrão foi invertido no `AuthGuard`: rota de empresa **exige** empresa.
`@Public()`, `@RequirePlatformOwner()` e `@RequirePlatformAdmin()` já saem
antes; o que sobra é rota de empresa, e sem `orgId` responde 403. As telas do
painel do SaaS que realmente precisam foram marcadas uma a uma com o novo
`@SemEmpresa()` — 29 rotas, cada uma conferida no navegador.

Depois: **113 rotas deixaram de entregar dado de empresa** ao master puro, e as
19 telas do painel do SaaS mais as 16 telas da empresa continuam abrindo — isso
conferido no navegador de verdade, tela por tela, com o cronômetro dos 403 em
cima de toda chamada de API que cada uma faz.

Duas chamadas que a casca dispara em **toda** tela (`/api/sidebar/counts` e
`/api/company-integrations/alerts`) passaram a 403 pro master puro, e com razão:
contador de pendência é de uma empresa. Elas deixaram de ser feitas quando não
há empresa, em vez de tomarem 403 a cada 60 segundos.

`apps/api/src/__checks__/empresa.check.mts` segura: o porteiro tem que existir,
tem que vir **depois** das três saídas de plataforma (senão barra o próprio
painel), o `@SemEmpresa()` tem teto de 40 rotas (marcar por reflexo desfaz o
porteiro), e nenhum controller de dado de cliente pode estar marcado.

### 3. Dois 500 que eram 400 e 403

Do mesmo tipo do 5xx da segunda passada, achados no log desta:

- **`POST` com corpo vazio** e `content-type: application/json` devolvia 500
  "Erro interno". O Fastify já tinha carimbado 400 (`FST_ERR_CTP_EMPTY_JSON_BODY`)
  e o filtro global apagava, jogando tudo no ramo genérico. Hoje sai
  400 com a mensagem do framework — que é legível e não vaza nada. JSON quebrado
  idem.
- **Segredo do VoIP errado** era `throw new Error("forbidden")` — 500 no log e
  no monitoramento, quando a intenção era 403. Virou `AppError(..., 403)`.

Resultado da varredura final das 278 rotas: **zero 5xx** (eram 12), 193 em 403,
47 em 200, 37 em 401, 1 em 404.

### O que a terceira passada mostrou sobre o próprio roteiro

Três testes meus estavam passando por engano e foram consertados:

- a caminhada pelas telas dava "abriu" pra **página em branco** (um `next start`
  velho ainda servia a porta 3001 por cima do build novo). Hoje tela com menos
  de 200 caracteres de texto reprova.
- o passo 13 conferia o **código** da resposta e nunca o **tempo** — foi
  exatamente por isso que os 24 segundos passaram despercebidos nas duas
  primeiras passadas. Hoje tem teto de 1.500 ms e uma regra contra a espera
  crescer a cada requisição.
- o `/app/equipe` que eu testava não existe (é `/app/usuarios`): a tela de 404
  passava como "abriu".

## O que ainda não dá pra marcar como feito

- **`/e/` sozinho dá 404.** O hub é por empresa (`/e/acme`). Quem digitar só
  `/e/` não encontra nada. Uma página de "qual empresa?" resolveria.
- Os passos que dependem de produção — Redis derrubado **em produção** e o log
  de um dia — foram exercitados aqui, não lá.
