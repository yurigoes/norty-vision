"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface Store {
  id: string;
  slug: string;
  name: string;
  document: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  status: string;
  createdAt: string;
  themePrimaryColor?: string | null;
  logoUrl?: string | null;
  themeMode?: string | null;
  examPriceCents?: number | null;
  examPaymentNote?: string | null;
}

export function StoresClient({ initialStores }: { initialStores: Store[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Store | null>(null);
  const [editLogoUrl, setEditLogoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openEdit(s: Store) {
    setEditing(s);
    setEditLogoUrl(s.logoUrl ?? null);
  }

  async function uploadLogo(storeId: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/stores/${storeId}/logo`, { method: "POST", body: fd, credentials: "include" });
    const data = await res.json();
    if (res.ok) setEditLogoUrl(data.url);
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      slug: String(fd.get("slug") ?? "").trim().toLowerCase(),
      name: String(fd.get("name") ?? "").trim(),
      document: String(fd.get("document") ?? "").trim() || null,
      city: String(fd.get("city") ?? "").trim() || null,
      state: String(fd.get("state") ?? "").trim().toUpperCase() || null,
    };
    const res = await fetch("/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao criar loja");
      return;
    }
    (e.currentTarget as HTMLFormElement).reset();
    setShowForm(false);
    startTransition(() => router.refresh());
  }

  async function onUpdate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      document: String(fd.get("document") ?? "").trim() || null,
      city: String(fd.get("city") ?? "").trim() || null,
      state: String(fd.get("state") ?? "").trim().toUpperCase() || null,
      status: String(fd.get("status") ?? "active") as
        | "active"
        | "paused"
        | "archived",
      themePrimaryColor: String(fd.get("themePrimaryColor") ?? "").trim() || null,
      themeMode: String(fd.get("themeMode") ?? "system") as "light" | "dark" | "system",
      logoUrl: editLogoUrl,
      examPriceCents: Math.round(Number(String(fd.get("examPrice") ?? "").replace(",", ".")) * 100) || 0,
      examPaymentNote: String(fd.get("examPaymentNote") ?? "").trim() || "no Pix ou dinheiro",
    };
    const res = await fetch(`/api/stores/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao atualizar loja");
      return;
    }
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function onArchive(store: Store) {
    if (!(await dialog.confirm({ message: `Arquivar loja "${store.name}"? Pode reabrir depois.`, confirmLabel: "Arquivar", tone: "danger" }))) return;
    const res = await fetch(`/api/stores/${store.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error?.message ?? "Falha ao arquivar");
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
          + Nova loja
        </button>
      )}

      {showForm && (
        <form
          onSubmit={onCreate}
          className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold">Nova loja</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="slug"
              label="Slug"
              required
              placeholder="matriz"
              help="2-40 chars, [a-z 0-9 -]."
            />
            <Field
              name="name"
              label="Nome"
              required
              placeholder="Matriz Centro"
            />
            <Field name="document" label="CNPJ" placeholder="00.000.000/0001-00" />
            <Field name="city" label="Cidade" placeholder="São Paulo" />
            <Field name="state" label="UF" placeholder="SP" />
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
              Criar loja
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
            Editar loja —{" "}
            <span className="font-mono text-sm text-muted">{editing.slug}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label="Nome" required defaultValue={editing.name} />
            <Field
              name="document"
              label="CNPJ"
              defaultValue={editing.document ?? ""}
            />
            <Field name="city" label="Cidade" defaultValue={editing.city ?? ""} />
            <Field name="state" label="UF" defaultValue={editing.state ?? ""} />
            <SelectField
              name="status"
              label="Status"
              defaultValue={editing.status}
              options={[
                { value: "active", label: "Ativa" },
                { value: "paused", label: "Pausada" },
                { value: "archived", label: "Arquivada" },
              ]}
            />
          </div>

          {/* ===== Branding da loja ===== */}
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
              Branding (aparência da loja)
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                  Cor predominante
                </span>
                <input
                  type="color"
                  name="themePrimaryColor"
                  defaultValue={editing.themePrimaryColor ?? "#387af0"}
                  className="h-10 w-full rounded-xl border border-line bg-surface cursor-pointer"
                />
              </label>
              <SelectField
                name="themeMode"
                label="Modo de tema"
                defaultValue={editing.themeMode ?? "system"}
                options={[
                  { value: "system", label: "Sistema" },
                  { value: "light", label: "Claro" },
                  { value: "dark", label: "Escuro" },
                ]}
              />
              <div className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                  Logo
                </span>
                <div className="flex items-center gap-2">
                  {editLogoUrl && (
                    <img src={editLogoUrl} alt="logo" className="h-8 w-auto rounded object-contain" />
                  )}
                  <label className="cursor-pointer rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">
                    {editLogoUrl ? "trocar" : "enviar"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadLogo(editing.id, e.target.files[0])}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              Agenda / exame
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                  Valor do exame (R$)
                </span>
                <input
                  name="examPrice"
                  inputMode="decimal"
                  defaultValue={((editing.examPriceCents ?? 14000) / 100).toFixed(2)}
                  className="input-base"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                  Forma de pagamento (texto)
                </span>
                <input
                  name="examPaymentNote"
                  defaultValue={editing.examPaymentNote ?? "no Pix ou dinheiro"}
                  placeholder="no Pix ou dinheiro"
                  className="input-base"
                />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-muted">Aparece nas mensagens de agendamento enviadas ao cliente.</p>
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

      {initialStores.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          Nenhuma loja cadastrada.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Cidade/UF</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {initialStores.map((s) => (
                <tr key={s.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {s.slug}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {[s.city, s.state].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEdit(s)}
                        className="text-xs text-brand hover:underline"
                      >
                        Editar
                      </button>
                      {s.status !== "archived" && (
                        <button
                          onClick={() => onArchive(s)}
                          className="text-xs text-muted hover:text-red-300"
                        >
                          Arquivar
                        </button>
                      )}
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
    paused: "bg-yellow-500/20 text-yellow-300",
    archived: "bg-line text-muted",
  };
  const label: Record<string, string> = {
    active: "ativa",
    paused: "pausada",
    archived: "arquivada",
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
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue ?? ""}
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
