-- ==============================================================================
-- 102_seed_service_contract.sql  (idempotente)
--
-- Semeia no MASTER um modelo de contrato de PRESTAÇÃO DE SERVIÇOS do sistema
-- (SaaS yugochat ↔ empresa contratante), com HTML estilizado (estilos INLINE —
-- blocos <style> são removidos pelo sanitizador) e variáveis {{contratante.*}}.
--
-- Só insere se ainda não existir um template com esta version+title.
-- ==============================================================================

INSERT INTO platform_contract_templates (version, title, description, body_markdown, kind, is_active)
SELECT
  'svc-v1',
  'Contrato de Prestação de Serviços — Sistema yugochat',
  'Modelo padrão de prestação de serviços (SaaS) yugochat ↔ empresa contratante.',
  $body$
<div style="border:1px solid #e5e7eb;border-left:5px solid #7c3aed;border-radius:10px;padding:16px 18px;margin:0 0 18px">
<p style="margin:0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Instrumento particular</p>
<p style="margin:4px 0 0;font-size:19px;font-weight:700;color:#111">Contrato de Prestação de Serviços Tecnológicos</p>
<p style="margin:6px 0 0;font-size:13px;color:#555">Pelo presente instrumento particular, as partes abaixo identificadas têm entre si justo e contratado o que segue.</p>
</div>

<div style="display:flex;gap:14px;flex-wrap:wrap;margin:0 0 8px">
<div style="flex:1;min-width:240px;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px">
<p style="margin:0;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.06em">Contratante</p>
<p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#111">{{contratante.razao_social}}</p>
<p style="margin:2px 0 0;font-size:13px;color:#444">Nome fantasia: {{contratante.nome_fantasia}}</p>
<p style="margin:2px 0 0;font-size:13px;color:#444">CNPJ/CPF: {{contratante.cnpj}}</p>
<p style="margin:2px 0 0;font-size:13px;color:#444">E-mail: {{contratante.email}} · Tel.: {{contratante.telefone}}</p>
</div>
<div style="flex:1;min-width:240px;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px">
<p style="margin:0;font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.06em">Contratada</p>
<p style="margin:6px 0 0;font-size:14px;font-weight:700;color:#111">YUGO EMPREENDIMENTOS LTDA (yugochat)</p>
<p style="margin:2px 0 0;font-size:13px;color:#444">CNPJ: 40.029.474/0001-80</p>
<p style="margin:2px 0 0;font-size:13px;color:#444">Av. Castro Alves, nº 465, Centro, Eunápolis/BA, CEP 45.820-350</p>
<p style="margin:2px 0 0;font-size:13px;color:#444">E-mail: jgf-consultoria@hotmail.com</p>
</div>
</div>

## Cláusula 1 — Objeto

O presente contrato tem por objeto a **licença de uso e a prestação de serviços** da plataforma **yugochat** (software como serviço — SaaS), disponibilizada à CONTRATANTE conforme o plano e os módulos contratados, podendo incluir, entre outros:

- **Agenda** com confirmação, lembrete e reagendamento automáticos por WhatsApp;
- **Atendimento (call center) com IA** integrada — WhatsApp e demais canais;
- **Disparador** de mensagens em massa com controle anti-bloqueio;
- **Vendas (PDV)**, **Caixa**, **Clientes**, **Produtos** e **Catálogo online**;
- **Crediário próprio**, **Pagamentos** (Pix/cartão) e **Cobrança** automática;
- **RH & Ponto**, **Contratos** com assinatura eletrônica, **Relatórios** e portais (cliente, funcionário e fornecedor).

<p style="font-size:12px;color:#6b7280;font-style:italic">Os módulos efetivamente liberados são os correspondentes ao plano contratado e/ou liberações avulsas (à la carte).</p>

## Cláusula 2 — Valores e condições comerciais

<table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13px">
<thead><tr style="background:#f3effe"><th style="text-align:left;border:1px solid #e5e7eb;padding:8px">Item</th><th style="text-align:right;border:1px solid #e5e7eb;padding:8px">Valor padrão</th></tr></thead>
<tbody>
<tr><td style="border:1px solid #e5e7eb;padding:8px">Implantação (setup inicial)</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:right">R$ 2.500,00</td></tr>
<tr><td style="border:1px solid #e5e7eb;padding:8px">Mensalidade do plano contratado</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:right">R$ 1.300,00 / mês</td></tr>
<tr><td style="border:1px solid #e5e7eb;padding:8px">Módulos avulsos (à la carte), se houver</td><td style="border:1px solid #e5e7eb;padding:8px;text-align:right">conforme contratação</td></tr>
</tbody>
</table>

<div style="border:1px solid #d6c8fb;background:rgba(124,58,237,.06);border-radius:8px;padding:10px 12px;margin:6px 0;font-size:13px;color:#444">
<strong>Condição especial desta CONTRATANTE:</strong> eventuais descontos, isenções ou valores promocionais (ex.: implantação isenta e mensalidade reduzida) constam da <strong>proposta comercial</strong> anexa, que integra este contrato e prevalece sobre os valores padrão acima.
</div>

## Cláusula 3 — Forma de pagamento

- Modelo **pós-pago**: a CONTRATANTE primeiro utiliza os serviços e depois realiza o pagamento;
- Emissão de **fatura mensal**, com vencimento **até o dia 05** de cada mês;
- Forma de pagamento: **Pix** (a chave será informada pela CONTRATADA na fatura);
- O não pagamento poderá ensejar suspensão do acesso aos serviços até a regularização.

## Cláusula 4 — Prazo e renovação

Vigência inicial de **90 (noventa) dias**, contados da assinatura. Após esse período, o contrato é **renovado automaticamente por prazo indeterminado**, caso não haja manifestação contrária de qualquer das partes.

## Cláusula 5 — Cancelamento

O contrato poderá ser rescindido por qualquer das partes mediante **aviso prévio de 30 (trinta) dias** e o pagamento da última mensalidade correspondente ao período efetivamente utilizado.

## Cláusula 6 — Obrigações da Contratada

- Disponibilizar e manter os sistemas contratados em funcionamento;
- Prestar **suporte técnico** dentro do escopo do plano;
- Emitir as faturas mensais e fornecer os acessos contratados;
- Adotar medidas técnicas e organizacionais de segurança da informação.

## Cláusula 7 — Obrigações da Contratante

- Realizar os pagamentos dentro do prazo;
- Utilizar os sistemas de forma **legal e adequada**, respeitando as políticas das plataformas integradas (ex.: WhatsApp/Meta);
- Fornecer as informações necessárias ao funcionamento dos serviços;
- Responsabilizar-se pelo conteúdo das mensagens e pelos dados que inserir na plataforma.

## Cláusula 8 — Proteção de dados (LGPD)

As partes se obrigam a tratar os dados pessoais em conformidade com a **Lei nº 13.709/2018 (LGPD)**. A CONTRATADA atua como **operadora** quanto aos dados inseridos pela CONTRATANTE, tratando-os exclusivamente para a prestação dos serviços e conforme as instruções da CONTRATANTE, que figura como **controladora**.

## Cláusula 9 — Disposições gerais

- Os serviços são **digitais** e podem sofrer melhorias e atualizações contínuas;
- A CONTRATADA **não se responsabiliza** por bloqueios, limitações ou indisponibilidades de **plataformas externas** (ex.: WhatsApp, Instagram, Mercado Pago);
- A tolerância quanto ao descumprimento de qualquer cláusula não implica novação ou renúncia.

## Cláusula 10 — Foro

Fica eleito o foro da comarca de **Eunápolis/BA** para dirimir quaisquer dúvidas oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.

## Cláusula 11 — Aceite

As partes declaram estar de acordo com todos os termos deste contrato, que é aceito eletronicamente (clickwrap), com validade jurídica nos termos da **Lei nº 14.063/2020** e da **MP nº 2.200-2/2001**.

<div style="margin-top:14px;border:1px dashed #7c3aed;border-radius:10px;padding:12px 14px;background:rgba(124,58,237,.05);font-size:13px;color:#444">
Ao clicar em <strong>“Li e aceito”</strong>, a CONTRATANTE — <strong>{{contratante.razao_social}}</strong>, CNPJ/CPF <strong>{{contratante.cnpj}}</strong> — manifesta sua concordância integral com este instrumento, registrando-se data/hora, IP e identificação do aceitante.
</div>

<p style="margin-top:16px;font-size:13px;color:#444">Eunápolis/BA, {{data.hoje}}.</p>
$body$,
  'onboarding',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM platform_contract_templates
   WHERE version = 'svc-v1' AND title = 'Contrato de Prestação de Serviços — Sistema yugochat'
);
