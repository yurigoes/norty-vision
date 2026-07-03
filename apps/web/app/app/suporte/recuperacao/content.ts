// ============================================================================
// content.ts — Runbook de recuperação/backup (SOMENTE servidor).
// Importado apenas pela server action (actions.ts) — nunca vai pro client antes
// de a senha ser validada. Conteúdo operacional (não contém segredos).
// ============================================================================

export type Block =
  | { t: "p"; text: string }
  | { t: "code"; text: string }
  | { t: "ol"; items: string[] }
  | { t: "ul"; items: string[] }
  | { t: "note"; text: string };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export const RUNBOOK: Section[] = [
  {
    id: "quando",
    title: "0. Quando usar este guia",
    blocks: [
      { t: "p", text: "Procedimento completo para reerguer a plataforma numa VPS nova — do zero ou restaurando um backup — e para deixar o backup automático no Google Drive funcionando." },
      { t: "note", text: "O código está 100% no GitHub (yurigoes/yugo-platform, branch main). Só os DADOS (banco + arquivos) e os SEGREDOS (.env) precisam de backup. Sem backup, os dados de negócio não voltam." },
    ],
  },
  {
    id: "vps",
    title: "1. Provisionar a VPS nova",
    blocks: [
      { t: "p", text: "Especificação recomendada (rodando Chatwoot + GLPI + Evolution + plataforma):" },
      { t: "ul", items: [
        "RAM: 16 GB mínimo, 24 GB confortável.",
        "Swap: 8 GB (rede de segurança).",
        "CPU: 4 vCPU. Disco: 80 GB+ SSD/NVMe.",
        "Debian 12 / Ubuntu 22.04.",
      ] },
      { t: "note", text: "11 GB foi o que travou a máquina antiga: os 3 serviços pesados + Postgres + app não cabem juntos. Não economize na RAM." },
      { t: "p", text: "Garanta swap (se o provedor não criar):" },
      { t: "code", text: "sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile\necho '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab" },
    ],
  },
  {
    id: "docker",
    title: "2. Instalar Docker e clonar o projeto",
    blocks: [
      { t: "code", text: "curl -fsSL https://get.docker.com | sh\ngit clone https://github.com/yurigoes/yugo-platform.git /opt/yugo-platform\ncd /opt/yugo-platform" },
    ],
  },
  {
    id: "segredos",
    title: "3. Gerar segredos e configurar o .env",
    blocks: [
      { t: "p", text: "Gera o .env.production com senhas internas novas (Postgres/Redis/MinIO/JWT):" },
      { t: "code", text: "bash infra/scripts/generate-secrets.sh" },
      { t: "p", text: "Edite infra/docker/.env.production e preencha o que é externo:" },
      { t: "ul", items: [
        "DOMAIN=yugochat.com.br",
        "PLATFORM_ORG_SLUG=yugo",
        "CLOUDFLARED_TOKEN=... (gere um novo no painel Cloudflare → Zero Trust → Tunnels)",
        "RUNBOOK_PASSWORD=... (senha desta página de ajuda)",
        "SMTP e demais integrações: opcional, dá pra configurar depois pelo painel.",
      ] },
      { t: "note", text: "As senhas internas antigas NÃO são necessárias num banco zerado — o generate-secrets cria novas. Só importam se você for RESTAURAR um Postgres antigo (aí o .env precisa bater com o backup)." },
    ],
  },
  {
    id: "subir",
    title: "4. Subir a stack e criar o master",
    blocks: [
      { t: "p", text: "Sobe tudo (banco zerado → todas as migrations aplicam) sem baixar imagens já presentes:" },
      { t: "code", text: "PULL=0 bash infra/scripts/deploy-prod.sh" },
      { t: "p", text: "Cria o primeiro login master (interativo, pede email/nome/senha):" },
      { t: "code", text: "bash infra/scripts/create-master.sh" },
      { t: "note", text: "O deploy já builda api/web sequencialmente, com teto de RAM no next build, e PARA Chatwoot/GLPI/Evolution durante o build pra não estourar a memória. Religa tudo no fim." },
    ],
  },
  {
    id: "reconfig",
    title: "5. Reconfigurar dentro do sistema",
    blocks: [
      { t: "ul", items: [
        "Empresas e lojas (recadastrar).",
        "Mercado Pago: colar as credenciais de novo em cada empresa.",
        "WhatsApp: reparear lendo o QR da Evolution.",
        "Chatwoot / GLPI: reconfigurar integrações.",
        "Clientes, produtos e crediário: recadastrar (se não houver backup).",
      ] },
    ],
  },
  {
    id: "cloudflare",
    title: "6. Cloudflare (domínio)",
    blocks: [
      { t: "p", text: "O túnel usa o CLOUDFLARED_TOKEN do .env. Assim que a VPS nova subir o cloudflared, o domínio aponta pra ela automaticamente. Garanta que o cloudflared da VPS antiga NÃO esteja rodando. Não mexa em DNS." },
    ],
  },
  {
    id: "restore",
    title: "7. Restaurar de um backup (se houver)",
    blocks: [
      { t: "p", text: "Se você tem um tarball gerado pelo backup (backup-volumes.sh ou backup-hot.sh), restaure ANTES do deploy:" },
      { t: "code", text: "bash infra/scripts/restore-volumes.sh /opt/yugo-backup-XXXX.tar.gz\nPULL=0 bash infra/scripts/deploy-prod.sh" },
      { t: "p", text: "Para o backup a quente (backup-hot.sh), o Postgres vem como dump SQL:" },
      { t: "code", text: "tar -xzf yugo-hot-XXXX.tar.gz\nzcat */postgres-all.sql.gz | docker exec -i yugo-postgres psql -U <POSTGRES_USER>" },
    ],
  },
  {
    id: "backup",
    title: "8. Backup automático (local + Google Drive)",
    blocks: [
      { t: "p", text: "8.1 — Criar a pasta no Google Drive e as credenciais (uma vez):" },
      { t: "ol", items: [
        "console.cloud.google.com → novo projeto → ative a 'Google Drive API'.",
        "Tela de consentimento OAuth (External) → adicione seu e-mail como 'test user'.",
        "Credenciais → Criar → ID do cliente OAuth → tipo 'App para computador' → copie Client ID e Client Secret.",
        "developers.google.com/oauthplayground → engrenagem → 'Use your own OAuth credentials' (cole Client ID/Secret) → escopo https://www.googleapis.com/auth/drive → Authorize → Exchange → copie o refresh_token.",
        "No Drive, crie a pasta 'yugo-backups', abra e copie o ID da URL: drive.google.com/drive/folders/<ESTE_ID>.",
      ] },
      { t: "p", text: "8.2 — Configurar na VPS:" },
      { t: "code", text: "cp infra/docker/.gdrive.env.example infra/docker/.gdrive.env\nnano infra/docker/.gdrive.env   # cole CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, FOLDER_ID, GDRIVE_KEEP=4\nchmod 600 infra/docker/.gdrive.env" },
      { t: "p", text: "8.3 — Testar e agendar (diário às 3h):" },
      { t: "code", text: "bash infra/scripts/backup-hot.sh   # deve aparecer 'upload OK'\necho '0 3 * * * root /opt/yugo-platform/infra/scripts/backup-hot.sh >> /var/log/yugo-backup.log 2>&1' | sudo tee /etc/cron.d/yugo-backup" },
      { t: "note", text: "Retenção: GDRIVE_KEEP=4 mantém 4 backups na nuvem. Ao subir o 5º, o mais antigo é apagado automaticamente. Localmente, KEEP mantém os últimos 7." },
    ],
  },
  {
    id: "emergencia",
    title: "9. Emergência: VPS travando por falta de RAM",
    blocks: [
      { t: "p", text: "Se a máquina estiver em swap-thrashing (tudo travando), recupere parando o Docker e cortando o auto-start dos pesados:" },
      { t: "code", text: "sudo systemctl stop docker docker.socket   # libera a RAM, máquina responde\nfree -h" },
      { t: "p", text: "Cortar o restart automático dos pesados (offline, antes de religar):" },
      { t: "code", text: "for hc in /var/lib/docker/containers/*/hostconfig.json; do sed -i 's/\"RestartPolicy\":{\"Name\":\"[^\"]*\"/\"RestartPolicy\":{\"Name\":\"no\"/' \"$hc\"; done\nsudo systemctl start docker" },
      { t: "p", text: "Depois suba o núcleo um a um conferindo a RAM (docker start yugo-postgres, redis, minio, caddy, api, web, cloudflared; free -h entre cada). Religue os pesados só quando houver folga." },
      { t: "note", text: "Causa raiz: VPS pequena demais. A solução definitiva é ter RAM suficiente (passo 1), não ficar cortando serviço." },
    ],
  },
];
