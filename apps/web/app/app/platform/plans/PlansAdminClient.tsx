"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MODULE_GROUPS, moduleLabel, planLimitLines } from "../../../../lib/modules";

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  highlight: string | null;
  niche: string | null;
  priceCents: number;
  currency: string;
  interval: string;
  trialDays: number;
  maxStores: number | null;
  maxUsers: number | null;
  maxMessagesMonth: number | null;
  features: string[];
  extraHighlights?: string[];
  isActive: boolean;
  displayOrder: number;
  mpPlanId: string | null;
}

export function PlansAdminClient({ initialPlans }: { initialPlans: Plan[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // módulos selecionados (checkbox) + destaques de marketing + limites (controlados p/ preview)
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [highlights, setHighlights] = useState("");
  const [limits, setLimits] = useState({ maxStores: "", maxUsers: "", maxMessagesMonth: "" });

  useEffect(() => {
    if (creating) { setModules(new Set()); setHighlights(""); setLimits({ maxStores: "", maxUsers: "", maxMessagesMonth: "" }); }
    else if (editing) {
      setModules(new Set(editing.features ?? []));
      setHighlights((editing.extraHighlights ?? []).join("\n"));
      setLimits({
        maxStores: editing.maxStores != null ? String(editing.maxStores) : "",
        maxUsers: editing.maxUsers != null ? String(editing.maxUsers) : "",
        maxMessagesMonth: editing.maxMessagesMonth != null ? String(editing.maxMessagesMonth) : "",
      });
    }
  }, [creating, editing]);

  function toggleModule(key: string) {
    setModules((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const extraHighlights = highlights.split("\n").map((s) => s.trim()).filter(Boolean);

    const payload: Record<string, unknown> = {
      name: String(fd.get("name") ?? "").trim(),
      description: String(fd.get("description") ?? "").trim() || null,
      highlight: String(fd.get("highlight") ?? "").trim() || null,
      priceCents: Math.round(Number(fd.get("priceReais") ?? 0) * 100),
      niche: String(fd.get("niche") ?? "").trim() || null,
      interval: String(fd.get("interval") ?? "monthly"),
      trialDays: Number(fd.get("trialDays") ?? 14),
      maxStores: limits.maxStores ? Number(limits.maxStores) : null,
      maxUsers: limits.maxUsers ? Number(limits.maxUsers) : null,
      maxMessagesMonth: limits.maxMessagesMonth ? Number(limits.maxMessagesMonth) : null,
      features: [...modules],
      extraHighlights,
      isActive: fd.get("isActive") === "on",
      displayOrder: Number(fd.get("displayOrder") ?? 0),
    };
    if (creating) {
      payload.slug = String(fd.get("slug") ?? "").trim().toLowerCase();
    }

    const url = editing
      ? `/api/plans/${editing.id}`
      : "/api/plans";
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
    setEditing(null);
    setCreating(false);
    startTransition(() => router.refresh());
  }

  const formOpen = creating || editing;

  return (
    <div className="space-y-6">
      {!formOpen && (
        <button onClick={() => setCreating(true)} className="btn-grad px-5 py-2">
          + Novo plano
        </button>
      )}

      {formOpen && (
        <form onSubmit={onSubmit} className="card space-y-5 p-6">
          <h2 className="text-lg font-semibold">
            {editing ? `Editar — ${editing.name}` : "Novo plano"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            {creating && (
              <Field name="slug" label="Slug" required placeholder="pro" />
            )}
            <Field
              name="name"
              label="Nome"
              required
              defaultValue={editing?.name ?? ""}
            />
            <Field
              name="highlight"
              label="Destaque (badge)"
              placeholder="Mais popular"
              defaultValue={editing?.highlight ?? ""}
            />
            <Field
              name="description"
              label="Descrição"
              defaultValue={editing?.description ?? ""}
            />
            <Field
              name="priceReais"
              label="Preço (R$)"
              type="number"
              required
              defaultValue={
                editing ? String(editing.priceCents / 100) : "0"
              }
            />
            <SelectField
              name="interval"
              label="Periodicidade"
              defaultValue={editing?.interval ?? "monthly"}
              options={[
                { value: "monthly", label: "Mensal" },
                { value: "yearly", label: "Anual" },
              ]}
            />
            <SelectField
              name="niche"
              label="Nicho (mensalidade por segmento)"
              defaultValue={editing?.niche ?? ""}
              options={[
                { value: "", label: "Todos (genérico)" },
                { value: "otica", label: "Ótica" },
                { value: "grafica", label: "Gráfica/Uniformes" },
              ]}
            />
            <Field
              name="trialDays"
              label="Trial (dias)"
              type="number"
              defaultValue={String(editing?.trialDays ?? 14)}
            />
            <Field
              name="displayOrder"
              label="Ordem de exibição"
              type="number"
              defaultValue={String(editing?.displayOrder ?? 0)}
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Máx lojas (vazio = ilimitado)</span>
              <input type="number" value={limits.maxStores} onChange={(e) => setLimits({ ...limits, maxStores: e.target.value })} className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Máx usuários (vazio = ilimitado)</span>
              <input type="number" value={limits.maxUsers} onChange={(e) => setLimits({ ...limits, maxUsers: e.target.value })} className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">Máx mensagens/mês</span>
              <input type="number" value={limits.maxMessagesMonth} onChange={(e) => setLimits({ ...limits, maxMessagesMonth: e.target.value })} className="input-base" />
            </label>
          </div>

          {/* Módulos liberados pelo plano — a empresa que assina recebe acesso
              automático (cadeado some). Define o que o plano "tem". */}
          <div>
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted">
              Módulos liberados pelo plano
            </span>
            <div className="grid gap-4 sm:grid-cols-2">
              {MODULE_GROUPS.map((g) => (
                <div key={g.group} className="rounded-xl border border-line bg-surface-2 p-3">
                  <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">{g.group}</p>
                  <div className="space-y-1.5">
                    {g.modules.map((m) => (
                      <label key={m.key} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input type="checkbox" checked={modules.has(m.key)} onChange={() => toggleModule(m.key)} className="h-4 w-4" />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">Lojas, Usuários, Permissões, Integrações e Assinatura são sempre liberados (core).</p>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
              Destaques extras (marketing — uma linha por item)
            </span>
            <textarea
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              rows={4}
              placeholder={"Tudo do Starter\nNLU avançado\nSuporte prioritário"}
              className="input-base"
            />
          </label>

          {/* Pré-visualização de como o plano será exibido */}
          <div className="rounded-lg border border-brand/30 bg-brand/5 p-4">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">Pré-visualização</p>
            <ul className="space-y-1 text-sm">
              {planLimitLines({
                maxStores: limits.maxStores ? Number(limits.maxStores) : null,
                maxUsers: limits.maxUsers ? Number(limits.maxUsers) : null,
                maxMessagesMonth: limits.maxMessagesMonth ? Number(limits.maxMessagesMonth) : null,
              }).map((l) => <li key={l} className="text-muted">• {l}</li>)}
              {[...modules].map((k) => <li key={k}>✓ {moduleLabel(k)}</li>)}
              {highlights.split("\n").map((h) => h.trim()).filter(Boolean).map((h, i) => <li key={`h${i}`} className="text-brand">★ {h}</li>)}
            </ul>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={editing?.isActive ?? true}
              className="h-4 w-4"
            />
            <span>Ativo (aparece em /planos)</span>
          </label>

          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
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
              className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand"
            >
              Cancelar
            </button>
            <button type="submit" disabled={isPending} className="btn-grad px-5 py-2">
              Salvar
            </button>
          </div>
        </form>
      )}

      {initialPlans.length === 0 ? (
        <p className="card text-sm text-muted">
          Nenhum plano cadastrado.
        </p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Nicho</th>
                <th className="px-4 py-3">Preço</th>
                <th className="px-4 py-3">Trial</th>
                <th className="px-4 py-3">Ativo</th>
                <th className="px-4 py-3">Ordem</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {initialPlans.map((p) => (
                <tr key={p.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">
                    {p.name}
                    {p.highlight && (
                      <span className="ml-2 rounded bg-brand/20 px-1.5 py-0.5 text-[10px] uppercase text-brand">
                        {p.highlight}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{p.slug}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      // Badge do nicho — destaca planos sem nicho ("Todos") em
                      // âmbar pra o master perceber os que precisam ser tagueados
                      // (ex.: plano da gráfica que aparece pra ótica por estar null).
                      const n = (p.niche ?? "").toLowerCase();
                      const map: Record<string, { label: string; cls: string }> = {
                        otica: { label: "Ótica", cls: "bg-sky-500/20 text-sky-300" },
                        grafica: { label: "Gráfica", cls: "bg-purple-500/20 text-purple-300" },
                      };
                      const b = map[n] ?? { label: "Todos", cls: "bg-amber-500/20 text-amber-300" };
                      return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {(p.priceCents / 100).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: p.currency,
                    })}
                    <span className="text-xs text-muted">
                      {p.interval === "yearly" ? "/ano" : "/mês"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{p.trialDays}d</td>
                  <td className="px-4 py-3 text-xs">
                    {p.isActive ? "sim" : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">{p.displayOrder}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setEditing(p)}
                      className="text-xs text-brand hover:underline"
                    >
                      Editar
                    </button>
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
  required,
  placeholder,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
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
        className="input-base"
      />
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
      <select name={name} defaultValue={defaultValue ?? ""} className="input-base">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
