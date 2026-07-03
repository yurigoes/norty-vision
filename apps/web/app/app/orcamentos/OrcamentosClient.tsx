"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

interface QItem { description: string; qty: number; unitPriceCents: number }
interface Quote {
  id: string; shortCode: string | null; contactName: string; contactPhone: string | null; contactEmail: string | null;
  status: string; totalCents: string | number; discountCents: number; validUntil: string | null; createdAt: string;
  createdByUserId: string | null;
  items: Array<{ id: string; description: string; qty: number; unitPriceCents: string | number; lineTotalCents: string | number }>;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-line text-muted" },
  sent: { label: "Enviado", cls: "bg-sky-500/15 text-sky-300" },
  accepted: { label: "Aceito", cls: "bg-green-500/15 text-green-300" },
  rejected: { label: "Recusado", cls: "bg-red-500/15 text-red-300" },
  converted: { label: "Virou pedido", cls: "bg-brand/15 text-brand" },
  expired: { label: "Expirado", cls: "bg-amber-500/15 text-amber-300" },
};
function brl(c: number | string): string { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function toCents(s: string): number { const n = Number(String(s).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : Math.round(n * 100); }

export function OrcamentosClient({ initial }: { initial: Quote[] }) {
  const router = useRouter();
  const dialog = useDialog();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  async function send(q: Quote, channel: "whatsapp" | "email" | "both") {
    const res = await fetch(`/api/quotes/${q.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ channel }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao enviar", "error"); return; }
    dialog.toast("Orçamento enviado ✅", "success");
    startTransition(() => router.refresh());
  }
  async function setStatus(q: Quote, status: string) {
    await fetch(`/api/quotes/${q.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    startTransition(() => router.refresh());
  }
  async function remove(q: Quote) {
    if (!(await dialog.confirm({ title: "Excluir orçamento", message: `Excluir o orçamento ${q.shortCode ?? ""}?`, tone: "danger" }))) return;
    await fetch(`/api/quotes/${q.id}`, { method: "DELETE", credentials: "include" });
    startTransition(() => router.refresh());
  }
  async function convert(q: Quote) {
    if (!(await dialog.confirm({ title: "Converter em pedido", message: `Gerar um pedido de produção a partir do orçamento ${q.shortCode ?? ""}? A entrada/sinal segue a política da gráfica.` }))) return;
    const res = await fetch(`/api/quotes/${q.id}/convert`, { method: "POST", credentials: "include" });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao converter", "error"); return; }
    dialog.toast(`Pedido ${d?.order?.shortCode ?? ""} criado ✅`, "success");
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={() => setOpen(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90">+ Novo orçamento</button>
      </div>

      {initial.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-muted">Nenhum orçamento ainda. Crie o primeiro!</p>
      ) : (
        <div className="space-y-2">
          {initial.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg/60 p-4">
              <div className="min-w-0">
                <p className="font-medium">{q.contactName} <span className="ml-1 text-xs text-muted">{q.shortCode}</span>{!q.createdByUserId && <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-brand">via IA</span>}</p>
                <p className="text-xs text-muted">{new Date(q.createdAt).toLocaleDateString("pt-BR")} · {q.items.length} item(ns) · <b>{brl(q.totalCents)}</b></p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS[q.status]?.cls ?? "bg-line text-muted"}`}>{STATUS[q.status]?.label ?? q.status}</span>
                <a href={`/api/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-md border border-line px-2 py-1 hover:border-brand">PDF</a>
                {q.contactPhone && <button onClick={() => send(q, "whatsapp")} className="rounded-md border border-line px-2 py-1 hover:border-brand">WhatsApp</button>}
                {q.contactEmail && <button onClick={() => send(q, "email")} className="rounded-md border border-line px-2 py-1 hover:border-brand">E-mail</button>}
                {q.status !== "accepted" && q.status !== "converted" && <button onClick={() => setStatus(q, "accepted")} className="rounded-md border border-line px-2 py-1 text-green-300 hover:border-green-400">aceito</button>}
                {q.status !== "converted" && <button onClick={() => convert(q)} className="rounded-md border border-line px-2 py-1 text-brand hover:border-brand">→ pedido</button>}
                <button onClick={() => remove(q)} className="rounded-md border border-line px-2 py-1 text-red-300 hover:border-red-400">excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <NewQuote onClose={() => setOpen(false)} onSaved={() => { setOpen(false); startTransition(() => router.refresh()); }} />}
    </div>
  );
}

function NewQuote({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Array<{ description: string; qty: string; price: string }>>([{ description: "", qty: "1", price: "" }]);
  const [busy, setBusy] = useState(false);

  const subtotal = items.reduce((s, it) => s + toCents(it.price) * (Number(it.qty) || 0), 0);
  const total = Math.max(0, subtotal - toCents(discount));

  function setItem(i: number, patch: Partial<{ description: string; qty: string; price: string }>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function save() {
    if (name.trim().length < 2) { dialog.toast("Informe o nome do cliente", "error"); return; }
    const its = items.filter((it) => it.description.trim()).map((it) => ({ description: it.description.trim(), qty: Math.max(1, Number(it.qty) || 1), unitPriceCents: toCents(it.price) }));
    if (its.length === 0) { dialog.toast("Adicione ao menos um item", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ contactName: name.trim(), contactPhone: phone.trim() || null, contactEmail: email.trim() || null, validUntil: validUntil || null, discountCents: toCents(discount), notes: notes.trim() || null, items: its }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao salvar", "error"); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Novo orçamento</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Cliente</span><input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">WhatsApp</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(71) 99999-9999" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">E-mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-muted">Itens</span>
            <button onClick={() => setItems((a) => [...a, { description: "", qty: "1", price: "" }])} className="text-xs text-brand hover:underline">+ item</button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Ex.: Conjunto sublimado (camisa + short) — tecido dryfit" className="flex-1 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
                <input value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} type="number" min={1} className="w-16 rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" />
                <input value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} inputMode="decimal" placeholder="R$ unit." className="w-28 rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" />
                {items.length > 1 && <button onClick={() => setItems((a) => a.filter((_, idx) => idx !== i))} className="text-muted hover:text-red-300">✕</button>}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Desconto (R$)</span><input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Válido até</span><input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
          <div className="flex items-end justify-end"><span className="text-sm">Total: <b className="text-lg">{brl(total)}</b></span></div>
        </div>
        <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase text-muted">Observações</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>

        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar orçamento"}</button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}
