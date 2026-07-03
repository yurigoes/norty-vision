"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

const CAT_LABEL: Record<string, string> = { duvida: "Dúvida", bug: "Problema/bug", solicitacao: "Solicitação", senha: "Trocar senha", email: "Trocar e-mail", telefone: "Trocar telefone", outro: "Outro" };
const STATUS_LABEL: Record<string, string> = { aberto: "Aberto", aguardando_master: "Com o suporte", aguardando_usuario: "Aguardando você", resolvido_ia: "Resolvido pela IA", resolvido: "Resolvido", fechado: "Fechado" };
const STATUS_CLS: Record<string, string> = { aberto: "bg-sky-500/15 text-sky-300", aguardando_master: "bg-amber-500/15 text-amber-300", aguardando_usuario: "bg-purple-500/15 text-purple-300", resolvido_ia: "bg-green-500/15 text-green-300", resolvido: "bg-green-500/15 text-green-300", fechado: "bg-line text-muted" };
const SECURE = new Set(["senha", "email", "telefone"]);

export function SuporteSistemaClient({ isAdmin }: { isAdmin: boolean }) {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () => fetch("/api/platform-support/tickets", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{isAdmin ? "Você vê os chamados de toda a empresa." : "Você vê apenas os seus chamados."}</p>
        <button onClick={() => setCreating(true)} className="btn-grad">+ Novo chamado</button>
      </div>
      {items === null ? <p className="text-sm text-muted">Carregando…</p> : items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-8 text-center text-muted">Nenhum chamado ainda.</p>
      ) : (
        <div className="space-y-2">
          {items.map((t) => (
            <button key={t.id} onClick={() => setOpenId(t.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-brand/50">
              <div><p className="font-medium">{t.subject} <span className="ml-1 text-xs text-muted">{t.shortCode}</span></p>
                <p className="text-xs text-muted">{CAT_LABEL[t.category] ?? t.category}{isAdmin && t.requesterName ? ` · ${t.requesterName}` : ""} · {new Date(t.updatedAt).toLocaleString("pt-BR")}</p></div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_CLS[t.status] ?? "bg-line text-muted"}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
            </button>
          ))}
        </div>
      )}
      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id); }} />}
      {openId && <Thread id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function NewTicket({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const dialog = useDialog();
  const [category, setCategory] = useState("duvida");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (subject.trim().length < 2 || body.trim().length < 2) { dialog.toast("Preencha assunto e descrição", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/platform-support/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ category, subject: subject.trim(), body: body.trim() }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      onCreated(d?.ticket?.id);
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Novo chamado</h3>
        <div className="mt-3 space-y-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-base">
              {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Assunto</span><input value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Descrição</span><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="input-base" placeholder={SECURE.has(category) ? "Ex.: quero trocar minha senha" : "Descreva sua dúvida ou problema"} /></label>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1">{busy ? "Abrindo…" : "Abrir chamado"}</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:border-brand hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function Thread({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [t, setT] = useState<any | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetch(`/api/platform-support/tickets/${id}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setT(d?.ticket ?? null)).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function send() {
    if (reply.trim().length < 1) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/platform-support/tickets/${id}/message`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ body: reply.trim() }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      setReply(""); setT(d?.ticket ?? t); onChanged();
    } finally { setBusy(false); }
  }
  if (!t) return null;
  const secure = SECURE.has(t.category);
  const done = ["resolvido", "resolvido_ia", "fechado"].includes(t.status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-base font-semibold">{t.subject} <span className="text-xs text-muted">{t.shortCode}</span></h3>
            <p className="text-xs text-muted">{CAT_LABEL[t.category] ?? t.category} · <span className={`rounded-full px-2 py-0.5 ${STATUS_CLS[t.status] ?? ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span></p></div>
          <button onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>

        <div className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-lg border border-line/60 bg-surface-2 p-3">
          {(t.messages ?? []).map((m: any) => (
            <div key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.author === "usuario" ? "ml-auto bg-brand/15" : m.author === "master" ? "bg-purple-500/15" : m.author === "sistema" ? "bg-line/40 text-muted" : "bg-surface border border-line"}`}>
              <p className="mb-0.5 text-[10px] uppercase tracking-wider text-muted">{m.author === "usuario" ? "Você" : m.author === "ia" ? "IA" : m.author === "master" ? "Suporte" : "Sistema"} · {new Date(m.createdAt).toLocaleString("pt-BR")}</p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>

        {secure ? (
          <SecureWizard ticket={t} onChanged={() => { load(); onChanged(); }} />
        ) : !done ? (
          <div className="mt-3 flex gap-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Responder…" className="input-base flex-1 w-auto" />
            <button disabled={busy} onClick={send} className="btn-grad disabled:opacity-50">Enviar</button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reabrir com uma nova mensagem…" className="input-base flex-1 w-auto" />
            <button disabled={busy} onClick={send} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold transition hover:border-brand disabled:opacity-50">Enviar</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Assistente seguro p/ senha / e-mail / telefone. */
function SecureWizard({ ticket, onChanged }: { ticket: any; onChanged: () => void }) {
  const dialog = useDialog();
  const [info, setInfo] = useState<any | null>(null);
  const [mode, setMode] = useState<"menu" | "self" | "otp">("menu");
  const [busy, setBusy] = useState(false);
  // self password
  const [curPw, setCurPw] = useState(""); const [newPw, setNewPw] = useState("");
  // otp
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [reqId, setReqId] = useState<string | null>(null);
  const [code, setCode] = useState(""); const [newVal, setNewVal] = useState("");
  const action = ticket.category === "senha" ? "password_change" : ticket.category === "email" ? "email_change" : "phone_change";
  const done = ["resolvido", "fechado"].includes(ticket.status);

  useEffect(() => { fetch(`/api/platform-support/tickets/${ticket.id}/secure-info`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {}); }, [ticket.id]);
  if (done) return <p className="mt-3 rounded-lg border border-success/30 bg-success/10 p-3 text-center text-sm text-success">✅ Concluído.</p>;
  if (!info) return <p className="mt-3 text-sm text-muted">Carregando assistente…</p>;

  async function call(url: string, body: any): Promise<any | null> {
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return null; }
      return d;
    } finally { setBusy(false); }
  }
  async function doSelf() {
    if (newPw.length < 8) { dialog.toast("A nova senha precisa ter ao menos 8 caracteres", "error"); return; }
    const d = await call(`/api/platform-support/tickets/${ticket.id}/password-self`, { currentPassword: curPw, newPassword: newPw });
    if (d?.ok) { dialog.toast("Senha alterada ✅", "success"); setCurPw(""); setNewPw(""); onChanged(); }
  }
  async function sendOtp() {
    const d = await call(`/api/platform-support/tickets/${ticket.id}/otp`, { action, channel });
    if (d?.requestId) { setReqId(d.requestId); dialog.toast(`Código enviado por ${channel === "email" ? "e-mail" : "WhatsApp"} ✅`, "success"); }
  }
  async function applyOtp() {
    if (code.trim().length !== 5) { dialog.toast("Digite o código de 5 dígitos", "error"); return; }
    if (action === "password_change" && newVal.length < 8) { dialog.toast("A nova senha precisa ter ao menos 8 caracteres", "error"); return; }
    const d = await call(`/api/platform-support/tickets/${ticket.id}/otp/apply`, { action, requestId: reqId, code: code.trim(), newValue: newVal });
    if (d?.ok) { dialog.toast("Concluído ✅", "success"); onChanged(); }
  }
  async function noAccess() {
    const d = await call(`/api/platform-support/tickets/${ticket.id}/no-access`, {});
    if (d?.ticket) { dialog.toast("Encaminhado ao suporte", "info"); onChanged(); }
  }

  const newLabel = action === "password_change" ? "Nova senha" : action === "email_change" ? "Novo e-mail" : "Novo telefone";
  const newType = action === "password_change" ? "password" : "text";

  return (
    <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 p-3">
      <p className="text-sm font-medium text-warn">🔒 Assistente seguro — {CAT_LABEL[ticket.category]}</p>

      {mode === "menu" && (
        <div className="mt-2 space-y-2 text-sm">
          {ticket.category === "senha" && info.isSelf && (
            <button onClick={() => setMode("self")} className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-brand">Sei minha senha atual → trocar agora</button>
          )}
          <button onClick={() => setMode("otp")} className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-brand">
            {ticket.category === "senha" ? "Esqueci a senha / autorizar por código" : "Autorizar com código"}
            <span className="block text-[11px] text-muted">Enviamos um código de 5 dígitos para o seu e-mail/WhatsApp cadastrado.</span>
          </button>
          <button onClick={noAccess} disabled={busy} className="w-full rounded-lg border border-line px-3 py-2 text-left text-muted hover:text-fg">Não tenho acesso ao e-mail/WhatsApp → falar com o suporte</button>
        </div>
      )}

      {mode === "self" && (
        <div className="mt-2 space-y-2">
          <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="Senha atual" className="input-base" />
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Nova senha (mín. 8)" className="input-base" />
          <p className="text-[11px] text-muted">Por segurança, a senha não fica registrada no chamado.</p>
          <div className="flex gap-2">
            <button onClick={() => setMode("menu")} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-brand hover:text-fg">voltar</button>
            <button disabled={busy} onClick={doSelf} className="btn-grad flex-1">Trocar senha</button>
          </div>
        </div>
      )}

      {mode === "otp" && (
        <div className="mt-2 space-y-2">
          {!reqId ? (
            <>
              <p className="text-[11px] text-muted">Enviar código para:</p>
              <div className="flex gap-2">
                <button disabled={!info.hasPhone} onClick={() => setChannel("whatsapp")} className={`flex-1 rounded-lg border px-3 py-2 text-xs ${channel === "whatsapp" ? "border-brand text-brand" : "border-line text-muted"} disabled:opacity-40`}>WhatsApp {info.phoneMask}</button>
                <button disabled={!info.hasEmail} onClick={() => setChannel("email")} className={`flex-1 rounded-lg border px-3 py-2 text-xs ${channel === "email" ? "border-brand text-brand" : "border-line text-muted"} disabled:opacity-40`}>E-mail {info.emailMask}</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setMode("menu")} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-brand hover:text-fg">voltar</button>
                <button disabled={busy} onClick={sendOtp} className="btn-grad flex-1">Enviar código</button>
              </div>
            </>
          ) : (
            <>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="Código (5 dígitos)" className="input-base text-center font-mono text-lg tracking-[0.4em]" />
              <input type={newType} value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder={newLabel} className="input-base" />
              <div className="flex gap-2">
                <button onClick={sendOtp} disabled={busy} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold text-muted transition hover:border-brand hover:text-fg">reenviar</button>
                <button disabled={busy} onClick={applyOtp} className="btn-grad flex-1">Confirmar</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
