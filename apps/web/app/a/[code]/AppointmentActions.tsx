"use client";

import { useState } from "react";

interface Option { id: string; startsAt: string; byArrival: boolean; free: number }
type Outcome = "confirmed" | "canceled" | "reschedule" | null;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
}

export function AppointmentActions({
  code,
  initialStatus,
  initialOutcome,
  canAct,
}: {
  code: string;
  initialStatus: string;
  initialOutcome: Outcome;
  canAct: boolean;
}) {
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);

  async function act(path: string, newOutcome: Outcome) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/public/appointments/${code}/${path}`, { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Não foi possível processar"); return; }
      setOutcome(newOutcome);
      if (newOutcome === "canceled") void openReschedule();
    } catch { setErr("Erro de conexão"); } finally { setBusy(false); }
  }

  async function openReschedule() {
    setRescheduling(true); setErr(null); setOptions(null);
    const res = await fetch(`/api/public/appointments/${code}/reschedule-options`);
    const d = await res.json().catch(() => ({ options: [] }));
    setOptions(d.options ?? []);
  }

  async function pickReschedule(slotId: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/public/appointments/${code}/reschedule`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newSlotId: slotId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Horário indisponível"); return; }
      if (d?.newShortCode) window.location.href = `/a/${d.newShortCode}`;
      else window.location.reload();
    } catch { setErr("Erro de conexão"); } finally { setBusy(false); }
  }

  // bloco de "próximas datas" (reaproveitado em cancelado/remarcar)
  const rescheduleList = (
    <div className="mt-5">
      <p className="mb-2 text-sm font-medium">Escolha um novo horário:</p>
      {options === null ? <p className="text-sm text-muted">Carregando datas...</p>
        : options.length === 0 ? <p className="text-sm text-muted">Sem horários disponíveis no momento. Fale com a loja.</p>
        : (
          <ul className="max-h-72 space-y-1 overflow-auto">
            {options.map((o) => (
              <li key={o.id}>
                <button onClick={() => pickReschedule(o.id)} disabled={busy} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-left text-sm transition hover:border-brand disabled:opacity-50">
                  <span>{fmtDate(o.startsAt)} · {o.byArrival ? `a partir das ${fmtTime(o.startsAt)}` : fmtTime(o.startsAt)}</span>
                  <span className="text-[11px] text-muted">{o.free} vaga(s)</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      <button onClick={() => setRescheduling(false)} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">voltar</button>
    </div>
  );

  return (
    <>
      {err && <p className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{err}</p>}

      {/* JÁ CONFIRMOU (aqui ou pelo WhatsApp) → sucesso, sem mais ações */}
      {outcome === "confirmed" ? (
        <p className="mt-5 rounded-xl border border-success/40 bg-success/10 px-3 py-4 text-center text-sm font-medium text-success">
          ✅ Presença confirmada! Estamos te esperando. 💙
        </p>

      /* CANCELOU → oferece próximas datas */
      ) : outcome === "canceled" ? (
        <div className="mt-5 space-y-3">
          <p className="rounded-lg border border-line bg-bg/40 px-3 py-3 text-center text-sm text-muted">
            Seu agendamento foi cancelado.
          </p>
          {rescheduling ? rescheduleList : (
            <button onClick={openReschedule} disabled={busy} className="w-full rounded-lg py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgb(var(--brand))" }}>
              📅 Ver próximas datas
            </button>
          )}
        </div>

      /* PEDIU PRA REMARCAR (pelo WhatsApp) → oferece próximas datas */
      ) : outcome === "reschedule" ? (
        <div className="mt-5 space-y-3">
          <p className="rounded-lg border border-line bg-bg/40 px-3 py-3 text-center text-sm text-muted">
            Você pediu para remarcar. Escolha a melhor data:
          </p>
          {rescheduling ? rescheduleList : (
            <button onClick={openReschedule} disabled={busy} className="w-full rounded-lg py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgb(var(--brand))" }}>
              📅 Ver próximas datas
            </button>
          )}
        </div>

      /* PENDENTE (ainda não respondeu) → 3 opções */
      ) : canAct ? (
        rescheduling ? rescheduleList : (
          <div className="mt-5 space-y-2">
            <button onClick={() => act("confirm", "confirmed")} disabled={busy} className="w-full rounded-lg py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50" style={{ background: "rgb(var(--brand))" }}>✅ Confirmar presença</button>
            <button onClick={openReschedule} disabled={busy} className="w-full rounded-lg border border-line py-2 text-sm font-medium transition hover:border-brand disabled:opacity-50">📅 Reagendar</button>
            <button onClick={() => act("cancel", "canceled")} disabled={busy} className="w-full rounded-lg border border-line py-2 text-sm text-muted transition hover:text-red-300 disabled:opacity-50">❌ Cancelar</button>
          </div>
        )

      /* qualquer outro estado (atendido, não compareceu, etc) */
      ) : (
        <p className="mt-5 rounded-lg border border-line bg-bg/40 px-3 py-3 text-center text-sm text-muted">
          Este agendamento não está mais ativo. Em caso de dúvida, fale com a loja. 💙
        </p>
      )}
    </>
  );
}
