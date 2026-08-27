# Deploy pelo Claude Code na web

O deploy da produção roda **dentro da thor**, em `/opt/yugo-platform`. Para o
Claude Code na web rodar isso sozinho, ele precisa alcançar a thor — e a sessão
dele não é a sua máquina: é um container efêmero na nuvem da Anthropic, com rede
própria e política de saída própria. O Tailscale que está ativo no seu notebook
não chega lá.

`infra/scripts/claude-ambiente-tailscale.sh` põe esse container dentro do
tailnet. Ele depende de três coisas que **só você** pode providenciar.

## As três

### 1. `TS_AUTHKEY` na configuração do ambiente

Entrar num tailnet exige credencial, e credencial não se descobre — se emite.
Em https://login.tailscale.com/admin/settings/keys, gere uma chave com:

| opção | por quê |
| --- | --- |
| **Ephemeral** | o nó some sozinho quando o container morre; sem isso cada sessão deixa um fantasma na lista de máquinas |
| **Pre-approved** | senão o nó fica pendurado esperando aprovação manual |
| **Tagged** (`tag:claude-code`) | é o que dá à ACL um nome para falar dele |
| **Reusable** | cada sessão é um container novo |

A chave vai na configuração do ambiente, não no repositório.

### 2. `tailscale.com` e `pkgs.tailscale.com` liberados na política de rede

Hoje a saída deste ambiente responde **403 no CONNECT** para os dois:

```
pkgs.tailscale.com:443    connect_rejected
tailscale.com:443         connect_rejected
```

O instalador oficial não baixa. Isso é política de rede do ambiente, ajustável
na configuração dele — e não é para contornar por fora: o bloqueio existe para
controlar o que este container instala.

### 3. Uma ACL que dê acesso à thor, e só a ela

O nó não precisa do tailnet inteiro. Uma sessão de agente com alcance a todas as
suas máquinas é bem mais do que o deploy pede:

```json
{
  "action": "accept",
  "src":    ["tag:claude-code"],
  "dst":    ["tag:thor:22"]
}
```

Se você preferir dispensar chave SSH, o Tailscale SSH resolve — mas aí a regra
precisa autorizar isso explicitamente, e vale limitar o usuário de destino ao
`deploy`, não ao root.

## Por que userspace

O container tem `/dev/net/tun`, mas pode não ter `CAP_NET_ADMIN` — e depender
disso quebra sem aviso quando a imagem muda. O script sobe o `tailscaled` em
*userspace networking*, que não precisa de capability nenhuma: abre um SOCKS5
local e o `ssh` sai por ele. É mais lento, e não importa — o que passa por aqui
é um `ssh` de deploy.

```bash
ssh -o ProxyCommand='nc -X 5 -x localhost:1055 %h %p' deploy@thor
```

## O deploy em si

Com a thor alcançável, o comando é o mesmo de sempre:

```bash
cd /opt/yugo-platform
bash infra/scripts/atualizar.sh main
```

O `main` explícito não é opcional: o padrão do `atualizar.sh` é `dev`, que não
existe no remoto.

## O que continua sendo decisão sua

Montado isso, sessões futuras passam a conseguir subir código para produção sem
você no meio. Isso é conveniência real e superfície real ao mesmo tempo — a
chave efêmera e a ACL estreita existem justamente para que o alcance seja "a
thor, na porta 22", e não "o tailnet". Vale revisar essa ACL de vez em quando
com a mesma desconfiança com que se revisa permissão de usuário.
