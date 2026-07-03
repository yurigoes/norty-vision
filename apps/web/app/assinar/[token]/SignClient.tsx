"use client";

import { useRef, useState, type FormEvent } from "react";

interface FieldSchemaItem {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

interface PublicContract {
  id: string;
  status: string;
  signerName: string | null;
  signerEmail: string | null;
  signerDocument: string | null;
  fieldValues: Record<string, unknown>;
  signedAt: string | null;
  template: {
    id: string;
    title: string;
    bodyMarkdown: string;
    fieldsSchema: FieldSchemaItem[];
    signatureMode: string;
  };
}

export function SignClient({
  token,
  contract,
}: {
  token: string;
  contract: PublicContract;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      contract.template.fieldsSchema.map((f) => [
        f.name,
        String((contract.fieldValues as any)?.[f.name] ?? ""),
      ]),
    ),
  );
  const [signerName, setSignerName] = useState(contract.signerName ?? "");
  const [signerEmail, setSignerEmail] = useState(contract.signerEmail ?? "");
  const [signerDocument, setSignerDocument] = useState(
    contract.signerDocument ?? "",
  );
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!accepted) {
      setError("Marque o aceite para prosseguir.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/contracts/by-token/${encodeURIComponent(token)}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldValues: values,
            signerName,
            signerEmail,
            signerDocument: signerDocument || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha ao assinar");
        return;
      }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-success/40 bg-success/10 p-8 text-center">
        <h2 className="text-2xl font-semibold text-success">
          ✓ Assinatura registrada
        </h2>
        <p className="mt-3 text-sm text-muted">
          Obrigado, {signerName}. Você receberá uma cópia do contrato no email{" "}
          <span className="font-mono">{signerEmail}</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Seus dados
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nome completo"
            required
            value={signerName}
            onChange={setSignerName}
          />
          <Field
            label="Email"
            type="email"
            required
            value={signerEmail}
            onChange={setSignerEmail}
          />
          <Field
            label="CPF ou CNPJ"
            value={signerDocument}
            onChange={setSignerDocument}
          />
        </div>
      </section>

      {contract.template.fieldsSchema.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-sm)]">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
            Campos do contrato
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {contract.template.fieldsSchema.map((f) => (
              <DynamicField
                key={f.name}
                field={f}
                value={values[f.name] ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, [f.name]: v }))
                }
              />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-sm)]">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Texto do contrato
        </h2>
        <iframe
          src={`/api/contracts/by-token/${token}/html`}
          title="Contrato"
          className="h-[420px] w-full rounded-lg border border-line bg-white"
        />
      </section>

      <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-sm)] transition hover:border-brand/50">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-sm">
          <strong>Eu li e concordo</strong> com todos os termos descritos acima.
          Esta assinatura eletrônica equivale a uma assinatura física para todos
          os fins legais (Lei 14.063/2020 e MP 2.200-2/2001).
        </span>
      </label>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading || !accepted}
          className="btn-grad px-6 py-3 text-sm shadow-[0_10px_28px_-10px_rgb(var(--brand)/0.7)]"
        >
          {loading ? "Assinando..." : "Aceitar e assinar"}
        </button>
      </div>
    </form>
  );
}

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: FieldSchemaItem;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "select") {
    return (
      <label className="block">
        <Label field={field} />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className="input-base"
        >
          <option value="">— selecione —</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="block sm:col-span-2">
        <Label field={field} />
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          rows={4}
          className="input-base"
        />
      </label>
    );
  }
  return (
    <Field
      label={field.label}
      type={mapType(field.type)}
      required={field.required}
      value={value}
      onChange={onChange}
    />
  );
}

function mapType(t: string): string {
  switch (t) {
    case "email":
      return "email";
    case "date":
      return "date";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

function Label({ field }: { field: FieldSchemaItem }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
      {field.label}
      {field.required && <span className="text-brand"> *</span>}
    </span>
  );
}

function Field({
  label,
  type = "text",
  required,
  value,
  onChange,
}: {
  label: string;
  type?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete="off"
        className="input-base"
      />
    </label>
  );
}
