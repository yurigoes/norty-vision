# Navegação, portais e memória de empresa

> Como alguém entra no Norty Vision, para onde volta ao sair e por que o
> endereço da empresa nunca mais se perde no meio do caminho.

## O problema que isso resolve

O sistema é multi-empresa: cada empresa tem a própria porta de entrada, com a
logo e a cor dela. Só que, uma vez logado, a URL virava `/app` — genérica — e o
botão **Sair** mandava todo mundo para `/login`, o login do apex (a porta do
master). Um funcionário da Zito Óticas entrava por
`vision.norty.com.br/e/zito-oticas/login`, saía e caía numa tela que nunca tinha
visto. Mesma coisa quando a sessão expirava: `redirect("/login")` em ~50 páginas
apagava o contexto da empresa.

## O modelo de entrada

| Portal | Rota da empresa | Rota genérica (apex) |
| --- | --- | --- |
| Equipe / administração | `/e/<slug>/login` | `/login` |
| Funcionário (RH, ponto) | `/rh/<slug>/login` | `/rh/login` |
| Cliente (crediário, OS) | `/c/<slug>/login` | `/c/login` |
| Fornecedor (médicos, laboratórios) | `/f/<slug>/login` | `/f/login` |
| **Hub da empresa** | `/e/<slug>` | — |

O **hub** (`/e/<slug>`) é o link único para divulgar internamente: a pessoa abre
um endereço só e escolhe quem ela é. Cada cartão explica em uma linha o que tem
lá dentro.

## Memória de empresa (cookie `nv_org`)

Ao passar por qualquer porta de empresa — hub, login com slug, ou simplesmente
usando o painel — o navegador guarda o slug em `nv_org` (1 ano, `SameSite=Lax`,
legível pelo JS: **é navegação, não é fronteira de segurança**).

Com ele:

- **Sair** volta para `/e/<slug>/login` (ou o portal correspondente), com a
  marca da empresa — nunca mais para o `/login` genérico.
- **Sessão expirada** volta para o login da empresa levando `?next=` com a
  página que a pessoa tentou abrir. Depois de entrar, ela cai exatamente onde
  estava.
- `/login`, `/rh/login`, `/c/login` e `/f/login` **redirecionam** para a porta da
  empresa lembrada.
- `/login?global=1` força o login genérico — é a saída para o **master** e para
  trocar de empresa no mesmo aparelho ("Entrar em outra empresa", presente em
  todas as telas de entrada).

Quem valida empresa + permissão continua sendo a API: o backend rejeita login
fora da org do slug, mesmo para admin de outra empresa.

### Peças de código

| Arquivo | Papel |
| --- | --- |
| `apps/web/lib/orgMemory.ts` | Cookie, caminhos de cada portal, `safeNext`, `goToLogin` (browser) |
| `apps/web/lib/tenantServer.ts` | `rememberedOrgSlug()` e `loginPath()` para Server Components |
| `apps/web/middleware.ts` | Publica o caminho atual no header `x-nv-path` (é o que alimenta o `?next=`) |
| `apps/web/components/RememberOrg.tsx` | Marca a empresa deste aparelho |
| `apps/web/components/PortalAuthLayout.tsx` | Casca única das quatro telas de entrada |
| `apps/web/app/e/[slug]/page.tsx` | Hub da empresa |

`?next=` só aceita caminho interno e nunca aponta para outra tela de login
(evita open redirect e loop de login) — ver `safeNext()`.

## Casca do painel (`/app`)

`components/AppShell.tsx` decide a apresentação do menu:

- **< 1024px** (celular e iPad em retrato): barra superior fixa com botão de
  menu + gaveta lateral. Fecha ao navegar, ao tocar fora e no `Esc`; trava o
  scroll do fundo enquanto está aberta.
- **>= 1024px**: a sidebar fixa de sempre.

Antes, o menu era `hidden md:block`: no celular ele simplesmente não existia —
quem abrisse o sistema no telefone ficava preso na primeira tela.
