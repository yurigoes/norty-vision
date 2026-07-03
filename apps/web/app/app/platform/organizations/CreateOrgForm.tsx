"use client";

import { useState, type FormEvent } from "react";

type ProviderResult = { provider: string; ok: boolean; status?: number; message?: string };

interface Result {
  organization: { id: string; slug: string; name: string };
  store: { id: string; slug: string; name: string };
  user: { id: string; email: string; name: string };
  provisioning: {
    chatwoot?: any;
    glpi?: any;
    evolution?: any;
  } | null;
}

export function CreateOrgForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const fd = new FormData(e.currentTarget);
    const payload = {
      slug: String(fd.get("slug") ?? "").trim().toLowerCase(),
      name: String(fd.get("name") ?? "").trim(),
      legalName: String(fd.get("legalName") ?? "").trim() || null,
      document: String(fd.get("document") ?? "").trim() || null,
      documentType: String(fd.get("documentType") ?? "") || null,
      contactEmail: String(fd.get("contactEmail") ?? "").trim() || null,
      contactPhone: String(fd.get("contactPhone") ?? "").trim() || null,
      niche: String(fd.get("niche") ?? "") || null,
      firstUser: {
        email: String(fd.get("userEmail") ?? "").trim(),
        name: String(fd.get("userName") ?? "").trim(),
        password: String(fd.get("userPassword") ?? ""),
      },
      firstStore: {
        slug: String(fd.get("storeSlug") ?? "").trim().toLowerCase(),
        name: String(fd.get("storeName") ?? "").trim(),
        city: String(fd.get("storeCity") ?? "").trim() || null,
        state: String(fd.get("storeState") ?? "").trim() || null,
      },
      autoProvision: fd.get("autoProvision") === "on",
    };

    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha ao criar organização");
        return;
      }
      setResult(data);
      (e.currentTarget as HTMLFormElement).reset();
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return <SuccessCard result={result} onClose={() => setResult(null)} />;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-8 rounded-xl border border-line bg-bg/60 p-6 backdrop-blur-sm"
    >
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Identificação da empresa
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="slug" label="Slug (URL-friendly)" required placeholder="rede-otica-x" help="3-40 chars, [a-z 0-9 -]. Usado em URLs internas." />
          <Field name="name" label="Nome fantasia" required placeholder="Rede Ótica X" />
          <Field name="legalName" label="Razão social" placeholder="Otica X Ltda" />
          <Field name="document" label="CNPJ ou CPF" placeholder="00.000.000/0001-00" />
          <SelectField
            name="documentType"
            label="Tipo de documento"
            options={[
              { value: "", label: "— selecione —" },
              { value: "cnpj", label: "CNPJ" },
              { value: "cpf", label: "CPF" },
            ]}
          />
          <Field name="contactEmail" label="Email de contato" type="email" />
          <Field name="contactPhone" label="Telefone de contato" />
          <SelectField
            name="niche"
            label="Nicho (define os módulos)"
            options={[
              { value: "", label: "— selecione —" },
              { value: "otica", label: "Ótica (agenda + vender + crediário + OS)" },
              { value: "grafica", label: "Gráfica/Uniformes (vender + pedido de produção + OS)" },
              { value: "generico", label: "Genérico (atendimento + vender)" },
            ]}
            help="Liga automaticamente os botões do call center e os recursos do portal típicos do segmento. Dá pra ajustar depois."
          />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Primeira loja
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="storeSlug" label="Slug da loja" required placeholder="matriz" help="Único dentro da empresa." />
          <Field name="storeName" label="Nome da loja" required placeholder="Matriz Centro" />
          <Field name="storeCity" label="Cidade" placeholder="São Paulo" />
          <Field name="storeState" label="UF" placeholder="SP" />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
          Primeiro usuário (owner)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="userName" label="Nome completo" required placeholder="João Silva" />
          <Field name="userEmail" label="Email" type="email" required placeholder="joao@oticax.com.br" />
          <Field
            name="userPassword"
            label="Senha inicial"
            type="password"
            required
            help="Mín 12 chars, com maiúscula, minúscula e número."
          />
        </div>
      </section>

      <label className="flex items-center gap-3 rounded-lg border border-line p-4 text-sm">
        <input
          type="checkbox"
          name="autoProvision"
          defaultChecked
          className="h-4 w-4"
        />
        <span>
          <strong>Auto-provisionar nos sistemas integrados</strong>
          <span className="ml-2 text-muted">
            Cria Account no Chatwoot, Entity+Group no GLPI, Instance no Evolution.
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Criando..." : "Criar organização"}
        </button>
      </div>
    </form>
  );
}

function SuccessCard({ result, onClose }: { result: Result; onClose: () => void }) {
  const prov = result.provisioning;
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-6">
        <h2 className="text-lg font-semibold text-green-100">
          ✓ Empresa criada com sucesso
        </h2>
        <dl className="mt-4 grid gap-2 text-sm">
          <Row label="Organização" value={`${result.organization.name} (${result.organization.slug})`} />
          <Row label="ID" value={result.organization.id} mono />
          <Row label="Loja inicial" value={`${result.store.name} (${result.store.slug})`} />
          <Row label="Owner" value={`${result.user.name} <${result.user.email}>`} />
        </dl>
      </div>

      {prov && (
        <div className="rounded-xl border border-line bg-bg/60 p-6 backdrop-blur-sm">
          <h3 className="text-base font-semibold">Provisionamento externo</h3>
          <div className="mt-3 space-y-2 text-sm">
            <ProvBlock title="Chatwoot" data={prov.chatwoot} />
            <ProvBlock title="GLPI" data={prov.glpi} />
            <ProvBlock title="Evolution" data={prov.evolution} />
          </div>
          <p className="mt-4 text-xs text-muted">
            Detalhes em <code className="font-mono">external_provisioning_log</code>.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-line px-5 py-2 text-sm font-medium text-fg transition hover:border-brand"
      >
        Criar outra
      </button>
    </div>
  );
}

function ProvBlock({ title, data }: { title: string; data: any }) {
  if (!data) return <p>{title}: <span className="text-muted">não retornado</span></p>;
  if (data.skipped) {
    return (
      <p>
        <span className="inline-block w-24">{title}:</span>
        <span className="text-muted">ignorado ({data.skipped})</span>
      </p>
    );
  }
  if (data.error) {
    return (
      <p>
        <span className="inline-block w-24">{title}:</span>
        <span className="text-red-300">✗ {data.error}</span>
      </p>
    );
  }
  return (
    <p>
      <span className="inline-block w-24">{title}:</span>
      <span className="text-green-300">✓ OK</span>
      <span className="ml-2 text-xs text-muted">
        {data.accountId && `account=${data.accountId}`}
        {data.entityId && `entity=${data.entityId}`}
        {data.stores && `stores=${data.stores.length}`}
      </span>
    </p>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`-mt-1 mb-2 text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  required,
  help,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
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
        autoComplete="off"
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
      />
      {help && <p className="mt-1 text-[11px] leading-snug text-muted">{help}</p>}
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  help,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </span>
      <select
        name={name}
        defaultValue=""
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <p className="mt-1 text-[11px] leading-snug text-muted">{help}</p>}
    </label>
  );
}
