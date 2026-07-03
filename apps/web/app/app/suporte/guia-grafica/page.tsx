export const dynamic = "force-dynamic";

export default function GuiaGraficaPage() {
  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Suporte · Guia</p>
        <h1 className="mt-1 text-3xl font-semibold">Configurar a Gráfica (passo a passo)</h1>
        <p className="mt-2 text-muted">Do catálogo à entrega: como deixar o fluxo da gráfica/uniformes rodando com a IA, pagamento e produção.</p>
      </header>

      <Step n={1} title="Definir o nicho como Gráfica">
        <p>No cadastro da empresa (master) ou em <b>Configurações</b>, o nicho precisa estar como <b>gráfica/uniformes</b>. É isso que ativa o bot e os painéis certos (Produção, Orçamentos, etc.).</p>
      </Step>

      <Step n={2} title="Cadastrar o catálogo com preços">
        <p>Em <b>Produtos</b>, cadastre o que você produz (camisa, conjunto, colete…) com <b>categoria</b> e o <b>preço à vista</b>. Marque <b>“Mostrar na vitrine”</b> nos itens que a IA pode oferecer.</p>
        <p className="mt-1 text-muted">A IA usa esses preços reais ao montar orçamento — nunca inventa valor.</p>
      </Step>

      <Step n={3} title="Configuração da gráfica">
        <p>Em <b>Atendimento → Configurações</b>, seção <b>Gráfica/uniformes</b>, preencha:</p>
        <ul className="ml-4 mt-1 list-disc space-y-1">
          <li><b>Chave Pix</b> — usada na cobrança do sinal e do saldo.</li>
          <li><b>Tabela de medidas</b> (texto e/ou imagem/PDF) — enviada quando a arte é aprovada.</li>
          <li><b>Prazo de entrega padrão</b> (dias) — vira a data do pedido quando não há prazo específico.</li>
          <li><b>Política de pagamento (sinal %)</b> — <b>100</b> = pagamento total; <b>50</b> = 50% de sinal + 50% na entrega. Esse % é o sinal cobrado e sugerido nos pedidos.</li>
        </ul>
      </Step>

      <Step n={4} title="Ligar o atendente virtual (IA)">
        <p>Em <b>Atendimento → Configurações</b>, ative o <b>bot</b> e conecte o <b>WhatsApp</b> (Integrações). Com o nicho gráfica, a IA já sabe o fluxo:</p>
        <ul className="ml-4 mt-1 list-disc space-y-1">
          <li>dá boas-vindas e mostra o <b>catálogo</b>;</li>
          <li>monta e <b>registra o orçamento</b> (e envia o PDF no WhatsApp);</li>
          <li>quando o cliente aceita, <b>converte em pedido</b> de produção (com o sinal da política);</li>
          <li>cadastra o cliente sozinha quando o número é novo.</li>
        </ul>
      </Step>

      <Step n={5} title="Arte e aprovação pelo WhatsApp">
        <p>O time de <b>Design</b> sobe a arte no pedido (aba <b>Produção</b>). O cliente recebe a arte no WhatsApp; se responder que aprovou, a <b>IA aprova automaticamente</b> e dispara a mensagem com <b>medidas + Pix + prazo</b> e o valor do sinal/saldo.</p>
      </Step>

      <Step n={6} title="Comprovante e baixa do pagamento">
        <p>Quando o cliente manda o <b>comprovante</b> (imagem/PDF) no WhatsApp, o sistema anexa sozinho ao pedido e avisa a equipe (alerta “comprovante aguardando conferência”). Confira e, no detalhe do pedido, clique em <b>Marcar pago</b> (ou Sinal/parcial). Isso encerra os lembretes de cobrança.</p>
      </Step>

      <Step n={7} title="Acompanhamento e entrega">
        <p>Mova o pedido pelas etapas (Produção → Pronto → Entrega). O cliente é avisado automaticamente em <b>produção</b>, <b>pronto</b> e <b>saiu para entrega</b>. Se houver <b>saldo em aberto</b>, a mensagem já cobra o valor restante com a chave Pix — e há <b>recobrança automática a cada 3 dias</b> até quitar.</p>
      </Step>

      <Step n={8} title="Orçamentos, financeiro e relatórios">
        <ul className="ml-4 list-disc space-y-1">
          <li><b>Orçamentos</b>: veja todos (os criados pela IA aparecem com a etiqueta <b>“via IA”</b>), reenvie o PDF, marque aceito ou clique em <b>“→ pedido”</b> pra converter.</li>
          <li><b>Produção → Financeiro</b>: faturamento, recebido, a receber, pedidos por etapa e funil de orçamentos. Dá pra <b>exportar em PDF/CSV</b>.</li>
          <li>O banner do topo avisa <b>pedidos perto do prazo</b> e <b>comprovantes a conferir</b>.</li>
        </ul>
      </Step>

      <p className="mt-8 rounded-xl border border-line bg-bg/60 p-4 text-sm text-muted">
        Resumo do ciclo: <b>catálogo → orçamento (IA) → cliente aceita → pedido com sinal → arte → aprovação no WhatsApp → produção → entrega → cobrança do saldo → baixa → relatório</b>.
      </p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 rounded-xl border border-line bg-bg/60 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="mt-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
