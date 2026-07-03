-- ==============================================================================
-- 115_seed_platform_contracts.sql  (idempotente)
--
-- Semeia 3 modelos de contrato da PLATAFORMA (SaaS ↔ empresa):
--   1) Contrato de uso da plataforma            (kind 'plataforma_uso')
--   2) Contrato de responsabilidade financeira  (kind 'responsabilidade_financeira')  -- inadimplência → negativação (Serasa/SPC)
--   3) Aditivo de módulo à la carte             (kind 'aditivo_modulo')  -- usa {{modulo.nome}} e {{modulo.preco}}
-- Variáveis: {{contratante.*}}, {{data.hoje}} e (no aditivo) {{modulo.nome}}/{{modulo.preco}}.
-- Só insere se ainda não existir version+title (idempotente).
-- ==============================================================================

-- Expande o CHECK de kind pra aceitar os novos tipos (idempotente).
ALTER TABLE platform_contract_templates DROP CONSTRAINT IF EXISTS platform_contract_templates_kind_check;
ALTER TABLE platform_contract_templates ADD CONSTRAINT platform_contract_templates_kind_check
  CHECK (kind IN ('onboarding','aditivo','servico_extra','plataforma_uso','responsabilidade_financeira','aditivo_modulo'));

-- 1) USO DA PLATAFORMA -----------------------------------------------------------
INSERT INTO platform_contract_templates (version, title, description, body_markdown, kind, is_active)
SELECT 'uso-v1', 'Contrato de Uso da Plataforma', 'Termos de uso do sistema (SaaS) pela empresa contratante.', $uso$
<div style="border:1px solid #e5e7eb;border-left:5px solid #7c3aed;border-radius:10px;padding:16px 18px;margin:0 0 18px">
<p style="margin:0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Instrumento particular</p>
<p style="margin:4px 0 0;font-size:19px;font-weight:700;color:#111">Contrato de Uso da Plataforma</p>
<p style="margin:6px 0 0;font-size:13px;color:#555">Contratante: <strong>{{contratante.razao_social}}</strong> — CNPJ/CPF {{contratante.cnpj}}. Data: {{data.hoje}}.</p>
</div>

## 1. Objeto
Concessão de licença de uso, não exclusiva e intransferível, do sistema (plataforma SaaS), incluindo os módulos contratados, na modalidade de assinatura.

## 2. Acesso e responsabilidades do contratante
O contratante é responsável pela guarda das credenciais, pela veracidade dos dados inseridos e pelo uso adequado por seus usuários. É vedado compartilhar acesso fora da sua organização.

## 3. Disponibilidade
Empenho de melhores esforços para manter a plataforma disponível, ressalvadas manutenções programadas e eventos de força maior.

## 4. Dados e privacidade (LGPD)
O contratante é controlador dos dados que insere; a plataforma atua como operadora, tratando os dados conforme a legislação e exclusivamente para a prestação do serviço.

## 5. Vigência e cancelamento
O contrato vigora por prazo indeterminado enquanto houver assinatura ativa. Em caso de cancelamento, aplica-se o período de aprovisionamento e de consulta previstos na política vigente.

## 6. Foro
Fica eleito o foro da comarca do prestador para dirimir questões oriundas deste contrato.
$uso$, 'plataforma_uso', true
WHERE NOT EXISTS (SELECT 1 FROM platform_contract_templates WHERE version = 'uso-v1' AND title = 'Contrato de Uso da Plataforma');

-- 2) RESPONSABILIDADE FINANCEIRA -------------------------------------------------
INSERT INTO platform_contract_templates (version, title, description, body_markdown, kind, is_active)
SELECT 'resp-v1', 'Termo de Responsabilidade Financeira', 'Responsabilidade pelo pagamento das mensalidades; inadimplência e negativação.', $resp$
<div style="border:1px solid #e5e7eb;border-left:5px solid #dc2626;border-radius:10px;padding:16px 18px;margin:0 0 18px">
<p style="margin:0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Instrumento particular</p>
<p style="margin:4px 0 0;font-size:19px;font-weight:700;color:#111">Termo de Responsabilidade Financeira</p>
<p style="margin:6px 0 0;font-size:13px;color:#555">Contratante: <strong>{{contratante.razao_social}}</strong> — CNPJ/CPF {{contratante.cnpj}}. Data: {{data.hoje}}.</p>
</div>

## 1. Da obrigação de pagamento
O contratante se responsabiliza pelo pagamento integral e pontual das mensalidades da assinatura e dos módulos adicionais (à la carte) contratados, nos valores e vencimentos vigentes.

## 2. Atraso e encargos
O atraso no pagamento sujeita o contratante a multa, juros e correção previstos em lei, além da suspensão do acesso após o período de carência.

## 3. Inadimplência e negativação
Persistindo a inadimplência, o contratante autoriza, desde já, a **inclusão do seu nome/CNPJ nos órgãos de proteção ao crédito (SERASA, SPC e congêneres)**, bem como o protesto do título e a adoção das medidas de cobrança cabíveis, sem prejuízo da suspensão e do posterior encerramento do serviço.

## 4. Regularização
A regularização do débito enseja a reativação do acesso e, quando aplicável, a baixa da negativação nos prazos legais.

## 5. Foro
Fica eleito o foro da comarca do prestador para dirimir questões oriundas deste termo.
$resp$, 'responsabilidade_financeira', true
WHERE NOT EXISTS (SELECT 1 FROM platform_contract_templates WHERE version = 'resp-v1' AND title = 'Termo de Responsabilidade Financeira');

-- 3) ADITIVO DE MÓDULO À LA CARTE ------------------------------------------------
INSERT INTO platform_contract_templates (version, title, description, body_markdown, kind, is_active)
SELECT 'aditivo-mod-v1', 'Aditivo de Módulo (à la carte)', 'Aditivo contratual de módulo avulso — preenche nome e preço do módulo automaticamente.', $adt$
<div style="border:1px solid #e5e7eb;border-left:5px solid #7c3aed;border-radius:10px;padding:16px 18px;margin:0 0 18px">
<p style="margin:0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Aditivo contratual</p>
<p style="margin:4px 0 0;font-size:19px;font-weight:700;color:#111">Aditivo — Módulo {{modulo.nome}}</p>
<p style="margin:6px 0 0;font-size:13px;color:#555">Contratante: <strong>{{contratante.razao_social}}</strong> — CNPJ/CPF {{contratante.cnpj}}. Data: {{data.hoje}}.</p>
</div>

## 1. Objeto do aditivo
Inclusão do módulo **{{modulo.nome}}** à assinatura do contratante, na modalidade à la carte, que passa a integrar o Contrato de Uso da Plataforma.

## 2. Valor
O módulo **{{modulo.nome}}** será cobrado em <strong>{{modulo.preco}}</strong> por mês, somado à mensalidade vigente, com o mesmo vencimento.

## 3. Vigência
O módulo fica ativo a partir da contratação e enquanto perdurar o pagamento. O cancelamento do módulo cessa a cobrança no ciclo seguinte e remove o acesso ao recurso.

## 4. Demais condições
Permanecem inalteradas todas as demais cláusulas do Contrato de Uso da Plataforma e do Termo de Responsabilidade Financeira.
$adt$, 'aditivo_modulo', true
WHERE NOT EXISTS (SELECT 1 FROM platform_contract_templates WHERE version = 'aditivo-mod-v1' AND title = 'Aditivo de Módulo (à la carte)');
