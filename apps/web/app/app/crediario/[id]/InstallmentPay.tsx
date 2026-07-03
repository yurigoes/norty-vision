"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Admin = { membershipId: string; name: string; role: string; hasWhatsapp: boolean };

export function InstallmentPay({
  installmentId,
  dueDate,
}: {
  installmentId: string;
  amountCents?: string;
  dueDate?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pix, setPix] = useState<{ qrCode: string | null; qrCodeBase64: string | null } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"menu" | "discount" | "due">("menu");

  function refresh() {
    setOpen(false); setView("menu");
    startTransition(() => router.refresh());
  }

  async function action(path: string) {
    setBusy(true); setError(null); setPix(null); setLink(null);
    const res = await fetch(`/api/payments/installments/${installmentId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      credentials: "include",
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
    if (path === "pix") setPix({ qrCode: data.qrCode, qrCodeBase64: data.qrCodeBase64 });
    else if (path === "card-link" && data.initPoint) window.open(data.initPoint, "_blank");
    else if (path === "infinitepay-link" && data.link) setLink(data.link);
    else refresh();
  }

  return (
    <div className="relative inline-block">
      <button onClick={() => { setOpen(!open); setView("menu"); }} className="text-xs text-brand hover:underline">
        Pagar ▾
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-lg border border-line bg-bg p-2 shadow-xl">
          {view === "menu" && (
            <>
              <button disabled={busy} onClick={() => action("pix")} className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-line">
                Gerar Pix
              </button>
              <button disabled={busy} onClick={() => action("card-link")} className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-line">
                Link de cartão
              </button>
              <button disabled={busy} onClick={() => action("infinitepay-link")} className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-line">
                Cobrar com link InfinitePay
              </button>
              <button disabled={busy} onClick={() => action("in-person")} className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-line">
                Dar baixa (presencial)
              </button>
              <button disabled={busy} onClick={() => { setView("discount"); setError(null); }} className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-line">
                Baixa com desconto de juros…
              </button>
              <button disabled={busy} onClick={() => { setView("due"); setError(null); }} className="block w-full rounded px-3 py-1.5 text-left text-xs hover:bg-line">
                Ajustar vencimento…
              </button>
              {error && <p className="px-3 py-1 text-[10px] text-red-300">{error}</p>}
              {link && (
                <div className="mt-2 border-t border-line p-2">
                  <p className="text-[10px] text-green-300">Link InfinitePay gerado e enviado por WhatsApp/e-mail ✅</p>
                  <textarea readOnly value={link} rows={2}
                    className="mt-1 w-full rounded border border-line bg-bg/60 p-1 font-mono text-[9px]"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
                  <a href={link} target="_blank" rel="noreferrer" className="mt-1 block text-[10px] text-brand hover:underline">abrir link ↗</a>
                </div>
              )}
              {pix && (
                <div className="mt-2 border-t border-line p-2">
                  {pix.qrCodeBase64 && <img src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Pix" className="mx-auto h-32 w-32" />}
                  {pix.qrCode && (
                    <textarea readOnly value={pix.qrCode} rows={3}
                      className="mt-2 w-full rounded border border-line bg-bg/60 p-1 font-mono text-[9px]"
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
                  )}
                </div>
              )}
            </>
          )}
          {view === "discount" && (
            <DiscountFlow installmentId={installmentId} onDone={refresh} onBack={() => setView("menu")} />
          )}
          {view === "due" && (
            <AdjustDueFlow installmentId={installmentId} dueDate={dueDate} onDone={refresh} onBack={() => setView("menu")} />
          )}
        </div>
      )}
    </div>
  );
}

/** Fluxo de desconto: valor → escolhe admin → pede código → confirma com baixa. */
function DiscountFlow({ installmentId, onDone, onBack }: { installmentId: string; onDone: () => void; onBack: () => void }) {
  const [step, setStep] = useState<"value" | "code">("value");
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminId, setAdminId] = useState("");
  const [discount, setDiscount] = useState("");
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [adminName, setAdminName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/payments/auth-admins", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items) { setAdmins(d.items); const f = d.items.find((a: Admin) => a.hasWhatsapp); if (f) setAdminId(f.membershipId); } })
      .catch(() => {});
  }, []);

  function parseCents(v: string): number {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Math.round((isNaN(n) ? 0 : n) * 100);
  }

  async function requestCode() {
    setBusy(true); setErr(null);
    try {
      const cents = parseCents(discount);
      if (cents <= 0) { setErr("Informe o valor do desconto"); return; }
      if (!adminId) { setErr("Selecione o admin"); return; }
      const res = await fetch(`/api/payments/installments/${installmentId}/discount-auth`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ adminMembershipId: adminId, discountCents: cents }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha"); return; }
      setRequestId(d.requestId); setAdminName(d.adminName ?? ""); setStep("code");
    } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/payments/installments/${installmentId}/in-person`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ authRequestId: requestId, authCode: code }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Código inválido"); return; }
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="p-1">
      <button onClick={onBack} className="mb-2 text-[10px] text-muted hover:text-fg">‹ voltar</button>
      {step === "value" ? (
        <>
          <p className="text-xs font-medium">Desconto de juros</p>
          <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="Valor do desconto (R$)"
            className="mt-2 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-xs outline-none focus:border-brand" />
          <p className="mt-2 text-[10px] text-muted">Autorizado por:</p>
          <select value={adminId} onChange={(e) => setAdminId(e.target.value)}
            className="mt-1 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-xs outline-none focus:border-brand">
            <option value="">Selecione…</option>
            {admins.map((a) => (
              <option key={a.membershipId} value={a.membershipId} disabled={!a.hasWhatsapp}>
                {a.name} ({a.role}){a.hasWhatsapp ? "" : " — sem WhatsApp"}
              </option>
            ))}
          </select>
          {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}
          <button disabled={busy} onClick={requestCode} className="mt-2 w-full rounded bg-brand py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? "Enviando…" : "Enviar código ao admin"}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs font-medium">Código de {adminName}</p>
          <p className="text-[10px] text-muted">Enviado por WhatsApp. Digite os 4 dígitos.</p>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="0000" inputMode="numeric"
            className="mt-2 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-center font-mono text-sm tracking-widest outline-none focus:border-brand" />
          {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}
          <button disabled={busy || code.length !== 4} onClick={confirm} className="mt-2 w-full rounded bg-brand py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? "Confirmando…" : "Confirmar baixa com desconto"}
          </button>
        </>
      )}
    </div>
  );
}

/** Ajuste de vencimento: nova data + tolerância + motivo. */
function AdjustDueFlow({ installmentId, dueDate, onDone, onBack }: { installmentId: string; dueDate?: string; onDone: () => void; onBack: () => void }) {
  const [newDate, setNewDate] = useState(dueDate ? dueDate.slice(0, 10) : "");
  const [tolerance, setTolerance] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      if (!newDate) { setErr("Informe a nova data"); return; }
      if (!reason.trim()) { setErr("Informe o motivo"); return; }
      const res = await fetch(`/api/payments/installments/${installmentId}/adjust-due`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ newDueDate: newDate, toleranceDays: tolerance ? Number(tolerance) : undefined, reason }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha"); return; }
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="p-1">
      <button onClick={onBack} className="mb-2 text-[10px] text-muted hover:text-fg">‹ voltar</button>
      <p className="text-xs font-medium">Ajustar vencimento</p>
      <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
        className="mt-2 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-xs outline-none focus:border-brand" />
      <input value={tolerance} onChange={(e) => setTolerance(e.target.value.replace(/\D/g, ""))} placeholder="Tolerância (dias) — opcional" inputMode="numeric"
        className="mt-2 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-xs outline-none focus:border-brand" />
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" rows={2}
        className="mt-2 w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-xs outline-none focus:border-brand" />
      {err && <p className="mt-1 text-[10px] text-red-300">{err}</p>}
      <button disabled={busy} onClick={save} className="mt-2 w-full rounded bg-brand py-1.5 text-xs font-semibold text-white disabled:opacity-50">
        {busy ? "Salvando…" : "Salvar novo vencimento"}
      </button>
    </div>
  );
}
