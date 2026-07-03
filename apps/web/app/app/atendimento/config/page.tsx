"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useDialog } from "../../../../components/SystemDialog";

type Agent = { membershipId: string; name: string };
type Inbox = { id: string; name: string; channel: string; channelRef: string | null };
type Team = { id: string; name: string; description: string | null; memberMembershipIds: string[] };

export default function CallCenterConfig() {
  const dialog = useDialog();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [sla, setSla] = useState<{ slaCustomerMin: number; slaAgentMin: number; botEnabled: boolean; botInstructions: string; hasAi: boolean; queuePositionEnabled: boolean; autoResolveHours: number; aiMinBookingHour: number; examArrivalWindows: string[]; productionStampEnabled: boolean; productionPackagingEnabled: boolean; graficaPixKey: string; graficaSizeChart: string; graficaSizeChartUrl: string; graficaLeadDays: number; graficaDownPaymentPct: number; graficaMaxOperatorDiscountPct: number }>({ slaCustomerMin: 10, slaAgentMin: 2, botEnabled: false, botInstructions: "", hasAi: false, queuePositionEnabled: true, autoResolveHours: 0, aiMinBookingHour: 7, examArrivalWindows: [], productionStampEnabled: false, productionPackagingEnabled: false, graficaPixKey: "", graficaSizeChart: "", graficaSizeChartUrl: "", graficaLeadDays: 7, graficaDownPaymentPct: 50, graficaMaxOperatorDiscountPct: 0 });
  const [display, setDisplay] = useState<{ displayName: string | null; userName: string | null }>({ displayName: null, userName: null });
  const [displayInput, setDisplayInput] = useState("");

  const loadTeams = useCallback(() => {
    fetch("/api/inbox/teams/detailed", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setTeams(d.items ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    fetch("/api/inbox/agents", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setAgents(d.items ?? [])).catch(() => {});
    fetch("/api/inbox/inboxes", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setInboxes(d.items ?? [])).catch(() => {});
    fetch("/api/inbox/settings", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setSla(d)).catch(() => {});
    fetch("/api/inbox/settings/display-name", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setDisplay(d); setDisplayInput(d.displayName ?? ""); } }).catch(() => {});
    loadTeams();
  }, [loadTeams]);

  async function saveDisplay() {
    const res = await fetch("/api/inbox/settings/display-name", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: displayInput }) });
    if (res.ok) dialog.toast("Nome de exibição salvo ✅", "success"); else dialog.toast("Não foi possível salvar", "error");
  }
  async function saveSettings(msg: string) {
    const res = await fetch("/api/inbox/settings", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(sla) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Sem permissão", "error"); return; }
    if (d) setSla((s) => ({ ...s, ...d })); dialog.toast(msg, "success");
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <Link href="/app/atendimento" className="text-sm text-brand hover:underline">← Atendimento</Link>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
        <h1 className="mt-1 text-3xl font-semibold">Configurações do Call Center</h1>
        <p className="mt-2 text-muted">Nome de exibição, SLA, equipes e agentes por caixa de entrada.</p>
      </header>

      {/* nome de exibição (cada operador) */}
      <section className="card mb-6">
        <h2 className="text-sm font-semibold">Meu nome de exibição</h2>
        <p className="mt-1 text-xs text-muted">É o nome que o cliente vê nas suas respostas (ex.: "Yuri (Vendas)"). Vazio = seu nome de usuário ({display.userName ?? "—"}).</p>
        <div className="mt-3 flex gap-2">
          <input value={displayInput} onChange={(e) => setDisplayInput(e.target.value)} placeholder={display.userName ?? "Seu nome"} className="input-base flex-1" />
          <button onClick={saveDisplay} className="btn-grad">Salvar</button>
        </div>
      </section>

      {/* SLA (admin) */}
      <section className="card mb-6">
        <h2 className="text-sm font-semibold">SLA (tempo-alvo de resposta)</h2>
        <p className="mt-1 text-xs text-muted">Define as cores do contador de espera nas conversas. (Apenas administradores salvam.)</p>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="block"><span className="block text-[10px] uppercase text-muted">Resposta do operador (min)</span>
            <input type="number" min={1} max={120} value={sla.slaAgentMin} onChange={(e) => setSla((s) => ({ ...s, slaAgentMin: Math.max(1, Number(e.target.value)) }))} className="input-base mt-1 w-28" /></label>
          <label className="block"><span className="block text-[10px] uppercase text-muted">Espera do cliente (min)</span>
            <input type="number" min={1} max={240} value={sla.slaCustomerMin} onChange={(e) => setSla((s) => ({ ...s, slaCustomerMin: Math.max(1, Number(e.target.value)) }))} className="input-base mt-1 w-28" /></label>
          <button onClick={() => saveSettings("SLA salvo ✅")} className="btn-grad self-end">Salvar SLA</button>
        </div>
        <p className="mt-2 text-[11px] text-muted">Verde até {sla.slaAgentMin}min · âmbar até {sla.slaCustomerMin}min · vermelho acima.</p>

        {/* Aviso de posição na fila */}
        <div className="mt-4 border-t border-line pt-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={sla.queuePositionEnabled} onChange={(e) => setSla((s) => ({ ...s, queuePositionEnabled: e.target.checked }))} className="mt-0.5 accent-brand" />
            <span>
              <span className="font-medium">Avisar o cliente da posição na fila</span>
              <span className="block text-[11px] text-muted">Quando todos os atendentes estão ocupados, envia automaticamente: <i>"🕒 Você está na fila — posição N. Já já alguém continua por aqui."</i> Desligado, a conversa ainda entra na fila normalmente, só não manda essa mensagem (alguns negócios preferem não mostrar fila pra não desestimular o cliente).</span>
            </span>
          </label>
          <button onClick={() => saveSettings(sla.queuePositionEnabled ? "Aviso de fila ativado ✅" : "Aviso de fila desativado")} className="btn-grad mt-3">Salvar aviso de fila</button>
        </div>

        {/* Auto-resolução silenciosa de conversas inativas */}
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Resolver conversas inativas automaticamente</h3>
          <p className="mt-1 text-[11px] text-muted">
            Depois de N horas SEM nenhuma mensagem (do cliente ou do operador), a conversa é marcada como resolvida automaticamente — <b>sem enviar nenhuma mensagem ao cliente</b>.
            Útil pra não acumular conversas esquecidas na caixa. <b>0 = desligado</b>. Sugestão: 72h (3 dias).
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[10px] uppercase text-muted">Horas de inatividade</span>
              <input
                type="number"
                min={0}
                max={720}
                value={sla.autoResolveHours}
                onChange={(e) => setSla((s) => ({ ...s, autoResolveHours: Math.max(0, Math.min(720, parseInt(e.target.value || "0", 10) || 0)) }))}
                className="input-base mt-1 w-28"
              />
            </label>
            <div className="flex gap-1">
              {[24, 48, 72, 168].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setSla((s) => ({ ...s, autoResolveHours: h }))}
                  className={`rounded-md border px-2 py-1 text-[11px] ${sla.autoResolveHours === h ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:border-brand"}`}
                  title={`${h}h = ${h / 24} dia(s)`}
                >{h}h</button>
              ))}
              <button
                type="button"
                onClick={() => setSla((s) => ({ ...s, autoResolveHours: 0 }))}
                className={`rounded-md border px-2 py-1 text-[11px] ${sla.autoResolveHours === 0 ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-line text-muted hover:border-brand"}`}
              >Desligado</button>
            </div>
            <button onClick={() => saveSettings(sla.autoResolveHours > 0 ? `Auto-resolução em ${sla.autoResolveHours}h ✅` : "Auto-resolução desligada")} className="btn-grad">Salvar</button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            ⚙️ O job roda de 1 em 1 hora. Conversas atribuídas ou em fila também são resolvidas (a conversa sai do painel; o cliente pode reabrir mandando outra mensagem).
          </p>
        </div>

        {/* Agenda — config do atendimento automático */}
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">Agenda — agendamento automático (IA)</h3>

          <label className="mt-3 block text-[10px] uppercase text-muted">Hora mínima que a IA oferece</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="number" min={0} max={23}
              value={sla.aiMinBookingHour}
              onChange={(e) => setSla((s) => ({ ...s, aiMinBookingHour: Math.max(0, Math.min(23, parseInt(e.target.value || "0", 10) || 0)) }))}
              className="input-base w-24"
            />
            <span className="text-sm text-muted">:00</span>
            {[6, 7, 8].map((h) => (
              <button key={h} type="button" onClick={() => setSla((s) => ({ ...s, aiMinBookingHour: h }))}
                className={`rounded-md border px-2 py-1 text-[11px] ${sla.aiMinBookingHour === h ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:border-brand"}`}>{String(h).padStart(2, "0")}:00</button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted">A IA só oferece e agenda horários a partir dessa hora. Horários mais cedo ficam reservados pra equipe interna marcar pelo painel.</p>

          <label className="mt-4 block text-[10px] uppercase text-muted">Janelas de chegada (ordem de chegada)</label>
          <input
            value={sla.examArrivalWindows.join(", ")}
            onChange={(e) => setSla((s) => ({ ...s, examArrivalWindows: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) }))}
            placeholder="06:00, 07:30, 08:30, 09:30, 10:30, 11:30, 13:00"
            className="input-base mt-1"
          />
          <p className="mt-1 text-[11px] text-muted">
            Horários de início de cada faixa, separados por vírgula. A mensagem de agendamento diz "a partir das HH:MM por ordem de chegada" usando a faixa em que o horário do cliente cai. <b>Vazio = usa o padrão</b> (06:30, 07:30, 08:30…). Ex.: pra abrir a porta às 06:00, comece a lista com <code>06:00</code>.
          </p>

          <button onClick={() => saveSettings("Config da agenda salva ✅")} className="btn-grad mt-3">Salvar agenda</button>
        </div>
      </section>

      {/* atendimento automático por IA (admin) */}
      <section className="card mb-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Atendimento automático por IA (bot)</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sla.botEnabled} onChange={(e) => setSla((s) => ({ ...s, botEnabled: e.target.checked }))} className="accent-brand" />
            {sla.botEnabled ? "Ligado" : "Desligado"}
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          Quando ligado, a IA responde os clientes no WhatsApp (tria, consulta agenda/produtos/crediário, agenda/cancela, transfere). Precisa de uma conexão de IA em Integrações.
          {!sla.hasAi && <span className="ml-1 text-amber-300">⚠️ Nenhuma IA conectada — configure em Integrações → Assistente de IA.</span>}
        </p>
        <label className="mt-3 flex items-center justify-between text-[10px] uppercase text-muted">
          <span>Instruções do assistente (sobre o seu negócio)</span>
          <span className={`font-normal normal-case ${sla.botInstructions.length > 45000 ? "text-red-300" : sla.botInstructions.length > 30000 ? "text-amber-300" : ""}`}>
            {sla.botInstructions.length.toLocaleString("pt-BR")} / 50.000 caracteres
          </span>
        </label>
        <textarea
          value={sla.botInstructions}
          onChange={(e) => setSla((s) => ({ ...s, botInstructions: e.target.value }))}
          rows={Math.min(20, Math.max(8, sla.botInstructions.split("\n").length + 2))}
          placeholder="Ex.: Somos uma ótica em Salvador. Horário: seg-sex 9h-18h, sáb 9h-13h. Fazemos exame de vista, conserto e crediário próprio. Tom amigável."
          className="input-base mt-1 resize-y font-mono text-xs"
          style={{ minHeight: "180px", maxHeight: "70vh" }}
        />
        <p className="mt-1 text-[11px] text-muted">Cresce automaticamente conforme você digita (até 70% da tela). Use o canto direito-inferior pra ajustar manualmente. A IA usa essas instruções + as respostas publicadas na Central de ajuda pra responder do jeito da sua empresa (qualquer ramo).</p>
        <button onClick={() => saveSettings(sla.botEnabled ? "IA ligada ✅" : "IA desligada")} className="btn-grad mt-3">Salvar IA</button>

        {/* Config do nicho gráfica/uniformes — usada na mensagem pós-aprovação de arte */}
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-semibold">Gráfica/uniformes — pós-aprovação de arte</p>
          <p className="mt-1 text-[11px] text-muted">Quando o cliente aprova a arte, a IA envia automaticamente a tabela de medidas, a chave Pix e o prazo. Preencha o que usar (vazio = não envia aquele item).</p>
          <label className="mt-3 block text-[10px] uppercase text-muted">Chave Pix</label>
          <input value={sla.graficaPixKey} onChange={(e) => setSla((s) => ({ ...s, graficaPixKey: e.target.value }))} placeholder="email@empresa.com, CNPJ ou chave aleatória" className="input-base mt-1" />
          <label className="mt-3 block text-[10px] uppercase text-muted">Tabela de medidas (texto)</label>
          <textarea value={sla.graficaSizeChart} onChange={(e) => setSla((s) => ({ ...s, graficaSizeChart: e.target.value }))} rows={4} placeholder={"Ex.:\nP: 50cm largura x 70cm altura\nM: 54 x 72\nG: 58 x 74\nGG: 62 x 76"} className="input-base mt-1" />
          <label className="mt-3 block text-[10px] uppercase text-muted">Tabela de medidas — imagem/PDF (URL, opcional)</label>
          <input value={sla.graficaSizeChartUrl} onChange={(e) => setSla((s) => ({ ...s, graficaSizeChartUrl: e.target.value }))} placeholder="https://… (anexa no WhatsApp)" className="input-base mt-1" />
          <label className="mt-3 block text-[10px] uppercase text-muted">Prazo de entrega padrão (dias)</label>
          <input type="number" min={0} max={180} value={sla.graficaLeadDays} onChange={(e) => setSla((s) => ({ ...s, graficaLeadDays: Math.max(0, parseInt(e.target.value || "0", 10) || 0) }))} className="input-base mt-1 w-32" />
          <p className="mt-1 text-[11px] text-muted">Se o pedido tiver data de entrega definida, ela tem prioridade sobre o prazo padrão.</p>
          <label className="mt-3 block text-[10px] uppercase text-muted">Política de pagamento — sinal (%)</label>
          <input type="number" min={0} max={100} value={sla.graficaDownPaymentPct} onChange={(e) => setSla((s) => ({ ...s, graficaDownPaymentPct: Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10) || 0)) }))} className="input-base mt-1 w-32" />
          <p className="mt-1 text-[11px] text-muted"><b>100 = pagamento total</b> à vista. <b>Menos de 100</b> = cobra esse % como sinal agora e o saldo na entrega (ex.: 50 = 50% + 50%). A mensagem pós-aprovação da arte mostra o valor do sinal/saldo automaticamente, e o novo pedido já sugere esse % como entrada (o operador pode ajustar). 0 = não sugere.</p>

          <label className="mt-3 block text-[10px] uppercase text-muted">Desconto máximo do vendedor (%)</label>
          <input type="number" step="0.01" min={0} max={100} value={sla.graficaMaxOperatorDiscountPct} onChange={(e) => setSla((s) => ({ ...s, graficaMaxOperatorDiscountPct: Math.max(0, Math.min(100, parseFloat(e.target.value || "0") || 0)) }))} className="input-base mt-1 w-32" />
          <p className="mt-1 text-[11px] text-muted">No pedido, o vendedor pode aplicar desconto até esse % sem precisar autorização. Acima, abre o modal de código de 4 dígitos do gerente/admin. <b>0 = qualquer desconto exige autorização.</b> Owner e admin não sofrem o limite.</p>

          <button onClick={() => saveSettings("Config da gráfica salva ✅")} className="btn-grad mt-3">Salvar gráfica</button>
        </div>

        {/* Etapas opcionais do kanban da produção (gráfica) */}
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-semibold">Etapas opcionais no kanban da produção</p>
          <p className="mt-1 text-[11px] text-muted">Algumas gráficas têm essas etapas como passo separado, outras juntam com produção/separação. Ligue só o que se aplica ao seu fluxo — colunas aparecem/somem do kanban automaticamente.</p>

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={sla.productionStampEnabled} onChange={(e) => setSla((s) => ({ ...s, productionStampEnabled: e.target.checked }))} className="mt-0.5 accent-brand" />
            <span>
              <span className="font-medium">Estampa</span>
              <span className="block text-[11px] text-muted">Aparece como coluna entre <i>Produção</i> e <i>Costura</i>. Use se você tem etapa separada de estampar/serigrafar/sublimar a peça antes de costurar.</span>
            </span>
          </label>

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={sla.productionPackagingEnabled} onChange={(e) => setSla((s) => ({ ...s, productionPackagingEnabled: e.target.checked }))} className="mt-0.5 accent-brand" />
            <span>
              <span className="font-medium">Embalagem</span>
              <span className="block text-[11px] text-muted">Aparece como coluna entre <i>Pronto</i> e <i>Entrega</i>. Use se você tem etapa de embalar/dobrar/empacotar antes de disponibilizar pra retirada.</span>
            </span>
          </label>

          <button onClick={() => saveSettings("Etapas do kanban salvas ✅")} className="btn-grad mt-3">Salvar etapas</button>
        </div>
      </section>

      {/* equipes (admin) */}
      <TeamsSection agents={agents} teams={teams} onChanged={loadTeams} />

      {/* agentes por inbox (admin) */}
      <InboxAgentsSection agents={agents} inboxes={inboxes} />
    </div>
  );
}

function TeamsSection({ agents, teams, onChanged }: { agents: Agent[]; teams: Team[]; onChanged: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);

  function startEdit(t: Team) { setEditId(t.id); setName(t.name); setMembers(t.memberMembershipIds); }
  function reset() { setEditId(null); setName(""); setMembers([]); }
  function toggle(id: string) { setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id])); }

  async function save() {
    if (!name.trim()) { dialog.toast("Informe o nome da equipe", "error"); return; }
    const res = await fetch("/api/inbox/teams", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: editId || undefined, name: name.trim(), memberMembershipIds: members }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Sem permissão", "error"); return; }
    reset(); onChanged();
  }
  async function remove(t: Team) {
    if (!(await dialog.confirm({ title: "Excluir equipe", message: `Remover "${t.name}"?`, tone: "danger" }))) return;
    const res = await fetch(`/api/inbox/teams/${t.id}/delete`, { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Sem permissão", "error"); return; }
    onChanged();
  }
  const nameOf = (id: string) => agents.find((a) => a.membershipId === id)?.name ?? "—";

  return (
    <section className="card mb-6">
      <h2 className="text-sm font-semibold">Equipes</h2>
      <div className="mt-3 space-y-1">
        {teams.length === 0 ? <p className="text-xs text-muted">Nenhuma equipe.</p> : teams.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-fg">{t.name}</span>
              <span className="block truncate text-xs text-muted">{t.memberMembershipIds.length === 0 ? "sem membros" : t.memberMembershipIds.map(nameOf).join(", ")}</span>
            </div>
            <div className="flex shrink-0 gap-2 text-xs">
              <button onClick={() => startEdit(t)} className="text-brand hover:underline">editar</button>
              <button onClick={() => remove(t)} className="text-danger hover:underline">excluir</button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={editId ? "Nome da equipe" : "Nova equipe"} className="input-base" />
        <p className="mt-2 text-[10px] uppercase tracking-wider text-muted">Membros</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {agents.map((a) => (
            <button key={a.membershipId} onClick={() => toggle(a.membershipId)} className={`rounded-full border px-2.5 py-1 text-xs transition ${members.includes(a.membershipId) ? "border-brand bg-brand/15 text-brand" : "border-line text-muted hover:border-brand"}`}>
              {a.name}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} className="btn-grad">{editId ? "Salvar equipe" : "Criar equipe"}</button>
          {editId && <button onClick={reset} className="rounded-xl border border-line px-3 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>}
        </div>
      </div>
    </section>
  );
}

function InboxAgentsSection({ agents, inboxes }: { agents: Agent[]; inboxes: Inbox[] }) {
  const dialog = useDialog();
  const [sel, setSel] = useState<string>("");
  const [members, setMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!sel) { setMembers([]); return; }
    fetch(`/api/inbox/inboxes/${sel}/agents`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setMembers(d.items ?? [])).catch(() => {});
  }, [sel]);
  function toggle(id: string) { setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id])); }
  async function save() {
    if (!sel) return;
    const res = await fetch(`/api/inbox/inboxes/${sel}/agents`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ membershipIds: members }) });
    if (res.ok) dialog.toast("Agentes da caixa salvos ✅", "success"); else dialog.toast("Sem permissão", "error");
  }

  return (
    <section className="card mb-6">
      <h2 className="text-sm font-semibold">Agentes por caixa de entrada</h2>
      <p className="mt-1 text-xs text-muted">Quem pode receber/atender cada número/caixa. Vazio = todos os agentes da empresa.</p>
      <select value={sel} onChange={(e) => setSel(e.target.value)} className="input-base mt-3">
        <option value="">Selecione a caixa…</option>
        {inboxes.map((i) => <option key={i.id} value={i.id}>{i.name} {i.channelRef ? `(${i.channelRef})` : ""}</option>)}
      </select>
      {sel && (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            {agents.map((a) => (
              <button key={a.membershipId} onClick={() => toggle(a.membershipId)} className={`rounded-full border px-2.5 py-1 text-xs transition ${members.includes(a.membershipId) ? "border-brand bg-brand/15 text-brand" : "border-line text-muted hover:border-brand"}`}>
                {a.name}
              </button>
            ))}
          </div>
          <button onClick={save} className="btn-grad mt-3">Salvar agentes</button>
        </>
      )}
    </section>
  );
}
