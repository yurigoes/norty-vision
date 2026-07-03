# Ponto eletrônico (REP-A — Portaria 671)

Módulo de ponto da yugo-platform. Marcação imutável (horário do servidor + NSR +
hash encadeado), espelho/jornada, banco de horas, fechamento de folha, geração de
**AFD/AEJ** assinados (ICP-Brasil A1 → `.p7s`), PWA por dispositivo, reconhecimento
facial + prova de vida, avisos, webhook e dashboard em tempo real.

> ⚠️ Conformidade legal (AFD/AEJ, DSR, horário contratual, CRC-16, AD-RB do `.p7s`)
> deve ser validada com contador/jurídico + verificador oficial do ITI antes de
> produção. O código gera os arquivos estruturados e assinados para essa validação.

## Mapa de endpoints

### Admin — autenticado (sessão do `/app`, prefixo `/api`)
**Config / empregador**
- `GET /api/ponto/config` · `POST /api/ponto/config` — empregador, facial, fundo, webhook

**Funcionários**
- `GET /api/ponto/employees` · `POST /api/ponto/employees`
- `POST /api/ponto/employees/:id/face` — cadastrar rosto (enroll)

**Marcações / jornada**
- `POST /api/ponto/punch` — bater (admin/web)
- `GET /api/ponto/punches` · `GET /api/ponto/punches/:id/comprovante` · `GET /api/ponto/punches/:id/selfie`
- `GET /api/ponto/verify-chain` — integridade do hash-chain
- `GET /api/ponto/espelho` · `GET /api/ponto/divergencias`
- `GET/POST /api/ponto/justificativas` · `POST /api/ponto/justificativas/:id/review`
- `GET/POST /api/ponto/schedules` — escalas

**Banco de horas / fechamento / arquivos legais**
- `GET/POST /api/ponto/banco` · `POST /api/ponto/banco/:id/delete` · `POST /api/ponto/banco/sweep`
- `GET /api/ponto/fechamento` · `GET /api/ponto/fechamento/:ref` · `/resumo`
- `POST /api/ponto/fechamento/:ref/aprovar-gestor` · `/fechar-rh` · `/reabrir`
- `GET /api/ponto/fechamento/:ref/export.csv`
- `GET /api/ponto/aej?from&to` — AEJ assinado (`.p7s`)
- `GET /api/ponto/afd?from&to` — AFD (+ `.p7s`)

**Certificado A1 / assinatura**
- `GET /api/ponto/cert` · `POST /api/ponto/cert` · `POST /api/ponto/cert/remove`

**Avisos / fundo / dispositivos / facial**
- `GET/POST /api/ponto/notices` · `POST /api/ponto/notices/:id/delete`
- `POST /api/ponto/background`
- `GET /api/ponto/devices` · `POST /api/ponto/devices` · `POST /api/ponto/devices/:id`
- `POST /api/ponto/face-test` — testar reconhecimento (calibração do limiar)

**Webhook / eventos**
- `GET /api/ponto/webhook` (info + segredo auto) · `POST /api/ponto/webhook/regenerate`
- `GET /api/ponto/eventos` — feed interno (inbox por empresa)

### Público — token do dispositivo (`/ponto-app`)
- `GET /api/ponto-pwa/bootstrap?token=` — tela inicial (empresa, fundo, avisos, flags)
- `POST /api/ponto-pwa/identify` — por código de barras / CPF / matrícula
- `POST /api/ponto-pwa/punch` — bate (após identificar) — selfie/GPS/liveness conforme config
- `POST /api/ponto-pwa/face-punch` — **bate pelo rosto (1:N)**

### Portal do funcionário (sessão do `/rh`)
- `POST /api/employee/ponto/punch` — bate no REP-A vinculado ao RH
- `POST /api/employee/clock` — fluxo legado que também registra no REP-A

## Serviço facial (yugo-face — grátis, self-hosted, rede interna)
Container `infra/face` (Flask + DeepFace). Não exposto na internet.
- `GET http://yugo-face:8080/health`
- `POST /verify` — 1:1 `{reference, probe}`(base64) → `{similarity}`
- `POST /identify` — 1:N `{probe, candidates:[{id,image}]}` → `{id, similarity}`

Config no painel (Empregador → facial): provedor **HTTP**, URL `http://yugo-face:8080/verify`,
similaridade mínima (calibrar com "Testar reconhecimento"), `x-api-key` opcional
(env `FACE_API_KEY`). Liveness é client-side (grátis), só marcar "Exigir prova de vida".

## Webhook
Evento `ponto.punch.created` é gravado no feed interno (sempre) e, se houver URL externa,
enviado por POST com header `x-ponto-signature = sha256(segredo + corpo)`. O segredo é
gerado automaticamente por empresa (aba Eventos / Webhook).

## Modelos (Prisma) e migrations
`ponto_config`, `ponto_employee`, `ponto_punch`, `ponto_audit`, `ponto_schedule`,
`ponto_justification`, `ponto_device`, `ponto_notice`, `ponto_bank_movement`,
`ponto_closing`, `ponto_webhook_event`. Migrations SQL: `packages/db/sql/125..134_ponto*`.

## Deploy
`bash infra/scripts/deploy-prod.sh` (migrations aplicam sozinhas, `prisma generate` no build).
Facial: `FACE_LOCAL_ENABLED=1` em `infra/docker/.env.production` liga o overlay do yugo-face.

## Fases (todas concluídas em código; homologação legal pendente)
0 marcação imutável + AFD · 1 jornada/espelho · 2 PWA (GPS/selfie/offline/geofence) ·
3 facial + liveness + antifraude · 4 banco de horas + fechamento + AEJ + assinatura A1 ·
5 escalas complexas + tempo real + IA absenteísmo + webhooks · extras (vínculo RH,
crachá EAN-13, painel lock-screen, avisos, fundo, bater pela face 1:N).
