# Cabeçalho de página

> Por que as 101 telas do painel pareciam sete produtos diferentes, e o que
> passou a segurar a consistência.

## O que acontecia

Cada tela montava o próprio topo, copiado da tela do lado:

```tsx
<header className="mb-8">
  <p className="text-xs font-semibold uppercase tracking-wider text-brand">Configuração · Usuários</p>
  <h1 className="mt-1 text-3xl font-semibold">Equipe</h1>
  <p className="mt-2 text-muted">Pessoas com acesso ao sistema…</p>
</header>
```

Noventa e cinco cópias. E, como toda cópia, com variações: `mb-8` em umas e
`mb-4` em outras, `text-3xl font-semibold` convivendo com `text-2xl` e com
`text-3xl font-extrabold tracking-tight`, botões de ação ora dentro do
`<header>`, ora fora. No celular, `text-3xl` (30px) quebrava feio em título
longo.

## Agora

`components/PageHeader.tsx` — uma estrutura só: **onde estou** (categoria), **o
que é isto** (título), **o que dá pra fazer** (descrição), e as ações à direita.

```tsx
<PageHeader
  eyebrow="Configuração · Usuários"
  title="Equipe"
  description="Pessoas com acesso ao sistema…"
  back={{ href: "/app/agenda", label: "Agenda" }}   // telas internas
  actions={<button className="btn-grad">+ Novo</button>}
>
  {/* extras opcionais: avisos, filtros, abas */}
</PageHeader>
```

- O título virou `text-2xl sm:text-3xl` com `text-balance` — para de quebrar mal
  no celular.
- As ações descem para baixo do título quando não cabem, em vez de espremer.
- `PageHeader` não usa hook: serve tanto em Server Component quanto em tela
  `"use client"`.

**99 das 101 telas** usam. As duas de fora — `agenda/relatorio` e
`caixa/relatorio` — são folhas de impressão, com cabeçalho próprio de relatório;
não são tela de painel.

## "Você está em..."

Sem `eyebrow`, a categoria vem do mapa do menu (`lib/nav.ts`) pela rota atual —
tela nova já nasce dizendo onde está. Passe `eyebrow={null}` para não mostrar
nenhuma (é o caso do painel inicial).

O `AutoEyebrow` mostra **só o nome do módulo**, o mesmo que está no menu. Ele
**não** tenta adivinhar o nome da sub-página a partir da URL: o slug vem sem
acento — `duvidas`, `botoes`, `relatorios` — e sairia errado em maiúsculas, que
é como o cabeçalho aparece. Quando o nome da tela interna importa, ele é escrito
na própria tela (`eyebrow="Atendimento · Dúvidas"`), e é isso que as telas
existentes fazem.

## Uma fonte para o menu

`lib/nav.ts` reúne o que antes estava espalhado dentro do `app/app/layout.tsx`:
categorias, itens de operação, admin, master e os fixos do rodapé
(`NAV_CONTA`). A sidebar, a busca (Ctrl+K), os favoritos e o cabeçalho leem
**do mesmo lugar**. Cada novo consumidor copiava um pedaço, e as cópias iam
divergir na primeira tela nova.

Dele sai também o `ROUTE_META`: rota → `{ label, group }`, com herança do módulo
pai (`/app/agenda/pacientes` → Agenda).

## Conferência

```bash
node --experimental-strip-types apps/web/lib/__checks__/pageHeader.check.mts
```

Falha (código 1) se:

1. **alguma tela do painel não tiver lugar no menu** — resolve só para a raiz
   `/app`. Tela órfã existe, mas o sistema não sabe dizer onde ela fica;
2. **alguma tela montar o topo à mão** — o sinal é a linha de categoria do
   padrão antigo. O `text-xs` importa: `text-[10px]` com as mesmas classes é
   etiqueta dentro de cartão, não cabeçalho de tela.
