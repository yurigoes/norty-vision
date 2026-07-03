"use client";

import { useState, type FormEvent, useRef } from "react";

interface Props {
  initial: Record<string, unknown>;
}

type FieldKind = "text" | "email" | "color" | "select" | "upload";

interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  kind?: FieldKind;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
}

const FIELD_GROUPS: Array<{ title: string; fields: FieldDef[] }> = [
  {
    title: "Identidade",
    fields: [
      { name: "productName", label: "Nome do produto" },
      { name: "tagline", label: "Tagline (frase curta)" },
      { name: "companyLegalName", label: "Razão social" },
      { name: "companyTradeName", label: "Nome fantasia" },
      { name: "companyDocument", label: "CNPJ ou CPF" },
      {
        name: "companyDocumentType",
        label: "Tipo de documento",
        kind: "select",
        options: [
          { value: "", label: "— selecione —" },
          { value: "cnpj", label: "CNPJ" },
          { value: "cpf", label: "CPF" },
        ],
      },
    ],
  },
  {
    title: "Endereço",
    fields: [
      { name: "addressLine1", label: "Endereço (rua/número)" },
      { name: "addressLine2", label: "Complemento" },
      { name: "city", label: "Cidade" },
      { name: "state", label: "UF" },
      { name: "postalCode", label: "CEP" },
      { name: "country", label: "País", placeholder: "BR" },
    ],
  },
  {
    title: "Contatos institucionais",
    fields: [
      { name: "supportEmail", label: "E-mail de suporte", kind: "email" },
      { name: "supportPhone", label: "Telefone de suporte" },
      { name: "supportWhatsapp", label: "WhatsApp de suporte" },
      { name: "salesEmail", label: "E-mail comercial", kind: "email" },
      { name: "privacyEmail", label: "E-mail LGPD/DPO", kind: "email" },
    ],
  },
  {
    title: "Imagens",
    fields: [
      {
        name: "logoUrl",
        label: "Logo (versão clara)",
        kind: "upload",
        hint: "Recomendado: PNG ou SVG, fundo transparente.",
      },
      {
        name: "logoDarkUrl",
        label: "Logo (versão dark)",
        kind: "upload",
        hint: "Variante para usar sobre fundos claros.",
      },
      {
        name: "faviconUrl",
        label: "Favicon",
        kind: "upload",
        hint: "Ícone na aba do navegador. SVG, ICO ou PNG 64×64.",
      },
      {
        name: "ogImageUrl",
        label: "og:image (compartilhamento social)",
        kind: "upload",
        hint:
          "Aparece quando alguém compartilha o link no WhatsApp/Facebook/LinkedIn. PNG ou JPG, 1200×630px.",
      },
    ],
  },
  {
    title: "Cores",
    fields: [
      { name: "primaryColor", label: "Cor primária", kind: "color", placeholder: "#60a5fa" },
      { name: "secondaryColor", label: "Cor secundária", kind: "color", placeholder: "#0a0a0b" },
      { name: "accentColor", label: "Cor de destaque", kind: "color", placeholder: "#f4f4f5" },
    ],
  },
  {
    title: "Redes sociais",
    fields: [
      { name: "instagramUrl", label: "Instagram URL" },
      { name: "linkedinUrl", label: "LinkedIn URL" },
      { name: "facebookUrl", label: "Facebook URL" },
      { name: "twitterUrl", label: "X / Twitter URL" },
      { name: "youtubeUrl", label: "YouTube URL" },
    ],
  },
];

const ALL_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields);

export function SettingsForm({ initial }: Props) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      ALL_FIELDS.map((f) => [f.name, String(initial[f.name] ?? "")]),
    ),
  );
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      payload[k] = v.trim() === "" ? null : v.trim();
    }

    try {
      const res = await fetch("/api/platform/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(data?.error?.message ?? "Falha ao salvar");
        setLoading(false);
        return;
      }
      setSuccess(true);
      setLoading(false);
    } catch {
      setError("Erro de conexão");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      {FIELD_GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted">
            {group.title}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((f) => (
              <FieldInput
                key={f.name}
                field={f}
                value={values[f.name] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))}
              />
            ))}
          </div>
        </section>
      ))}

      {error && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Configurações salvas com sucesso.
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-surface/80 px-4 py-4 backdrop-blur sm:rounded-b-2xl">
        <button
          type="submit"
          disabled={loading}
          className="btn-grad px-6 py-2.5"
        >
          {loading ? "Salvando..." : "Salvar tudo"}
        </button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const kind = field.kind ?? "text";

  async function handleFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("purpose", field.name);
      const res = await fetch("/api/uploads/platform", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setUploadError(data?.error?.message ?? "Falha no upload");
        return;
      }
      const data = (await res.json()) as { url?: string };
      if (data.url) onChange(data.url);
    } catch {
      setUploadError("Erro de conexão");
    } finally {
      setUploading(false);
    }
  }

  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs font-medium uppercase tracking-wider text-muted">
        <span>{field.label}</span>
        {kind === "upload" && (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="text-[10px] font-semibold normal-case tracking-normal text-brand hover:underline disabled:opacity-50"
          >
            {uploading ? "enviando..." : "↑ enviar arquivo"}
          </button>
        )}
      </span>

      {kind === "select" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-base"
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : kind === "color" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1"
          />
          <input
            type="text"
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="input-base flex-1"
          />
        </div>
      ) : (
        <>
          <input
            type={kind === "email" ? "email" : "text"}
            value={value}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="input-base"
          />
          {kind === "upload" && (
            <input
              type="file"
              ref={fileRef}
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          )}
          {kind === "upload" && value && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
              <img
                src={value}
                alt=""
                className="h-10 w-10 rounded object-contain"
              />
              <span className="truncate text-xs text-muted">{value}</span>
            </div>
          )}
        </>
      )}

      {field.hint && (
        <p className="mt-1 text-[11px] text-muted">{field.hint}</p>
      )}
      {uploadError && (
        <p className="mt-1 text-xs text-danger">{uploadError}</p>
      )}
    </label>
  );
}
