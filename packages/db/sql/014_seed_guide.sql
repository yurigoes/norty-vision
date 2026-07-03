-- ==============================================================================
-- 014_seed_guide.sql
-- Conteudo inicial da aba "Guia do Sistema" - explica o que cada modulo faz.
-- ==============================================================================

-- limpa antes pra fazer re-seed limpo (raro precisar)
-- Comentado por seguranca; descomentar manualmente em DEV se quiser refazer.
-- DELETE FROM system_guide_sections WHERE path LIKE 'overview/%' OR path LIKE 'agenda/%' OR path LIKE 'leads/%' OR path LIKE 'disparador/%';

-- raiz: overview
INSERT INTO system_guide_sections (id, parent_id, depth, path, slug, title, body_markdown, module, display_order)
VALUES
  ('11111111-0000-0000-0000-000000000001'::uuid, NULL, 0, 'overview', 'overview',
   'Visao geral da plataforma',
   $$
# Visao geral do yugo-platform

O yugo-platform e um SaaS multi-tenant que cobre 3 grandes areas operacionais:

| Modulo      | O que faz                                                       |
| ----------- | --------------------------------------------------------------- |
| Agenda      | Marca e gerencia atendimentos. Confirma com cliente via WhatsApp. |
| Leads       | CRM kanban de oportunidades comerciais.                          |
| Disparador  | Envio em massa de mensagens (WhatsApp, SMS, email).              |

Tudo amarrado por **multinivel + multiloja**:

- Uma **organizacao** (cliente master) pode ter varias **lojas/filiais**.
- Um **usuario** pode ter papeis diferentes em lojas diferentes.
- Cada loja tem seus proprios clientes, agendamentos, leads, campanhas — isolados.
$$,
   'overview', 0),

  -- ============ AGENDA ============
  ('11111111-0000-0000-0000-000000000010'::uuid, NULL, 0, 'agenda', 'agenda',
   'Modulo Agenda',
   $$
# Modulo Agenda

## Para que serve

Substitui agendas de papel e planilhas. Centraliza horarios de profissionais,
permite que recepcao marque atendimentos, dispara confirmacao automatica e
recebe a resposta do cliente.

## Conceitos

- **Profissional** - quem atende (medico, atendente especialista).
- **Template de agenda** - modelo semanal de horarios (ex: Seg-Sex 8h-12h e 14h-18h, slots de 15 min).
- **Slot** - horario concreto gerado pelo template (ou criado manualmente).
- **Capacidade do slot** - quantos pacientes podem ser agendados no mesmo horario
  (ex: 4 pessoas marcam pra 06:30, todas chegam no mesmo horario - util pra otica
  e clinica de imagem que faz triagem em lote).
- **Agendamento** - reserva concreta de um cliente num slot.
- **Eventos** - timeline imutavel de tudo que aconteceu no agendamento
  (criado, lembrete enviado, cliente confirmou, etc).

## Fluxo padrao

```
1. Profissional cadastrado
2. Template de agenda configurado
3. Sistema gera slots dos proximos 60 dias
4. Recepcao marca clientes nos slots
5. (D-3) Worker dispara WhatsApp pedindo confirmacao
6. Cliente responde 1/2/3 ou texto livre
7. NLU classifica e atualiza status do agendamento
8. (se nao entendeu) Fila de revisao humana
```
$$,
   'agenda', 10),

  ('11111111-0000-0000-0000-000000000011'::uuid, '11111111-0000-0000-0000-000000000010'::uuid, 1,
   'agenda/nlu', 'nlu',
   'NLU: como o sistema interpreta respostas',
   $$
# NLU - Natural Language Understanding

## Problema

Quando o sistema pede "responda 1 pra confirmar, 2 pra reagendar, 3 pra cancelar",
clientes respondem coisas como:

- "pode confirmar"
- "ta bom"
- "outro dia"
- "nao tenho mais interesse"
- emojis ✅ 👍

O sistema antigo usava regex literal "1|2|3" e perdia todas essas respostas.

## Solucao em 3 camadas

### 1. Match exato (instantaneo, custo zero)

`1`, `2`, `3`, `sim`, `nao`, etc.

### 2. Palavras-chave por loja (configuravel)

Tabela `intent_keywords` com hierarquia:

- **Global** - termos PT-BR padrao (seed inicial com ~50 entradas)
- **Organizacao** - palavras adicionadas pela rede toda
- **Loja** - palavras especificas daquela unidade

Cada palavra tem **peso** (0.0 - 1.0). Sistema soma os pesos das palavras
que batem na mensagem e classifica pela maior soma acima de **0.7**.

### 3. Fallback LLM (Claude Haiku)

Se nada bater claramente, o sistema chama uma IA pequena (~$0.001 por classificacao)
que retorna confirm/reschedule/cancel/unknown.

### Fila de revisao

Mensagens classificadas como `unknown` ou com score baixo entram na
**Fila de revisao** - a recepcao classifica manualmente, e tem opcao de
**"promover a palavra como nova regra"** - o sistema aprende.
$$,
   'agenda', 20),

  -- ============ LEADS ============
  ('11111111-0000-0000-0000-000000000020'::uuid, NULL, 0, 'leads', 'leads',
   'Modulo Leads',
   $$
# Modulo Leads

CRM kanban configuravel para gestao de oportunidades comerciais.

## Conceitos

- **Pipeline** - fluxo de vendas. Pode haver varios (Vendas, Atendimento, Pos-Venda).
- **Estagio** - coluna do kanban (Novo, Contato feito, Proposta, Convertido, Perdido).
- **Lead** - oportunidade individual. Tem cliente associado (ou potencial cliente).
- **Atribuicao** - lead pode ter vendedor responsavel; visibilidade respeita.
- **Eventos** - tudo que aconteceu no lead (mudou estagio, ligacao registrada, mensagem enviada).

## Customizacao

Cada loja desenha seu proprio kanban. Pipelines, estagios, cores, ordem.
Templates globais agilizam o setup inicial.
$$,
   'leads', 30),

  -- ============ DISPARADOR ============
  ('11111111-0000-0000-0000-000000000030'::uuid, NULL, 0, 'disparador', 'disparador',
   'Modulo Disparador',
   $$
# Modulo Disparador

Envio em massa de mensagens via WhatsApp Business, SMS e email.

## Conceitos

- **Template** - modelo de mensagem reutilizavel, com variaveis `{{customer.name}}` etc.
  WhatsApp Business exige que templates sejam **aprovados pela Meta** antes de uso.
- **Campanha** - instancia de envio. Tem template + segmento (filtro) + agendamento.
- **Segmento** - filtro pra escolher destinatarios (tags, ultima compra, opt-out).
- **Alvo (target)** - 1 destinatario individual dentro da campanha.
- **Status de entrega** - queued / sending / sent / delivered / read / replied / failed / opted_out.

## Limites e boa pratica

- Rate-limit padrao: 30 mensagens/minuto. Aumentar exige conta WhatsApp confiavel.
- Sistema respeita `opt_out_marketing` automaticamente; quem optou por sair fica de fora.
- Toda mensagem fica em `message_log` pra auditoria e LGPD.
$$,
   'disparador', 40),

  -- ============ PLATAFORMA ============
  ('11111111-0000-0000-0000-000000000040'::uuid, NULL, 0, 'platform', 'platform',
   'Plataforma e seguranca',
   $$
# Plataforma e seguranca

## Tenancy

Multi-tenant compartilhado com isolamento via Row-Level Security (RLS) no Postgres.
Mesmo que a API tenha um bug e esqueca o filtro, o banco bloqueia.

## Auditoria

Tabela `audit_log` particionada por mes registra toda acao sensivel
(login, criacao, alteracao, exclusao). Append-only - ninguem altera depois.

Tabela `data_access_log` rastreia LGPD: quem visualizou/exportou dados pessoais quando.

## Backups

Postgres em backup diario criptografado para MinIO. Retencao 30 dias.
Teste de restore trimestral.

## Detalhes tecnicos completos

Disponivel na aba **Specs Tecnicas** (acesso restrito).
$$,
   'platform', 50)

ON CONFLICT (path) DO UPDATE SET
  title         = EXCLUDED.title,
  body_markdown = EXCLUDED.body_markdown,
  module        = EXCLUDED.module,
  display_order = EXCLUDED.display_order,
  version       = system_guide_sections.version + 1,
  updated_at    = now();
