# Ponto eletrônico: paridade com o RH

O ponto do Norty Vision era uma fotografia antiga do ponto do Norty RH
(`yugo-ponto`). Mesma origem, mesma estrutura, só que parado num ponto
anterior. Este documento registra o que foi trazido e, principalmente, **o que
foi preservado** — porque os dois tinham divergido nos dois sentidos.

## O tamanho da diferença

| | RH | Vision (antes) | Vision (agora) |
| --- | ---: | ---: | ---: |
| rotas de ponto | 111 | 69 | **111** |
| serviços | 16 | 10 | **16** |
| tela `ponto/page.tsx` | 2.267 | 1.869 | **2.267** |

As 69 rotas do Vision eram subconjunto estrito das 111 do RH — nenhuma
exclusiva. Então, no nível de endpoint, o porte não removeu nada.

## O que chegou

| bloco | o que é |
| --- | --- |
| `allocation.service` | ceder e receber funcionário entre lojas, com relatório e fatura |
| `shift-swap.service` | troca de turno com aprovação do RH |
| `assiduidade.service` | ranking de assiduidade e recibos |
| `employer.service` | múltiplos empregadores (CNPJs) na mesma empresa |
| `reports.service` | consolidado, espelhos por loja, CSV e PDF |
| `payroll-layouts` | layouts de exportação de folha |
| terminais | relógio de ponto físico, dispositivos liberados, RustDesk |
| afastamentos | licenças, com reflexo no espelho |
| banco de horas | pedidos e resposta do RH |

16 migrations novas (`198`–`213`), renumeradas para a sequência do Vision, e 8
models novos no Prisma, mais campos nos models existentes.

## O que foi preservado — a parte que exigiu cuidado

O motor do espelho (`jornada.service.ts`) **não** é cópia de nenhum dos dois:
cada um tinha o que o outro não tinha.

Só no Vision, e que continuou:

- **dia futuro não entra nos totais** — sem isto, o espelho do dia 10 já mostra
  o mês inteiro em vermelho;
- **feriado × ponto facultativo** (`kind`), que a contabilidade trata diferente;
- **dia especial por justificativa** — folga premium, facultativo ou feriado
  lançado e aprovado zeram o esperado: não é falta e não desconta;
- **abono parcial de horas** — trabalhou 08–13 e o resto foi abonado; os
  minutos abonados pagam o déficit, abatem saída antecipada e depois atraso;
- **anti-cache no PDF do espelho assinado** — sem isso, depois de reassinar o
  navegador servia o PDF antigo, porque a URL era idêntica.

Só no RH, e que chegou:

- **feriados nacionais** fixos e móveis (Páscoa, Carnaval, Corpus Christi);
- **política de feriado** por escala (folga / trabalha / alterna) e como paga;
- **afastamento** e **troca de turno** sobrepondo a escala do dia.

Uma correção de rumo que vale registrar: a primeira leitura sugeria que o RH
não tinha a Portaria 671 (NSR e cadeia de hash). Tinha — num arquivo chamado
`190_punch_voided.sql`, que o filtro por nome não pegou. E o NSR do RH é
melhor: **por empregador**, não global, que é o que a norma pede quando a
empresa tem mais de um CNPJ.

## O que ficou de fora, de propósito

O ponto do RH vinha amarrado a três módulos que **não são ponto**:

- **medidas disciplinares** — o cálculo de assiduidade descontava o bônus de
  quem tem advertência no mês. O módulo não existe no Vision, então o contador
  fica em zero: ninguém perde bônus por advertência enquanto ele não vier;
- **lembrete de entrevista (ATS)** e **notificações proativas por IA** — o
  agendador do RH disparava os dois. Saíram daqui em vez de ficarem quebrados.

Portar esses três seria trazer recrutamento e IA junto, que é outro escopo.

## Uma coisa que mudou de comportamento

O registro **08 do AEJ** identifica quem desenvolve o software de ponto, e vai
num arquivo entregue à fiscalização do trabalho. No RH ele estava cravado no
código com o nome e o e-mail de outro produto.

Agora vem de `PTRP_NAME` e `PTRP_EMAIL` — variáveis que o `.env.norty.example`
do Vision já previa. **Confira com a contabilidade antes do primeiro AEJ**: é
documento entregue a órgão público, e o padrão (`Norty Vision`, e-mail vazio)
provavelmente não é o que deve constar.

## O que as conferências do Vision pegaram no porte

A tela veio do RH e não seguia três padrões que o Vision cobra de todas as 101
telas. As conferências reprovaram, e foi bom:

- cabeçalho montado à mão em vez de `<PageHeader>`;
- 7 tabelas sem `table-cards` — não virariam cartão no celular;
- 8 ocorrências do nome do produto antigo, uma delas no AEJ.

Todas corrigidas. `tsc --noEmit` limpo, `npm run check` verde e `nest build` +
`next build` passando nos dois apps.

## Como subir: as migrations primeiro

`infra/scripts/db-apply-nv-thor.sh` aplica as migrations no Postgres
compartilhado da thor (CT 102, banco `norty_vision`). O `db-apply.sh` do
projeto não serve: ele aponta pro Postgres do compose e pro `.env.production`,
e nenhum dos dois existe nesta instalação.

**A ordem é o contrário da intuição:**

Os dois scripts **descobrem sozinhos onde o código mora neste host**: perguntam
ao Proxmox qual diretório está montado como `/opt/fase3` dentro do CT 105. O
caminho já mudou uma vez — era `/srv/apps-fase3` e virou `/mnt/ssd/apps-fase3`
quando o armazenamento dos containers foi movido —, e cravar de novo só adiaria
o mesmo problema. `BASE=/caminho bash <script>` força, se precisar.

```bash
bash infra/scripts/db-apply-nv-thor.sh --dry-run   # lista, sem tocar
bash infra/scripts/db-apply-nv-thor.sh             # aplica + confere
bash infra/scripts/deploy-nv-thor.sh               # só então o código
```

Subir o código antes quebra o ponto inteiro: toda consulta estoura com
"relation does not exist". Na ordem certa não há janela de quebra — as
migrations só ADICIONAM, e o código velho ignora o que não conhece.

O script faz dump do banco antes de qualquer DDL, aplica uma migration por vez
parando no primeiro erro, e **confere no fim** se o banco tem as 8 tabelas e as
10 colunas que o Prisma Client passou a esperar. Se faltar alguma, ele manda
NÃO subir o código — porque é exatamente aí que o erro apareceria só quando
alguém abrisse o Ponto.

### Provado antes de entregar

Num Postgres 16 com pgvector, do zero:

| | |
| --- | ---: |
| base de julho reconstruída (migrations 001–197) | **197 ok, 0 falhas**, 211 tabelas |
| as 16 novas, sobre essa base | **16 ok, 0 falhas** |
| as 16 de novo (idempotência) | **0 falhas** |
| as 18 conferências do script | **18 ok** |
| Prisma Client novo contra o banco migrado | **13 de 13 models respondem** |

O último é o que importa de verdade: não basta o SQL aplicar, o cliente gerado
precisa conseguir consultar. Os 8 models novos e os campos novos nos 5 models
antigos foram consultados de fato.
