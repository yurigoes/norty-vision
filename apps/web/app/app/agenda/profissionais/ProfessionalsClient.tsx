"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../../components/SystemDialog";

interface Professional {
  id: string;
  storeId: string;
  name: string;
  displayName: string | null;
  specialty: string | null;
  email: string | null;
  phone: string | null;
  colorHex: string | null;
  defaultAppointmentDurationMin: number;
  defaultAppointmentCapacity: number;
  status: string;
  displayOrder: number;
}

interface Store {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
  professionalId: string;
  professional: { id: string; name: string; colorHex: string | null };
  weeklyBlocks: any;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
}

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

export function ProfessionalsClient({
  initialProfessionals,
  stores,
  templates,
}: {
  initialProfessionals: Professional[];
  stores: Store[];
  templates: Template[];
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Professional | null>(null);
  const [creating, setCreating] = useState(false);
  const [tplForProfessional, setTplForProfessional] = useState<Professional | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      name: String(fd.get("name") ?? "").trim(),
      displayName: String(fd.get("displayName") ?? "").trim() || null,
      specialty: String(fd.get("specialty") ?? "").trim() || null,
      email: String(fd.get("email") ?? "").trim() || null,
      phone: String(fd.get("phone") ?? "").trim() || null,
      colorHex: String(fd.get("colorHex") ?? "").trim() || null,
      defaultAppointmentDurationMin: Number(fd.get("durationMin") ?? 15),
      defaultAppointmentCapacity: Number(fd.get("capacity") ?? 1),
      status: String(fd.get("status") ?? "active"),
      displayOrder: Number(fd.get("displayOrder") ?? 0),
    };
    if (creating) payload.storeId = String(fd.get("storeId") ?? "");

    const url = editing ? `/api/professionals/${editing.id}` : "/api/professionals";
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

  async function generateSlots(tplId: string) {
    const today = new Date();
    const in30 = new Date(today.getTime() + 30 * 86400_000);
    const start = today.toISOString().slice(0, 10);
    const end = in30.toISOString().slice(0, 10);
    const res = await fetch("/api/schedule/slots/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: tplId, startDate: start, endDate: end }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      dialog.toast(data?.error?.message ?? "Falha ao gerar slots", "error");
      return;
    }
    dialog.toast(`Gerados ${data.generated ?? 0} slots de ${data.candidates ?? 0} candidatos.`, "success");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      {!creating && !editing && !tplForProfessional && (
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white"
        >
          + Novo profissional
        </button>
      )}

      {(creating || editing) && (
        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-line bg-bg/60 p-6"
        >
          <h2 className="text-lg font-semibold">
            {editing ? `Editar — ${editing.name}` : "Novo profissional"}
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
                  className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
                >
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Field name="name" label="Nome" required defaultValue={editing?.name ?? ""} />
            <Field name="displayName" label="Como aparece (Dr/Dra ...)" defaultValue={editing?.displayName ?? ""} />
            <Field name="specialty" label="Especialidade" defaultValue={editing?.specialty ?? ""} />
            <Field name="email" label="Email" type="email" defaultValue={editing?.email ?? ""} />
            <Field name="phone" label="Telefone" defaultValue={editing?.phone ?? ""} />
            <Field
              name="colorHex"
              label="Cor (hex)"
              placeholder="#60a5fa"
              defaultValue={editing?.colorHex ?? ""}
            />
            <Field
              name="durationMin"
              label="Duração padrão (min)"
              type="number"
              defaultValue={String(editing?.defaultAppointmentDurationMin ?? 15)}
            />
            <Field
              name="capacity"
              label="Capacidade por slot"
              type="number"
              defaultValue={String(editing?.defaultAppointmentCapacity ?? 1)}
            />
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
                setCreating(false);
                setEditing(null);
                setError(null);
              }}
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

      {tplForProfessional && (
        <TemplateEditor
          professional={tplForProfessional}
          existing={templates.find((t) => t.professionalId === tplForProfessional.id) ?? null}
          onClose={() => {
            setTplForProfessional(null);
            startTransition(() => router.refresh());
          }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Especialidade</th>
              <th className="px-4 py-3">Cor</th>
              <th className="px-4 py-3">Slot</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Template</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {initialProfessionals.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">
                  Nenhum profissional cadastrado.
                </td>
              </tr>
            ) : (
              initialProfessionals.map((p) => {
                const tpl = templates.find((t) => t.professionalId === p.id);
                return (
                  <tr key={p.id} className="border-t border-line/50">
                    <td className="px-4 py-3 font-medium">
                      {p.displayName || p.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {p.specialty ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: p.colorHex ?? "#60a5fa" }}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.defaultAppointmentDurationMin}min · cap{" "}
                      {p.defaultAppointmentCapacity}
                    </td>
                    <td className="px-4 py-3 text-xs">{p.status}</td>
                    <td className="px-4 py-3 text-xs">
                      {tpl ? (
                        <button
                          onClick={() => generateSlots(tpl.id)}
                          className="text-brand hover:underline"
                        >
                          Gerar slots 30d
                        </button>
                      ) : (
                        <span className="text-muted">sem</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => setEditing(p)}
                          className="text-xs text-brand hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setTplForProfessional(p)}
                          className="text-xs text-brand hover:underline"
                        >
                          {tpl ? "Editar jornada" : "Configurar jornada"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TemplateEditor({
  professional,
  existing,
  onClose,
}: {
  professional: Professional;
  existing: Template | null;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<
    Array<{ weekday: number; start: string; end: string; slotMinutes: number }>
  >(
    existing?.weeklyBlocks
      ? (existing.weeklyBlocks as any[]).flatMap((day: any) =>
          (day.blocks ?? []).map((b: any) => ({
            weekday: day.weekday,
            start: b.start,
            end: b.end,
            slotMinutes: b.slotMinutes ?? 15,
          })),
        )
      : [
          { weekday: 1, start: "08:00", end: "12:00", slotMinutes: 15 },
          { weekday: 1, start: "14:00", end: "18:00", slotMinutes: 15 },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function add() {
    setBlocks((b) => [...b, { weekday: 1, start: "08:00", end: "12:00", slotMinutes: 15 }]);
  }
  function remove(i: number) {
    setBlocks((b) => b.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: Partial<(typeof blocks)[number]>) {
    setBlocks((b) => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    // agrupa por weekday
    const grouped: Record<number, Array<{ start: string; end: string; slotMinutes: number }>> = {};
    for (const b of blocks) {
      grouped[b.weekday] = grouped[b.weekday] ?? [];
      grouped[b.weekday].push({ start: b.start, end: b.end, slotMinutes: b.slotMinutes });
    }
    const weeklyBlocks = Object.entries(grouped).map(([wd, bs]) => ({
      weekday: Number(wd),
      blocks: bs,
    }));

    const url = existing
      ? `/api/schedule/templates/${existing.id}`
      : "/api/schedule/templates";
    const method = existing ? "PATCH" : "POST";
    const payload: any = {
      name: existing?.name ?? `Padrão ${professional.name}`,
      weeklyBlocks,
    };
    if (!existing) {
      payload.professionalId = professional.id;
      payload.storeId = professional.storeId;
    }
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include",
    });
    setSaving(false);
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha");
      return;
    }
    onClose();
  }

  return (
    <div className="space-y-4 rounded-xl border border-brand/40 bg-bg/60 p-6">
      <h2 className="text-lg font-semibold">
        Jornada de {professional.displayName ?? professional.name}
      </h2>
      <p className="text-xs text-muted">
        Cada linha = um bloco de atendimento num dia da semana. Slots são
        gerados dividindo o bloco pela duração escolhida.
      </p>

      <div className="space-y-2">
        {blocks.map((b, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-5">
            <select
              value={b.weekday}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
              className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
            >
              {WEEKDAYS.map((d, idx) => (
                <option key={idx} value={idx}>
                  {d}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={b.start}
              onChange={(e) => update(i, { start: e.target.value })}
              className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
            />
            <input
              type="time"
              value={b.end}
              onChange={(e) => update(i, { end: e.target.value })}
              className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
            />
            <input
              type="number"
              value={b.slotMinutes}
              min={5}
              max={480}
              onChange={(e) => update(i, { slotMinutes: Number(e.target.value) })}
              className="rounded border border-line bg-bg/60 px-2 py-1.5 text-xs"
              placeholder="min"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-xs text-muted hover:text-red-300"
            >
              remover
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="text-sm text-brand hover:underline"
      >
        + adicionar bloco
      </button>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line px-4 py-2 text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar jornada"}
        </button>
      </div>
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
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
      />
    </label>
  );
}
