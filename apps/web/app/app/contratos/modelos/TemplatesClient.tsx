"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// variáveis do sistema preenchidas na assinatura do contrato
const SYSTEM_VARS: Array<{ group: string; items: Array<{ key: string; label: string }> }> = [
  {
    group: "Empresa",
    items: [
      { key: "empresa.nome", label: "Nome da empresa" },
      { key: "empresa.documento", label: "CNPJ/CPF da empresa" },
    ],
  },
  {
    group: "Cliente",
    items: [
      { key: "cliente.nome", label: "Nome do cliente" },
      { key: "cliente.cpf", label: "CPF/CNPJ" },
      { key: "cliente.endereco", label: "Endereço" },
      { key: "cliente.telefone", label: "Telefone" },
      { key: "cliente.email", label: "E-mail" },
    ],
  },
  {
    group: "Crediário / Data",
    items: [
      { key: "crediario.limite", label: "Limite de crédito" },
      { key: "data.hoje", label: "Data de hoje" },
    ],
  },
];

interface FieldSchemaItem {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

interface Template {
  id: string;
  organizationId: string | null;
  slug: string;
  title: string;
  description: string | null;
  bodyMarkdown: string;
  fieldsSchema: FieldSchemaItem[];
  signatureMode: string;
  isActive: boolean;
  createdAt: string;
}

const FIELD_TYPES = [
  "text",
  "email",
  "cpf",
  "cnpj",
  "phone",
  "date",
  "select",
  "textarea",
];

// campos pré-prontos do sistema: 1 clique adiciona ao formulário do contrato
const FIELD_PRESETS: Array<{ key: string; item: { name: string; label: string; type: string; required: boolean } }> = [
  { key: "Valor total", item: { name: "valor_total", label: "Valor total (R$)", type: "text", required: true } },
  { key: "Forma de pagamento", item: { name: "forma_pagamento", label: "Forma de pagamento", type: "text", required: false } },
  { key: "Nº de parcelas", item: { name: "num_parcelas", label: "Número de parcelas", type: "text", required: false } },
  { key: "Data de vencimento", item: { name: "data_vencimento", label: "Data de vencimento", type: "date", required: false } },
  { key: "Testemunha 1", item: { name: "testemunha_1", label: "Testemunha 1", type: "text", required: false } },
  { key: "Testemunha 2", item: { name: "testemunha_2", label: "Testemunha 2", type: "text", required: false } },
  { key: "Observações", item: { name: "observacoes", label: "Observações", type: "textarea", required: false } },
];

export function TemplatesClient({
  initialTemplates,
  isMaster = false,
}: {
  initialTemplates: Template[];
  isMaster?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldSchemaItem[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function insertVar(key: string) {
    const ta = bodyRef.current;
    const token = `{{${key}}}`;
    if (!ta) return;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    const pos = start + token.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  }

  function startEdit(t: Template) {
    setEditing(t);
    setFields(t.fieldsSchema);
    setShowForm(false);
  }
  function startNew() {
    setShowForm(true);
    setEditing(null);
    setFields([]);
  }
  function reset() {
    setShowForm(false);
    setEditing(null);
    setFields([]);
    setError(null);
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      { name: "", label: "", type: "text", required: true },
    ]);
  }
  function addPreset(p: FieldSchemaItem) {
    // evita duplicar pelo name
    setFields((prev) => (prev.some((f) => f.name === p.name) ? prev : [...prev, { ...p }]));
  }
  function updateField(i: number, patch: Partial<FieldSchemaItem>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      slug: String(fd.get("slug") ?? "").trim().toLowerCase(),
      title: String(fd.get("title") ?? "").trim(),
      description: String(fd.get("description") ?? "").trim() || null,
      bodyMarkdown: String(fd.get("bodyMarkdown") ?? ""),
      fieldsSchema: fields,
      signatureMode: String(fd.get("signatureMode") ?? "click") as
        | "click"
        | "draw",
    };
    const url = editing
      ? `/api/contracts/templates/${editing.id}`
      : "/api/contracts/templates";
    const method = editing ? "PATCH" : "POST";
    const body = editing
      ? {
          title: payload.title,
          description: payload.description,
          bodyMarkdown: payload.bodyMarkdown,
          fieldsSchema: payload.fieldsSchema,
          signatureMode: payload.signatureMode,
        }
      : payload;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao salvar");
      return;
    }
    reset();
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      {!showForm && !editing && (
        <button
          onClick={startNew}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white"
        >
          + Novo modelo
        </button>
      )}

      {(showForm || editing) && (
        <form
          onSubmit={onSubmit}
          className="space-y-5 rounded-xl border border-line bg-bg/60 p-6"
        >
          <h2 className="text-lg font-semibold">
            {editing ? `Editar — ${editing.title}` : "Novo modelo"}
          </h2>

          {!editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="slug"
                label="Slug"
                required
                placeholder="termo-adesao"
                help="3-60 chars, [a-z 0-9 -]"
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="title"
              label="Título"
              required
              defaultValue={editing?.title ?? ""}
            />
            <SelectField
              name="signatureMode"
              label="Tipo de assinatura"
              defaultValue={editing?.signatureMode ?? "click"}
              options={[
                { value: "click", label: "Clique (aceite eletrônico)" },
                { value: "draw", label: "Desenhar rubrica (canvas)" },
              ]}
            />
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
              Descrição
            </span>
            <input
              name="description"
              defaultValue={editing?.description ?? ""}
              className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm text-fg outline-none focus:border-brand"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
              Corpo (Markdown — use{" "}
              <code className="rounded bg-line px-1.5 py-0.5 text-[10px]">
                {"{{nome_do_campo}}"}
              </code>{" "}
              para placeholders)
            </span>

            {/* paleta de variáveis do sistema (preenchidas na assinatura) */}
            <div className="mb-2 space-y-2 rounded-lg border border-line bg-bg/40 p-3">
              <p className="text-[11px] text-muted">
                Clique para inserir variáveis do sistema (preenchidas automaticamente na assinatura):
              </p>
              {SYSTEM_VARS.map((g) => (
                <div key={g.group} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-muted">{g.group}:</span>
                  {g.items.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVar(v.key)}
                      title={v.label}
                      className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-brand transition hover:border-brand hover:bg-brand/10"
                    >
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            <textarea
              ref={bodyRef}
              name="bodyMarkdown"
              defaultValue={editing?.bodyMarkdown ?? ""}
              required
              rows={14}
              className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 font-mono text-xs text-fg outline-none focus:border-brand"
            />
          </label>

          <div>
            <button
              type="button"
              onClick={() =>
                setPreview((p) => (p === null ? bodyRef.current?.value ?? "" : null))
              }
              className="text-xs text-brand hover:underline"
            >
              {preview === null ? "Pré-visualizar ↓" : "Fechar pré-visualização"}
            </button>
            {preview !== null && (
              <iframe
                srcDoc={preview}
                title="Pré-visualização do modelo"
                className="mt-2 h-[420px] w-full rounded-lg border border-line bg-white"
              />
            )}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Campos do formulário
              </h3>
              <button
                type="button"
                onClick={addField}
                className="text-xs text-brand hover:underline"
              >
                + campo manual
              </button>
            </div>
            {/* campos prontos do sistema (1 clique) */}
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">Campos prontos:</span>
              {FIELD_PRESETS.map((p) => (
                <button
                  key={p.item.name}
                  type="button"
                  onClick={() => addPreset(p.item)}
                  className="rounded border border-line px-2 py-0.5 text-[11px] text-brand transition hover:border-brand hover:bg-brand/10"
                >
                  + {p.key}
                </button>
              ))}
            </div>
            {fields.length === 0 ? (
              <p className="rounded-lg border border-line bg-bg/40 p-4 text-xs text-muted">
                Nenhum campo definido. Adicione um campo pra cada placeholder
                usado no corpo do contrato.
              </p>
            ) : (
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-line bg-bg/40 p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-4">
                      <input
                        placeholder="name (ex: nome_completo)"
                        value={f.name}
                        onChange={(e) => updateField(i, { name: e.target.value })}
                        className="rounded border border-line bg-bg/60 px-2 py-1.5 font-mono text-xs"
                      />
                      <input
                        placeholder="Label (ex: Nome completo)"
                        value={f.label}
                        onChange={(e) =>
                          updateField(i, { label: e.target.value })
                        }
                        className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
                      />
                      <select
                        value={f.type}
                        onChange={(e) => updateField(i, { type: e.target.value })}
                        className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) =>
                              updateField(i, { required: e.target.checked })
                            }
                          />
                          obrigatório
                        </label>
                        <button
                          type="button"
                          onClick={() => removeField(i)}
                          className="text-muted hover:text-red-300"
                        >
                          remover
                        </button>
                      </div>
                    </div>
                    {f.type === "select" && (
                      <input
                        placeholder="Opções (separadas por vírgula)"
                        defaultValue={(f.options ?? []).join(", ")}
                        onBlur={(e) =>
                          updateField(i, {
                            options: e.target.value
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                          })
                        }
                        className="mt-2 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        </form>
      )}

      {initialTemplates.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">
          Nenhum modelo cadastrado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Escopo</th>
                <th className="px-4 py-3">Assinatura</th>
                <th className="px-4 py-3">Campos</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {initialTemplates.map((t) => (
                <tr key={t.id} className="border-t border-line/50">
                  <td className="px-4 py-3 font-medium">
                    {t.title}
                    {t.description && (
                      <div className="text-xs text-muted">{t.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    {t.slug}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.organizationId ? "Empresa" : "yugochat"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.signatureMode === "draw" ? "Rubrica" : "Clique"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.fieldsSchema.length}
                  </td>
                  <td className="px-4 py-3">
                    {t.organizationId === null && !isMaster ? (
                      <span className="text-xs text-muted">somente master</span>
                    ) : (
                      <button
                        onClick={() => startEdit(t)}
                        className="text-xs text-brand hover:underline"
                      >
                        Editar
                      </button>
                    )}
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
