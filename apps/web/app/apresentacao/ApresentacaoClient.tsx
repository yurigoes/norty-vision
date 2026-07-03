"use client";

import { useEffect, useState } from "react";

// ===================== dados da apresentação (mock — não dispara nada) =====================
type Role = "vendedor" | "gerente" | "dono";
const ROLES: { key: Role; label: string; blurb: string }[] = [
  { key: "vendedor", label: "Vendedor", blurb: "Foco no balcão: vende, agenda, atende e vê as próprias comissões." },
  { key: "gerente", label: "Gerente", blurb: "Conduz a loja: tudo da operação + financeiro, cobrança, RH e relatórios." },
  { key: "dono", label: "Dono / Admin", blurb: "Controle total: configurações, integrações, planos, usuários e permissões." },
];

type Access = "full" | "limited" | "none";
const ACCESS_BADGE: Record<Access, { label: string; cls: string }> = {
  full: { label: "Acesso total", cls: "bg-green-500/15 text-green-300" },
  limited: { label: "Limitado", cls: "bg-amber-500/15 text-amber-300" },
  none: { label: "Sem acesso", cls: "bg-line text-muted" },
};

type SimMsg = { dir: "in" | "out"; text: string };
type Sim = { channel: "whatsapp" | "email"; contact: string; subject?: string; messages: SimMsg[] };

interface Mod {
  key: string; label: string; icon: string; group: string; desc: string;
  access: Record<Role, Access>; accessNote: Record<Role, string>;
  sim?: Sim;
}

const MODS: Mod[] = [
  {
    key: "agenda", label: "Agenda", icon: "📅", group: "Operação",
    desc: "Marque exames/consultas e deixe o WhatsApp confirmar, lembrar e reagendar sozinho. Menos falta, mais cadeira ocupada.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Agenda e remarca; não edita disponibilidade da loja.", gerente: "Abre dias, define horários e vê o relatório.", dono: "Tudo + configurações da agenda." },
    sim: { channel: "whatsapp", contact: "Zito Óticas", messages: [
      { dir: "out", text: "Olá, Maria! 😊 Lembrando do seu *exame de vista*:\n\n📅 quinta-feira, 12/06\n🕐 09:00\n📍 Ilha de Vera Cruz - BA\n\nResponda *1* para confirmar ou *2* para remarcar." },
      { dir: "in", text: "1" },
      { dir: "out", text: "Perfeito! ✅ Agendamento confirmado. Chegue 10 min antes. Até lá! 👓" },
    ] },
  },
  {
    key: "atendimento", label: "Atendimento (IA)", icon: "🎧", group: "Operação",
    desc: "Central de atendimento WhatsApp com IA: tria, responde, mostra produtos, agenda e transfere pro humano quando precisa.",
    access: { vendedor: "full", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Atende as conversas atribuídas a ele.", gerente: "Vê todas as filas + supervisão e relatórios.", dono: "Tudo + configura a IA e os números." },
    sim: { channel: "whatsapp", contact: "Cliente novo", messages: [
      { dir: "in", text: "Oi, vocês fazem exame de vista?" },
      { dir: "out", text: "Olá! 😊 Eu sou a Cris, da Zito Óticas. Sim, fazemos exame de vista! É R$ 140 (dinheiro ou Pix). Quer que eu veja os horários disponíveis pra você?" },
      { dir: "in", text: "Quero sim" },
      { dir: "out", text: "📅 quinta-feira, 12/06\n🕐 08:00\n🕐 09:30\n\nQual horário você prefere? ✨" },
    ] },
  },
  {
    key: "vendas", label: "Vendas (PDV)", icon: "🛒", group: "Operação",
    desc: "Venda no balcão com busca de produtos, múltiplos meios de pagamento (Pix, cartão, dinheiro, crediário) e comprovante na hora.",
    access: { vendedor: "full", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Vende e fecha o pedido.", gerente: "Vende + desconto e relatórios de vendas.", dono: "Tudo + configurações de pagamento." },
    sim: { channel: "whatsapp", contact: "João Silva", messages: [
      { dir: "out", text: "Olá, João! Aqui está o comprovante da sua compra na Zito Óticas:\n\n👓 Armação Ray-Ban — R$ 450,00\n🔎 Lente antirreflexo — R$ 320,00\n\n*Total: R$ 770,00* (Pix)\n\nObrigado pela preferência! 💙" },
    ] },
  },
  {
    key: "caixa", label: "Caixa", icon: "💵", group: "Operação",
    desc: "Abertura e fechamento de turno com totais por meio de pagamento. Cada vendedor presta contas do seu caixa.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Abre/fecha o próprio turno.", gerente: "Vê o caixa de todos + conferência.", dono: "Tudo + auditoria." },
  },
  {
    key: "clientes", label: "Clientes", icon: "👥", group: "Comercial",
    desc: "Cadastro completo, histórico, foto, documentos, e cruzamento com a agenda. Reset de senha do portal do cliente.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Cadastra e edita dados básicos.", gerente: "Tudo + documentos e portal.", dono: "Tudo." },
  },
  {
    key: "mala_direta", label: "Mala direta", icon: "📣", group: "Comercial",
    desc: "Campanhas de WhatsApp em fila com anti-ban (delays inteligentes). Segmenta por compras, aniversário, recall de exame.",
    access: { vendedor: "none", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Não dispara campanhas.", gerente: "Cria e dispara campanhas.", dono: "Tudo + limites." },
    sim: { channel: "whatsapp", contact: "Campanha · Recall", messages: [
      { dir: "out", text: "Oi, Ana! 👓 Já faz 1 ano do seu último exame na Zito Óticas. Que tal agendar uma revisão? Temos horários essa semana. Responda *AGENDAR* que eu já te encaixo! 😊" },
    ] },
  },
  {
    key: "produtos", label: "Produtos", icon: "📦", group: "Comercial",
    desc: "Catálogo com foto, preço à vista/prazo, estoque e vitrine online. Aparece na busca do PDV e no catálogo público.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Consulta no PDV.", gerente: "Cadastra e precifica.", dono: "Tudo + vitrine." },
  },
  {
    key: "crediario", label: "Crediário", icon: "💳", group: "Financeiro",
    desc: "Venda parcelada própria: análise de limite, contrato assinado com biometria e parcelas com 2ª via de Pix.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Solicita a venda no crediário.", gerente: "Aprova limite e gerencia contas.", dono: "Tudo + regras." },
    sim: { channel: "whatsapp", contact: "Carlos · Crediário", messages: [
      { dir: "out", text: "Olá, Carlos! Sua *parcela 3/10* do crediário vence em 15/06.\n\n💰 R$ 77,00\n\nPague pelo Pix copia-e-cola ou no portal:\nyugochat.com.br/c\n\n_Mensagem automática — já pagou? desconsidere._" },
    ] },
  },
  {
    key: "cobranca", label: "Cobrança", icon: "🔔", group: "Financeiro",
    desc: "Régua de cobrança automática: lembrete antes do vencimento, aviso no atraso e retry de cartão. Tudo por WhatsApp/e-mail.",
    access: { vendedor: "none", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Não acessa cobrança.", gerente: "Configura régua e acompanha.", dono: "Tudo." },
    sim: { channel: "email", contact: "financeiro@zitooticas.com.br", subject: "Sua fatura vence amanhã", messages: [
      { dir: "out", text: "Olá, Carlos,\n\nPassando para lembrar que sua parcela de R$ 77,00 vence amanhã (15/06).\n\nVocê pode pagar por Pix ou cartão direto pelo portal. É rápido e a baixa é automática.\n\nAbraços,\nZito Óticas" },
    ] },
  },
  {
    key: "pesquisas", label: "Pesquisas (NPS)", icon: "⭐", group: "Comercial",
    desc: "Pesquisa de satisfação por etapa do atendimento, com nota do vendedor. Mede e melhora a experiência.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Vê a própria nota.", gerente: "Vê tudo + relatórios.", dono: "Tudo." },
    sim: { channel: "whatsapp", contact: "Zito Óticas", messages: [
      { dir: "out", text: "Maria, tudo certo com seu atendimento? 💙\n\nDe 0 a 5, quanto você recomendaria a Zito Óticas? Responda com a nota (⭐ a ⭐⭐⭐⭐⭐)." },
      { dir: "in", text: "⭐⭐⭐⭐⭐" },
      { dir: "out", text: "Que alegria! 🥹 Muito obrigado pela confiança. Volte sempre! 👓" },
    ] },
  },
  {
    key: "chamados", label: "Chamados / OS", icon: "🎫", group: "Atendimento",
    desc: "Ordens de serviço (conserto, montagem) com urgência, timeline e aviso de 'pronto pra retirada' por WhatsApp.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Abre e acompanha OS.", gerente: "Gerencia todas + prazos.", dono: "Tudo." },
    sim: { channel: "whatsapp", contact: "Zito Óticas", messages: [
      { dir: "out", text: "Oi, João! 🎉 Seu óculos está *pronto pra retirada*!\n\n🎫 OS #1042 · Troca de lente\n📍 Ilha de Vera Cruz - BA\n🕐 Seg a Sex, 07h–17h\n\nTe esperamos! 👓" },
    ] },
  },
  {
    key: "rh", label: "RH & Funcionários", icon: "🧑‍💼", group: "Pessoas",
    desc: "Ponto com selfie e geolocalização, holerite, escala, férias, vale, atestado e folha de fechamento em PDF.",
    access: { vendedor: "limited", gerente: "full", dono: "full" },
    accessNote: { vendedor: "Bate ponto e vê o próprio holerite.", gerente: "Gerencia equipe, escala e folha.", dono: "Tudo." },
  },
];

const GROUPS = ["Operação", "Comercial", "Financeiro", "Atendimento", "Pessoas"];

const PORTALS = [
  { icon: "🙍", title: "Portal do cliente", desc: "O cliente acessa pedidos, 2ª via de Pix do crediário, contratos assinados, documentos e nota fiscal — no subdomínio da sua empresa." },
  { icon: "🧑‍💼", title: "Portal do funcionário (RH)", desc: "Bate ponto com selfie, vê holerite e escala, pede férias/vale, anexa atestado e acompanha comissões." },
  { icon: "🏭", title: "Portal do fornecedor", desc: "Médicos e laboratórios recebem pedidos de lente, atualizam status e veem repasses — com login 2FA por WhatsApp." },
];

// ===================== componente =====================
export function ApresentacaoClient() {
  const [role, setRole] = useState<Role>("dono");
  const [sim, setSim] = useState<Sim | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-6 pb-24">
      {/* hero */}
      <header className="py-14 text-center">
        <span className="inline-block rounded-full border border-brand/40 bg-brand/10 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-brand">Demonstração interativa</span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">Veja o sistema funcionando — sem instalar nada</h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">Escolha um perfil pra ver os níveis de acesso e clique em <b>“Simular envio”</b> nos módulos para ver, na tela, como a mensagem chegaria no WhatsApp ou e-mail do cliente. Nada é disparado de verdade.</p>
      </header>

      {/* seletor de papel */}
      <section className="rounded-2xl border border-line bg-bg/60 p-6">
        <p className="text-center text-sm font-semibold uppercase tracking-wider text-muted">Entre como…</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          {ROLES.map((r) => (
            <button key={r.key} onClick={() => setRole(r.key)}
              className={`rounded-xl border px-5 py-3 text-left transition ${role === r.key ? "border-brand bg-brand/10 shadow-lg shadow-brand/10" : "border-line hover:border-brand"}`}>
              <span className="block text-sm font-semibold">{r.label}</span>
              <span className="mt-0.5 block max-w-[220px] text-xs text-muted">{r.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {/* módulos por grupo */}
      {GROUPS.map((group) => {
        const mods = MODS.filter((m) => m.group === group);
        if (!mods.length) return null;
        return (
          <section key={group} className="mt-12">
            <h2 className="text-2xl font-semibold text-brand">{group}</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {mods.map((m) => {
                const acc = m.access[role];
                const badge = ACCESS_BADGE[acc];
                return (
                  <div key={m.key} className="flex flex-col rounded-2xl border border-line bg-bg/60 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold">{m.icon} {m.label}</h3>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <p className="mt-2 flex-1 text-sm text-muted">{m.desc}</p>
                    <p className="mt-3 rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-xs">
                      <span className="font-semibold text-fg">Como {ROLES.find((r) => r.key === role)!.label.toLowerCase()}:</span> <span className="text-muted">{m.accessNote[role]}</span>
                    </p>
                    {m.sim && (
                      <button onClick={() => setSim(m.sim!)} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">
                        ▶ Simular envio {m.sim.channel === "whatsapp" ? "(WhatsApp)" : "(e-mail)"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* portais */}
      <section className="mt-14">
        <h2 className="text-2xl font-semibold text-brand">Portais externos (inclusos)</h2>
        <p className="mt-1 text-sm text-muted">Cada empresa tem seus portais no próprio subdomínio, com o seu logo e a sua cor.</p>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {PORTALS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-line bg-bg/60 p-5">
              <h3 className="text-lg font-semibold">{p.icon} {p.title}</h3>
              <p className="mt-2 text-sm text-muted">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {sim && <SimModal sim={sim} onClose={() => setSim(null)} />}
    </div>
  );
}

// ===================== modal de simulação (telefone WhatsApp / e-mail) =====================
function SimModal({ sim, onClose }: { sim: Sim; onClose: () => void }) {
  const [shown, setShown] = useState(0);
  const [sending, setSending] = useState(true);

  // "dispara" as mensagens uma a uma, com um pequeno atraso (simula o envio)
  useEffect(() => {
    setShown(0); setSending(true);
    let i = 0;
    const tick = () => {
      i += 1;
      setShown(i);
      if (i >= sim.messages.length) { setSending(false); return; }
      timer = setTimeout(tick, sim.messages[i]?.dir === "in" ? 700 : 1100);
    };
    let timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [sim]);

  const visible = sim.messages.slice(0, shown);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {sim.channel === "whatsapp" ? (
          <div className="overflow-hidden rounded-[2rem] border-4 border-neutral-800 bg-[#0b141a] shadow-2xl">
            {/* header whatsapp */}
            <div className="flex items-center gap-3 bg-[#202c33] px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{sim.contact.slice(0, 1)}</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{sim.contact}</p>
                <p className="text-[10px] text-emerald-300">{sending ? "digitando…" : "online"}</p>
              </div>
            </div>
            {/* corpo */}
            <div className="min-h-[260px] space-y-2 bg-[#0b141a] bg-[radial-gradient(#1f2c34_1px,transparent_1px)] [background-size:18px_18px] p-3">
              {visible.map((m, i) => (
                <div key={i} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-snug ${m.dir === "out" ? "bg-[#005c4b] text-white" : "bg-[#202c33] text-neutral-100"}`}>
                    {m.text}
                    <span className="ml-2 align-bottom text-[9px] text-white/50">{new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{m.dir === "out" ? " ✓✓" : ""}</span>
                  </div>
                </div>
              ))}
              {sending && <p className="pl-1 text-[10px] text-neutral-500">simulando envio…</p>}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl">
            <div className="border-b border-line bg-bg/80 px-5 py-3">
              <p className="text-xs text-muted">De: <span className="text-fg">{sim.contact}</span></p>
              <p className="mt-1 text-base font-semibold">{sim.subject}</p>
            </div>
            <div className="min-h-[200px] space-y-3 p-5">
              {visible.map((m, i) => (
                <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{m.text}</p>
              ))}
              {sending && <p className="text-xs text-muted">simulando envio…</p>}
            </div>
          </div>
        )}
        <p className="mt-3 text-center text-xs text-muted">Isto é uma simulação — nenhuma mensagem foi enviada de verdade.</p>
        <button onClick={onClose} className="mx-auto mt-2 block rounded-lg border border-line bg-bg px-5 py-2 text-sm text-muted hover:text-fg">fechar</button>
      </div>
    </div>
  );
}
