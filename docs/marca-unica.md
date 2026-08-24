# Uma marca só

> Por que o mesmo sistema se apresentava com quatro nomes, e como isso deixou
> de acontecer.

## O que acontecia

O sistema é white-label: nome, logo e cores vêm de `platform_settings`, e o
master edita em **Identidade & Branding**. Só que, espalhado pelo código, havia
o nome de um produto anterior cravado — e o valor cravado ganha da configuração
sempre que a tela não passa pela busca das settings.

O resultado, para a mesma pessoa no mesmo dia:

- o portal do funcionário abria com o título de um produto;
- o e-mail de redefinição de senha chegava assinado por outro;
- o app autenticador (2FA) cadastrava a conta com um terceiro;
- e o rodapé do painel mostrava um quarto.

## Agora

**No web** — `apps/web/lib/brand.ts` expõe `PRODUCT_NAME` e `ROOT_DOMAIN`.
É o valor de partida: `platform_settings` continua mandando onde a tela busca
as settings, e `NEXT_PUBLIC_PRODUCT_NAME` sobrescreve no build.

**Na API** — o que sai do sistema usa `NORTY_SYSTEM_NAME`: assunto e corpo dos
e-mails, rótulo do 2FA no app autenticador, rodapé do PDF da fatura, prompt da
IA de insights.

No compose, a **mesma** variável alimenta os dois lados — o `NEXT_PUBLIC_*` é
inlinado no build do Next, então entra como build arg, não só como environment.

Trocar o rótulo do 2FA **não invalida** quem já cadastrou: o que autentica é o
segredo, o nome é só a etiqueta na lista do aplicativo.

## O que ficou como está, e por quê

| O quê | Por quê |
| --- | --- |
| `@yugo/web`, `@yugo/shared` | nome de pacote do monorepo; ninguém de fora lê |
| `prose-yugo`, `yugo-loading-*`, `yugo-theme`, `yugo-sb:` | classe de CSS e chave de `localStorage` — renomear reseta a preferência de quem já usa |
| `MINIO_BUCKET_PRIVATE` | bucket que já existe **com dados dentro** |
| rede docker `yugo-internal` | é o nome real da rede compartilhada, e a tela de infraestrutura descreve a máquina de verdade |
| `X-Yugo-Signature` | cabeçalho de webhook: é contrato público. Quem já valida a assinatura quebraria |

## Endereços cravados eram bug, não só marca

Alguns lugares não traziam só o nome errado — traziam o **endereço de outro
sistema**, e isso quebrava funcionalidade:

- a tela de Pagamentos mostrava a URL de webhook do Mercado Pago apontando para
  outro domínio. O lojista copiava e colava um endereço que nunca ia receber a
  notificação. Agora é a origem da própria instalação;
- o runbook de recuperação de desastre mandava clonar outro repositório em
  outra pasta — seguido numa emergência, restauraria o sistema errado;
- a tela de Infraestrutura descrevia containers que não existem aqui;
- o e-mail do encarregado de dados (LGPD) e a identificação do desenvolvedor no
  arquivo AEJ do ponto estavam cravados. Viraram env (`LGPD_DPO_EMAIL`,
  `PTRP_*`) — **confirme os dois com a contabilidade**: vão em documento
  entregue a órgão público.

`NORTY_ROOT_DOMAIN` era usado pelo compose e não estava no `.env.norty.example`;
sem ele o padrão é `norty.com.br`, e é dele que a API monta os links públicos.
Ficou documentado, com as duas opções explicadas.

## Conferência

```bash
node --experimental-strip-types apps/web/lib/__checks__/marca.check.mts
```

Varre web **e** API (a API é quem manda e-mail e nomeia o 2FA) e falha se o
nome antigo reaparecer fora da lista de identificadores técnicos — que está no
próprio arquivo, cada um com o motivo.
