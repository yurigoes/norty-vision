# Deploy pelo Claude Code na web

O deploy da produção roda **dentro da thor**, em `/opt/yugo-platform`. Para o
Claude Code na web rodar isso sozinho, ele precisa alcançar a thor.

E aqui está o mal-entendido que custa tempo: **a sessão dele não é a sua
máquina**. É uma VM efêmera na infraestrutura da Anthropic, com rede própria.
Estar na rede local da thor, ou ter Tailscale ativo no notebook, não transfere
nada para lá — são máquinas diferentes, em redes diferentes.

Medido de dentro da sessão:

```
rede do container:  192.0.2.0/24, gw 192.0.2.1
saída TCP na 22:    sem caminho (estoura o tempo)
```

`192.0.2.0/24` é TEST-NET-1, faixa que a RFC 5737 reserva para documentação —
rede sintética, isolada. E a única saída é HTTPS por um proxy de política. Não
existe SSH direto, nem para a LAN, nem para IP público.

Por isso o túnel. `infra/scripts/claude-ambiente-tailscale.sh` e
`claude-sessao-tailscale.sh` põem essa VM dentro do tailnet.

## Os dois scripts, e por que são dois

| script | onde vai | quando roda |
| --- | --- | --- |
| `claude-ambiente-tailscale.sh` | campo **Setup script** do ambiente | uma vez, e o resultado vira cache |
| `claude-sessao-tailscale.sh` | hook `SessionStart` em `.claude/settings.json` | toda sessão |

O setup script roda uma vez e o ambiente vira um **snapshot de disco** reusado
pelas sessões seguintes. O snapshot guarda o que foi *escrito em disco* e perde
o que estava *só rodando*:

- instalar o binário → disco → sobrevive no cache;
- subir o `tailscaled` → processo → morre com o snapshot.

Ligar o daemon no setup script daria certo na primeira sessão e falharia calado
em todas as outras. Por isso o hook.

Os dois **sempre saem com zero**. Setup script que sai diferente de zero faz a
sessão inteira não subir — não conseguir montar o túnel não pode impedir de
trabalhar no repositório. Todo caminho de erro avisa e devolve 0. Os três
caminhos (sem binário, sem chave, instalador bloqueado) foram testados rodando.

## As três coisas que só você pode providenciar

Tudo se configura em **claude.ai/code** → ícone de nuvem com o nome do ambiente,
na linha acima da caixa de mensagem → engrenagem do ambiente. Não há URL direta.

### 1. Liberar os domínios

No diálogo do ambiente, **Network access** tem quatro níveis: `None`, `Trusted`,
`Full` e `Custom`. Hoje o ambiente responde **403 no CONNECT**:

```
pkgs.tailscale.com:443    connect_rejected
tailscale.com:443         connect_rejected
```

Escolha **Custom**, marque **"Also include default list of common package
managers"** (senão você perde npm, PyPI e o resto que o projeto usa) e ponha em
**Allowed domains**, um por linha:

```
tailscale.com
*.tailscale.com
```

O segundo **não é enfeite**. O instalador está em `pkgs.tailscale.com`, a
coordenação em `controlplane.tailscale.com` e os relays em `derpN.tailscale.com`.
Liberar só `tailscale.com` instala e não conecta — o pior dos dois mundos,
porque parece que funcionou.

### 2. `TS_AUTHKEY` nas variáveis do ambiente

Em https://login.tailscale.com/admin/settings/keys, gere com:

| opção | por quê |
| --- | --- |
| **Ephemeral** | o nó some quando a VM morre; sem isso cada sessão deixa um fantasma na lista de máquinas |
| **Pre-approved** | senão o nó fica pendurado esperando aprovação manual |
| **Tagged** (`tag:claude-code`) | é o que dá à ACL um nome para falar dele |
| **Reusable** | cada sessão é uma VM nova |

> **Leia isto antes de colar a chave.** A documentação da Anthropic é explícita:
> variáveis de ambiente **não são cofre**, qualquer pessoa que use o ambiente lê
> os valores, e ela desaconselha guardar credenciais ali. Não existe secrets
> store ainda.
>
> Ou seja: você vai colocar uma credencial num lugar que não foi feito para
> credencial. É exatamente por isso que a chave precisa ser **efêmera, com tag e
> presa por ACL** — assim o estrago de um vazamento é "alcançar a thor na porta
> 22 até você revogar", e não "entrar no seu tailnet". Chave sem tag, permanente
> e sem ACL transforma esse campo num acesso permanente à sua infraestrutura.

### 3. Uma ACL que dê acesso à thor, e só a ela

O nó não precisa do tailnet inteiro:

```json
{
  "action": "accept",
  "src":    ["tag:claude-code"],
  "dst":    ["tag:thor:22"]
}
```

Se preferir dispensar chave SSH, o Tailscale SSH resolve — mas aí autorize
explicitamente, e limite o usuário de destino ao `deploy`, não ao root.

## Por que userspace

O container tem `/dev/net/tun`, mas pode não ter `CAP_NET_ADMIN` — e depender
disso quebra sem aviso quando a imagem muda. O `tailscaled` sobe em *userspace
networking*, que não precisa de capability: abre um SOCKS5 local e o `ssh` sai
por ele.

```bash
ssh -o ProxyCommand='nc -X 5 -x localhost:1055 %h %p' deploy@thor
```

Como a saída é só HTTPS por proxy, não há UDP para conexão direta e o Tailscale
cai no relay (DERP) sobre 443. Mais lento, e não importa: o que passa por aqui é
um `ssh` de deploy.

## O deploy em si

Com a thor alcançável:

```bash
cd /opt/yugo-platform
bash infra/scripts/atualizar.sh main
```

O `main` explícito não é opcional: o padrão do `atualizar.sh` é `dev`, que não
existe no remoto.

## O que continua sendo decisão sua

Montado isso, sessões futuras passam a subir código para produção sem você no
meio. É conveniência real e superfície real ao mesmo tempo. A chave efêmera e a
ACL estreita existem para que o alcance seja "a thor, na porta 22" e não "o
tailnet" — e valem uma revisão periódica, com a mesma desconfiança com que se
revisa permissão de usuário.
