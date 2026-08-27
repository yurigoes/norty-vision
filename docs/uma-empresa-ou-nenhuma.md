# Uma empresa, ou nenhuma

O master logado no painel do SaaS, **sem ter entrado em empresa nenhuma**,
chamava `GET /api/customers` e recebia isto:

```
121 clientes de 2 empresas — Acme Óticas e Zito Óticas — na mesma lista
```

Não é o RLS falhando. É o RLS funcionando como mandaram: o platform admin
enxerga tudo (é o que faz o painel do SaaS existir), e sem `orgId` a consulta
não tinha por onde filtrar. O resultado é uma lista que mistura empresas — algo
que nenhuma tela espera e nenhum papel prevê.

O que mais incomoda não é a lista. É que a **impersonação vira opcional**.
Entrar numa empresa grava `impersonation.start` no `platform_audit`; ler direto
não grava nada. O caminho auditado era o caminho mais trabalhoso.

## O tamanho

Varrendo as 278 rotas GET com o cookie de um master puro:

| | antes | depois |
| --- | --- | --- |
| respondiam 200 | **160** | 47 |
| respondiam 403 | 80 | **193** |
| respondiam 5xx | 12 | **0** |

## O conserto

No `AuthGuard`, depois das três saídas que já existiam:

```ts
if (req.yugo.isPlatformAdmin && !req.yugo.orgId && !atendeSemEmpresa) {
  throw new AppError(ErrorCode.Forbidden,
    "Entre na empresa para ver os dados dela (impersonar). " +
    "O painel do SaaS não lista dado de cliente.", 403);
}
```

A ordem é o que faz funcionar. `@Public()`, `@RequirePlatformOwner()` e
`@RequirePlatformAdmin()` respondem **antes**; o que chega aqui é rota de
empresa. Se o porteiro subisse uma linha, barraria o próprio painel do master.

## O `@SemEmpresa()`

Sobraram telas do painel do SaaS que chamam rota não decorada — a referência
fiscal (NCM/CEST), o preço dos módulos, o guia de suporte, a saúde do sistema,
os contratos da plataforma, os usuários de uma empresa (`?organizationId=`).
Cada uma ganhou a marca, uma a uma, conferida no navegador:

```ts
@SemEmpresa()   // "esta rota também atende o master puro"
@Get("ref/ncm")
```

São **29 rotas** em 11 arquivos. O número importa: marcar por reflexo desfaz o
porteiro, porque cada marca é uma rota que o master lê sem entrar na empresa e
sem deixar rastro. Rota **exclusiva** do master continua sendo
`@RequirePlatformAdmin()`, não `@SemEmpresa()`.

## As duas chamadas da casca

`/api/sidebar/counts` e `/api/company-integrations/alerts` são disparadas em
**toda** tela, a cada 60 segundos. Pro master puro elas passaram a 403 — e com
razão: contador de pendência é de uma empresa. Em vez de tomar 403 pra sempre,
elas deixaram de ser feitas quando não há empresa (`temEmpresa={opVisible}`,
o mesmo sinal que a casca já usava pra decidir se mostra o menu de operação).

## Conferido no navegador

- **19 telas do painel do SaaS** abrem com o master puro, sem 403 nenhum e sem
  tela em branco.
- **16 telas da empresa** abrem com a dona da Acme, igual a antes.
- **7 telas da empresa** abrem com o master **impersonando**, com o banner
  "Acme Óticas (modo master)" — e no `stop`, `/api/customers` volta a 403.

## A rede

`apps/api/src/__checks__/empresa.check.mts`, no `npm run check`. Reprova se:

- o porteiro sumir do `AuthGuard`;
- o guard parar de ler o `@SemEmpresa()` (aí o painel do SaaS quebra inteiro);
- o porteiro subir pra **antes** de `@Public` / `@RequirePlatformOwner` /
  `@RequirePlatformAdmin`;
- as marcas passarem de 40 rotas;
- um controller de dado de cliente (`customers`, `sales`, `quotes`, `credit`,
  `production`, `payables`, `receivables`, `payments`, `optical`) aparecer
  marcado.

Cada uma dessas cinco regras foi testada quebrando o código de propósito.
