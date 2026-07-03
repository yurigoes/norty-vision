-- ==============================================================================
-- 013_seed_help.sql
-- Conteudo inicial da aba "Ajuda" - alimentado conforme o sistema cresce.
-- ==============================================================================

INSERT INTO help_articles (organization_id, slug, category, title, summary, body_markdown, display_order, tags)
VALUES
  (NULL, 'primeiros-passos', 'geral', 'Primeiros passos no yugo-platform',
   'Como entrar no sistema, escolher loja ativa e navegar pelos modulos.',
   $$
# Primeiros passos

Bem-vindo ao **yugo-platform**. Esta pagina explica o basico para voce comecar a usar o sistema.

## 1. Entrar no sistema

1. Acesse `https://yugochat.com.br/app`
2. Informe seu **email** cadastrado e sua **senha**
3. Se o 2FA estiver ativo, informe o codigo de 6 digitos do seu app autenticador

## 2. Escolher a loja ativa

Se voce tem acesso a mais de uma loja (filial), o sistema pede que escolha qual quer usar agora.
Voce pode trocar a qualquer momento no menu superior, ao lado do seu nome.

## 3. Modulos disponiveis

- **Agenda** - criar slots, marcar atendimentos, confirmar com clientes via WhatsApp
- **Leads** - kanban de oportunidades comerciais
- **Disparador** - envio em massa de mensagens (com templates aprovados)
- **Clientes** - cadastro unificado de pacientes/compradores
- **Configuracoes** - usuarios, perfis de acesso, integracoes

## 4. Onde pedir ajuda

- **Aba Ajuda** (esta) - passo a passo de cada acao
- **Aba Guia do Sistema** - explicacao detalhada de cada modulo
- Email: `suporte@yugochat.com.br`
$$,
   10, ARRAY['onboarding','login','navegacao']),

  (NULL, 'fazer-login', 'geral', 'Como fazer login com 2FA',
   'Passo a passo do login normal e como configurar autenticacao em 2 fatores.',
   $$
# Fazer login

## Login basico

1. URL: `https://yugochat.com.br/app`
2. Email cadastrado
3. Senha
4. Botao **Entrar**

## Login com 2FA (recomendado)

Se voce ativou o **2FA** (autenticacao em 2 fatores), o sistema vai pedir um codigo
de 6 digitos depois da senha.

### Ativando o 2FA pela primeira vez

1. Apos logar, va em **Meu Perfil > Seguranca > Ativar 2FA**
2. Escaneie o QR Code com o app **Google Authenticator**, **Authy** ou **1Password**
3. Digite o codigo de 6 digitos que aparece no app pra confirmar
4. **Guarde os codigos de recuperacao** em local seguro (gerenciador de senhas).
   Sao a sua unica salvacao se voce perder o celular.

### Esqueci a senha

Clique em **Esqueci minha senha** na tela de login. Voce recebe um link por email
valido por 30 minutos.
$$,
   20, ARRAY['login','2fa','seguranca','senha']),

  (NULL, 'agenda-criar-slot', 'agenda', 'Criar um slot de atendimento',
   'Como abrir vagas de atendimento na agenda de um profissional.',
   $$
# Criar slot de atendimento

Slot = horario disponivel para um profissional atender.

## Slot avulso (rapido)

1. Va em **Agenda > Novo slot**
2. Escolha o **profissional**
3. Escolha **data e hora de inicio**
4. **Duracao** (padrao 15 min) e **capacidade** (quantos pacientes podem ser agendados no mesmo horario, padrao 1)
5. Salvar

## Slots em serie (template semanal)

Para nao precisar criar 1 por 1:

1. Va em **Agenda > Templates**
2. **Novo template** > Nome, profissional
3. Configure os blocos da semana: ex segunda 08:00-12:00 cada 15 min, 14:00-18:00 cada 15 min
4. Salvar e ativar
5. O sistema gera os slots automaticamente pelos proximos 60 dias

## Bloquear um slot

Se um slot existe mas voce nao quer agendamentos (almoco, reuniao):

- Lista de slots > clicar no slot > **Bloquear** > informar motivo
$$,
   30, ARRAY['agenda','slot','template']),

  (NULL, 'agenda-confirmar-resposta', 'agenda', 'Quando o sistema nao entende a resposta',
   'O que fazer quando a confirmacao do paciente cai na fila de revisao.',
   $$
# Respostas que o sistema nao entendeu

Quando enviamos a mensagem de confirmacao 3 dias antes da consulta, o paciente
deveria responder **1** (confirmo), **2** (reagendar) ou **3** (cancelar).

Mas pacientes escrevem coisas como "pode confirmar", "outro dia", "nao tenho mais
interesse". O sistema tenta entender em **3 camadas**:

1. **Match exato** - 1, 2, 3, sim, nao
2. **Palavras-chave** - "confirmo", "reagendar", "cancelar" e similares (configuravel)
3. **IA** - se nada bater, pede a uma IA pra classificar

Se mesmo a IA nao tiver certeza, a mensagem cai na **Fila de revisao**.

## Resolver da fila

1. Va em **Agenda > Fila de revisao**
2. Veja a mensagem original do paciente
3. Veja os candidatos rankeados pela IA
4. Clique no botao da intencao correta: **Confirmar**, **Reagendar**, **Cancelar**, **Ignorar**
5. Marque a opcao **"Ensinar o sistema com esta palavra"** se quiser que da proxima vez ja entenda

## Adicionar palavras manualmente

Se voce ve a mesma palavra cair sempre na fila:

1. **Configuracoes > Palavras-chave**
2. **Nova palavra** > intencao (confirm/reschedule/cancel/opt_out)
3. Tipo de match: exato, contem, regex
4. Salvar. A partir da proxima resposta, a palavra ja casa.
$$,
   40, ARRAY['agenda','nlu','confirmacao','whatsapp']),

  (NULL, 'leads-criar', 'leads', 'Cadastrar um lead',
   'Como adicionar uma oportunidade comercial.',
   $$
# Cadastrar um lead

1. **Leads > Novo lead**
2. Selecione o **pipeline** (Vendas, Atendimento, etc) e o **estagio inicial**
3. Nome, telefone, email
4. Titulo (ex "Interesse em oculos progressivo")
5. Estimativa de valor (opcional)
6. Origem (de onde veio - website, indicacao, disparo)
7. Atribuir a um vendedor (opcional)
8. Salvar

## Importar leads em lote

Para importar uma planilha CSV:

1. **Leads > Importar**
2. Baixe o template CSV de exemplo
3. Preencha e suba
4. O sistema mostra preview e voce confirma
$$,
   50, ARRAY['leads','crm','cadastro']),

  (NULL, 'disparador-criar-campanha', 'disparador', 'Criar uma campanha de disparo',
   'Como configurar e enviar uma campanha em massa.',
   $$
# Criar campanha de disparo

## 1. Escolher ou criar template

**Disparador > Templates** > selecione um aprovado ou crie um novo.

> Para WhatsApp Business, o template precisa estar **aprovado pela Meta**
> antes de poder ser usado em disparo.

## 2. Configurar a campanha

1. **Disparador > Nova campanha**
2. Nome interno (ex "Promo dia das maes 2026")
3. Template
4. **Segmento** (filtros pra escolher os destinatarios):
   - Tags
   - Ultima compra
   - Status do lead
   - Opt-out de marketing (sempre exclui quem optou por sair)
5. Agendamento (agora ou em data futura)
6. **Taxa de envio** (padrao 30/min - nao exagere pra evitar bloqueio)

## 3. Revisar e disparar

- Pre-visualizacao mostra quantos contatos vao receber
- **Iniciar disparo** > o sistema processa em background
- Acompanhe em tempo real na tela da campanha
$$,
   60, ARRAY['disparador','campanha','whatsapp']),

  (NULL, 'config-usuarios', 'config', 'Adicionar um usuario novo',
   'Como criar conta para um funcionario.',
   $$
# Adicionar usuario novo

1. **Configuracoes > Usuarios > Convidar**
2. Email do usuario
3. Nome
4. Loja(s) que ele tera acesso
5. **Perfil** em cada loja:
   - **Owner** - tudo (apenas voce/socios)
   - **Admin** - tudo menos billing
   - **Manager** - gerencia uma loja
   - **Recepcao** - agenda + atende clientes
   - **Medico** - so sua agenda
   - **Vendedor** - leads atribuidos a ele
   - **Somente leitura** - so consulta

O usuario recebe um email com link para criar a senha. Link valido por 24h.

## Perfis customizados

**Admin** ou **Owner** podem criar perfis personalizados em
**Configuracoes > Perfis de acesso**.
$$,
   70, ARRAY['config','usuarios','rbac'])

ON CONFLICT (organization_id, slug, locale) DO UPDATE SET
  title          = EXCLUDED.title,
  summary        = EXCLUDED.summary,
  body_markdown  = EXCLUDED.body_markdown,
  display_order  = EXCLUDED.display_order,
  tags           = EXCLUDED.tags,
  version        = help_articles.version + 1,
  updated_at     = now();
