"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

function brl(c: number | string): string { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function toCents(s: string): number { const n = Number(String(s).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : Math.round(n * 100); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function addMonths(iso: string, n: number) { const d = new Date(iso + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
function fileToDataUrl(f: File): Promise<string> { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); }); }

const STATUS_TABS = [
  { k: "a_pagar", label: "A pagar" },
  { k: "a_vencer", label: "A vencer" },
  { k: "vencido", label: "Vencido" },
  { k: "pago", label: "Pago" },
] as const;

export function ContasClient() {
  const dialog = useDialog();
  const [tab, setTab] = useState<string>("a_pagar");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payFor, setPayFor] = useState<any | null>(null);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [sum, setSum] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/payables?status=${tab}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {}).finally(() => setLoading(false));
    fetch(`/api/payables/summary`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then(setSum).catch(() => {});
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const total = items.reduce((s, it) => s + Number(it.amountCents), 0);

  async function importDanfe(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.currentTarget.value = ""; if (!f) return;
    const xml = await f.text();
    const res = await fetch("/api/payables/import-nfe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ xml }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao importar XML", "error"); return; }
    dialog.toast(`DANFE importada: ${d?.installments?.length ?? 0} parcela(s) ✅`, "success"); load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`rounded-full px-4 py-1.5 text-sm ${tab === t.k ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{t.label}</button>
        ))}
        <a href={`/api/payables/report.pdf?status=${tab}`} target="_blank" rel="noreferrer" className="ml-auto rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium transition hover:border-brand">PDF</a>
        <a href={`/api/payables/export?status=${tab}`} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium transition hover:border-brand">CSV</a>
        <button onClick={() => setRecipientsOpen(true)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium transition hover:border-brand">Avisos</button>
        <label className="cursor-pointer rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium transition hover:border-brand">Importar DANFE (XML)<input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={importDanfe} /></label>
        <button onClick={() => setCreating(true)} className="btn-grad px-4 py-2">+ Nova conta</button>
      </div>

      {sum && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Card label="A vencer" value={brl(sum.aVencer.cents)} hint={`${sum.aVencer.count} parcela(s)`} tone="amber" />
          <Card label="Vencido" value={brl(sum.vencido.cents)} hint={`${sum.vencido.count} parcela(s)`} tone="red" />
          <Card label="Total a pagar" value={brl(sum.aPagarTotal.cents)} hint={`${sum.aPagarTotal.count} em aberto`} />
          <Card label="Pago no mês" value={brl(sum.pagoPeriodo.cents)} hint={`${sum.pagoPeriodo.count} baixa(s)`} tone="green" />
        </div>
      )}

      <div className="card p-4 text-sm">
        <span className="text-muted">{loading ? "Carregando…" : `${items.length} parcela(s)`}</span>
        <span className="ml-3 font-semibold">Total ({STATUS_TABS.find((t) => t.k === tab)?.label}): {brl(total)}</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted">
            <th className="px-4 py-3">Fornecedor / descrição</th><th className="px-4 py-3">Parcela</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Nada aqui.</td></tr> : items.map((it) => (
              <tr key={it.id} className="border-t border-line/50">
                <td className="px-4 py-3"><div className="font-medium">{it.payable?.supplier || it.payable?.description || "—"}</div>{it.payable?.description && it.payable?.supplier ? <div className="text-xs text-muted">{it.payable.description}</div> : null}{it.payable?.category ? <div className="text-[10px] uppercase text-muted">{it.payable.category}</div> : null}</td>
                <td className="px-4 py-3 text-xs">{it.number}</td>
                <td className={`px-4 py-3 ${it.overdue ? "font-semibold text-red-300" : ""}`}>{new Date(it.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td>
                <td className="px-4 py-3">{brl(it.amountCents)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${it.status === "pago" ? "bg-green-500/20 text-green-300" : it.overdue ? "bg-red-500/20 text-red-300" : "bg-amber-500/15 text-amber-200"}`}>
                    {it.status === "pago" ? "pago" : it.overdue ? "vencido" : "a pagar"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {it.proofUrl && <a href={`/api/payables/attachments`} className="hidden" />}
                  {it.status !== "pago" && it.status !== "cancelado" && <button onClick={() => setPayFor(it)} className="rounded-md border border-line px-2 py-1 text-xs text-green-300 hover:border-green-400">Dar baixa</button>}
                  {it.status === "pago" && <span className="text-xs text-muted">{it.paidAt ? new Date(it.paidAt).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : ""}{it.paymentMethod ? ` · ${it.paymentMethod}` : ""}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <NewPayable onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} dialog={dialog} />}
      {payFor && <PayModal inst={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); load(); }} dialog={dialog} />}
      {recipientsOpen && <Recipients onClose={() => setRecipientsOpen(false)} dialog={dialog} />}
    </div>
  );
}

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "amber" | "red" }) {
  const cls = tone === "green" ? "text-success" : tone === "amber" ? "text-warn" : tone === "red" ? "text-danger" : "text-fg";
  return <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-muted">{label}</p><p className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</p>{hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}</div>;
}

function Recipients({ onClose, dialog }: { onClose: () => void; dialog: any }) {
  const [list, setList] = useState<any[]>([]);
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [whatsapp, setWhatsapp] = useState("");
  const load = () => fetch("/api/payables/recipients", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setList(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function add() {
    if (name.trim().length < 2) { dialog.toast("Informe o nome", "error"); return; }
    if (!email.trim() && !whatsapp.trim()) { dialog.toast("Informe e-mail ou WhatsApp", "error"); return; }
    const res = await fetch("/api/payables/recipients", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim(), email: email.trim() || null, whatsapp: whatsapp.trim() || null }) });
    if (!res.ok) { dialog.toast("Falha ao salvar", "error"); return; }
    setName(""); setEmail(""); setWhatsapp(""); load();
  }
  async function remove(id: string) { await fetch(`/api/payables/recipients/${id}`, { method: "DELETE", credentials: "include" }); load(); }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Quem é avisado das contas</h3>
        <p className="mt-1 text-xs text-muted">Recebem por WhatsApp/e-mail um resumo diário das contas a vencer (próx. 3 dias) e vencidas.</p>
        <div className="mt-3 space-y-1.5">
          {list.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-sm">
              <div><b>{r.name}</b><div className="text-xs text-muted">{[r.whatsapp, r.email].filter(Boolean).join(" · ") || "sem contato"}</div></div>
              <button onClick={() => remove(r.id)} className="text-xs text-red-300 hover:underline">remover</button>
            </div>
          ))}
          {list.length === 0 && <p className="text-xs text-muted">Ninguém ainda. Adicione o dono e quem mais precisar.</p>}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" className="input-base" />
          <div className="grid grid-cols-2 gap-2">
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp" className="input-base" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className="input-base" />
          </div>
          <button onClick={add} className="btn-grad py-2">+ Adicionar destinatário</button>
        </div>
        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-line py-2 text-sm text-muted hover:text-fg">fechar</button>
      </div>
    </div>
  );
}

function NewPayable({ onClose, onSaved, dialog }: { onClose: () => void; onSaved: () => void; dialog: any }) {
  const [supplier, setSupplier] = useState(""); const [description, setDescription] = useState(""); const [category, setCategory] = useState("");
  const [docNumber, setDocNumber] = useState(""); const [issueDate, setIssueDate] = useState(todayISO());
  const [rows, setRows] = useState<Array<{ dueDate: string; value: string; barcode: string }>>([{ dueDate: todayISO(), value: "", barcode: "" }]);
  const [recurring, setRecurring] = useState(false); const [recDay, setRecDay] = useState("5"); const [recValue, setRecValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);

  async function ocrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.currentTarget.value = ""; if (!f) return;
    setOcrBusy(true);
    try {
      const data = await fileToDataUrl(f);
      const res = await fetch("/api/payables/ocr", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ data }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao ler com IA", "error"); return; }
      if (!d?.available) { dialog.toast(d?.message ?? "Sua empresa não tem IA com visão configurada (Configurações → IA).", "error"); return; }
      const p = d.parsed; if (!p) { dialog.toast("A IA não conseguiu extrair os dados — preencha manualmente.", "error"); return; }
      if (p.supplier) setSupplier(p.supplier);
      if (p.description) setDescription(p.description);
      if (p.category) setCategory(p.category);
      if (p.docNumber) setDocNumber(p.docNumber);
      if (p.dueDate || p.amountCents || p.barcode) {
        setRecurring(false);
        setRows([{ dueDate: p.dueDate || todayISO(), value: p.amountCents ? (p.amountCents / 100).toFixed(2).replace(".", ",") : "", barcode: p.barcode || "" }]);
      }
      dialog.toast("Dados extraídos pela IA ✅ — confira antes de salvar.", "success");
    } finally { setOcrBusy(false); }
  }

  function parcelar() {
    const totalStr = prompt("Valor TOTAL (R$):"); if (totalStr == null) return;
    const nStr = prompt("Em quantas parcelas?", "1"); if (nStr == null) return;
    const total = toCents(totalStr); const n = Math.max(1, parseInt(nStr || "1", 10) || 1);
    if (total <= 0) return;
    const base = Math.floor(total / n); const rest = total - base * n;
    const out = Array.from({ length: n }, (_, i) => ({ dueDate: addMonths(issueDate, i), value: ((i === 0 ? base + rest : base) / 100).toFixed(2).replace(".", ","), barcode: "" }));
    setRows(out);
  }
  const total = rows.reduce((s, r) => s + toCents(r.value), 0);

  async function lerBoleto(i: number) {
    const code = rows[i]?.barcode?.trim(); if (!code) { dialog.toast("Cole a linha digitável do boleto primeiro", "error"); return; }
    const res = await fetch("/api/payables/parse-boleto", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ code }) });
    const d = await res.json().catch(() => null);
    if (!res.ok || (!d?.dueDate && !d?.amountCents)) { dialog.toast("Não consegui ler o boleto (confira o código)", "error"); return; }
    setRows((a) => a.map((x, idx) => idx === i ? { ...x, dueDate: d.dueDate || x.dueDate, value: d.amountCents ? (d.amountCents / 100).toFixed(2).replace(".", ",") : x.value } : x));
    dialog.toast("Boleto lido ✅", "success");
  }

  async function save() {
    const body: any = { supplier: supplier.trim() || null, description: description.trim() || null, category: category.trim() || null, docNumber: docNumber.trim() || null, issueDate };
    if (recurring) {
      if (toCents(recValue) <= 0) { dialog.toast("Informe o valor mensal da conta recorrente", "error"); return; }
      body.recurring = true; body.recurrenceDay = Math.min(28, Math.max(1, parseInt(recDay || "5", 10) || 5)); body.recurrenceAmountCents = toCents(recValue); body.installments = [];
    } else {
      const installments = rows.filter((r) => r.dueDate && toCents(r.value) > 0).map((r, i) => ({ number: i + 1, dueDate: r.dueDate, amountCents: toCents(r.value), barcode: r.barcode.trim() || null }));
      if (!installments.length) { dialog.toast("Adicione ao menos uma parcela com vencimento e valor", "error"); return; }
      body.installments = installments;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/payables", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha ao salvar", "error"); return; }
      dialog.toast("Conta lançada ✅", "success"); onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Nova conta a pagar</h3>
          <label className={`cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand ${ocrBusy ? "opacity-50" : ""}`}>{ocrBusy ? "Lendo…" : "📷 Ler boleto/NF com IA"}<input type="file" accept="image/*,application/pdf" className="hidden" disabled={ocrBusy} onChange={ocrFile} /></label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Fornecedor" v={supplier} on={setSupplier} />
          <Field label="Categoria" v={category} on={setCategory} placeholder="aluguel, energia, fornecedor…" />
          <Field label="Descrição" v={description} on={setDescription} />
          <Field label="Nº do documento / NF" v={docNumber} on={setDocNumber} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Emissão</span><input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="input-base" /></label>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-4 w-4 accent-brand" />
          <span>Conta recorrente (mensal fixa — ex.: aluguel, internet). Gera a parcela do mês automaticamente.</span>
        </label>
        {recurring ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Dia do vencimento (1–28)</span><input value={recDay} onChange={(e) => setRecDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="5" className="input-base" /></label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Valor mensal</span><input value={recValue} onChange={(e) => setRecValue(e.target.value)} inputMode="decimal" placeholder="R$ valor" className="input-base" /></label>
            <p className="text-xs text-muted sm:col-span-2">A primeira parcela é criada agora para o mês corrente; nos meses seguintes o sistema gera automaticamente no dia configurado.</p>
          </div>
        ) : (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold uppercase text-muted">Parcelas</span>
              <div className="flex gap-2 text-xs"><button onClick={parcelar} className="text-brand hover:underline">parcelar valor total</button><button onClick={() => setRows((a) => [...a, { dueDate: addMonths(a[a.length - 1]?.dueDate ?? todayISO(), 1), value: "", barcode: "" }])} className="text-brand hover:underline">+ parcela</button></div>
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex flex-wrap gap-2">
                  <input type="date" value={r.dueDate} onChange={(e) => setRows((a) => a.map((x, idx) => idx === i ? { ...x, dueDate: e.target.value } : x))} className="input-base w-auto px-2" />
                  <input value={r.value} onChange={(e) => setRows((a) => a.map((x, idx) => idx === i ? { ...x, value: e.target.value } : x))} inputMode="decimal" placeholder="R$ valor" className="input-base w-28 px-2" />
                  <input value={r.barcode} onChange={(e) => setRows((a) => a.map((x, idx) => idx === i ? { ...x, barcode: e.target.value } : x))} placeholder="linha digitável do boleto (opcional)" className="input-base flex-1 px-2" />
                  <button onClick={() => lerBoleto(i)} title="Ler vencimento e valor do boleto" className="rounded-xl border border-line px-2 py-2 text-xs transition hover:border-brand">ler</button>
                  {rows.length > 1 && <button onClick={() => setRows((a) => a.filter((_, idx) => idx !== i))} className="text-muted hover:text-red-300">×</button>}
                </div>
              ))}
            </div>
            <p className="mt-2 text-sm">Total: <b>{brl(total)}</b></p>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1 py-2">{busy ? "Salvando…" : "Lançar conta"}</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function PayModal({ inst, onClose, onSaved, dialog }: { inst: any; onClose: () => void; onSaved: () => void; dialog: any }) {
  const [paid, setPaid] = useState((Number(inst.amountCents) / 100).toFixed(2).replace(".", ","));
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState("pix");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<{ data: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; setProof({ data: await fileToDataUrl(f), name: f.name }); }
  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/payables/installments/${inst.id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ paidCents: toCents(paid), paidAt: date, paymentMethod: method, notes: notes.trim() || undefined, proof: proof?.data, proofName: proof?.name }) });
      if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha ao dar baixa", "error"); return; }
      dialog.toast("Baixa registrada ✅", "success"); onSaved();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Dar baixa</h3>
        <p className="mt-1 text-xs text-muted">{inst.payable?.supplier || inst.payable?.description} · parcela {inst.number} · vence {new Date(inst.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</p>
        <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase text-muted">Valor pago (R$)</span><input value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" className="input-base" /></label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Data</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Meio</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-base">
              <option value="pix">Pix</option><option value="boleto">Boleto</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="dinheiro">Dinheiro</option>
            </select></label>
        </div>
        <label className="mt-2 block"><span className="mb-1 block text-[10px] uppercase text-muted">Observação</span><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base" /></label>
        <label className="mt-2 block cursor-pointer rounded-xl border border-dashed border-line px-3 py-3 text-center text-xs transition hover:border-brand">{proof ? `📎 ${proof.name}` : "Anexar comprovante (imagem/PDF)"}<input type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} /></label>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="btn-grad flex-1 py-2">{busy ? "…" : "Confirmar baixa"}</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, on, placeholder }: { label: string; v: string; on: (v: string) => void; placeholder?: string }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">{label}</span><input value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="input-base" /></label>;
}
