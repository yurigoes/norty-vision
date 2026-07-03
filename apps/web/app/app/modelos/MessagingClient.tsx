"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

type Category = "info" | "low" | "warning" | "critical";

const CATEGORIES: Array<{ value: Category; label: string; color: string }> = [
  { value: "info", label: "Informação", color: "#2563eb" },
  { value: "low", label: "Não urgente", color: "#0d9488" },
  { value: "warning", label: "Urgente", color: "#f59e0b" },
  { value: "critical", label: "Crítico / Inadimplente", color: "#dc2626" },
];

interface VarGroup { group: string; items: Array<{ key: string; label: string }> }

interface Template {
  id: string;
  channel: "email" | "whatsapp";
  code: string;
  name: string;
  category?: Category;
  subject: string | null;
  body: string;
  isActive: boolean;
}

interface Smtp {
  host: string | null;
  port: number;
  secure: boolean;
  username: string | null;
  hasPassword: boolean;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  enabled: boolean;
}

const VARS = "{{nome}} {{cpf}} {{valor}} {{vencimento}} {{parcela}} {{empresa}} {{loja}} {{link}}";

export function MessagingClient({
  initialTemplates,
  initialSmtp,
}: {
  initialTemplates: Template[];
  initialSmtp: Smtp | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"email" | "whatsapp" | "smtp">("email");

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-line">
        <TabBtn active={tab === "email"} onClick={() => setTab("email")}>Email</TabBtn>
        <TabBtn active={tab === "whatsapp"} onClick={() => setTab("whatsapp")}>WhatsApp</TabBtn>
        <TabBtn active={tab === "smtp"} onClick={() => setTab("smtp")}>SMTP da empresa</TabBtn>
      </div>

      {tab === "smtp" ? (
        <SmtpForm initial={initialSmtp} onSaved={() => router.refresh()} />
      ) : (
        <ChannelTemplates
          channel={tab}
          templates={initialTemplates.filter((t) => t.channel === tab)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function ChannelTemplates({
  channel,
  templates,
  onChanged,
}: {
  channel: "email" | "whatsapp";
  templates: Template[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/messaging/system-templates", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setCatalog(d?.items ?? [])).catch(() => {});
  }, []);
  const sysForChannel = catalog.filter((c) => (c.channels ?? []).includes(channel));
  const existingCodes = new Set(templates.map((t) => t.code));

  const blank: Template = {
    id: "", channel, code: "", name: "", category: "info", subject: "", body: "", isActive: true,
  };
  function personalizar(c: any) {
    setEditing({ id: "", channel, code: c.code, name: c.name, category: c.category ?? "info", subject: channel === "email" ? (c.subject ?? "") : "", body: c.body, isActive: true });
  }

  if (creating || editing) {
    return (
      <TemplateForm
        channel={channel}
        initial={editing ?? blank}
        onCancel={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { setCreating(false); setEditing(null); onChanged(); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Use variáveis no corpo: <code className="rounded bg-line px-1.5 py-0.5 text-[11px]">{VARS}</code>
        </p>
        <button onClick={() => setCreating(true)} className="btn-grad">
          Novo modelo
        </button>
      </div>
      {templates.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhum modelo de {channel} personalizado ainda.</p>
      ) : (
        templates.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.name} <span className="font-mono text-[11px] text-muted">· {t.code}</span></p>
              {t.subject && <p className="truncate text-xs text-muted">Assunto: {t.subject}</p>}
              <p className="truncate text-xs text-muted">{t.body.slice(0, 80)}</p>
            </div>
            <button onClick={() => setEditing(t)} className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">Editar</button>
          </div>
        ))
      )}

      {sysForChannel.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm font-semibold">Modelos automáticos do sistema</p>
          <p className="mb-3 text-xs text-muted">Mensagens que o sistema envia sozinho. Clique em <b>Personalizar</b> para criar a sua versão (com o branding da empresa no e-mail). Enquanto não personalizar, vale o texto padrão.</p>
          <div className="space-y-2">
            {sysForChannel.map((c) => {
              const done = existingCodes.has(c.code);
              return (
                <div key={c.code} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.name} <span className="font-mono text-[10px] text-muted">· {c.code}</span>{done && <span className="ml-2 rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] text-green-300">personalizado</span>}</p>
                    <p className="text-[11px] text-muted">{c.description}</p>
                    {c.variables?.length > 0 && <p className="mt-0.5 font-mono text-[10px] text-muted">{c.variables.map((v: string) => `{{${v}}}`).join(" ")}</p>}
                  </div>
                  {done ? (
                    <button onClick={() => { const t = templates.find((x) => x.code === c.code); if (t) setEditing(t); }} className="shrink-0 rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">Editar</button>
                  ) : (
                    <button onClick={() => personalizar(c)} className="shrink-0 rounded-xl border border-brand px-3 py-1.5 text-xs text-brand transition hover:bg-brand hover:text-white">Personalizar</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateForm({
  channel,
  initial,
  onCancel,
  onSaved,
}: {
  channel: "email" | "whatsapp";
  initial: Template;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const dialog = useDialog();
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);
  const [category, setCategory] = useState<Category>(initial.category ?? "info");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [groups, setGroups] = useState<VarGroup[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // catalogo de variaveis chaveaveis
  useEffect(() => {
    fetch("/api/messaging/variables", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setGroups(d?.groups ?? []))
      .catch(() => setGroups([]));
  }, []);

  function insertVar(key: string) {
    const tag = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + tag); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + tag + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function refreshPreview() {
    try {
      const res = await fetch("/api/messaging/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subject, body, category }),
      });
      const data = await res.json();
      if (res.ok) setPreviewHtml(data.html);
    } catch { /* ignora */ }
  }

  // atualiza a previa do email automaticamente (debounce)
  useEffect(() => {
    if (channel !== "email") return;
    const t = setTimeout(refreshPreview, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, category, channel]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/messaging/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel, code: code || name, name,
          category: channel === "email" ? category : undefined,
          subject: channel === "email" ? (subject || null) : null,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!initial.id) return;
    if (!(await dialog.confirm({ message: "Remover este modelo?", confirmLabel: "Remover", tone: "danger" }))) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/messaging/templates/${initial.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d?.error?.message ?? "Falha"); }
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function sendTest() {
    if (!testTo.trim() || !initial.id) {
      setTestMsg("Salve o modelo antes de testar e informe o destino.");
      return;
    }
    setBusy(true); setTestMsg(null); setErr(null);
    try {
      const url = channel === "email" ? "/api/messaging/test/email" : "/api/messaging/test/whatsapp";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ to: testTo.trim(), templateId: initial.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no teste");
      setTestMsg(`Enviado! ${data.source ? `(via ${data.source})` : ""}`);
    } catch (e: any) { setTestMsg(`Erro: ${e.message}`); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-brand/40 bg-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
        {initial.id ? "Editar modelo" : "Novo modelo"} · {channel}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Código {initial.id && "(fixo)"}</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!initial.id} placeholder="cobranca_vencida" className="input-base font-mono text-xs disabled:opacity-50" />
        </label>
      </div>
      {channel === "email" && (
        <>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Assunto</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base" />
          </label>
          <div>
            <span className="mb-1 block text-[10px] uppercase text-muted">Tipo / urgência (cor do email)</span>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                    category === c.value ? "border-transparent text-white" : "border-line text-muted hover:text-fg"
                  }`}
                  style={category === c.value ? { background: c.color } : undefined}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Corpo</span>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={channel === "email" ? 12 : 6}
              className="input-base font-mono text-xs"
            />
          </label>
          {groups.length > 0 && (
            <div className="mt-2 space-y-2">
              <span className="text-[10px] uppercase text-muted">Inserir variável</span>
              {groups.map((g) => (
                <div key={g.group}>
                  <p className="text-[10px] text-muted">{g.group}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.items.map((it) => (
                      <button
                        key={it.key}
                        type="button"
                        title={it.label}
                        onClick={() => insertVar(it.key)}
                        className="rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted transition hover:border-brand hover:text-fg"
                      >
                        {`{{${it.key}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {channel === "email" && (
          <div>
            <span className="mb-1 block text-[10px] uppercase text-muted">Pré-visualização</span>
            <div className="overflow-hidden rounded-lg border border-line bg-white">
              {previewHtml ? (
                <iframe title="preview" srcDoc={previewHtml} className="h-[420px] w-full" />
              ) : (
                <div className="flex h-[420px] items-center justify-center text-xs text-muted">gerando prévia...</div>
              )}
            </div>
          </div>
        )}
      </div>

      {err && <p className="text-xs text-red-300">{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy || !name.trim() || !body.trim()} className="btn-grad disabled:opacity-50">
          {busy ? "..." : "Salvar"}
        </button>
        <button onClick={onCancel} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Cancelar</button>
        {initial.id && (
          <button onClick={remove} className="rounded-lg border border-line px-4 py-2 text-sm text-red-300 transition hover:border-red-400">Remover</button>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface-2 p-3">
        <p className="mb-2 text-[10px] uppercase text-muted">Testar envio</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder={channel === "email" ? "email@destino.com" : "DDD + número"}
            className="input-base flex-1"
          />
          <button onClick={sendTest} disabled={busy} className="rounded-lg border border-brand px-4 py-2 text-sm text-brand transition hover:bg-brand hover:text-white disabled:opacity-50">
            Enviar teste
          </button>
        </div>
        {testMsg && <p className="mt-2 text-xs text-muted">{testMsg}</p>}
      </div>
    </section>
  );
}

function SmtpForm({ initial, onSaved }: { initial: Smtp | null; onSaved: () => void }) {
  const [f, setF] = useState({
    host: initial?.host ?? "",
    port: initial?.port ?? 587,
    secure: initial?.secure ?? false,
    username: initial?.username ?? "",
    password: "",
    fromName: initial?.fromName ?? "",
    fromEmail: initial?.fromEmail ?? "",
    replyTo: initial?.replyTo ?? "",
    enabled: initial?.enabled ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const payload: any = { ...f };
      if (!payload.password) delete payload.password; // mantém a senha existente
      const res = await fetch("/api/messaging/smtp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      setMsg("SMTP salvo.");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <p className="text-sm text-muted">
        Configure o SMTP da sua empresa. Se desabilitado ou vazio, usamos o servidor da plataforma —
        mas sempre <strong>em nome da sua empresa</strong>, com reply-to seu.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="accent-brand" />
        Usar meu próprio SMTP
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Inp label="Host" value={f.host} onChange={(v) => setF({ ...f, host: v })} placeholder="smtp.gmail.com" />
        <Inp label="Porta" value={String(f.port)} onChange={(v) => setF({ ...f, port: Number(v) || 587 })} />
        <Inp label="Usuário" value={f.username} onChange={(v) => setF({ ...f, username: v })} />
        <Inp label="Senha" value={f.password} onChange={(v) => setF({ ...f, password: v })} type="password" placeholder={initial?.hasPassword ? "•••••• (mantém atual)" : ""} />
        <Inp label="Nome do remetente" value={f.fromName} onChange={(v) => setF({ ...f, fromName: v })} placeholder="Minha Loja" />
        <Inp label="Email do remetente" value={f.fromEmail} onChange={(v) => setF({ ...f, fromEmail: v })} placeholder="contato@minhaloja.com" />
        <Inp label="Reply-to" value={f.replyTo} onChange={(v) => setF({ ...f, replyTo: v })} />
        <label className="flex items-end gap-2 text-sm">
          <input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} className="accent-brand" />
          TLS/SSL (porta 465)
        </label>
      </div>
      {err && <p className="text-xs text-red-300">{err}</p>}
      {msg && <p className="text-xs text-green-300">{msg}</p>}
      <button onClick={save} disabled={busy} className="btn-grad disabled:opacity-50">
        {busy ? "Salvando..." : "Salvar SMTP"}
      </button>
    </section>
  );
}

function Inp({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase text-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-base" />
    </label>
  );
}
