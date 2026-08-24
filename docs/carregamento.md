# Estado de carregamento

> Por que o painel parecia travado entre uma tela e outra, e o que passou a
> aparecer no lugar.

## O que acontecia

Não existia **nenhum** `loading.tsx` no projeto. Ao trocar de módulo, o
conteúdo da tela ANTERIOR ficava na tela até a nova responder — e o único sinal
de vida era o overlay global "Processando…", disparado pelo próprio item do
menu.

Esse overlay é a linguagem de quem está **salvando** algo: escurece a página
inteira e bloqueia o clique, de propósito, para evitar envio duplicado. Usá-lo
para abrir uma página dava a sensação de que o sistema tinha travado.

## O que aparece agora

Um esqueleto na forma do que vem. A pessoa já vê a tabela, o quadro ou o
formulário tomando forma; a percepção de espera cai mesmo com o mesmo tempo de
resposta.

- `components/Skeleton.tsx` — as peças e o `PageSkeleton`, com nove formatos:
  `home`, `page`, `table`, `dashboard`, `board`, `form`, `calendar`, `split`
  e `doc`.
- **Uma `loading.tsx` por tela** — 101 no total.
- O cabeçalho do esqueleto é sempre igual porque todas as telas usam o
  `PageHeader`.

O overlay continua existindo, agora só para o que ele sempre foi: mutações
(qualquer `fetch` que não seja GET). O item do menu virou um `<Link>` puro.

### Por que uma por tela, e não uma só

O App Router faz a tela **herdar** o `loading.tsx` do segmento pai quando não
tem o seu. Uma só na raiz cobriria tudo — e é aí que dói: `/app/agenda/pacientes`
é uma tabela e herdaria o calendário da Agenda, mostrando a forma errada do que
está por vir. Pior que esqueleto nenhum é esqueleto mentindo.

Por isso as sub-telas ganharam a sua: as seis da Agenda, as nove do
Atendimento, as onze do Suporte (texto corrido), os detalhes por id.

### Acessibilidade

`role="status"` + `aria-busy` fazem o leitor de tela anunciar "carregando" uma
vez, em vez de ler blocos vazios. O brilho que corre nos blocos some com
`prefers-reduced-motion`.

## Conferência

```bash
node --experimental-strip-types apps/web/lib/__checks__/loading.check.mts
```

Falha se alguma tela ficar sem `loading.tsx` próprio, ou se usar uma variante
que não existe em `components/Skeleton.tsx`.

Todas as conferências de uma vez:

```bash
pnpm --filter @yugo/web check
```
