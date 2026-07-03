"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

const STAGE_LABEL: Record<string, string> = { novo: "Novo", em_contato: "Em contato", qualificado: "Qualificado", proposta: "Proposta", negociacao: "Negociação", ganho: "Ganho", perdido: "Perdido" };
const OPEN_STAGES = ["novo", "em_contato", "qualificado", "proposta", "negociacao"];
const CHAN_ICON: Record<string, string> = { whatsapp: "🟢", site: "🌐", email: "✉️", telegram: "✈️", import: "📄", webchat: "💬", manual: "✍️", prospector: "🤖" };
const KIND_ICON: Record<string, string> = { system: "•", whatsapp_in: "🟢", whatsapp_out: "🟢", email: "✉️", call: "📞", note: "📝", task: "⏰", task_done: "✅", tabulation: "🏷️", stage_change: "↗", assigned: "👤", sale: "💰", quote: "📄", video: "🎥" };

function fmt(d?: string | null) { return d ? new Date(d).toLocaleString("pt-BR") : ""; }
async function jget(url: string) { const r = await fetch(url, { credentials: "include", headers: { "x-no-loading": "1" } }); return r.ok ? r.json() : null; }

export function CrmClient() {
  const [tab, setTab] = useState<"fila" | "mine" | "board" | "sup">("fila");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-1 border-b border-line">
          {([["fila", "Leads novos"], ["mine", "Acompanhamento"], ["board", "Pipeline"], ["sup", "Supervisão"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k as any)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{lbl}</button>
          ))}
        </nav>
        <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Lead</button>
      </div>

      {tab === "fila" && <LeadList key={`fila${reloadKey}`} view="fila" onOpen={setOpenId} />}
      {tab === "mine" && <LeadList key={`mine${reloadKey}`} view="mine" onOpen={setOpenId} />}
      {tab === "board" && <Board key={`b${reloadKey}`} onOpen={setOpenId} />}
      {tab === "sup" && <Supervision key={`s${reloadKey}`} />}

      {creating && <NewLead onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); reload(); setOpenId(id); }} />}
      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function LeadList({ view, onOpen }: { view: "fila" | "mine"; onOpen: (id: string) => void }) {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const load = () => jget(`/api/crm/leads?view=${view}`).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  async function pegar(id: string) {
    const r = await fetch(`/api/crm/leads/${id}/claim`, { method: "POST", credentials: "include" });
    if (r.ok) { dialog.toast("Lead pego (vá em Acompanhamento) ✅", "success"); load(); } else dialog.toast("Falha", "error");
  }
  if (items === null) return <p className="text-sm text-muted">Carregando…</p>;
  if (items.length === 0) return <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-muted">{view === "fila" ? "Sem leads novos 👍" : "Você ainda não pegou nenhum lead."}</p>;
  return (
    <div className="space-y-2">
      {items.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4">
          <button onClick={() => onOpen(l.id)} className="text-left">
            <p className="font-medium">{CHAN_ICON[l.source] ?? "•"} {l.name} <span className="ml-1 text-xs text-muted">{l.phone ?? ""}</span> <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">{STAGE_LABEL[l.stage] ?? l.stage}</span></p>
            <p className="text-xs text-muted">{l.source}{l.protocol ? ` · protocolo ${l.protocol}` : ""} · atualizado {fmt(l.lastEventAt)}{l.nextActionAt ? ` · ⏰ ${fmt(l.nextActionAt)}` : ""}</p>
          </button>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${l.score >= 70 ? "bg-green-500/15 text-green-300" : l.score >= 50 ? "bg-amber-500/15 text-amber-300" : "bg-line text-muted"}`}>score {l.score}</span>
            {view === "fila" && <button onClick={() => pegar(l.id)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Pegar</button>}
            <button onClick={() => onOpen(l.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Abrir</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<{ stages: string[]; byStage: Record<string, any[]> } | null>(null);
  useEffect(() => { jget("/api/crm/board").then(setData).catch(() => {}); }, []);
  if (!data) return <p className="text-sm text-muted">Carregando…</p>;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {data.stages.map((s) => (
        <div key={s} className="w-56 shrink-0 rounded-xl border border-line bg-bg/40 p-2">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{STAGE_LABEL[s] ?? s} <span className="text-muted/60">({(data.byStage[s] ?? []).length})</span></p>
          <div className="space-y-2">
            {(data.byStage[s] ?? []).map((l) => (
              <button key={l.id} onClick={() => onOpen(l.id)} className="block w-full rounded-lg border border-line bg-bg/70 p-2 text-left text-xs hover:border-brand">
                <p className="font-medium">{l.name}</p>
                <p className="text-[10px] text-muted">{CHAN_ICON[l.source] ?? "•"} score {l.score}</p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Supervision() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { jget("/api/crm/supervision").then(setD).catch(() => {}); }, []);
  if (!d) return <p className="text-sm text-muted">Carregando…</p>;
  const sc = d.stageCounts ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi k="Leads novos" v={d.novos ?? 0} cls="text-sky-300" />
        <Kpi k="Ganhos (24h)" v={d.ganhosHoje ?? 0} cls="text-green-400" />
        <Kpi k="Follow-ups vencidos" v={d.followupsVencidos ?? 0} cls={(d.followupsVencidos ?? 0) > 0 ? "text-red-400" : "text-white"} />
        <Kpi k="Em negociação" v={sc["negociacao"] ?? 0} />
      </div>
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-2 text-sm font-medium">Por etapa</p>
        <div className="flex flex-wrap gap-2">
          {Object.keys(STAGE_LABEL).map((s) => (
            <span key={s} className="rounded-full border border-line px-3 py-1 text-sm">{STAGE_LABEL[s]}: <b>{sc[s] ?? 0}</b></span>
          ))}
        </div>
      </div>
    </div>
  );
}
function Kpi({ k, v, cls }: { k: string; v: any; cls?: string }) { return <div className="rounded-2xl border border-line bg-bg/60 px-4 py-3"><p className="text-[10px] uppercase tracking-wider text-muted">{k}</p><p className={`mt-1 text-2xl font-black ${cls ?? "text-fg"}`}>{v}</p></div>; }

function NewLead({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const dialog = useDialog();
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (name.trim().length < 2) { dialog.toast("Informe o nome", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/crm/leads", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, source: "manual" }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      onCreated(d?.lead?.id);
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Novo lead</h3>
        <div className="mt-3 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome / empresa" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp/telefone" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail (opcional)" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Criar lead"}</button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [lead, setLead] = useState<any | null>(null);
  const [tabs, setTabs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [tabModal, setTabModal] = useState<null | { then: "ganho" | "perdido" | "call" }>(null);
  const [pickedTab, setPickedTab] = useState(""); const [lostReason, setLostReason] = useState("");
  const load = () => jget(`/api/crm/leads/${id}`).then((d) => setLead(d?.lead ?? null)).catch(() => {});
  useEffect(() => { load(); jget("/api/crm/tabulations").then((d) => setTabs(d?.items ?? [])).catch(() => {}); /* eslint-disable-next-line */ }, [id]);

  async function post(url: string, body?: any) {
    setBusy(true);
    try {
      const r = await fetch(url, { method: body && (body as any)._method === "PATCH" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return null; }
      setLead(d?.lead ?? lead); onChanged(); return d;
    } finally { setBusy(false); }
  }
  async function nota() { const t = await dialog.prompt("Anotação:"); if (t && t.trim()) await post(`/api/crm/leads/${id}/interaction`, { kind: "note", body: t.trim() }); }
  async function meeting(kind: "video" | "audio") {
    const d = await post(`/api/crm/leads/${id}/${kind}`);
    if (d?.url) { window.open(d.url, "_blank"); try { await navigator.clipboard?.writeText(d.url); } catch {} dialog.toast(kind === "audio" ? "Chamada de áudio criada (link copiado) 📞" : "Sala de vídeo criada (link copiado) 🎥", "success"); }
  }
  async function followup() { const t = await dialog.prompt("Follow-up — descrição (data depois): "); if (t && t.trim()) await post(`/api/crm/leads/${id}/task`, { title: t.trim() }); }
  function ligacao() { setPickedTab(""); setLostReason(""); setTabModal({ then: "call" }); }
  function stage(s: string) { if (s === "ganho" || s === "perdido") { setPickedTab(""); setLostReason(""); setTabModal({ then: s }); return; } post(`/api/crm/leads/${id}/stage`, { stage: s }); }
  async function confirmTab() {
    if (!pickedTab) { dialog.toast("Escolha a tabulação (obrigatória)", "error"); return; }
    if (tabModal?.then === "call") await post(`/api/crm/leads/${id}/interaction`, { kind: "call", tabulation: pickedTab });
    else await post(`/api/crm/leads/${id}/stage`, { stage: tabModal!.then, tabulation: pickedTab, lostReason: tabModal!.then === "perdido" ? lostReason : undefined });
    setTabModal(null);
  }
  if (!lead) return null;
  const grouped: Record<string, any[]> = {};
  for (const t of tabs) { const g = t.groupName || "Geral"; (grouped[g] ??= []).push(t); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold">{lead.name} <span className="text-xs text-muted">{lead.phone ?? ""}</span> <span className="ml-1 rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold">score {lead.score}</span></h3>
            <p className="text-xs text-muted">{CHAN_ICON[lead.source] ?? "•"} {lead.source}{lead.protocol ? ` · protocolo ${lead.protocol}` : ""} · {lead.status}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase text-muted">Etapa:</span>
          {OPEN_STAGES.map((s) => <button key={s} disabled={busy} onClick={() => stage(s)} className={`rounded-full px-3 py-1 text-xs ${lead.stage === s ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{STAGE_LABEL[s]}</button>)}
          <button disabled={busy} onClick={() => stage("ganho")} className={`rounded-full px-3 py-1 text-xs ${lead.stage === "ganho" ? "bg-green-500/30 text-green-200" : "border border-line text-green-300 hover:border-green-400"}`}>Ganho</button>
          <button disabled={busy} onClick={() => stage("perdido")} className={`rounded-full px-3 py-1 text-xs ${lead.stage === "perdido" ? "bg-red-500/30 text-red-200" : "border border-line text-red-300 hover:border-red-400"}`}>Perdido</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy} onClick={ligacao} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">📞 Registrar ligação</button>
          <button disabled={busy} onClick={nota} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">📝 Nota</button>
          <button disabled={busy} onClick={followup} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">⏰ Follow-up</button>
          <button disabled={busy} onClick={() => meeting("audio")} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">📞 Áudio (link)</button>
          <button disabled={busy} onClick={() => meeting("video")} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">🎥 Vídeo</button>
          <a href="/app/atendimento" target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">💬 Abrir conversa</a>
        </div>

        {(lead.tasks ?? []).filter((t: any) => !t.doneAt).length > 0 && (
          <div className="mt-3 space-y-1">
            {(lead.tasks ?? []).filter((t: any) => !t.doneAt).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs">
                <span>⏰ {t.title}{t.dueAt ? ` · ${fmt(t.dueAt)}` : ""}</span>
                <button onClick={() => post(`/api/crm/tasks/${t.id}/done`)} className="text-green-300 hover:underline">concluir</button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-[10px] uppercase tracking-wider text-muted">Linha do tempo</p>
        <div className="mt-1 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-line/60 bg-bg/40 p-3">
          {[...(lead.events ?? [])].reverse().map((e: any) => (
            <div key={e.id} className="flex gap-2 text-sm">
              <span className="mt-0.5 w-5 shrink-0 text-center">{KIND_ICON[e.kind] ?? "•"}</span>
              <div className="min-w-0">
                <p className="font-medium">{e.title}</p>
                {e.body && <p className="text-xs text-muted">{e.body}</p>}
                <p className="text-[10px] text-muted">{fmt(e.createdAt)}{e.protocol ? ` · protocolo ${e.protocol}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {tabModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setTabModal(null)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Tabulação obrigatória</h3>
            <p className="mt-1 text-xs text-muted">{tabModal.then === "ganho" ? "Fechando como GANHO." : tabModal.then === "perdido" ? "Fechando como PERDIDO." : "Encerrando a ligação."} Selecione o resultado:</p>
            {tabs.length === 0 ? (
              <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">Nenhuma tabulação cadastrada. Cadastre em Atendimento › configurações (tabulações).</p>
            ) : (
              <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">
                {Object.entries(grouped).map(([g, items]) => (
                  <div key={g}>
                    <p className="text-[10px] uppercase tracking-wider text-muted">{g}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {items.map((t) => { const v = `${t.groupName ? t.groupName + " › " : ""}${t.name}`; return (
                        <button key={t.id} onClick={() => setPickedTab(v)} className={`rounded-full px-3 py-1 text-xs ${pickedTab === v ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{t.name}</button>
                      ); })}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tabModal.then === "perdido" && <input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Motivo da perda (opcional)" className="mt-3 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setTabModal(null)} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
              <button disabled={busy || !pickedTab} onClick={confirmTab} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">Confirmar tabulação</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
