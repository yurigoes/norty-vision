"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface MembershipBrief {
  id: string;
  status: string;
  isPrimary: boolean;
  isSeller?: boolean;
  permissions?: Record<string, boolean>;
  store: { id: string; slug: string; name: string } | null;
  role: { slug: string; name: string; permissions?: Record<string, boolean> };
}

interface CatalogGroup { group: string; items: Array<{ key: string; label: string }> }

interface UserRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  memberships: MembershipBrief[];
}

interface StoreBrief {
  id: string;
  slug: string;
  name: string;
}

interface RoleBrief {
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

function genPassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", D = "23456789", S = "!@#$%&*";
  const all = U + L + D + S;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let p = pick(U) + pick(L) + pick(D) + pick(S);
  for (let i = 0; i < 10; i++) p += pick(all);
  return p.split("").sort(() => Math.random() - 0.5).join("");
}

export function UsersClient({
  initialUsers,
  stores,
  roles,
  catalog,
}: {
  initialUsers: UserRow[];
  stores: StoreBrief[];
  roles: RoleBrief[];
  catalog: CatalogGroup[];
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [showPerms, setShowPerms] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const primaryOf = (u: UserRow) => u.memberships.find((m) => m.isPrimary) ?? u.memberships[0];

  function openEdit(u: UserRow) {
    const m = primaryOf(u);
    setPwValue("");
    setShowPerms(false);
    // base = papel + overrides do usuário, mas sanitizado: papéis legados têm
    // permissions aninhados ({"appointments":{"read":"store"}}) que quebram
    // o Zod do backend. Aqui só pegamos chaves do catálogo com valor boolean.
    const validKeys = new Set(catalog.flatMap((g) => g.items.map((i) => i.key)));
    const merged: Record<string, boolean> = {};
    for (const src of [m?.role.permissions ?? {}, m?.permissions ?? {}]) {
      for (const [k, v] of Object.entries(src)) {
        if (validKeys.has(k) && typeof v === "boolean") merged[k] = v;
      }
    }
    setPerms(merged);
    setEditing(u);
    setError(null);
  }

  async function changeRole(membershipId: string, roleSlug: string) {
    setBusyAction("role");
    try {
      const res = await fetch(`/api/users/memberships/${membershipId}/role`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ roleSlug }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error?.message ?? "Falha ao trocar papel"); return; }
      dialog.toast("Papel atualizado.", "success");
      startTransition(() => router.refresh());
    } finally { setBusyAction(null); }
  }

  async function savePerms(membershipId: string) {
    setBusyAction("perms");
    try {
      const res = await fetch(`/api/users/memberships/${membershipId}/permissions`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ permissions: perms }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d?.error?.message ?? "Falha ao salvar permissões"); return; }
      dialog.toast("Permissões personalizadas salvas.", "success");
      startTransition(() => router.refresh());
    } finally { setBusyAction(null); }
  }

  async function sendCredentials(userId: string) {
    setBusyAction("creds");
    try {
      const res = await fetch(`/api/users/${userId}/send-credentials`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ password: pwValue || null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d?.error?.message ?? "Falha ao enviar"); return; }
      const ch = [d?.sent?.whatsapp && "WhatsApp", d?.sent?.email && "email"].filter(Boolean).join(" + ") || "nenhum canal (verifique telefone/email)";
      dialog.toast(`Credenciais enviadas: ${ch}.`, "success");
    } finally { setBusyAction(null); }
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Captura a referência ao form ANTES do await — depois de await, no React,
    // e.currentTarget vira null e .reset() joga TypeError silencioso que
    // impede setShowForm + router.refresh de rodarem (tela parecia "travada").
    const form = e.currentTarget;
    setError(null);
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || null,
      password: String(fd.get("password") ?? ""),
      roleSlug: String(fd.get("roleSlug") ?? ""),
      storeId: String(fd.get("storeId") ?? "") || null,
    };
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao criar usuário");
      return;
    }
    try { form.reset(); } catch {}
    setShowForm(false);
    dialog.toast("Usuário criado.", "success");
    startTransition(() => router.refresh());
  }

  async function onUpdate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = e.currentTarget; // captura antes do await (vide onCreate)
    setError(null);
    const fd = new FormData(form);
    const payload: Record<string, unknown> = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || null,
      status: String(fd.get("status") ?? "active"),
    };
    if (pwValue) payload.password = pwValue;
    const res = await fetch(`/api/users/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao atualizar usuário");
      return;
    }
    setEditing(null);
    dialog.toast("Usuário atualizado.", "success");
    startTransition(() => router.refresh());
  }

  async function onDisableMfa(userId: string, userName: string) {
    if (!(await dialog.confirm({ message: `Desativar o 2FA de ${userName}? Ele precisará configurar novamente no próximo login.`, confirmLabel: "Desativar 2FA", tone: "danger" }))) return;
    setError(null);
    const res = await fetch(`/api/users/${userId}/disable-mfa`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error?.message ?? "Falha ao desativar 2FA");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function onToggleSeller(userId: string, isSeller: boolean) {
    setError(null);
    const res = await fetch(`/api/users/${userId}/seller`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isSeller }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error?.message ?? "Falha ao atualizar vendedor");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function onRevokeMembership(membershipId: string, userName: string) {
    if (!(await dialog.confirm({ message: `Revogar acesso de ${userName}?`, confirmLabel: "Revogar", tone: "danger" }))) return;
    const res = await fetch(`/api/users/memberships/${membershipId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error?.message ?? "Falha ao revogar");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      {!showForm && !editing && (
        <button
          onClick={() => setShowForm(true)}
          className="btn-grad px-5"
        >
          + Novo usuário
        </button>
      )}

      {showForm && (
        <form
          onSubmit={onCreate}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Novo usuário</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Nome completo" required />
            <Field name="email" label="Email" type="email" required />
            <Field name="phone" label="Telefone" />
            <Field
              name="password"
              label="Senha inicial"
              type="password"
              required
              help="Min 12 chars, com maiúscula, minúscula e número."
            />
            <SelectField
              name="roleSlug"
              label="Papel"
              required
              options={[
                { value: "", label: "— selecione —" },
                ...roles.map((r) => ({ value: r.slug, label: r.name })),
              ]}
            />
            <SelectField
              name="storeId"
              label="Loja (opcional)"
              options={[
                { value: "", label: "— todas as lojas (org-wide) —" },
                ...stores.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-grad px-5 disabled:opacity-50"
            >
              Criar usuário
            </button>
          </div>
        </form>
      )}

      {editing && (
        <form
          onSubmit={onUpdate}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold">
            Editar — <span className="font-mono text-sm text-muted">{editing.email}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Nome" required defaultValue={editing.name} />
            <Field
              name="email"
              label="Email"
              type="email"
              required
              defaultValue={editing.email}
            />
            <Field name="phone" label="Telefone" defaultValue={editing.phone ?? ""} />
            <SelectField
              name="status"
              label="Status"
              defaultValue={editing.status}
              options={[
                { value: "active", label: "Ativo" },
                { value: "suspended", label: "Suspenso" },
                { value: "invited", label: "Convidado" },
              ]}
            />
          </div>

          {/* Papel */}
          {primaryOf(editing) && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Papel principal</span>
              <select
                defaultValue={primaryOf(editing)!.role.slug}
                onChange={(e) => changeRole(primaryOf(editing)!.id, e.target.value)}
                disabled={busyAction === "role"}
                className="input-base"
              >
                {roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-muted">Define o conjunto base de permissões. Personalize abaixo se precisar de exceções.</p>
            </label>
          )}

          {/* Senha */}
          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Senha</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                placeholder="deixe em branco pra manter"
                className="input-base flex-1 font-mono"
              />
              <button type="button" onClick={() => setPwValue(genPassword())} className="rounded-xl border border-line px-3 py-2 text-xs whitespace-nowrap transition hover:border-brand/60 hover:text-brand">
                Gerar aleatória
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">Salve pra aplicar a senha. Depois use "Enviar credenciais" pra mandar login + senha ao usuário.</p>
          </div>

          {/* Personalizar permissões */}
          {primaryOf(editing) && (
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <button type="button" onClick={() => setShowPerms((v) => !v)} className="text-xs font-medium text-brand hover:underline">
                {showPerms ? "▾ Personalizar permissões" : "▸ Personalizar permissões deste usuário"}
              </button>
              {showPerms && (
                <div className="mt-3 space-y-3">
                  <p className="text-[11px] text-muted">Marque o que este usuário pode fazer (sobrepõe o papel). Owner/admin têm acesso total.</p>
                  {catalog.map((g) => (
                    <div key={g.group}>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-brand">{g.group}</p>
                      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {g.items.map((it) => (
                          <label key={it.key} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={!!perms[it.key]}
                              onChange={() => setPerms((p) => ({ ...p, [it.key]: !p[it.key] }))}
                              className="accent-brand"
                            />
                            <span>{it.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => savePerms(primaryOf(editing)!.id)} disabled={busyAction === "perms"} className="rounded-xl border border-brand px-4 py-2 text-xs font-semibold text-brand transition hover:bg-brand hover:text-white disabled:opacity-50">
                    {busyAction === "perms" ? "Salvando..." : "Salvar permissões"}
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => onDisableMfa(editing.id, editing.name)}
              className="mr-auto rounded-xl border border-warn/40 px-4 py-2 text-sm text-warn transition hover:border-warn/60"
            >
              Desativar 2FA
            </button>
            <button
              type="button"
              onClick={() => sendCredentials(editing.id)}
              disabled={busyAction === "creds"}
              className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand disabled:opacity-50"
            >
              {busyAction === "creds" ? "Enviando..." : "Enviar credenciais"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
              className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-grad px-5 disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        </form>
      )}

      {initialUsers.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          Nenhum usuário cadastrado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Papel / Loja</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Último acesso</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {initialUsers.map((u) => (
                <tr key={u.id} className="border-t border-line align-top transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {u.memberships.map((m) => (
                        <div key={m.id} className="text-xs">
                          <span className="font-semibold">{m.role.name}</span>
                          {m.store && (
                            <span className="text-muted"> · {m.store.name}</span>
                          )}
                          {m.status === "revoked" && (
                            <span className="ml-1 text-red-300">[revogado]</span>
                          )}
                          {m.status === "active" && !u.memberships[0]?.isPrimary && (
                            <button
                              onClick={() => onRevokeMembership(m.id, u.name)}
                              className="ml-2 text-[10px] text-muted hover:text-red-300"
                            >
                              revogar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleString("pt-BR")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1.5">
                      <button
                        onClick={() => openEdit(u)}
                        className="text-xs text-brand hover:underline"
                      >
                        Editar
                      </button>
                      <label className="flex items-center gap-1 text-[11px] text-muted">
                        <input
                          type="checkbox"
                          checked={!!u.memberships[0]?.isSeller}
                          onChange={(e) => onToggleSeller(u.id, e.target.checked)}
                          className="h-3.5 w-3.5 accent-brand"
                        />
                        Vendedor
                      </label>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-500/20 text-green-300",
    suspended: "bg-red-500/20 text-red-300",
    invited: "bg-yellow-500/20 text-yellow-300",
  };
  const label: Record<string, string> = {
    active: "ativo",
    suspended: "suspenso",
    invited: "convidado",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
        styles[status] ?? "bg-line text-muted"
      }`}
    >
      {label[status] ?? status}
    </span>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  required,
  help,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        autoComplete="off"
        className="input-base"
      />
      {help && <p className="mt-1 text-[11px] leading-snug text-muted">{help}</p>}
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="input-base"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
