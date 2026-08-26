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
| 9 | master desliga sub-módulo | ✅ a aba e o item do menu somem — **mas veja a ressalva abaixo** |
| 10 | trocar permissão de UMA pessoa | ✅ vale no clique seguinte (403 → 200), e só pra ela |
| 11 | editar o PAPEL | ✅ as duas balconistas mudaram juntas |
| 12 | revogar acesso de quem está logado | ✅ a sessão morreu na hora (401); a colega seguiu em 200 |
| 13 | Redis fora do ar | ✅ 4 requisições seguidas em 200, telas abrindo, e o aviso próprio no log |
| 14 | imprimir os dois relatórios | ⚠️ **achou um defeito** — consertado, veja abaixo |
| 15 | impersonar e voltar | ✅ banner com o nome da empresa, dados dela, e `stop` devolve o master puro |
| 16 | os dois cookies ao mesmo tempo | ✅ o guard reconhece o master e descarta o contexto da empresa |
| 17 | inativar um master | ✅ HTTP 200 (era 500) com `inactive` e com `disabled`; a sessão dele morre na hora |
| 18 | marcadores no log | ✅ zero em 844 requisições — e **provado que a linha funciona** |

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

**O passo 9 é cosmético.** Desligar `producao.costureiras` no master tira a aba
e o item do menu — mas `/app/producao/costureiras` **continua abrindo pela
URL**, com a tela inteira funcionando. Quem tem o link salvo continua usando um
sub-módulo que a empresa não contratou. Não é falha de isolamento (o RLS e as
permissões continuam valendo sobre os dados), é falha de porteiro: o bloqueio
está só no menu.

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

## O que ainda não dá pra marcar como feito

- **`/e/` sozinho dá 404.** O hub é por empresa (`/e/acme`). Quem digitar só
  `/e/` não encontra nada. Uma página de "qual empresa?" resolveria.
- Os passos que dependem de produção — Redis derrubado **em produção** e o log
  de um dia — foram exercitados aqui, não lá.
