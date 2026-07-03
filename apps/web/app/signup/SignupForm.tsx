"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface Plan {
  slug: string;
  name: string;
}

export function SignupForm({
  plans,
  initialPlanSlug,
}: {
  plans: Plan[];
  initialPlanSlug?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<null | {
    orgName: string;
    orgSlug: string;
    ownerEmail: string;
    trialEndsAt: string | null;
  }>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const payload = {
      organization: {
        name: String(fd.get("orgName") ?? "").trim(),
        slug: String(fd.get("orgSlug") ?? "").trim().toLowerCase(),
        contactEmail: String(fd.get("orgEmail") ?? "").trim() || undefined,
        contactPhone: String(fd.get("orgPhone") ?? "").trim() || undefined,
      },
      owner: {
        name: String(fd.get("ownerName") ?? "").trim(),
        email: String(fd.get("ownerEmail") ?? "").trim(),
        password: String(fd.get("ownerPassword") ?? ""),
      },
      store: {
        name: String(fd.get("storeName") ?? "").trim(),
        slug: String(fd.get("storeSlug") ?? "matriz").trim().toLowerCase(),
        city: String(fd.get("storeCity") ?? "").trim() || undefined,
        state: String(fd.get("storeState") ?? "").trim().toUpperCase() || undefined,
      },
      planSlug: String(fd.get("planSlug") ?? initialPlanSlug ?? ""),
    };

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha ao criar conta");
        return;
      }
      setSuccess({
        orgName: data.organization.name,
        orgSlug: data.organization.slug,
        ownerEmail: data.user.email,
        trialEndsAt: data.subscription?.trialEndsAt ?? null,
      });
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-8">
        <h2 className="text-2xl font-semibold text-green-100">
          ✓ Conta criada
        </h2>
        <dl className="mt-4 grid gap-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">
              Empresa
            </dt>
            <dd>{success.orgName} ({success.orgSlug})</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">
              Login
            </dt>
            <dd className="font-mono text-xs">{success.ownerEmail}</dd>
          </div>
          {success.trialEndsAt && (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">
                Trial até
              </dt>
              <dd>{new Date(success.trialEndsAt).toLocaleDateString("pt-BR")}</dd>
            </div>
          )}
        </dl>
        <button
          onClick={() => router.push("/login")}
          className="mt-6 rounded-lg bg-brand px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Entrar agora →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 rounded-2xl border border-line bg-bg/60 p-6">
      {plans.length > 1 && (
        <Section title="Plano escolhido">
          <SelectField
            name="planSlug"
            label="Plano"
            defaultValue={initialPlanSlug ?? plans[0]?.slug}
            options={plans.map((p) => ({ value: p.slug, label: p.name }))}
          />
        </Section>
      )}

      <Section title="Sobre sua empresa">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="orgName" label="Nome fantasia" required placeholder="Ótica Solar" />
          <Field
            name="orgSlug"
            label="Slug (URL interna)"
            required
            placeholder="otica-solar"
            help="3-40 chars, [a-z 0-9 -]"
          />
          <Field name="orgEmail" label="Email de contato" type="email" />
          <Field name="orgPhone" label="Telefone de contato" />
        </div>
      </Section>

      <Section title="Sua conta (será o owner)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="ownerName" label="Seu nome" required placeholder="João Silva" />
          <Field name="ownerEmail" label="Seu email" type="email" required />
          <div className="sm:col-span-2">
            <Field
              name="ownerPassword"
              label="Senha"
              type="password"
              required
              help="Mín 12 chars, com maiúscula, minúscula e número."
            />
          </div>
        </div>
      </Section>

      <Section title="Primeira loja">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="storeName" label="Nome da loja" required placeholder="Matriz" />
          <Field
            name="storeSlug"
            label="Slug da loja"
            required
            placeholder="matriz"
            defaultValue="matriz"
          />
          <Field name="storeCity" label="Cidade" />
          <Field name="storeState" label="UF (2 letras)" />
        </div>
      </Section>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Criando..." : "Criar conta e começar trial"}
      </button>
      <p className="text-center text-xs text-muted">
        Ao criar, você concorda com os{" "}
        <a href="/termos" className="text-brand hover:underline">termos</a> e{" "}
        <a href="/privacidade" className="text-brand hover:underline">política de privacidade</a>.
      </p>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  placeholder,
  help,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        placeholder={placeholder}
        defaultValue={defaultValue}
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
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
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
