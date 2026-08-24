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

## Busca de módulos (Ctrl+K)

O menu do painel tem quase 70 itens em sete categorias recolhíveis, só texto.
Quem não lembra o nome exato do módulo — ou em qual categoria ele mora — abria
seção por seção até achar. Agora **Ctrl+K** (⌘K no Mac) abre uma busca: a
pessoa digita `cred`, `nota fiscal`, `lente` e chega.

- A lista sai do **mesmo menu** que aquele usuário vê, já filtrada por nicho,
  permissão, sub-módulo e plano. Nada aparece na busca que não apareceria na
  lateral. Módulos fora do plano aparecem com cadeado e levam para a
  Assinatura.
- Sem nada digitado, mostra os **últimos usados** (localStorage, 5 itens).
- Teclado: `↑` `↓` navegam, `enter` abre, `esc` fecha. O mouse também funciona.
- Além do atalho, há o campo "Buscar..." no topo do menu (que mostra o atalho,
  para quem não conhece) e o botão de lupa na barra do celular.

| Arquivo | Papel |
| --- | --- |
| `apps/web/lib/paletteSearch.ts` | A busca em si — pura, sem React |
| `apps/web/components/CommandPalette.tsx` | Diálogo, teclado, recentes |
| `apps/web/components/CommandPaletteButton.tsx` | Os dois gatilhos (campo e lupa) |
| `apps/web/lib/__checks__/paletteSearch.check.mts` | Conferência com os rótulos reais |

A pontuação é deliberadamente simples, não fuzzy: prefixo do rótulo ganha de
início de palavra, que ganha de "aparece no meio", que ganha de categoria /
endereço / sinônimo. Com vários termos, **todos** precisam casar — `nota
fiscal` não traz "Notas de crédito". Fuzzy casaria quase tudo e a primeira
linha deixaria de ser confiável.

Para rodar a conferência (sem instalar nada):

```bash
node --experimental-strip-types apps/web/lib/__checks__/paletteSearch.check.mts
```

O menu do master virou dado (`NAV_MASTER_TOP` / `NAV_MASTER_OWNER` /
`NAV_MASTER_BOTTOM` em `app/app/layout.tsx`) porque a mesma lista alimenta a
sidebar e a busca — em duas cópias elas divergiriam na primeira tela nova.

## Ícones e favoritos no menu

Com a busca no lugar, o que ainda pesava era o reconhecimento: 69 linhas de
texto puro, todas com o mesmo peso e a mesma forma. Achar "Cobrança" no meio de
"Comissões", "Contratos" e "Contas a pagar" era leitura, não reconhecimento.

**Ícones** — `lib/navIcons.ts` mapeia cada ROTA (não a chave de módulo, que é
opcional) para um ícone do `lucide-react`, que já era dependência e é
tree-shakeable. Rota desconhecida cai no genérico: nunca fica sem ícone, nunca
quebra ao entrar uma tela nova. Uma conferência garante que o mapa não fique
para trás:

```bash
node --experimental-strip-types apps/web/lib/__checks__/navIcons.check.mts
```

**Favoritos** — cada pessoa vive em quatro ou cinco módulos dos quase 70. A
estrela ao lado de cada item fixa o módulo numa seção **Favoritos** no topo do
menu, e os fixados também aparecem primeiro na busca (Ctrl+K).

- Guardado no `localStorage` deste aparelho (`lib/favorites.ts`), como os
  "recentes" da busca. É preferência de navegação, não configuração de conta:
  não vale uma tabela, uma rota e uma migration. Quem troca de computador
  refixa em dois cliques.
- Sem provider: quem precisa lê pelo `useFavorites()` (via
  `useSyncExternalStore`) e `toggleFavorite()` avisa todo mundo por evento —
  inclusive **outras abas**, pelo evento `storage`.
- Máximo de 8. Acima disso deixa de ser atalho e vira um segundo menu.
- A lista de referência é a mesma do menu e da busca, já filtrada por nicho,
  permissão, sub-módulo e plano: favorito de módulo cujo acesso a pessoa
  perdeu simplesmente some, sem virar link quebrado.

A estrela some no repouso para não poluir uma lista de 70 itens; aparece no
hover e no foco por teclado, e fica sempre visível no item já fixado. Em
aparelho **sem mouse** o hover nunca acontece, então ela fica esmaecida em vez
de invisível para sempre (regra `.fav-star` em `globals.css`).

O botão da estrela fica **fora** do `<Link>` de propósito: um `<button>` dentro
de um `<a>` é HTML inválido e quebra o clique no meio.

## Cabeçalho de página

O topo de cada tela virou um componente só (`PageHeader`), e o mapa do menu
saiu do layout para `lib/nav.ts`, de onde sidebar, busca, favoritos e cabeçalho
leem. Ver [`cabecalho-de-pagina.md`](./cabecalho-de-pagina.md).

## Estado de carregamento

Cada tela ganhou um esqueleto na forma do que vem, e o overlay "Processando…"
voltou a ser só para quem salva algo. Ver
[`carregamento.md`](./carregamento.md).
