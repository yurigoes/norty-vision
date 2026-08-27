# Bootstrap da casca do painel

> Por que o `/app` parava pra pensar entre uma tela e outra, e o que passou a
> acontecer no lugar.

## O que acontecia

O layout do `/app` é `force-dynamic`: ele roda inteiro a cada navegação. E ele
buscava, uma requisição HTTP depois da outra:

```
/api/auth/me
  → /api/platform/integrations     (só master, e só pra achar 1 token)
  → /api/organizations/me
  → /api/company-integrations/shortcuts
  → /api/stores/:id
  → /api/subscriptions/current
```

Seis idas e voltas **em série**. Mais uma sétima, porque cada página também
chamava `getSession()` por conta própria — e `getSession()` batia de novo em
`/api/auth/me`. Várias páginas ainda pediam `/api/organizations/me` outra vez
para saber o nicho, o slug ou a logo.

## O que acontece agora

Uma chamada: **`GET /api/bootstrap`**.

```jsonc
{
  "session":      { "authenticated": true, "user": {…}, "master": null, "impersonating": null },
  "organization": { …, "enabledModules": […], "nicheHiddenModules": […] },
  "store":        { … },   // loja ativa, quando o usuário tem uma
  "subscription": { … },   // null para o master
  "shortcuts":    [ … ],   // SSO Chatwoot/GLPI, só para admin da empresa
  "chatwoot":     { "baseUrl": "…", "websiteToken": "…" }  // só para o master
}
```

As peças são resolvidas **em paralelo dentro da API** (`BootstrapService`), do
lado de dentro da rede — sem passar pelo Caddy nem pelo túnel a cada uma.

- `apps/api/src/bootstrap/` — controller, service e módulo.
- `apps/api/src/auth/session-snapshot.service.ts` — a montagem do payload de
  sessão, que agora `/auth/me` e `/bootstrap` **compartilham** em vez de manter
  duas cópias que iam divergir.
- `apps/web/lib/bootstrap.ts` — `getBootstrap()` embrulhado no `cache()` do
  React: layout e página dividem uma única ida à API dentro da mesma
  requisição. `getOrganization()` serve as páginas que só querem a empresa.
- `apps/web/lib/session.ts` — `getSession()` virou uma leitura desse mesmo
  resultado. A assinatura não mudou, então as ~100 páginas que já a chamavam
  continuam iguais.

### Nada disso derruba a tela

Cada peça é resolvida com tolerância a falha: o que faltar vira `null` / `[]`
e a casca renderiza sem aquele pedaço — o mesmo comportamento de antes, quando
um dos endpoints dava erro.

> **Continuação:** uma chamada HTTP não era uma ida ao banco. Por dentro, isto
> aqui eram onze transações e 34 idas ao Postgres. Hoje é **uma consulta só** —
> ver [`casca-em-uma-consulta.md`](casca-em-uma-consulta.md).

A tolerância do lado do web também continua: só devolve "não autenticado"
quando a API responde **401/403**. Timeout, erro de rede ou 5xx mantêm a sessão
de pé com base no cookie presente. Era a causa do bug "ao finalizar pedido o
sistema desloga" — um piscar do backend derrubava o usuário para o login.

### Deploy pela metade

Se a API que estiver rodando ainda não tiver o `/api/bootstrap` (404), o web cai
sozinho no caminho antigo, um endpoint por peça — só que agora **em paralelo**.
Ninguém fica na mão durante uma janela de deploy.

## Próximo passo natural

`getBootstrap()` é `cache()` **por requisição**. Do lado da API a consulta já
custa uma ida ao banco; o que ainda pesa quando a sessão não está no cache do
Redis é o guard de autenticação resolvê-la pelo Prisma (~11 idas).
