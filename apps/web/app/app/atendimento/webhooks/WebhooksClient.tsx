"use client";

// CRUD de webhooks out. Eventos suportados pelo backend (em inbox.service):
//   conversation.created       — nova conversa
//   message.created            — mensagem recebida ou enviada
//   conversation.resolved      — conversa finalizada (com protocolo)

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

const ALL_EVENTS = [
  { key: "conversation.created", label: "Nova conversa" },
  { key: "message.created", label: "Nova mensagem (in/out)" },
  { key: "conversation.resolved", label: "Conversa finalizada" },
];

interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  isActive: boolean;
  lastDeliveredAt: string | null;
  deliverFailCount: number;
}

export function WebhooksClient() {
  const dialog = useDialog();
  const [items, setItems] = useState<Webhook[]>([]);
  const [edit, setEdit] = useState<Partial<Webhook> | null>(null);

  function load() {
    fetch("/api/inbox/webhooks", { credentials: "include" }).then((r) => r.json()).then((d) => setItems(d?.items ?? [])).catch(() => undefined);
  }
  useEffect(load, []);

  async function save() {
    if (!edit?.name?.trim() || !edit.url?.trim()) { dialog.toast("Preencha nome e URL", "error"); return; }
    if (!edit.events?.length) { dialog.toast("Selecione ao menos 1 evento", "error"); return; }
    const r = await fetch("/api/inbox/webhooks", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ id: edit.id, name: edit.name.trim(), url: edit.url.trim(), secret: edit.secret || null, events: edit.events, isActive: edit.isActive ?? true }),
    });
    if (r.ok) { dialog.toast("Webhook salvo ✅", "success"); setEdit(null); load(); }
    else { const d = await r.json().catch(() => ({})); dialog.toast(d?.error?.message ?? "Falha", "error"); }
  }

  async function remove(id: string) {
    if (!(await dialog.confirm({ message: "Remover webhook?", confirmLabel: "Remover", tone: "danger" }))) return;
    await fetch(`/api/inbox/webhooks/${id}/delete`, { method: "POST", credentials: "include" });
    load();
  }

  function toggleEvent(key: string) {
    if (!edit) return;
    const evs = new Set(edit.events ?? []);
    if (evs.has(key)) evs.delete(key); else evs.add(key);
    setEdit({ ...edit, events: Array.from(evs) });
  }

  return (
    <div className="space-y-4">
      {edit ? (
        <section className="card space-y-4 border-brand/40">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{edit.id ? `Editar: ${edit.name}` : "Novo webhook"}</h2>
          <input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Nome (ex: n8n - novos pedidos)" className="input-base" />
          <input value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="URL (https://...)" className="input-base" />
          <input value={edit.secret ?? ""} onChange={(e) => setEdit({ ...edit, secret: e.target.value })} placeholder="Segredo (opcional — gera header X-Yugo-Signature)" className="input-base" />
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Eventos</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {ALL_EVENTS.map((e) => (
                <label key={e.key} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm transition hover:border-brand/50">
                  <input type="checkbox" checked={(edit.events ?? []).includes(e.key)} onChange={() => toggleEvent(e.key)} className="accent-brand" />
                  <span className="flex-1">{e.label}</span>
                  <code className="text-[10px] text-muted">{e.key}</code>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted transition hover:text-fg">Cancelar</button>
            <button onClick={save} className="btn-grad px-5">Salvar</button>
          </div>
        </section>
      ) : (
        <button onClick={() => setEdit({ name: "", url: "", events: [] })} className="btn-grad px-5">+ Novo webhook</button>
      )}

      <section className="space-y-2">
        {items.length === 0
          ? <p className="card text-sm text-muted">Nenhum webhook ainda.</p>
          : items.map((w) => (
              <div key={w.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-fg">
                      {w.name}
                      {!w.isActive && <span className="ml-2 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] uppercase text-danger">desativado</span>}
                      {w.deliverFailCount > 0 && w.isActive && <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] uppercase text-warn">{w.deliverFailCount} falha(s)</span>}
                    </p>
                    <p className="font-mono text-[11px] text-muted">{w.url}</p>
                    <p className="text-[11px] text-muted">eventos: {w.events.join(", ")} {w.lastDeliveredAt && `· última entrega: ${new Date(w.lastDeliveredAt).toLocaleString("pt-BR")}`}</p>
                  </div>
                  <button onClick={() => setEdit(w)} className="rounded-lg border border-line px-2.5 py-1 text-xs transition hover:border-brand hover:text-brand">editar</button>
                  <button onClick={() => remove(w.id)} className="text-muted transition hover:text-danger">×</button>
                </div>
              </div>
            ))}
      </section>

      <section className="rounded-2xl border border-line bg-surface-2 p-4 text-xs text-muted">
        <p className="mb-1 font-semibold text-fg">Payload enviado:</p>
        <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-mono text-[11px]">{`{
  "event": "message.created",
  "organizationId": "...",
  "occurredAt": "2026-05-30T12:34:56.000Z",
  "data": {
    "conversationId": "...",
    "direction": "in" | "out",
    "content": "...",
    "contentType": "text"
  }
}`}</pre>
        <p className="mt-2">Se configurar <b>Segredo</b>, recebe header <code>X-Yugo-Signature: sha256=hex(hmac(body))</code> pra validar autenticidade. Após 5 falhas seguidas, o webhook é desativado automaticamente.</p>
      </section>
    </div>
  );
}
