# Central de Atendimento — Desenho da Fase A

> Documento de desenho (não é código). Objetivo: você entender o todo e a gente
> evoluir junto. Fase A = **só software, de graça, reaproveitando o que já existe**
> (inbox/WhatsApp, customers, IA local, kiosk, ponto). Telefonia/VoIP e vídeo ficam
> para as Fases B/C.

---

## 1. Visão geral

Um módulo **CRM operacional de atendimento** por cima do que já temos. O coração é:

- **Lead** = um contato comercial com **dono (operador)**, **etapa do funil**, **score** e uma **linha do tempo** (timeline) de tudo que aconteceu.
- A timeline é **alimentada automaticamente** pelos módulos que já existem (WhatsApp/inbox, vendas, orçamentos, ponto) + ações manuais do operador (ligou, anotou, agendou follow-up).

Princípios:
- **Não duplicar**: o lead "puxa" o histórico das tabelas que já temos.
- **Multiempresa + RLS** (igual ao resto).
- **IA local (Ollama)** para score e sugestões — sem custo.

---

## 2. Como encaixa no que já existe (mapa de integração)

```
            ENTRADAS DE LEAD                         JÁ EXISTE
  ┌─────────────────────────────┐
  │ WhatsApp inbound (Evolution) │──┐   inbox/conversations  ─┐
  │ Webchat / E-mail             │  │   customers            │
  │ Landing / contato do site    │  ├──►   CRM (novo)  ◄──────┤  broadcast (disparador)
  │ Marketplace leads            │  │   crm_lead             │  quotes/orçamentos
  │ Import CSV/XLSX              │──┘   crm_lead_event       │  sales (PDV)
  └─────────────────────────────┘        (timeline)         ┘  ponto (jornada do operador)
                                              │
                                              ▼
                          ┌───────────────────────────────────┐
                          │  TELAS (novas, dentro de /app)      │
                          │  Leads · Acompanhamento · Pipeline  │
                          │  Detalhe do lead · Supervisão       │
                          └───────────────────────────────────┘
```

- **Quando chega um WhatsApp novo** (inbox cria uma `conversation`), o CRM cria/atualiza um `crm_lead` ligado a ela e registra um evento na timeline.
- **Quando o operador responde/atende** no inbox, vira evento na timeline do lead.
- **Quando fecha venda/orçamento**, a etapa do lead avança automaticamente.
- **Supervisão** reusa o padrão dos **painéis kiosk** (wallboard) + `metrics`.

---

## 3. Modelo de dados (novo, aditivo)

Tabelas novas (com `organization_id` + RLS por empresa; nada destrutivo nas existentes):

### `crm_lead`
| campo | tipo | nota |
|---|---|---|
| id | uuid | |
| organization_id / store_id | uuid | RLS |
| customer_id | uuid? | vínculo opcional com `customers` |
| conversation_id | uuid? | vínculo com a conversa do inbox |
| name / phone / email | text | contato (normalizado p/ WhatsApp) |
| source | text | whatsapp · webchat · site · import · manual · marketplace |
| stage | text | etapa do funil (ver §5) |
| owner_membership_id | uuid? | operador dono |
| score | int (0–100) | calculado pela IA |
| status | text | aberto · ganho · perdido |
| lost_reason | text? | motivo da perda |
| next_action_at | timestamptz? | próximo follow-up agendado |
| last_event_at | timestamptz | p/ ordenar "mais quentes/parados" |
| tags | text[] | |
| created_at / updated_at | | |

### `crm_lead_event` (a **linha do tempo**)
| campo | tipo | nota |
|---|---|---|
| id | uuid | |
| organization_id / lead_id | uuid | |
| kind | text | stage_change · note · call · whatsapp_in · whatsapp_out · email · task · task_done · sale · quote · assigned · system |
| title | text | resumo curto ("Mudou para Qualificado") |
| body | text? | detalhe/anotação |
| author_membership_id | uuid? | quem fez (null = sistema/IA) |
| ref_type / ref_id | text/uuid? | aponta p/ conversation, sale, quote… |
| created_at | timestamptz | |

### `crm_task` (follow-ups / agenda do operador)
| campo | tipo | nota |
|---|---|---|
| id, organization_id, lead_id | | |
| title, due_at, owner_membership_id | | |
| done_at | timestamptz? | |

### `crm_pipeline_stage` (etapas configuráveis por empresa)
| campo | nota |
|---|---|
| key, label, order, is_won, is_lost, sla_hours | etapas editáveis (com SLA opcional) |

> Reuso: **nada** de recriar mensagens/vendas/clientes — o lead referencia. A timeline
> agrega eventos próprios + "puxa" os do inbox/vendas quando abre o detalhe.

---

## 4. Telas (wireframes)

### 4.1 Leads (contatos novos) — fila de entrada
Operador "pega" leads novos; admin distribui.
```
┌ Central · Leads novos ───────────────────────────────── [Distribuir] [+ Lead] ┐
│ Filtros: [Canal ▾] [Origem ▾] [Mais quentes ▾]            🔎 buscar           │
│                                                                               │
│ 🟢 NOVO  João Silva   ·  WhatsApp  ·  há 3 min     score 82  [Pegar] [Abrir]  │
│ 🟢 NOVO  Maria Souza  ·  Site      ·  há 12 min    score 64  [Pegar] [Abrir]  │
│ 🟡 SEM DONO  Pedro    ·  Import    ·  ontem        score 40  [Pegar] [Abrir]  │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Acompanhamento (meus leads + linha do tempo)
A tela que você descreveu: o operador acompanha quem ele chamou, com status e timeline.
```
┌ Meus atendimentos ──────────────────────────────────────────────────────────┐
│ [Em contato 5] [Qualificado 3] [Proposta 2] [Negociação 1]   ⏰ 2 follow-ups  │
│                                                                               │
│ ▸ João Silva · Qualificado · ☎ último contato há 1d · próximo: hoje 16h       │
│ ▸ Maria Souza · Em contato · WhatsApp respondido há 2h                        │
└───────────────────────────────────────────────────────────────────────────────┘
        (clicar abre o Detalhe →)
```

### 4.3 Detalhe do lead (timeline)
```
┌ João Silva  ·  (11) 9 9999-8888  ·  score 82  ·  [Qualificado ▾]  [Ganho][Perdido] ┐
│ Dados | Origem WhatsApp | Dono: você | Tags: [orçamento]                          │
│ ─ Ações: [📞 Registrar ligação] [📝 Nota] [⏰ Agendar follow-up] [💬 Abrir conversa]│
│                                                                                   │
│ LINHA DO TEMPO                                                                    │
│ • hoje 14:10  Você ligou (2m) — "vai pensar, retornar 3ª"                         │
│ • hoje 12:00  Mudou p/ Qualificado (você)                                         │
│ • ontem 18:30 WhatsApp recebido: "quero ver preços"   [ver conversa]              │
│ • ontem 18:29 Lead criado · origem WhatsApp                                       │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Pipeline (kanban) — arrastar entre etapas
```
 Novo        Em contato   Qualificado   Proposta    Negociação   Ganho   Perdido
 ┌──────┐    ┌──────┐     ┌──────┐      ┌──────┐    ┌──────┐    ┌────┐  ┌────┐
 │ Ana  │    │ João │     │ Maria│      │ Pedro│    │  ... │    │... │  │... │
 └──────┘    └──────┘     └──────┘      └──────┘    └──────┘    └────┘  └────┘
   3            5            3             2           1
```

### 4.5 Supervisão / Wallboard (reusa kiosk)
```
┌ Supervisão — ao vivo ─────────────────────────────────────────────── ⚽/⌚ ┐
│ Operadores: 6 online · 2 em pausa     Fila: 4 leads novos · espera 3 min     │
│ Conversão hoje: 18%   Leads pegos: 42   Follow-ups vencidos: 5 ⚠            │
│ Ranking: 1) Ana 9 · 2) João 7 · 3) Maria 5                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Funil (etapas) — configurável por empresa
Padrão sugerido (editável): **Novo → Em contato → Qualificado → Proposta → Negociação → Ganho / Perdido**.
Cada etapa pode ter **SLA** (ex.: "responder em 30 min") → alimenta os alertas da supervisão.

---

## 5.1 Tabulação obrigatória (toda interação fechada é tabulada)
Regra: **nada fecha sem tabulação.** Sempre que o operador encerra uma interação
(ligação, conversa de WhatsApp/e-mail/canal social, ou muda o lead para Ganho/Perdido),
o sistema **exige uma tabulação**.

- Reaproveita a **tabulação que já existe no inbox** (`conversation_tabulation`,
  por empresa, com grupo/nome — ex.: "Interesse > Pediu preço", "Sem interesse >
  Já comprou", "Não atende"). Admin configura a lista.
- A tabulação escolhida vira **evento na timeline** (`kind=tabulation`) e fica gravada
  na interação/conversa. Relatórios e o score usam isso.
- "Fechar" o lead (Ganho/Perdido) **abre o seletor de tabulação** antes de concluir;
  Perdido também pede o **motivo** (`lost_reason`).

## 5.2 Omnichannel dentro do sistema + protocolo na timeline
Todo atendimento acontece **dentro do sistema** (não no app pessoal do operador):
WhatsApp, e-mail, webchat e canais sociais (Telegram já na Fase A; Instagram/Messenger
nas fases pagas da Meta).

- Cada interação/conversa gera/possui um **protocolo** (o inbox já tem `protocol` na
  `conversation`). Esse **protocolo + a conversa** ficam **anexados à timeline do lead**.
- Na timeline, o evento mostra o protocolo e um **"abrir conversa"** (histórico completo
  de mensagens daquele canal, dentro do sistema).
- **"Subir depois"**: se o operador precisar retomar/escalar um protocolo antigo, ele
  **reabre** a conversa pela timeline (ou busca pelo número do protocolo) e ela volta
  pra fila/atendimento — sem perder o histórico. (status da conversa: aberta → resolvida
  → reaberta, que o inbox já suporta.)

## 6. Fluxos automáticos (o que a timeline registra sozinha)
- WhatsApp recebido/enviado (via inbox) → evento `whatsapp_in/out`.
- Lead pego/atribuído → `assigned`; mudança de etapa → `stage_change`.
- Orçamento criado / venda fechada → `quote` / `sale` (avança etapa se configurado).
- Follow-up criado/concluído → `task` / `task_done`.
- **Tabulação registrada** ao fechar interação → evento `tabulation` (com grupo/nome).
- **Protocolo** de cada conversa (qualquer canal) → fica vinculado ao evento e reabrível.
- Sem interação há X dias → marca como "parado" (cor) e pode notificar o dono.

---

## 7. Lead Scoring (IA local, grátis)
- Sinais: origem, velocidade de resposta, nº de interações, se pediu preço/orçamento, histórico de compra (customers/sales).
- A IA (Ollama, via `OrgAiService`) gera um **score 0–100** + uma **frase de recomendação** ("quente, ligar hoje"). Recalcula em eventos relevantes.
- Começa com regras simples (determinístico) + camada de IA por cima — sem custo.

---

## 8. Distribuição (quem pega o lead)
- **Manual** (operador "Pega") e/ou **automática** (round-robin / por skill / por carga), reusando a lógica de fila que o inbox já tem.
- Admin vê todos; operador vê os **dele** (mesmo padrão de visibilidade do suporte que fizemos).

---

## 9. API (esboço de rotas)
```
GET  /api/crm/leads?stage=&owner=&q=          # lista (fila / meus)
POST /api/crm/leads                            # criar (manual/import)
GET  /api/crm/leads/:id                        # detalhe + timeline
PATCH/api/crm/leads/:id                        # etapa, dono, tags, ganho/perdido
POST /api/crm/leads/:id/claim                  # "pegar"
POST /api/crm/leads/:id/event                  # nota/ligação/etc.
POST /api/crm/leads/:id/task                   # agendar follow-up
GET  /api/crm/pipeline                         # etapas configuráveis
GET  /api/crm/board                            # dados do kanban
GET  /api/crm/supervision                      # wallboard ao vivo
```

---

## 10. Segurança / multiempresa
- RLS por `organization_id` em todas as tabelas novas (master bypass).
- Operador vê só os leads dele; admin vê os da empresa; master vê tudo.
- Tudo logado (auditoria) — base para a parte de compliance/LGPD da Fase A.

---

## 11. Entrega incremental da Fase A
- **A.1 — núcleo do lead:** `crm_lead` + `crm_lead_event` + telas **Leads (fila)**, **Acompanhamento**, **Detalhe (timeline)** + criação automática a partir do WhatsApp/inbox. *(o que você pediu primeiro)*
- **A.2 — pipeline + tarefas:** kanban arrastável, etapas configuráveis, follow-ups (`crm_task`), avanço automático por venda/orçamento.
- **A.3 — scoring + supervisão:** lead scoring (IA local) + wallboard ao vivo + ranking/SLA.
- **A.4 — extras grátis:** canal Telegram no inbox · LGPD (consentimento/anonimização).

> Fases B (VoIP WebRTC interno + softphone) e C (trunk SIP/discador/transcrição/canais Meta) entram depois, como módulos/containers separados na mesma VPS, sem tocar nos dados existentes.

---

## 12. Integração na VPS (sem perder dado)
- Módulo novo no monorepo (`apps/api/src/crm` + páginas em `apps/web/app/app/crm`).
- Migrations **aditivas idempotentes** (`IF NOT EXISTS`) — nunca alteram tabelas existentes.
- Backup antes de cada deploy; branch `dev` → `atualizar.sh` (db-apply idempotente).

---

## 13. Armazenamento de gravações (sem pesar o servidor) — Google Drive multi-conta
Gravações de **ligação** (Fase B/C) e **vídeo** (Jitsi, Fase B) são arquivos grandes.
Para não encher o disco da VPS, a estratégia é um **adapter de armazenamento de mídia**
com camada de **arquivamento no Google Drive** (grátis, 15 GB por conta), com **rotação
entre várias contas** para backup/capacidade.

### Como funciona
1. A gravação é gerada (servidor de voz/vídeo) e fica **temporariamente** no disco/MinIO.
2. Um **worker** sobe o arquivo para o **Google Drive** (na conta com espaço livre) e
   **apaga o local**. No nosso banco guardamos só **metadados** (lead_id, protocolo,
   duração, tamanho, `drive_account`, `drive_file_id`, data) — **não o arquivo**.
3. Para ouvir/ver no sistema: gera-se um **link temporário** (ou baixa sob demanda) a
   partir do `drive_file_id`. A timeline mostra "▶ gravação" apontando pra isso.
4. **Rotação/backup**: quando uma conta enche, o worker vai pra próxima; dá pra subir a
   **mesma gravação em 2 contas** (redundância) se quiser backup real.

### Modelo (novo, Fase B)
`recording` (organization_id, lead_id?, conversation_id?, protocol, kind = call|video,
duration_s, size_bytes, storage = gdrive|minio, drive_account, drive_file_id, url_cache,
created_at).

`gdrive_account` (label, client_id/secret e refresh_token **cifrados no vault**,
used_bytes, quota_bytes, active) — lista de contas em rotação, gerida pelo master/admin.

### Implementação (grátis)
- **rclone** (multi-remote) ou **Google Drive API** (OAuth2 por conta).
- Recomendo começar com **rclone** num container/worker: simples para upload em massa,
  já lida com múltiplos remotes (contas) e rotação por espaço.
- Reusa o **vault** (segredos cifrados) que já temos para guardar os tokens das contas.

### ⚠️ Limites/avisos honestos (Google Drive)
- O Drive tem **quotas de API** (uploads/dia, rate limit) e os **15 GB são compartilhados**
  com Gmail/Fotos da conta → use contas **dedicadas** só pra isso.
- É ótimo para **arquivo/backup** (subir depois que a gravação termina), **não** para
  streaming ao vivo nem acesso aleatório de alta frequência.
- Termos de uso: ok para uso próprio/arquivamento; evite revender espaço de Drive.
- Alternativa/併: manter **MinIO** como camada "quente" (gravações recentes, acesso rápido)
  e mandar o "frio" pro Drive por um worker → libera disco sem perder agilidade no recente.

> Como gravação só existe quando entrar VoIP/vídeo (Fases B/C), o **adapter + tabela
> `recording`** podem ser criados já na transição, e a mesma camada serve para qualquer
> mídia grande (inclusive anexos pesados do WhatsApp hoje).

---

## 14. Motor de Prospecção de Leads ("Prospector") — grátis, sem comprar cartela
Robô que, a partir de **nicho + região**, busca leads novos de **fontes públicas
gratuitas** de tempos em tempos e joga na fila do CRM. Substitui a compra de cartela.

### Fluxo
```
[Campanha de prospecção]  → worker agendado (cron) → fontes públicas grátis
  nicho (CNAE/categoria)                              ├─ OpenStreetMap (Overpass API)
  região (município/UF/raio)                          └─ CNPJ Dados Abertos (CNAE+UF)
  frequência (diária/semanal)        → dedupe (telefone/CNPJ/nome+cidade)
  limite por rodada                  → cria crm_lead (source="prospector", enriquecido)
                                     → cai em "Leads novos" → operador pega → IA dá score
```

### Fontes (free-first)
- ✅ **OpenStreetMap / Overpass API** — grátis, sem chave. Estabelecimentos por tipo +
  cidade (nome, endereço, às vezes telefone/site).
- ✅ **CNPJ — Dados Abertos (Receita)** — melhor B2B grátis: busca por **CNAE + município/UF**
  (razão social, endereço, telefone, situação). Subconjunto filtrado ou mirror/API comunitária.
- ❌ Google Maps/Places (pago + ToS), Instagram/Facebook/diretórios (ToS/ban), enriquecimento pago.

### Modelo (novo)
- `prospect_campaign` (org, nome, niche/cnae, regiao, fontes[], frequencia, limite, ativo, ultima_exec).
- `prospect_result` (campaign_id, fonte, dados crus, dedupe_key, status = novo|virou_lead|descartado, lead_id?).
- `prospect_optout` (telefone/cnpj que pediu "não perturbe") — respeitado em toda rodada.
- Reusa o **scheduler** (cron) e cria `crm_lead` com `source="prospector"`.

### LGPD / ética (obrigatório no robô)
- Só **dados públicos de empresa** (telefone comercial, endereço, CNPJ) por **legítimo interesse**.
- **Opt-out** (`prospect_optout`) respeitado sempre; sem dados sensíveis; tudo logado (base legal).
- Rate limit por fonte (não martelar a API) + cache.

### Trade-off
- Grátis = mais **volume bruto** e mais **limpeza manual** (nem todo registro tem telefone).
- Qualidade premium (Maps) é paga → fora por enquanto. Para começar sem custo, OSM + CNPJ aberto.

### Entrega
- **A.5 (depois do CRM A.1–A.3)**: 1ª fonte = **OSM Overpass** (mais simples, sem dataset);
  depois **CNPJ aberto** (B2B forte). Tela de campanhas de prospecção + a fila já existente
  de "Leads novos" recebe o resultado.
- **Decisão (Yuri):** foco **B2B** (prospecção ativa por nicho/CNAE/região); **OSM primeiro,
  CNPJ depois**. B2C fica como inbound (anúncio/landing/indicação), não scraping.

---

## 15. FASE B — Voz e Vídeo (self-host, grátis) — desenho
Ordem recomendada: **B.1 Vídeo (fácil) → B.2 Voz (pesado)**. Tudo self-host/grátis;
PSTN (ligar pra fora) só na Fase C (trunk pago).

### B.1 — Videoconferência (Jitsi)
- **Caminho fácil/zero-infra:** sala por lead/atendimento em `meet.jit.si` (grátis) —
  geramos a URL (`https://meet.jit.si/yugo-<token>`), gravamos como **evento na timeline**
  do lead e abrimos numa aba. Funciona hoje, sem container.
- **Caminho self-host:** subir **Jitsi Meet** em container na VPS (atrás do Caddy), domínio
  próprio (ex.: `meet.seudominio`). Melhor marca/controle; consome CPU/RAM (vídeo é pesado).
- Recursos: link por lead, embed (iframe), gravação (no self-host, via jibri → arquivo →
  **Google Drive** pela camada da §13). 1ª entrega: **rooms meet.jit.si** + timeline.

### B.2 — VoIP interno (WebRTC, FreeSWITCH)
- **FreeSWITCH** (container) como core SIP/WebRTC. **Ramais** por operador (WebRTC), softphone
  no navegador (SIP.js/JsSIP sobre WSS). Ligação **ramal↔ramal interna grátis**; ligar pra
  número externo (PSTN) exige **trunk SIP pago** (Fase C).
- **Ramal por operador (auto, grátis):** ao logar, o operador recebe um ramal automático
  (`voip_extension` operador↔ramal). Disca **pelo nome** (lista de operadores online); ao tocar
  aparece o **nome** (Caller-ID = nome do operador). Conferência + transferência assistida
  ("aprovar" antes de juntar) e supervisão (escutar/sussurrar/barge) = recursos do FreeSWITCH,
  **internos e grátis**.
- **Número grátis (verdade):** PABX interno NÃO precisa de número. Para **discar/receber de
  telefone real (PSTN)** é preciso **DID + trunk SIP** — **não há opção grátis confiável no BR**
  (número BR custa ~poucos reais/mês + minuto) → **Fase C**. Alternativas grátis p/ falar com
  cliente sem número: **WhatsApp** (já temos) e **link de chamada WebRTC** (áudio, igual ao
  vídeo Jitsi — cliente entra por link, sem app/sem número).
- Sinalização WSS atrás do Caddy; mídia (RTP/SRTP) precisa de portas UDP abertas + (se NAT)
  TURN (coturn). Atenção: **consome CPU/banda**; numa VPS enxuta pode pedir 2ª VPS.
- Modelo de dados: `voip_extension` (operador↔ramal), `call` (origem/destino/duração/status/
  gravação) → eventos na timeline do CRM ("📞 ligação"). Gravação → Drive (§13).
- **Click-to-call** a partir do lead (quando houver trunk): liga o ramal do operador ao número.

### Capacidade / risco (honesto)
- **Jitsi** e **FreeSWITCH** são pesados (CPU/RAM/banda). A VPS atual roda bem CRM/omnichannel/IA,
  mas voz/vídeo simultâneos pedem medição. Recomendo: **B.1 com meet.jit.si primeiro** (zero
  infra), e **B.2/Jitsi self-host só após avaliar capacidade** (talvez 2ª VPS dedicada a mídia).
- Tudo entra como **container separado + tabelas novas** (não toca nos dados existentes).
```

