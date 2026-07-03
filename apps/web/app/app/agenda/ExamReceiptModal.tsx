"use client";

import { useEffect, useState } from "react";

type Admin = { membershipId: string; name: string; role: string; hasWhatsapp: boolean };
type Line = { method: "cash" | "pix" | "card"; provider?: string; cardType?: "credit" | "debit"; amountStr: string };
type EpLine = { id: string; method: string; provider: string | null; status: string; amountCents: string; mpQrCode: string | null; mpQrBase64: string | null };

function brl(c: number) { return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function parseCents(v: string): number {
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Math.round((isNaN(n) ? 0 : n) * 100);
}

/**
 * Recebimento do exame no check-in. Split (dinheiro/pix/cartão), NUNCA crediário;
 * pix = maquininha ou MP (gera QR ao vivo); desconto só com código de admin.
 */
export function ExamReceiptModal({
  appointmentId, customerId, professionalId, patientName, examPriceCents, isAdmin = false,
  onDone, onClose,
}: {
  appointmentId: string;
  customerId?: string | null;
  professionalId?: string | null;
  patientName?: string;
  examPriceCents?: number | null;
  isAdmin?: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  // 1ª linha prefilada com o preço de exame da loja
  const initial = examPriceCents && examPriceCents > 0 ? (examPriceCents / 100).toFixed(2).replace(".", ",") : "";
  const [lines, setLines] = useState<Line[]>([{ method: "cash", amountStr: initial }]);
  const [discountStr, setDiscountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 2FA de desconto
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminId, setAdminId] = useState("");
  const [authReqId, setAuthReqId] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");

  // Pix MP: QR + autorefresh
  const [pix, setPix] = useState<{ examPaymentId: string; lines: EpLine[] } | null>(null);
  const [pixPaid, setPixPaid] = useState(false);

  const total = lines.reduce((s, l) => s + parseCents(l.amountStr), 0);
  const discountCents = parseCents(discountStr);

  useEffect(() => {
    fetch("/api/exams/auth-admins", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items) { setAdmins(d.items); const f = d.items.find((a: Admin) => a.hasWhatsapp); if (f) setAdminId(f.membershipId); } })
      .catch(() => {});
  }, []);

  // autorefresh do Pix MP
  useEffect(() => {
    if (!pix || pixPaid) return;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/exams/payments/${pix.examPaymentId}/check`, { method: "POST", credentials: "include", headers: { "x-no-loading": "1" } });
        const d = await r.json().catch(() => null);
        if (d?.status === "paid") { setPixPaid(true); onDone(); }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, [pix, pixPaid, onDone]);

  function setLine(i: number, patch: Partial<Line>) { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  function addLine() { setLines((ls) => [...ls, { method: "cash", amountStr: "" }]); }
  function rmLine(i: number) { setLines((ls) => ls.filter((_, idx) => idx !== i)); }

  async function requestCode() {
    setBusy(true); setErr(null);
    try {
      if (discountCents <= 0) { setErr("Informe o valor do desconto"); return; }
      if (!adminId) { setErr("Selecione o admin"); return; }
      const res = await fetch("/api/exams/discount-auth", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ adminMembershipId: adminId, discountCents }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha"); return; }
      setAuthReqId(d.requestId);
    } finally { setBusy(false); }
  }

  async function confirm() {
    setBusy(true); setErr(null);
    try {
      if (total <= 0) { setErr("Informe ao menos um pagamento"); return; }
      if (discountCents > 0 && !isAdmin && (!authReqId || authCode.length !== 4)) { setErr("Desconto precisa do código do admin (4 dígitos)"); return; }
      const res = await fetch("/api/exams/payments", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          appointmentId, customerId: customerId ?? undefined, professionalId: professionalId ?? undefined,
          lines: lines.map((l) => ({ method: l.method, provider: l.provider, cardType: l.cardType, amountCents: parseCents(l.amountStr) })).filter((l) => l.amountCents > 0),
          discountCents: discountCents > 0 ? discountCents : undefined,
          authRequestId: authReqId ?? undefined, authCode: authCode || undefined,
          markAttended: false,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao registrar"); return; }
      // se tem pix MP pendente → mostra QR e aguarda; senão conclui
      const mpLines: EpLine[] = (d.lines ?? []).filter((l: EpLine) => l.method === "pix" && l.provider === "mp" && l.status === "pending" && (l.mpQrBase64 || l.mpQrCode));
      if (d.status === "pending" && mpLines.length) {
        setPix({ examPaymentId: d.id, lines: mpLines });
      } else {
        onDone();
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {pix ? (
          <>
            <h3 className="text-base font-semibold">Pix Mercado Pago</h3>
            {pixPaid ? (
              <p className="mt-2 rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-300">✅ Pagamento confirmado!</p>
            ) : (
              <p className="mt-1 flex items-center justify-center gap-2 text-sm text-muted">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" /> Aguardando pagamento… (confirma automático)
              </p>
            )}
            {pix.lines.map((l) => (
              <div key={l.id} className="mt-3 text-center">
                {l.mpQrBase64 ? (
                  <img src={`data:image/png;base64,${l.mpQrBase64}`} alt="QR Pix" className="mx-auto h-52 w-52 rounded-lg bg-white p-2" />
                ) : null}
                {l.mpQrCode && (
                  <button onClick={() => navigator.clipboard?.writeText(l.mpQrCode!)} className="mt-2 w-full break-all rounded-lg border border-line bg-bg/60 px-3 py-2 text-[11px] text-muted hover:border-brand">
                    {l.mpQrCode}
                  </button>
                )}
              </div>
            ))}
            <button onClick={onClose} className="mt-4 w-full rounded-lg border border-line py-2 text-sm text-muted hover:text-fg">fechar</button>
          </>
        ) : (
          <>
            <h3 className="text-base font-semibold">Recebimento do exame</h3>
            {patientName && <p className="text-xs text-muted">{patientName}</p>}

            <div className="mt-3 space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="rounded-lg border border-line bg-bg/40 p-2">
                  <div className="flex items-center gap-2">
                    <select value={l.method} onChange={(e) => setLine(i, { method: e.target.value as Line["method"], provider: undefined, cardType: undefined })}
                      className="rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs">
                      <option value="cash">Dinheiro</option>
                      <option value="pix">Pix</option>
                      <option value="card">Cartão</option>
                    </select>
                    <input inputMode="decimal" placeholder="0,00" value={l.amountStr}
                      onChange={(e) => setLine(i, { amountStr: e.target.value })}
                      className="flex-1 rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs" />
                    {lines.length > 1 && <button onClick={() => rmLine(i)} className="text-xs text-red-300">×</button>}
                  </div>
                  {l.method === "pix" && (
                    <select value={l.provider ?? "maquininha"} onChange={(e) => setLine(i, { provider: e.target.value })}
                      className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs">
                      <option value="maquininha">Pix maquininha</option>
                      <option value="mp">Pix Mercado Pago (gera QR)</option>
                    </select>
                  )}
                  {l.method === "card" && (
                    <select value={l.cardType ?? "credit"} onChange={(e) => setLine(i, { cardType: e.target.value as "credit" | "debit" })}
                      className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs">
                      <option value="credit">Crédito</option>
                      <option value="debit">Débito</option>
                    </select>
                  )}
                </div>
              ))}
              <button onClick={addLine} className="text-xs text-brand hover:underline">+ adicionar pagamento</button>
            </div>

            <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3">
              <p className="text-xs font-medium">Desconto {isAdmin ? "(admin — direto)" : "(precisa de admin)"}</p>
              <input value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} placeholder="Valor do desconto (R$) — opcional"
                className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs" />
              {discountCents > 0 && !isAdmin && !authReqId && (
                <>
                  <select value={adminId} onChange={(e) => setAdminId(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-xs">
                    <option value="">Autorizado por…</option>
                    {admins.map((a) => <option key={a.membershipId} value={a.membershipId} disabled={!a.hasWhatsapp}>{a.name} ({a.role}){a.hasWhatsapp ? "" : " — sem WhatsApp"}</option>)}
                  </select>
                  <button disabled={busy} onClick={requestCode} className="mt-2 w-full rounded-lg bg-brand py-1.5 text-xs font-semibold text-white disabled:opacity-50">Enviar código ao admin</button>
                </>
              )}
              {discountCents > 0 && !isAdmin && authReqId && (
                <input value={authCode} onChange={(e) => setAuthCode(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Código de 4 dígitos" inputMode="numeric"
                  className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-center font-mono text-sm tracking-widest" />
              )}
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted">Total recebido</span>
              <span className="font-semibold">{brl(total)}{discountCents > 0 ? <span className="ml-2 text-xs text-green-300">(desc. {brl(discountCents)})</span> : null}</span>
            </div>

            {err && <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}

            <div className="mt-4 flex gap-2">
              <button disabled={busy || total <= 0} onClick={confirm} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Registrando…" : "Registrar recebimento"}
              </button>
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
            </div>
            <p className="mt-2 text-[10px] text-muted">Crediário não é aceito em exames. Vai pro caixa de Exames (separado das vendas).</p>
          </>
        )}
      </div>
    </div>
  );
}
