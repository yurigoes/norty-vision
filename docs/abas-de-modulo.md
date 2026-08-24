# Abas de módulo

> Como se anda **dentro** de um módulo — e por que cinco jeitos diferentes de
> fazer isso viraram um só.

## O que acontecia

Cinco navegações internas, nenhuma igual à outra:

| Módulo | Como era |
| --- | --- |
| Agenda | trilho lateral, com `SubLink` próprio |
| Contratos | trilho lateral, com outro `SubLink` |
| Suporte | trilho lateral, com um terceiro `SubLink` |
| Atendimento | oito botões-pílula no cabeçalho |
| Produção | um botão solto no cabeçalho |

Dois problemas que nenhuma das cinco resolvia:

- **Nenhuma marcava a tela atual.** Dentro do módulo, a pessoa não sabia onde
  estava.
- **Os trilhos eram `hidden lg:block`.** Abaixo de 1024px a navegação do módulo
  simplesmente não existia — quem abrisse a Agenda no telefone não tinha como
  chegar em Pacientes.

## Agora

Uma faixa de abas logo abaixo do título, que rola na horizontal quando não
cabe. Funciona em qualquer largura, marca a aba atual (cor e traço da marca,
mais `aria-current="page"`), e é o mesmo gesto do portal do funcionário.

- `lib/nav.ts` → **`MODULE_TABS`** é a lista, por módulo.
- `components/ModuleTabs.tsx` desenha, achando o módulo pela rota.
- O **`PageHeader` renderiza sozinho** — nenhuma tela precisa lembrar de
  incluir, e módulo sem entrada no mapa simplesmente não tem abas.

Os três layouts viraram só a guarda de acesso que já faziam; os botões do
cabeçalho do Atendimento e da Produção viraram abas. Sobrou no cabeçalho do
Atendimento só o **Tela cheia**, que abre fora do `/app`, em outra aba do
navegador — por isso não é aba de módulo.

Seis módulos, 35 abas: Agenda, Atendimento, Produção, Financeiro, Contratos e
Suporte.

## As abas somem pelos mesmos motivos que o item do menu

Não adianta a aba levar a uma tela de "acesso restrito". Uma aba desaparece
quando:

- é **só do master** (`master: true`) — Specs técnicas, Servidor/VPS,
  Recuperação;
- o master **desligou o sub-módulo** para aquela empresa (`subMod`) —
  Costureiras, Importar planilha, Macros, Webhooks, Contas a pagar/receber;
- o **recurso da produção** está desligado (`prodFeature`) — Financeiro.

Isso precisa de sessão, e as abas são renderizadas dentro do `PageHeader`, que
não tem uma. Daí o `components/Viewer.tsx`: um contexto pequeno, preenchido no
layout do painel, com `isMaster`, `isOrgAdmin` e os dois mapas de sub-módulo.

Uma aba sozinha não é navegação: com menos de duas visíveis, a faixa não
aparece.

## Conferência

```bash
node --experimental-strip-types apps/web/lib/__checks__/moduleTabs.check.mts
```

Falha se alguma aba apontar para uma tela que não existe (aba quebrada é pior
que aba faltando — a pessoa clica e cai num 404), ou se algum layout voltar a
montar a própria navegação com um `SubLink` caseiro.
