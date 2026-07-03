"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface Role {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive?: boolean;
  organizationId: string | null;
  permissions: Record<string, boolean>;
}

interface CatalogGroup {
  group: string;
  items: Array<{ key: string; label: string }>;
}

const EMPTY = { name: "", description: "", permissions: {} as Record<string, boolean> };

export function RolesClient({
  initialRoles,
  catalog,
}: {
  initialRoles: Role[];
  catalog: CatalogGroup[];
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startCreate() {
    setForm(EMPTY);
    setCreating(true);
    setEditing(null);
    setErr(null);
  }
  function startEdit(r: Role) {
    setForm({
      name: r.name,
      description: r.description ?? "",
      permissions: { ...r.permissions },
    });
    setEditing(r);
    setCreating(false);
    setErr(null);
  }
  function cancel() {
    setEditing(null);
    setCreating(false);
    setErr(null);
  }
  function toggle(key: string) {
    setForm((f) => ({
      ...f,
      permissions: { ...f.permissions, [key]: !f.permissions[key] },
    }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const perms: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(form.permissions)) if (v) perms[k] = true;
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        permissions: perms,
      };
      const url = editing ? `/api/users/roles/${editing.id}` : "/api/users/roles";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      cancel();
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: Role) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/users/roles/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: r.name, isActive: !(r.isActive ?? true) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao atualizar");
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function remove(r: Role) {
    if (!(await dialog.confirm({ message: `Remover o papel "${r.name}"?`, confirmLabel: "Remover", tone: "danger" }))) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/users/roles/${r.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao remover");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const showForm = creating || editing;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Papéis padrão (owner, admin, etc.) têm acesso total e não são
          editáveis. Crie papéis próprios e marque as permissões.
        </p>
        {!showForm && (
          <button
            onClick={startCreate}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Novo papel
          </button>
        )}
      </div>

      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      {showForm && (
        <section className="space-y-4 rounded-xl border border-brand/40 bg-bg/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            {editing ? `Editar: ${editing.name}` : "Novo papel"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Nome</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Ex.: Recepção"
                className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Descrição</span>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
              />
            </label>
          </div>

          <div className="space-y-4">
            {catalog.map((g) => (
              <div key={g.group}>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-brand">{g.group}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((it) => (
                    <label key={it.key} className="flex items-center gap-2 rounded border border-line bg-bg/40 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!form.permissions[it.key]}
                        onChange={() => toggle(it.key)}
                        className="accent-brand"
                      />
                      <span>{it.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !form.name.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Salvando..." : "Salvar papel"}
            </button>
            <button onClick={cancel} className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">
              Cancelar
            </button>
          </div>
        </section>
      )}

      <div className="space-y-2">
        {initialRoles.map((r) => {
          const count = Object.values(r.permissions ?? {}).filter(Boolean).length;
          const custom = !r.isSystem && r.organizationId !== null;
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {r.name}
                  {!custom && (
                    <span className="rounded bg-line px-1.5 py-0.5 text-[10px] uppercase text-muted">padrão</span>
                  )}
                  {custom && r.isActive === false && (
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] uppercase text-red-300">inativo</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">
                  {custom ? `${count} permissão(ões)` : "acesso total"} {r.description ? `· ${r.description}` : ""}
                </p>
              </div>
              {custom && (
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => startEdit(r)} className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand">Editar</button>
                  <button onClick={() => toggleActive(r)} disabled={busy} className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand disabled:opacity-50">
                    {r.isActive === false ? "Ativar" : "Inativar"}
                  </button>
                  <button onClick={() => remove(r)} className="rounded border border-line px-3 py-1 text-xs text-red-300 transition hover:border-red-400">Remover</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
