"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";
import { ExamReceiptModal } from "./ExamReceiptModal";

interface Professional {
  id: string;
  name: string;
  colorHex: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  whatsappPhone: string | null;
}

interface Slot {
  id: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  used: number;
  isBlocked: boolean;
  professional: { id: string; name: string; colorHex: string | null };
  slotStatus?: "free" | "booked" | "blocked";
  bookings?: Array<{ id: string; status: string; customerName: string | null }>;
}

interface Appointment {
  id: string;
  status: string;
  serviceName: string | null;
  startsAt: string;
  endsAt: string;
  shortCode: string | null;
  professional: { id: string; name: string; colorHex: string | null };
  customer: {
    id: string;
    name: string;
    phone: string | null;
    whatsappPhone: string | null;
  };
  examPriceCents?: number | null;
}

export function AgendaClient({
  date,
  professionals,
  customers,
  appointments,
  slots,
  selectedProfessionalId,
  isAdmin = false,
}: {
  date: string;
  professionals: Professional[];
  customers: Customer[];
  appointments: Appointment[];
  slots: Slot[];
  selectedProfessionalId: string | null;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [isPending, startTransition] = useTransition();
  const [bookingSlot, setBookingSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examReceipt, setExamReceipt] = useState<Appointment | null>(null);
  const [showOpenDay, setShowOpenDay] = useState(false);
  const [view, setView] = useState<"day" | "month">("day");
  // pacientes criados na hora (cruzados com clientes existentes)
  const [extraCustomers, setExtraCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [npName, setNpName] = useState("");
  const [npDoc, setNpDoc] = useState("");
  const [npPhone, setNpPhone] = useState("");
  const [npBusy, setNpBusy] = useState(false);

  // dedupe por id: find-or-create pode devolver um cliente que já está na lista
  const allCustomers = (() => {
    const map = new Map<string, Customer>();
    for (const c of [...extraCustomers, ...customers]) if (!map.has(c.id)) map.set(c.id, c);
    return [...map.values()];
  })();

  async function addPatient() {
    if (npName.trim().length < 2) { dialog.toast("Informe o nome do paciente.", "error"); return; }
    setNpBusy(true);
    try {
      const res = await fetch("/api/customers/find-or-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: npName.trim(),
          document: npDoc.trim() || null,
          phone: npPhone.trim() || null,
          whatsappPhone: npPhone.trim() || null,
        }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao cadastrar");
      const c = data.customer as Customer;
      setExtraCustomers((prev) => (prev.some((p) => p.id === c.id) ? prev : [c, ...prev]));
      setSelectedCustomerId(c.id);
      setShowNewPatient(false);
      setNpName(""); setNpDoc(""); setNpPhone("");
      dialog.toast(
        data.matched
          ? `Cliente já cadastrado — vinculado: ${c.name}`
          : `Paciente cadastrado: ${c.name}`,
        "success",
      );
    } catch (e: any) {
      dialog.toast(e.message, "error");
    } finally { setNpBusy(false); }
  }

  // abre o agendamento limpando o estado do paciente (senão fica o anterior)
  function openBooking(s: Slot) {
    setBookingSlot(s);
    setSelectedCustomerId("");
    setShowNewPatient(false);
    setNpName(""); setNpDoc(""); setNpPhone("");
    setError(null);
  }
  function resetPatientForm() {
    setSelectedCustomerId("");
    setShowNewPatient(false);
    setNpName(""); setNpDoc(""); setNpPhone("");
  }

  function setDate(newDate: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("date", newDate);
    router.push(url.pathname + url.search);
  }

  function setProfessional(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("professionalId", id);
    else url.searchParams.delete("professionalId");
    router.push(url.pathname + url.search);
  }

  async function onBook(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bookingSlot) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const customerId = selectedCustomerId || String(fd.get("customerId") ?? "");
    if (!customerId) { setError("Selecione ou cadastre o paciente."); return; }
    const serviceName = String(fd.get("serviceName") ?? "").trim() || null;
    const notes = String(fd.get("notes") ?? "").trim() || null;
    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotId: bookingSlot.id,
        customerId,
        serviceName,
        notes,
      }),
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Falha ao agendar");
      return;
    }
    setBookingSlot(null);
    resetPatientForm();
    startTransition(() => router.refresh());
  }

  async function appointmentAction(
    id: string,
    action: "confirm" | "cancel" | "check-in" | "attended",
  ) {
    if (action === "cancel") {
      const ok = await dialog.confirm({ message: "Cancelar este agendamento?", confirmLabel: "Cancelar agendamento", tone: "danger" });
      if (!ok) return;
    }
    const res = await fetch(`/api/appointments/${id}/${action}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d?.error?.message ?? `Falha em ${action}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  const availableSlots = slots.filter(
    (s) => !s.isBlocked && s.used < s.capacity,
  );

  return (
    <div className="space-y-6">
      {/* Header de controle */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/60 p-4">
        {/* só navega quando a data está completa e válida — evita o "deform"
            ao digitar o ano (cada tecla disparava um router.push e perdia foco) */}
        <input
          type="date"
          defaultValue={date}
          min="2020-01-01"
          max="2100-12-31"
          onChange={(e) => { const v = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2020) setDate(v); }}
          className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
        />
        <select
          value={selectedProfessionalId ?? ""}
          onChange={(e) => setProfessional(e.target.value || null)}
          className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
        >
          <option value="">Todos profissionais</option>
          {professionals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex items-center overflow-hidden rounded-lg border border-line">
          <button onClick={() => setView("day")} className={`px-3 py-2 text-xs font-medium ${view === "day" ? "bg-brand text-white" : "text-muted"}`}>Dia</button>
          <button onClick={() => setView("month")} className={`px-3 py-2 text-xs font-medium ${view === "month" ? "bg-brand text-white" : "text-muted"}`}>Mês</button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowOpenDay(true)}
            className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
          >
            + Abrir agenda do dia
          </button>
          <a
            href={`/app/agenda/relatorio?date=${date}${selectedProfessionalId ? `&professionalId=${selectedProfessionalId}` : ""}`}
            className="rounded-lg border border-line px-3 py-2 text-xs font-medium transition hover:border-brand"
          >
            🖨️ Relatório do dia
          </a>
        </div>
      </div>
      <p className="px-1 text-xs text-muted">
        {appointments.length} agendado(s) · {availableSlots.length} horário(s) livre(s)
      </p>

      {showOpenDay && (
        <OpenDayModal
          date={date}
          professionals={professionals}
          defaultProfessionalId={selectedProfessionalId ?? professionals[0]?.id ?? ""}
          onClose={() => setShowOpenDay(false)}
          onDone={() => { setShowOpenDay(false); startTransition(() => router.refresh()); }}
        />
      )}

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {view === "month" && (
        <MonthView
          date={date}
          professionalId={selectedProfessionalId}
          onPickDay={(d) => { setView("day"); setDate(d); }}
        />
      )}

      {view === "day" && bookingSlot && (
        <form
          onSubmit={onBook}
          className="space-y-4 rounded-xl border border-brand/40 bg-bg/60 p-6"
        >
          <h2 className="text-lg font-semibold">
            Agendar — {new Date(bookingSlot.startsAt).toLocaleString("pt-BR")}{" "}
            <span className="text-muted">com {bookingSlot.professional.name}</span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="block sm:col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium uppercase tracking-wider text-muted">
                  Paciente *
                </span>
                <button
                  type="button"
                  onClick={() => setShowNewPatient((v) => !v)}
                  className="text-xs text-brand hover:underline"
                >
                  {showNewPatient ? "selecionar existente" : "+ novo paciente"}
                </button>
              </div>
              {!showNewPatient ? (
                <select
                  name="customerId"
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
                >
                  <option value="">— selecione —</option>
                  {allCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `· ${c.phone}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2 rounded-lg border border-brand/30 bg-bg/40 p-3">
                  <p className="text-[11px] text-muted">
                    Cruzamos pelo CPF/telefone: se o cliente já existir, vinculamos automaticamente.
                  </p>
                  <input
                    value={npName}
                    onChange={(e) => setNpName(e.target.value)}
                    placeholder="Nome completo *"
                    className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={npDoc}
                      onChange={(e) => setNpDoc(e.target.value)}
                      placeholder="CPF/CNPJ"
                      className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
                    />
                    <input
                      value={npPhone}
                      onChange={(e) => setNpPhone(e.target.value)}
                      placeholder="Telefone/WhatsApp"
                      className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addPatient}
                    disabled={npBusy}
                    className="rounded-lg border border-brand px-4 py-2 text-sm text-brand transition hover:bg-brand hover:text-white disabled:opacity-50"
                  >
                    {npBusy ? "Salvando..." : "Cadastrar e vincular"}
                  </button>
                </div>
              )}
              {selectedCustomerId && !showNewPatient && (
                <p className="mt-1 text-[11px] text-green-600 dark:text-green-300">
                  Paciente selecionado: {allCustomers.find((c) => c.id === selectedCustomerId)?.name}
                </p>
              )}
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                Serviço
              </span>
              <input
                name="serviceName"
                placeholder="Ex: Consulta de rotina"
                className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
                Notas internas
              </span>
              <input
                name="notes"
                className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setBookingSlot(null)}
              className="rounded-lg border border-line px-4 py-2 text-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirmar agendamento
            </button>
          </div>
        </form>
      )}

      {view === "day" && (
      <>
      {/* Lista de agendamentos do dia */}
      <section className="rounded-xl border border-line bg-bg/60">
        <h2 className="border-b border-line px-5 py-3 text-sm font-semibold uppercase tracking-wider text-muted">
          Agendamentos do dia
        </h2>
        {appointments.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted">Nenhum agendamento.</p>
        ) : (
          <ul className="divide-y divide-line/50">
            {appointments.map((a) => (
              <li key={a.id} className="flex items-start gap-4 px-5 py-4">
                <div
                  className="mt-1 h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: a.professional.colorHex ?? "#60a5fa",
                  }}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">
                      {new Date(a.startsAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      –
                      {new Date(a.endsAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="mt-1 font-medium">{a.customer.name}</p>
                  <p className="text-xs text-muted">
                    {a.professional.name}
                    {a.serviceName && ` · ${a.serviceName}`}
                    {a.customer.phone && ` · ${a.customer.phone}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a.status === "pending" && (
                    <button
                      onClick={() => appointmentAction(a.id, "confirm")}
                      className="rounded-md border border-line px-3 py-1 text-xs hover:border-green-500 hover:text-green-300"
                    >
                      Confirmar
                    </button>
                  )}
                  {(a.status === "confirmed" || a.status === "pending") && (
                    <button
                      onClick={() => setExamReceipt(a)}
                      className="rounded-md border border-line px-3 py-1 text-xs hover:border-blue-500 hover:text-blue-300"
                    >
                      Check-in
                    </button>
                  )}
                  {a.status === "in_progress" && (
                    <button
                      onClick={() => appointmentAction(a.id, "attended")}
                      className="rounded-md border border-line px-3 py-1 text-xs hover:border-green-500 hover:text-green-300"
                    >
                      Finalizar
                    </button>
                  )}
                  {a.status !== "canceled" && a.status !== "attended" && (
                    <button
                      onClick={() => appointmentAction(a.id, "cancel")}
                      className="rounded-md border border-line px-3 py-1 text-xs hover:border-red-500 hover:text-red-300"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Horários do dia (verde livre · vermelho ocupado · cinza inativo) */}
      <section className="rounded-xl border border-line bg-bg/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Horários do dia</h2>
          <div className="flex gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-green-500" /> livre</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-red-500" /> ocupado</span>
            <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-gray-400" /> inativo</span>
          </div>
        </div>
        {slots.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted">
            Nenhum horário aberto neste dia. Abra a agenda (por duração ou quantidade) ou gere slots em{" "}
            <a className="text-brand hover:underline" href="/app/agenda/profissionais">Profissionais</a>.
          </p>
        ) : (
          <div className="grid gap-2 p-5 sm:grid-cols-3 lg:grid-cols-4">
            {[...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((s) => {
              const status = s.slotStatus ?? (s.isBlocked ? "blocked" : s.used >= s.capacity ? "booked" : "free");
              const hora = new Date(s.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              const nomes = (s.bookings ?? []).map((b) => b.customerName).filter(Boolean) as string[];
              const cls =
                status === "free" ? "border-green-500/50 bg-green-500/10 hover:border-green-500 hover:bg-green-500/20 cursor-pointer"
                : status === "booked" ? "border-red-500/50 bg-red-500/10"
                : "border-gray-400/40 bg-gray-400/10 opacity-70";
              return (
                <div
                  key={s.id}
                  onClick={status === "free" ? () => openBooking(s) : undefined}
                  className={`group rounded-lg border p-3 text-left transition ${cls}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.professional.colorHex ?? "#60a5fa" }} />
                      <span className="font-mono text-sm">{hora}</span>
                    </div>
                    <span className={`text-[10px] font-semibold uppercase ${status === "free" ? "text-green-600 dark:text-green-300" : status === "booked" ? "text-red-600 dark:text-red-300" : "text-gray-500"}`}>
                      {status === "free" ? "livre" : status === "booked" ? "ocupado" : "inativo"}
                    </span>
                  </div>
                  {status === "booked" && nomes.length > 0 && (
                    <p className="mt-1 truncate text-xs font-medium" title={nomes.join(", ")}>👤 {nomes.join(", ")}</p>
                  )}
                  {s.capacity > 1 && (
                    <p className="mt-0.5 text-[11px] text-muted">{s.used}/{s.capacity} · {s.professional.name}</p>
                  )}
                  {s.capacity <= 1 && status !== "booked" && (
                    <p className="mt-1 truncate text-xs text-muted">{s.professional.name}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      </>
      )}

      {examReceipt && (
        <ExamReceiptModal
          appointmentId={examReceipt.id}
          customerId={examReceipt.customer?.id}
          professionalId={examReceipt.professional?.id}
          patientName={examReceipt.customer?.name}
          examPriceCents={examReceipt.examPriceCents ?? null}
          isAdmin={isAdmin}
          onClose={() => setExamReceipt(null)}
          onDone={async () => {
            const id = examReceipt.id;
            setExamReceipt(null);
            await appointmentAction(id, "check-in"); // após receber, faz o check-in
          }}
        />
      )}
    </div>
  );
}

interface OpenDayPreview {
  slotMinutes: number;
  slotsCount: number;
  capacityPerSlot: number;
  totalCapacity: number;
  perPeriod: Array<{ start: string; end: string; slots: number }>;
}

/** Modal "Abrir agenda do dia": por duração ou por quantidade, com confirmação. */
function OpenDayModal({
  date,
  professionals,
  defaultProfessionalId,
  onClose,
  onDone,
}: {
  date: string;
  professionals: Professional[];
  defaultProfessionalId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [professionalId, setProfessionalId] = useState(defaultProfessionalId);
  const [mode, setMode] = useState<"byDuration" | "byCount">("byDuration");
  const [periods, setPeriods] = useState<Array<{ start: string; end: string }>>([{ start: "08:00", end: "13:00" }]);
  const [slotMinutes, setSlotMinutes] = useState(15);
  const [count, setCount] = useState(20);
  const [capacityPerSlot, setCapacityPerSlot] = useState(1);
  const [preview, setPreview] = useState<OpenDayPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function payload(dryRun: boolean) {
    return {
      professionalId, date, periods, mode, capacityPerSlot,
      ...(mode === "byDuration" ? { slotMinutes } : { count }),
      dryRun,
    };
  }

  async function calc() {
    setErr(null); setBusy(true); setPreview(null);
    try {
      const res = await fetch("/api/schedule/open-day", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(true)), credentials: "include",
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao calcular"); return; }
      setPreview(d);
    } catch { setErr("Erro de conexão"); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/schedule/open-day", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(false)), credentials: "include",
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao abrir agenda"); return; }
      onDone();
    } catch { setErr("Erro de conexão"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Abrir agenda do dia</h3>
        <p className="mt-1 text-sm text-muted">{new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Profissional</span>
            <select value={professionalId} onChange={(e) => { setProfessionalId(e.target.value); setPreview(null); }} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          {/* janelas */}
          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Janelas de atendimento</span>
            <div className="space-y-2">
              {periods.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="time" value={p.start} onChange={(e) => { const n = [...periods]; n[i] = { ...n[i]!, start: e.target.value }; setPeriods(n); setPreview(null); }} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm" />
                  <span className="text-muted">até</span>
                  <input type="time" value={p.end} onChange={(e) => { const n = [...periods]; n[i] = { ...n[i]!, end: e.target.value }; setPeriods(n); setPreview(null); }} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm" />
                  {periods.length > 1 && (
                    <button onClick={() => { setPeriods(periods.filter((_, x) => x !== i)); setPreview(null); }} className="text-muted hover:text-red-300">×</button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={() => { setPeriods([...periods, { start: "14:00", end: "18:00" }]); setPreview(null); }} className="mt-1 text-[11px] text-brand hover:underline">+ adicionar janela (ex.: tarde)</button>
          </div>

          {/* modo */}
          <div className="flex gap-2">
            <button onClick={() => { setMode("byDuration"); setPreview(null); }} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${mode === "byDuration" ? "border-brand text-brand" : "border-line text-muted"}`}>Por duração (min/horário)</button>
            <button onClick={() => { setMode("byCount"); setPreview(null); }} className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${mode === "byCount" ? "border-brand text-brand" : "border-line text-muted"}`}>Por quantidade</button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {mode === "byDuration" ? (
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Minutos por horário</span>
                <input type="number" min={5} value={slotMinutes} onChange={(e) => { setSlotMinutes(Number(e.target.value)); setPreview(null); }} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Qtde de horários</span>
                <input type="number" min={1} value={count} onChange={(e) => { setCount(Number(e.target.value)); setPreview(null); }} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Pessoas por horário</span>
              <input type="number" min={1} value={capacityPerSlot} onChange={(e) => { setCapacityPerSlot(Number(e.target.value)); setPreview(null); }} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
              <span className="mt-0.5 block text-[10px] text-muted">&gt;1 = por ordem de chegada</span>
            </label>
          </div>

          {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}

          {preview && (
            <div className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
              <p>Serão abertos <strong>{preview.slotsCount}</strong> horário(s) de <strong>{preview.slotMinutes} min</strong> cada.</p>
              <p className="mt-1">Capacidade total: <strong>{preview.totalCapacity}</strong> atendimento(s){preview.capacityPerSlot > 1 ? " (por ordem de chegada)" : ""}.</p>
              <p className="mt-1 text-xs text-muted">{preview.perPeriod.map((p) => `${p.start}–${p.end}: ${p.slots}`).join(" · ")}</p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Fechar</button>
          {!preview ? (
            <button onClick={calc} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Calculando..." : "Calcular"}</button>
          ) : (
            <button onClick={commit} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Abrindo..." : `Confirmar e abrir ${preview.slotsCount} horário(s)`}</button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DayAvail { date: string; totalSlots: number; freeSlots: number; freeCapacity: number }

/** Visão de mês: dias com horários livres ficam verdes; clicar abre o dia. */
function MonthView({
  date,
  professionalId,
  onPickDay,
}: {
  date: string;
  professionalId: string | null;
  onPickDay: (d: string) => void;
}) {
  const month = date.slice(0, 7); // YYYY-MM
  const [days, setDays] = useState<Record<string, DayAvail>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/schedule/month?month=${month}${professionalId ? `&professionalId=${professionalId}` : ""}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { days: [] }))
      .then((d: { days: DayAvail[] }) => {
        const map: Record<string, DayAvail> = {};
        (d.days ?? []).forEach((x) => { map[x.date] = x; });
        setDays(map);
      })
      .finally(() => setLoading(false));
  }, [month, professionalId]);

  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y!, m! - 1, 1));
    const startWeekday = first.getUTCDay(); // 0=dom
    const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    const arr: Array<{ day: number; date: string } | null> = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      arr.push({ day: d, date });
    }
    return arr;
  }, [month]);

  const monthLabel = new Date(date + "T00:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-xl border border-line bg-bg/60 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted capitalize">{monthLabel}</h2>
        {loading && <span className="text-xs text-muted">carregando...</span>}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-muted">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const av = days[c.date];
          const hasFree = av && av.freeCapacity > 0;
          const hasAny = av && av.totalSlots > 0;
          const isToday = c.date === today;
          return (
            <button
              key={c.date}
              onClick={() => onPickDay(c.date)}
              className={`flex min-h-[58px] flex-col items-center justify-start rounded-lg border p-1 text-left transition hover:border-brand ${
                hasFree ? "border-green-500/50 bg-green-500/10" : hasAny ? "border-orange-500/40 bg-orange-500/10" : "border-line bg-bg/40"
              } ${isToday ? "ring-1 ring-brand" : ""}`}
            >
              <span className="self-end text-xs font-medium">{c.day}</span>
              {hasFree ? (
                <span className="mt-auto w-full rounded bg-green-500/20 px-1 text-center text-[10px] font-semibold text-green-300">
                  {av!.freeCapacity} livre(s)
                </span>
              ) : hasAny ? (
                <span className="mt-auto w-full text-center text-[10px] text-orange-300">lotado</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        <span className="text-green-300">verde</span> = tem horário livre · <span className="text-orange-300">laranja</span> = aberto mas lotado · clique no dia para agendar.
      </p>
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-300",
    confirmed: "bg-blue-500/20 text-blue-300",
    in_progress: "bg-purple-500/20 text-purple-300",
    attended: "bg-green-500/20 text-green-300",
    canceled: "bg-red-500/20 text-red-300",
    rescheduled: "bg-orange-500/20 text-orange-300",
    no_show: "bg-line text-muted",
  };
  const labels: Record<string, string> = {
    pending: "pendente",
    confirmed: "confirmado",
    in_progress: "atendendo",
    attended: "atendido",
    canceled: "cancelado",
    rescheduled: "remarcado",
    no_show: "no-show",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
        styles[status] ?? "bg-line text-muted"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}
