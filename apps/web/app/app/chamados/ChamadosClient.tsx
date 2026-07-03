"use client";

import { useCallback, useEffect, useState } from "react";

function brl(c: number | string) {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
const STATUS_LABEL: Record<string, string> = {
  new: "Novo", triage: "Triagem", open: "Aberto", pending: "Pendente",
  waiting_customer: "Aguardando cliente", resolved: "Resolvido", closed: "Fechado", reopened: "Reaberto",
};
const PRIO_LABEL: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const PRIO_CLS: Record<string, string> = {
  low: "text-muted", normal: "text-fg", high: "text-orange-300", urgent: "text-red-300",
};

export function ChamadosClient() {
  const [tab, setTab] = useState<"tickets" | "os">("tickets");
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <TabBtn active={tab === "tickets"} onClick={() => setTab("tickets")}>Chamados</TabBtn>
        <TabBtn active={tab === "os"} onClick={() => setTab("os")}>Ordens de serviço</TabBtn>
      </div>
      {tab === "tickets" ? <Tickets /> : <ServiceOrders />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-xl px-4 py-2 text-sm font-medium transition ${active ? "bg-brand text-white" : "border border-line text-muted hover:border-brand/60 hover:text-brand"}`}>
      {children}
    </button>
  );
}

// ============================== CHAMADOS ==============================
function Tickets() {
  const [status, setStatus] = useState("open");
  const [items, setItems] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/helpdesk/tickets?status=${status}`, { credentials: "include" })
      .then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => {});
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base flex-1 w-auto">
            <option value="open">Abertos</option>
            <option value="new">Novos</option>
            <option value="pending">Pendentes</option>
            <option value="resolved">Resolvidos</option>
            <option value="closed">Fechados</option>
            <option value="all">Todos</option>
          </select>
          <button onClick={() => setCreating(true)} className="btn-grad px-3 py-1.5 text-sm">+ Novo</button>
        </div>
        <div className="space-y-1.5">
          {items.length === 0 && <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Nenhum chamado.</p>}
          {items.map((t) => (
            <button key={t.id} onClick={() => setSel(t.id)} className={`block w-full rounded-xl border p-3 text-left transition ${sel === t.id ? "border-brand bg-brand/5" : "border-line bg-surface hover:border-brand/50 hover:bg-surface-2"}`}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted">{t.code}</span>
                <span className={`text-[10px] ${PRIO_CLS[t.priority] ?? ""}`}>{PRIO_LABEL[t.priority] ?? t.priority}</span>
              </div>
              <p className="mt-0.5 truncate text-sm font-medium">{t.subject}</p>
              <span className="text-[10px] uppercase text-muted">{STATUS_LABEL[t.status] ?? t.status}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        {sel ? <TicketDetail id={sel} onChange={load} /> : <p className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted">Selecione um chamado.</p>}
      </div>
      {creating && <CreateTicket onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); load(); setSel(id); }} />}
    </div>
  );
}

function TicketDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const [t, setT] = useState<any>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/helpdesk/tickets/${id}`, { credentials: "include" }).then((r) => r.json()).then(setT).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // tempo real leve
  useEffect(() => { const i = setInterval(load, 8000); return () => clearInterval(i); }, [load]);

  async function reply() {
    if (!body.trim()) return;
    setBusy(true);
    await fetch(`/api/helpdesk/tickets/${id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ body, isInternal: internal }),
    });
    setBody(""); setBusy(false); load(); onChange();
  }
  async function setStatus(status: string) {
    await fetch(`/api/helpdesk/tickets/${id}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ status }),
    });
    load(); onChange();
  }

  if (!t) return <p className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-muted">Carregando…</p>;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] text-muted">{t.code}</p>
          <h2 className="text-lg font-semibold">{t.subject}</h2>
          <p className="text-xs text-muted">{t.requesterName ?? "—"} · {STATUS_LABEL[t.status] ?? t.status} · {PRIO_LABEL[t.priority]}</p>
        </div>
        <select value={t.status} onChange={(e) => setStatus(e.target.value)} className="input-base w-auto px-2 py-1.5 text-xs">
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
        {(t.messages ?? []).map((m: any) => (
          <div key={m.id} className={`rounded-lg p-3 text-sm ${m.isInternal ? "border border-amber-500/40 bg-amber-500/5" : m.authorType === "customer" ? "bg-line/40" : "bg-brand/10"}`}>
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
              <span>{m.isInternal ? "🔒 nota interna" : m.authorType === "customer" ? "cliente" : "atendente"}</span>
              <span>{new Date(m.createdAt).toLocaleString("pt-BR")}</span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Escreva uma resposta…" className="input-base" />
        <div className="mt-2 flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> nota interna (cliente não vê)
          </label>
          <button disabled={busy} onClick={reply} className="btn-grad disabled:opacity-50">
            {busy ? "Enviando…" : internal ? "Adicionar nota" : "Responder"}
          </button>
        </div>
      </div>

      {Array.isArray(t.serviceOrders) && t.serviceOrders.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase text-muted">Ordens de serviço</p>
          {t.serviceOrders.map((so: any) => (
            <div key={so.id} className="flex items-center justify-between rounded-xl border border-line bg-surface-2 p-2 text-sm">
              <span>{so.code} · {so.title}</span>
              <span className="text-xs text-muted">{brl(so.totalCents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateTicket({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [requesterName, setRequesterName] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!subject.trim() || !description.trim()) return;
    setBusy(true);
    const r = await fetch("/api/helpdesk/tickets", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ subject, description, priority, requesterName, requesterPhone, channel: "manual" }),
    });
    const d = await r.json(); setBusy(false);
    if (r.ok && d?.id) onDone(d.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Novo chamado</h3>
        <div className="mt-3 space-y-2">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" className="input-base" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Descrição" className="input-base" />
          <div className="grid grid-cols-2 gap-2">
            <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} placeholder="Solicitante" className="input-base" />
            <input value={requesterPhone} onChange={(e) => setRequesterPhone(e.target.value)} placeholder="WhatsApp (opcional)" className="input-base" />
          </div>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input-base">
            {Object.entries(PRIO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1 disabled:opacity-50">Abrir chamado</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ============================== ORDENS DE SERVIÇO ==============================
const SO_STATUS: Record<string, string> = {
  open: "Aberta", in_progress: "Em execução", waiting_part: "Aguardando peça", ready: "Pronta", delivered: "Entregue", canceled: "Cancelada",
};
const SO_STATUS_CLS: Record<string, string> = {
  open: "bg-line text-fg", in_progress: "bg-blue-500/20 text-blue-300", waiting_part: "bg-amber-500/20 text-amber-300",
  ready: "bg-green-500/20 text-green-300", delivered: "bg-green-500/20 text-green-300", canceled: "bg-red-500/20 text-red-300",
};
const URGENCY_LABEL: Record<string, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const URGENCY_CLS: Record<string, string> = { low: "text-muted", normal: "text-fg", high: "text-orange-300", urgent: "text-red-300 font-semibold" };

function ServiceOrders() {
  const [items, setItems] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const load = useCallback(() => {
    fetch("/api/helpdesk/service-orders?status=all", { credentials: "include" }).then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!openId) { setDetail(null); return; }
    fetch(`/api/helpdesk/service-orders/${openId}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => setDetail(d)).catch(() => {});
  }, [openId]);

  async function setStatus(id: string, status: string) {
    const res = await fetch(`/api/helpdesk/service-orders/${id}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { const d = await res.json().catch(() => null); alert(d?.error?.message ?? "Ação não permitida"); }
    load(); if (openId === id) setOpenId(id);
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setCreating(true)} className="btn-grad px-3 py-1.5 text-sm">+ Nova OS</button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Nenhuma ordem de serviço.</p>}
        {items.map((so) => (
          <div key={so.id} className="rounded-2xl border border-line bg-surface p-4 transition hover:bg-surface-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-muted">{so.code}</p>
                <p className="font-medium">{so.title} {so.urgency && so.urgency !== "normal" && <span className={`ml-1 text-[10px] ${URGENCY_CLS[so.urgency]}`}>● {URGENCY_LABEL[so.urgency]}</span>}</p>
                <p className="text-xs text-muted">{[so.customerName, so.equipment].filter(Boolean).join(" · ")}{so.equipment || so.customerName ? " · " : ""}{brl(so.totalCents)}{typeof so.rating === "number" ? ` · ⭐${so.rating}` : ""}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SO_STATUS_CLS[so.status] ?? "bg-line text-muted"}`}>{SO_STATUS[so.status] ?? so.status}</span>
                <select value={so.status} onChange={(e) => setStatus(so.id, e.target.value)} className="input-base w-auto px-2 py-1.5 text-xs">
                  {Object.entries(SO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <button onClick={() => setOpenId(openId === so.id ? null : so.id)} className="rounded-xl border border-line px-2 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">{openId === so.id ? "ocultar" : "detalhes"}</button>
              </div>
            </div>
            {Array.isArray(so.items) && so.items.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {so.items.map((it: any) => <li key={it.id}>{it.qty}× {it.description} — {brl(it.totalCents)}</li>)}
              </ul>
            )}
            {openId === so.id && detail && (
              <div className="mt-3 border-t border-line/60 pt-3">
                {detail.notes && <p className="mb-2 text-xs text-muted">📝 {detail.notes}</p>}
                <p className="mb-1 text-[10px] font-semibold uppercase text-muted">Linha do tempo</p>
                <ul className="space-y-1 text-xs">
                  {(detail.events ?? []).map((ev: any) => (
                    <li key={ev.id} className="flex items-center gap-2 text-muted">
                      <span className="text-[10px]">{new Date(ev.createdAt).toLocaleString("pt-BR")}</span>
                      <span>· {ev.eventType === "created" ? "criada" : ev.eventType === "status" ? `status: ${SO_STATUS[ev.payload?.status] ?? ev.payload?.status}` : ev.eventType === "rated" ? `avaliada ⭐${ev.payload?.rating}` : ev.eventType}</span>
                    </li>
                  ))}
                </ul>
                {detail.ratingComment && <p className="mt-2 text-xs text-amber-300">Avaliação do cliente: "{detail.ratingComment}"</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && <CreateSo onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
    </div>
  );
}

type Cust = { id: string; name: string; document?: string | null; phone?: string | null };
function CreateSo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [equipment, setEquipment] = useState("");
  const [type, setType] = useState("repair");
  const [urgency, setUrgency] = useState("normal");
  const [notes, setNotes] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Cust[]>([]);
  const [customer, setCustomer] = useState<Cust | null>(null);
  const [items, setItems] = useState<{ kind: string; description: string; qty: number; unitCents: number }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || customer) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(term)}&limit=6`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setResults(d.items ?? [])).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q, customer]);

  function addItem() { setItems([...items, { kind: "service", description: "", qty: 1, unitCents: 0 }]); }
  function upd(i: number, patch: any) { setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it)); }

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    await fetch("/api/helpdesk/service-orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ title, equipment, type, urgency, notes: notes.trim() || undefined, customerId: customer?.id, items }),
    });
    setBusy(false); onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Nova ordem de serviço</h3>
        <div className="mt-3 space-y-2">
          {/* cliente (pra avisar no WhatsApp + portal) */}
          {customer ? (
            <div className="flex items-center justify-between rounded-lg border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
              <span className="truncate">👤 {customer.name}{customer.document ? ` · ${customer.document}` : ""}</span>
              <button onClick={() => { setCustomer(null); setQ(""); }} className="text-xs text-red-300 hover:underline">trocar</button>
            </div>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente (nome / CPF) — opcional, p/ avisar no WhatsApp" className="input-base" />
              {results.length > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {results.map((c) => (
                    <button key={c.id} onClick={() => { setCustomer(c); setResults([]); }} className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-left text-sm transition hover:border-brand">
                      <span className="truncate">{c.name}</span><span className="text-xs text-muted">{c.phone || c.document || ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (ex.: Troca de haste)" className="input-base" />
          <div className="grid grid-cols-2 gap-2">
            <input value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="Equipamento/óculos" className="input-base" />
            <select value={type} onChange={(e) => setType(e.target.value)} className="input-base">
              <option value="repair">Conserto</option>
              <option value="warranty">Garantia</option>
              <option value="assistance">Assistência</option>
              <option value="other">Outro</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="input-base">
              <option value="low">Urgência: Baixa</option>
              <option value="normal">Urgência: Normal</option>
              <option value="high">Urgência: Alta</option>
              <option value="urgent">Urgência: Urgente</option>
            </select>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações (opcional)" className="input-base" />
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted">Itens</span>
              <button onClick={addItem} className="text-xs text-brand">+ item</button>
            </div>
            {items.map((it, i) => (
              <div key={i} className="mb-1 grid grid-cols-[1fr_56px_90px] gap-1">
                <input value={it.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="Descrição" className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-brand" />
                <input type="number" value={it.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-brand" />
                <input type="number" value={it.unitCents / 100} onChange={(e) => upd(i, { unitCents: Math.round(Number(e.target.value) * 100) })} placeholder="R$ unit" className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs outline-none focus:border-brand" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1 disabled:opacity-50">Criar OS</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
