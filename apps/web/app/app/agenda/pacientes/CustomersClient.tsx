"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface Customer {
  id: string;
  storeId: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  prefersChannel: string | null;
  optOutMarketing: boolean;
  city: string | null;
  state: string | null;
  birthDate: string | null;
  tags: string[];
}

interface Store {
  id: string;
  name: string;
}

export function CustomersClient({
  initialCustomers,
  stores,
  initialQuery,
}: {
  initialCustomers: Customer[];
  stores: Store[];
  initialQuery: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);

  function search() {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    router.push(url.pathname + url.search);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      name: String(fd.get("name") ?? "").trim(),
      document: String(fd.get("document") ?? "").trim() || null,
      birthDate: String(fd.get("birthDate") ?? "").trim() || null,
      email: String(fd.get("email") ?? "").trim() || null,
      phone: String(fd.get("phone") ?? "").trim() || null,
      whatsappPhone: String(fd.get("whatsappPhone") ?? "").trim() || null,
      city: String(fd.get("city") ?? "").trim() || null,
      state: String(fd.get("state") ?? "").trim().toUpperCase() || null,
      prefersChannel: String(fd.get("prefersChannel") ?? "whatsapp"),
    };
    if (creating) {
      const sid = String(fd.get("storeId") ?? "").trim() || stores[0]?.id || "";
      if (sid) payload.storeId = sid;
    }

    const url = editing ? `/api/customers/${editing.id}` : "/api/customers";
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao salvar");
      return;
    }
    setCreating(false);
    setEditing(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Buscar por nome, telefone, CPF..."
          className="input-base flex-1"
        />
        <button
          onClick={search}
          className="rounded-xl border border-line px-4 py-2 text-sm font-semibold transition hover:bg-surface-2"
        >
          Buscar
        </button>
        {!creating && !editing && (
          <button
            onClick={() => setCreating(true)}
            className="btn-grad whitespace-nowrap"
          >
            + Novo paciente
          </button>
        )}
      </div>

      {(creating || editing) && (
        <form
          onSubmit={onSubmit}
          className="card space-y-4"
        >
          <h2 className="text-lg font-semibold">
            {editing ? `Editar — ${editing.name}` : "Novo paciente"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {creating && stores.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                  Loja *
                </span>
                <select
                  name="storeId"
                  required
                  className="input-base"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Field name="name" label="Nome completo" required defaultValue={editing?.name ?? ""} />
            <Field name="document" label="CPF/Documento" defaultValue={editing?.document ?? ""} />
            <Field
              name="birthDate"
              label="Nascimento"
              type="date"
              defaultValue={editing?.birthDate ? editing.birthDate.slice(0, 10) : ""}
            />
            <Field name="email" label="Email" type="email" defaultValue={editing?.email ?? ""} />
            <Field name="phone" label="Telefone" defaultValue={editing?.phone ?? ""} help="Formato +5511999998888" />
            <Field
              name="whatsappPhone"
              label="WhatsApp"
              defaultValue={editing?.whatsappPhone ?? ""}
              help="Se diferente do telefone"
            />
            <Field name="city" label="Cidade" defaultValue={editing?.city ?? ""} />
            <Field name="state" label="UF" defaultValue={editing?.state ?? ""} />
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                Canal preferido
              </span>
              <select
                name="prefersChannel"
                defaultValue={editing?.prefersChannel ?? "whatsapp"}
                className="input-base"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="phone">Telefone</option>
                <option value="none">Nenhum</option>
              </select>
            </label>
          </div>
          {error && (
            <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setEditing(null);
                setError(null);
              }}
              className="rounded-xl border border-line px-4 py-2 text-sm font-semibold transition hover:bg-surface-2"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-grad"
            >
              Salvar
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Cidade</th>
              <th className="px-4 py-3">Opt-out</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {initialCustomers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  Nenhum paciente.
                </td>
              </tr>
            ) : (
              initialCustomers.map((c) => (
                <tr key={c.id} className="border-t border-line/50 transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.phone ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.whatsappPhone ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {c.city ? `${c.city}${c.state ? `/${c.state}` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.optOutMarketing ? "sim" : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditing(c)}
                      className="text-xs text-brand hover:underline"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  help,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
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
        required={required}
        defaultValue={defaultValue}
        autoComplete="off"
        className="input-base"
      />
      {help && <p className="mt-1 text-[11px] leading-snug text-muted">{help}</p>}
    </label>
  );
}
