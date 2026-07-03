"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

type SupplierType = "medico" | "laboratorio" | "costureira" | "outro";

interface Supplier {
  id: string;
  type: SupplierType;
  name: string;
  document: string | null;
  councilNumber: string | null;
  phone: string | null;
  email: string | null;
  payoutMode: "fixed" | "percent";
  payoutFixedCents: string | null;
  payoutPercent: string | null;
  pricePerPieceCents: string | null;
  pixKey: string | null;
  status: "active" | "inactive";
}

const TYPE_LABEL: Record<SupplierType, string> = {
  medico: "Médico",
  laboratorio: "Laboratório",
  costureira: "Costureira",
  outro: "Outro",
};

function brl(cents: string | null): string {
  if (cents == null) return "—";
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const EMPTY = {
  type: "medico" as SupplierType,
  name: "",
  document: "",
  councilNumber: "",
  phone: "",
  email: "",
  payoutMode: "fixed" as "fixed" | "percent",
  payoutValue: "", // R$ (fixed) ou % (percent)
  pricePerPieceValue: "", // R$ por peça (costureira)
  pixKey: "",
  status: "active" as "active" | "inactive",
};

export function SuppliersClient({ initial, niche }: { initial: Supplier[]; niche?: string | null }) {
  const router = useRouter();
  const dialog = useDialog();
  // Tipos visíveis dependem do nicho:
  //  - Ótica → médico (com CRM + repasse) | laboratório | outro
  //  - Demais → costureira | outro (esconde médico/lab pra não confundir)
  const isOtica = niche === "otica" || niche === "óptica" || niche === "optica";
  const visibleTypes: SupplierType[] = isOtica
    ? ["medico", "laboratorio", "outro"]
    : ["costureira", "outro"];
  const defaultType: SupplierType = isOtica ? "medico" : "costureira";
  const [filter, setFilter] = useState<"all" | SupplierType>("all");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY, type: defaultType });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const list = useMemo(
    () => (filter === "all" ? initial : initial.filter((s) => s.type === filter)),
    [filter, initial],
  );

  function startCreate() {
    setForm(EMPTY);
    setCreating(true);
    setEditing(null);
    setErr(null);
  }
  function startEdit(s: Supplier) {
    setForm({
      type: s.type,
      name: s.name,
      document: s.document ?? "",
      councilNumber: s.councilNumber ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      payoutMode: s.payoutMode,
      payoutValue:
        s.payoutMode === "percent"
          ? (s.payoutPercent ?? "")
          : s.payoutFixedCents != null
            ? String(Number(s.payoutFixedCents) / 100)
            : "",
      pricePerPieceValue: s.pricePerPieceCents != null && Number(s.pricePerPieceCents) > 0
        ? String(Number(s.pricePerPieceCents) / 100).replace(".", ",")
        : "",
      pixKey: s.pixKey ?? "",
      status: s.status,
    });
    setEditing(s);
    setCreating(false);
    setErr(null);
  }
  function cancel() { setCreating(false); setEditing(null); setErr(null); }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const showPayout = form.type !== "laboratorio";
      const payload: any = {
        type: form.type,
        name: form.name.trim(),
        document: form.document.trim() || null,
        councilNumber: form.type === "medico" ? (form.councilNumber.trim() || null) : null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        pixKey: form.pixKey.trim() || null,
        status: form.status,
      };
      if (showPayout) {
        payload.payoutMode = form.payoutMode;
        const v = Number(form.payoutValue.replace(",", "."));
        if (form.payoutMode === "percent") {
          payload.payoutPercent = isNaN(v) ? null : v;
          payload.payoutFixedCents = null;
        } else {
          payload.payoutFixedCents = isNaN(v) ? null : Math.round(v * 100);
          payload.payoutPercent = null;
        }
      }
      // costureira: valor único por peça (multiplica por total de peças do roster)
      if (form.type === "costureira") {
        const v = Number((form.pricePerPieceValue || "0").replace(",", "."));
        payload.pricePerPieceCents = isNaN(v) ? 0 : Math.round(v * 100);
      }
      const url = editing ? `/api/suppliers/${editing.id}` : "/api/suppliers";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      cancel();
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function remove(s: Supplier) {
    if (!(await dialog.confirm({ message: `Remover ${s.name}?`, confirmLabel: "Remover", tone: "danger" }))) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/suppliers/${s.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d?.error?.message ?? "Falha"); }
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const showForm = creating || editing;
  const showPayout = form.type !== "laboratorio";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["all", ...visibleTypes] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                filter === f ? "border-brand bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              {f === "all" ? "Todos" : TYPE_LABEL[f]}
            </button>
          ))}
        </div>
        {!showForm && (
          <button onClick={startCreate} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">
            Novo fornecedor
          </button>
        )}
      </div>

      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      {showForm && (
        <section className="space-y-4 rounded-xl border border-brand/40 bg-bg/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            {editing ? `Editar: ${editing.name}` : "Novo fornecedor"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as SupplierType })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm">
                {visibleTypes.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Nome">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            </Field>
            <Field label="Documento (CPF/CNPJ)">
              <input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            </Field>
            {form.type === "medico" && (
              <Field label="CRM">
                <input value={form.councilNumber} onChange={(e) => setForm({ ...form, councilNumber: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
              </Field>
            )}
            <Field label="Telefone">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            </Field>
            <Field label="E-mail">
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            </Field>
            <Field label="Chave Pix">
              <input value={form.pixKey} onChange={(e) => setForm({ ...form, pixKey: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
            </Field>
            {form.type === "costureira" && (
              <Field label="Valor por peça (R$)">
                <input
                  value={form.pricePerPieceValue}
                  onChange={(e) => setForm({ ...form, pricePerPieceValue: e.target.value })}
                  placeholder="ex.: 8,00"
                  inputMode="decimal"
                  className="w-full rounded border border-line bg-bg/60 px-2 py-1 text-sm"
                />
                <p className="mt-1 text-[10px] text-muted">Multiplicado pelo total de peças do pedido quando ela marcar "Pedido pronto". 0 = sem cálculo automático.</p>
              </Field>
            )}
          </div>

          {showPayout && (
            <div className="rounded-lg border border-line bg-bg/40 p-3">
              <span className="mb-2 block text-[10px] uppercase text-muted">Repasse por exame</span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={form.payoutMode === "fixed"} onChange={() => setForm({ ...form, payoutMode: "fixed" })} /> Valor fixo (R$)
                </label>
                <label className="flex items-center gap-1 text-sm">
                  <input type="radio" checked={form.payoutMode === "percent"} onChange={() => setForm({ ...form, payoutMode: "percent" })} /> Percentual (%)
                </label>
                <input
                  value={form.payoutValue}
                  onChange={(e) => setForm({ ...form, payoutValue: e.target.value })}
                  placeholder={form.payoutMode === "percent" ? "ex.: 30" : "ex.: 50,00"}
                  inputMode="decimal"
                  className="w-32 rounded border border-line bg-bg/60 px-2 py-1 text-sm"
                />
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.status === "active"} onChange={(e) => setForm({ ...form, status: e.target.checked ? "active" : "inactive" })} className="accent-brand" />
            Ativo
          </label>

          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !form.name.trim()} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
              {busy ? "Salvando..." : "Salvar"}
            </button>
            <button onClick={cancel} className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-brand">Cancelar</button>
          </div>
        </section>
      )}

      {list.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum fornecedor.</p>
      ) : (
        <div className="space-y-2">
          {list.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {s.name}
                  <span className="rounded bg-line px-1.5 py-0.5 text-[10px] uppercase text-muted">{TYPE_LABEL[s.type]}</span>
                  {s.status === "inactive" && <span className="text-[10px] text-red-300">inativo</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {s.document ?? "sem doc"}
                  {s.type === "medico" && (s.councilNumber ? ` · CRM ${s.councilNumber}` : "")}
                  {s.type !== "laboratorio" && (
                    s.payoutMode === "percent"
                      ? ` · repasse ${s.payoutPercent ?? "0"}%`
                      : ` · repasse ${brl(s.payoutFixedCents)}`
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => startEdit(s)} className="rounded border border-line px-3 py-1 text-xs transition hover:border-brand">Editar</button>
                <button onClick={() => remove(s)} className="rounded border border-line px-3 py-1 text-xs text-red-300 transition hover:border-red-400">Remover</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase text-muted">{label}</span>
      {children}
    </label>
  );
}
