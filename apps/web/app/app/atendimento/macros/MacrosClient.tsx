"use client";

// Editor admin de macros. Cada macro tem nome + descrição + lista de ações.
// Tipos de ação suportados pelo backend:
//   send_message { body, isPrivate? }
//   assign       { assigneeMembershipId? }   (null = tira responsável)
//   transfer_team { teamId }
//   add_label    { labelId }
//   remove_label { labelId }
//   set_status   { status: "open" | "pending" | "resolved" }
//   set_priority { priority: string }

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

type Action =
  | { kind: "send_message"; body: string; isPrivate?: boolean }
  | { kind: "assign"; assigneeMembershipId?: string | null }
  | { kind: "transfer_team"; teamId: string }
  | { kind: "add_label"; labelId: string }
  | { kind: "remove_label"; labelId: string }
  | { kind: "set_status"; status: "open" | "pending" | "resolved" }
  | { kind: "set_priority"; priority: string };

interface Macro { id: string; name: string; description: string | null; actions: Action[]; isActive: boolean }

export function MacrosClient() {
  const dialog = useDialog();
  const [items, setItems] = useState<Macro[]>([]);
  const [edit, setEdit] = useState<Partial<Macro> | null>(null);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [labels, setLabels] = useState<Array<{ id: string; name: string }>>([]);

  function load() {
    fetch("/api/inbox/macros", { credentials: "include" }).then((r) => r.json()).then((d) => setItems(d?.items ?? [])).catch(() => undefined);
  }
  useEffect(() => {
    load();
    fetch("/api/inbox/teams", { credentials: "include" }).then((r) => r.json()).then((d) => setTeams(d?.items ?? [])).catch(() => undefined);
    fetch("/api/inbox/labels", { credentials: "include" }).then((r) => r.json()).then((d) => setLabels(d?.items ?? [])).catch(() => undefined);
  }, []);

  async function save() {
    if (!edit?.name?.trim()) { dialog.toast("Dê um nome pra macro", "error"); return; }
    if (!edit.actions?.length) { dialog.toast("Adicione ao menos uma ação", "error"); return; }
    const r = await fetch("/api/inbox/macros", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ id: edit.id, name: edit.name.trim(), description: edit.description ?? null, actions: edit.actions, isActive: true }),
    });
    if (r.ok) { dialog.toast("Macro salva ✅", "success"); setEdit(null); load(); }
    else { const d = await r.json().catch(() => ({})); dialog.toast(d?.error?.message ?? "Falha", "error"); }
  }
  async function remove(id: string) {
    if (!(await dialog.confirm({ message: "Remover macro?", confirmLabel: "Remover", tone: "danger" }))) return;
    await fetch(`/api/inbox/macros/${id}/delete`, { method: "POST", credentials: "include" });
    load();
  }

  function addAction(kind: Action["kind"]) {
    if (!edit) return;
    const base: any = { kind };
    if (kind === "send_message") base.body = "";
    if (kind === "set_status") base.status = "resolved";
    if (kind === "set_priority") base.priority = "normal";
    setEdit({ ...edit, actions: [...(edit.actions ?? []), base] });
  }
  function patchAction(i: number, patch: Partial<Action>) {
    if (!edit?.actions) return;
    setEdit({ ...edit, actions: edit.actions.map((a, idx) => idx === i ? { ...a, ...patch } as Action : a) });
  }
  function removeAction(i: number) {
    if (!edit?.actions) return;
    setEdit({ ...edit, actions: edit.actions.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="space-y-4">
      {edit ? (
        <section className="space-y-4 rounded-xl border border-brand/40 bg-bg/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{edit.id ? `Editar: ${edit.name}` : "Nova macro"}</h2>
          <input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Nome (ex.: Receber pedido)" className="w-full rounded border border-line bg-bg/60 px-3 py-2 text-sm" />
          <textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} rows={2} placeholder="Descrição (opcional)" className="w-full rounded border border-line bg-bg/60 px-3 py-2 text-sm" />

          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">Ações (executadas em sequência)</p>
            {(edit.actions ?? []).map((a, i) => (
              <div key={i} className="rounded border border-line bg-bg/40 p-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-brand">{i + 1}. {KIND_LABEL[a.kind]}</span>
                  <button onClick={() => removeAction(i)} className="text-muted hover:text-red-300">×</button>
                </div>
                {a.kind === "send_message" && (
                  <>
                    <textarea value={(a as any).body} onChange={(e) => patchAction(i, { body: e.target.value } as any)} rows={2} placeholder="Mensagem... use {{cliente.nome}}, {{operador.nome}}, etc" className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
                    <label className="mt-1 flex items-center gap-1 text-[10px] text-muted">
                      <input type="checkbox" checked={(a as any).isPrivate ?? false} onChange={(e) => patchAction(i, { isPrivate: e.target.checked } as any)} /> nota interna (cliente não vê)
                    </label>
                  </>
                )}
                {a.kind === "transfer_team" && (
                  <select value={(a as any).teamId ?? ""} onChange={(e) => patchAction(i, { teamId: e.target.value } as any)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                    <option value="">— escolha equipe —</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                {(a.kind === "add_label" || a.kind === "remove_label") && (
                  <select value={(a as any).labelId ?? ""} onChange={(e) => patchAction(i, { labelId: e.target.value } as any)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                    <option value="">— escolha label —</option>
                    {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                )}
                {a.kind === "set_status" && (
                  <select value={(a as any).status} onChange={(e) => patchAction(i, { status: e.target.value as any })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                    <option value="open">Aberta</option>
                    <option value="pending">Pendente</option>
                    <option value="resolved">Resolvida</option>
                  </select>
                )}
                {a.kind === "set_priority" && (
                  <select value={(a as any).priority} onChange={(e) => patchAction(i, { priority: e.target.value } as any)} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                    <option value="low">Baixa</option>
                    <option value="normal">Normal</option>
                    <option value="high">Alta</option>
                    <option value="urgent">Urgente</option>
                  </select>
                )}
                {a.kind === "assign" && (
                  <p className="text-[11px] text-muted">Tira responsável (devolve pra fila). Outras atribuições: use bulk actions.</p>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(["send_message", "transfer_team", "add_label", "remove_label", "set_status", "set_priority", "assign"] as const).map((k) => (
                <button key={k} onClick={() => addAction(k)} className="rounded border border-line px-2 py-1 text-xs hover:border-brand">+ {KIND_LABEL[k]}</button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
            <button onClick={save} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white">Salvar macro</button>
          </div>
        </section>
      ) : (
        <button onClick={() => setEdit({ name: "", actions: [] })} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white">+ Nova macro</button>
      )}

      <section className="space-y-2">
        {items.length === 0
          ? <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhuma macro cadastrada ainda.</p>
          : items.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg/60 p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">⚡ {m.name}</p>
                  {m.description && <p className="text-xs text-muted">{m.description}</p>}
                  <p className="text-[11px] text-muted">{m.actions.length} ação(ões): {m.actions.map((a) => KIND_LABEL[a.kind]).join(" → ")}</p>
                </div>
                <button onClick={() => setEdit(m)} className="rounded border border-line px-2 py-1 text-xs hover:border-brand">editar</button>
                <button onClick={() => remove(m.id)} className="text-muted hover:text-red-300">×</button>
              </div>
            ))}
      </section>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  send_message: "Enviar mensagem",
  assign: "Tirar responsável",
  transfer_team: "Transferir pra equipe",
  add_label: "Adicionar label",
  remove_label: "Remover label",
  set_status: "Mudar status",
  set_priority: "Mudar prioridade",
};
