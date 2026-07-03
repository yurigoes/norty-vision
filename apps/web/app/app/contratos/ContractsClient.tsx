"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface TemplateBrief {
  id: string;
  slug: string;
  title: string;
  signatureMode: string;
  fieldsSchema: Array<{
    name: string;
    label: string;
    type: string;
    required: boolean;
    options?: string[];
  }>;
}

interface ContractRow {
  id: string;
  status: string;
  signerName: string | null;
  signerEmail: string | null;
  signerDocument: string | null;
  signerToken: string | null;
  sentAt: string | null;
  signedAt: string | null;
  tokenExpiresAt: string | null;
  createdAt: string;
  template: { id: string; slug: string; title: string; signatureMode: string };
}

export function ContractsClient({
  templates,
  contracts,
}: {
  templates: TemplateBrief[];
  contracts: ContractRow[];
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<ContractRow | null>(null);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget; // captura antes do await (currentTarget vira null depois)
    const fd = new FormData(form);
    const payload = {
      templateId: String(fd.get("templateId") ?? ""),
      signerName: String(fd.get("signerName") ?? "").trim() || undefined,
      signerEmail: String(fd.get("signerEmail") ?? "").trim() || undefined,
      signerDocument: String(fd.get("signerDocument") ?? "").trim() || undefined,
      signerPhone: String(fd.get("signerPhone") ?? "").trim() || undefined,
      expiresInDays: Number(fd.get("expiresInDays") ?? 30) || 30,
    };
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao criar contrato");
      return;
    }
    form.reset();
    setShowForm(false);
    setLastCreated(data.contract);
    startTransition(() => router.refresh());
  }

  async function onCancel(c: ContractRow) {
    if (!(await dialog.confirm({ message: `Cancelar contrato de ${c.signerName ?? c.signerEmail ?? c.id}?`, confirmLabel: "Cancelar contrato", tone: "danger" }))) return;
    const res = await fetch(`/api/contracts/${c.id}/cancel`, {
      method: "PATCH",
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error?.message ?? "Falha ao cancelar");
      return;
    }
    startTransition(() => router.refresh());
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/assinar/${token}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  return (
    <div className="space-y-6">
      {lastCreated?.signerToken && (
        <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-5">
          <p className="text-sm font-semibold text-green-100">
            ✓ Contrato criado. Envie este link ao signatário:
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={`${typeof window !== "undefined" ? window.location.origin : ""}/assinar/${lastCreated.signerToken}`}
              className="input-base flex-1 font-mono text-xs"
            />
            <button
              onClick={() => copyLink(lastCreated.signerToken!)}
              className="btn-grad text-xs"
            >
              Copiar
            </button>
          </div>
          <button
            onClick={() => setLastCreated(null)}
            className="mt-3 text-xs text-muted hover:underline"
          >
            fechar
          </button>
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          disabled={templates.length === 0}
          className="btn-grad disabled:opacity-50"
        >
          + Novo contrato
        </button>
      )}
      {templates.length === 0 && (
        <p className="text-sm text-muted">
          Crie um modelo em{" "}
          <a className="text-brand hover:underline" href="/app/contratos/modelos">
            Modelos
          </a>{" "}
          antes de enviar contratos.
        </p>
      )}

      {showForm && (
        <form
          onSubmit={onCreate}
          className="card space-y-4"
        >
          <h2 className="text-lg font-semibold">Novo contrato</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              name="templateId"
              label="Modelo"
              required
              options={[
                { value: "", label: "— selecione —" },
                ...templates.map((t) => ({ value: t.id, label: t.title })),
              ]}
            />
            <Field
              name="expiresInDays"
              label="Expira em (dias)"
              type="number"
              defaultValue="30"
            />
            <Field name="signerName" label="Nome do signatário" />
            <Field name="signerEmail" label="Email" type="email" />
            <Field name="signerDocument" label="CPF/CNPJ" />
            <Field name="signerPhone" label="Telefone" />
          </div>
          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <p className="text-xs text-muted">
            Os campos do signatário podem ficar em branco e serem preenchidos
            por ele mesmo ao abrir o link.
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-grad disabled:opacity-50"
            >
              Gerar link de assinatura
            </button>
          </div>
        </form>
      )}

      {contracts.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          Nenhum contrato enviado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Modelo</th>
                <th className="px-4 py-3 font-medium">Signatário</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Enviado</th>
                <th className="px-4 py-3 font-medium">Assinado</th>
                <th className="px-4 py-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">{c.template.title}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{c.signerName ?? "—"}</div>
                    <div className="text-muted">{c.signerEmail ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {c.sentAt ? new Date(c.sentAt).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {c.signedAt
                      ? new Date(c.signedAt).toLocaleString("pt-BR")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      {c.signerToken && c.status === "sent" && (
                        <button
                          onClick={() => copyLink(c.signerToken!)}
                          className="text-xs text-brand hover:underline"
                        >
                          Copiar link
                        </button>
                      )}
                      <a
                        href={`/api/contracts/${c.id}/html`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-brand hover:underline"
                      >
                        Visualizar
                      </a>
                      <a
                        href={`/app/contratos/${c.id}`}
                        className="text-xs text-brand hover:underline"
                      >
                        Detalhes
                      </a>
                      {c.status === "sent" && (
                        <button
                          onClick={() => onCancel(c)}
                          className="text-xs text-muted hover:text-red-300"
                        >
                          Cancelar
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
    draft: "bg-line text-muted",
    sent: "bg-blue-500/20 text-blue-300",
    signed: "bg-green-500/20 text-green-300",
    cancelled: "bg-red-500/20 text-red-300",
    expired: "bg-yellow-500/20 text-yellow-300",
  };
  const label: Record<string, string> = {
    draft: "rascunho",
    sent: "enviado",
    signed: "assinado",
    cancelled: "cancelado",
    expired: "expirado",
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
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        autoComplete="off"
        className="input-base"
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  required,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
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
        defaultValue=""
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
