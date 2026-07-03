"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "../../../components/SystemDialog";

/** Preço unitário (centavos) da faixa correspondente à quantidade. */
function priceForQty(tiers: Array<{ minQty: number; priceCents: number }>, qty: number): number {
  const sorted = [...(tiers ?? [])].filter((t) => t && t.minQty > 0).sort((a, b) => a.minQty - b.minQty);
  if (!sorted.length) return 0;
  let chosen = sorted[0]!.priceCents;
  for (const t of sorted) if (qty >= t.minQty) chosen = t.priceCents;
  return chosen;
}

// Ordem CANÔNICA — inclui estágios opcionais (estampa/embalagem). O componente
// busca em /api/production/stages quais estão ativos pra ESTA org e filtra.
// Sem chamada (ou falha do fetch), cai no FLOW padrão sem estampa/embalagem.
const FLOW_FULL = ["novo", "arte", "producao", "estampa", "costura", "separacao", "pronto", "embalagem", "entrega", "finalizado"];
const FLOW_DEFAULT = ["novo", "arte", "producao", "costura", "separacao", "pronto", "entrega", "finalizado"];
const FLOW = FLOW_DEFAULT; // mantido pra compat de código antigo que importava FLOW (substituído pelo useStages no kanban)
const STATUS_LABEL: Record<string, string> = { novo: "Pedido", arte: "Arte", producao: "Produção", estampa: "Estampa", costura: "Costura", separacao: "Separação", pronto: "Pronto", embalagem: "Embalagem", entrega: "Entrega", finalizado: "Finalizado", cancelado: "Cancelado", cancelamento_solicitado: "Cancelamento solicitado" };
const ART_LABEL: Record<string, string> = { aguardando_arquivos: "Aguardando arquivos", arquivos_recebidos: "Arquivos recebidos", em_producao: "Arte em produção", enviada: "Enviada ao cliente", aprovada: "Aprovada", reprovada: "Reprovada" };
const URG: Record<string, string> = { ok: "border-line", soon: "border-amber-500/60", urgent: "border-red-500/70" };

function brl(c: number | string): string { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function toCents(s: string): number { const n = Number(String(s).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? 0 : Math.round(n * 100); }

/** Hook compartilhado: estágios ativos do kanban pra ESTA org (com fallback
 *  pro fluxo padrão sem estampa/embalagem se a chamada falhar). */
function useActiveStages(): string[] {
  const [stages, setStages] = useState<string[]>(FLOW_DEFAULT);
  useEffect(() => {
    fetch("/api/production/stages", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.stages?.length) setStages(d.stages); })
      .catch(() => {});
  }, []);
  return stages;
}

export function ProducaoClient({ initial, features }: { initial: any[]; features?: Record<string, boolean> }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<"lista" | "kanban" | "lotes" | "nf" | "cancel" | "tabelas">("lista");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = () => startTransition(() => router.refresh());
  // Sub-módulos da Produção (Fase 2): default-on — só esconde o que o master
  // marcou como false. "Pedidos" (lista) é core, sempre visível.
  const subOn = (k: string) => (features ? features[k] !== false : true);
  const tabCls = (active: boolean) => `-mb-px border-b-2 px-4 py-2 text-sm font-medium ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <nav className="flex gap-1 border-b border-line">
          <button onClick={() => setTab("lista")} className={tabCls(tab === "lista")}>Pedidos</button>
          {subOn("kanban") && <button onClick={() => setTab("kanban")} className={tabCls(tab === "kanban")}>Design (Kanban)</button>}
          {subOn("lotes") && <button onClick={() => setTab("lotes")} className={tabCls(tab === "lotes")}>Lotes</button>}
          {subOn("nf") && <button onClick={() => setTab("nf")} className={tabCls(tab === "nf")}>Notas fiscais</button>}
          {subOn("cancel") && <button onClick={() => setTab("cancel")} className={tabCls(tab === "cancel")}>Cancelamentos</button>}
          {subOn("tabelas") && <button onClick={() => setTab("tabelas")} className={tabCls(tab === "tabelas")}>Tabelas</button>}
        </nav>
        <div className="flex items-center gap-2">
          <KioskLinkButton kind="recepcao" />
          <KioskLinkButton kind="producao" />
          <button onClick={() => setCreating(true)} className="btn-grad">+ Novo pedido</button>
        </div>
      </div>

      {tab === "lista" ? (
        <OrderList orders={initial} onOpen={setOpenId} />
      ) : tab === "kanban" ? (
        <Kanban onOpen={setOpenId} />
      ) : tab === "lotes" ? (
        <LotesTab orders={initial} onOpen={setOpenId} />
      ) : tab === "nf" ? (
        <NfTab onOpen={setOpenId} />
      ) : tab === "cancel" ? (
        <CancelamentosTab onOpen={setOpenId} onChanged={refresh} />
      ) : (
        <TabelasTab />
      )}

      {creating && <NewOrder onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      {openId && <Detail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </div>
  );
}

/** Lista de pedidos separada em "Pendentes" (em produção) e "Finalizados/
 *  cancelados" recolhível. Evita poluir a visão da recepção que só quer ver
 *  o que está em andamento. */
function OrderList({ orders, onOpen }: { orders: any[]; onOpen: (id: string) => void }) {
  const [showDone, setShowDone] = useState(false);
  if (!orders.length) {
    return <p className="rounded-2xl border border-line bg-surface p-8 text-center text-muted">Nenhum pedido ainda.</p>;
  }
  const isDone = (o: any) => o.status === "finalizado" || o.status === "cancelado";
  const pending = orders.filter((o) => !isDone(o));
  const done = orders.filter((o) => isDone(o));

  const renderCard = (o: any) => (
    <button key={o.id} onClick={() => onOpen(o.id)} className="card flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left">
      <div>
        <p className="font-medium">{o.contactName} <span className="ml-1 text-xs text-muted">{o.shortCode}</span></p>
        <p className="text-xs text-muted">{o.items?.length ?? 0} item(ns) · {brl(o.totalCents)}{o.dueDate ? ` · prazo ${new Date(o.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}</p>
      </div>
      <div className="flex items-center gap-2 text-[10px]">
        <span className={`rounded-full px-2 py-0.5 font-semibold uppercase ${o.status === "finalizado" ? "bg-green-500/15 text-green-300" : o.status === "cancelado" ? "bg-red-500/15 text-red-300" : "bg-brand/15 text-brand"}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
        <span className="rounded-full bg-line px-2 py-0.5 font-semibold uppercase text-muted">arte: {ART_LABEL[o.artStatus] ?? o.artStatus}</span>
      </div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Em produção ({pending.length})</p>
        {pending.length === 0
          ? <p className="rounded-xl border border-line bg-surface-2 p-4 text-center text-xs text-muted">Nenhum pedido pendente.</p>
          : <div className="space-y-2">{pending.map(renderCard)}</div>}
      </div>

      {done.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2">
          <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted hover:bg-line/30">
            <span>{showDone ? "▾" : "▸"} Finalizados / cancelados ({done.length})</span>
            <span className="text-[10px] normal-case text-muted/70">{showDone ? "ocultar" : "mostrar"}</span>
          </button>
          {showDone && (
            <div className="space-y-2 border-t border-line p-3">{done.map(renderCard)}</div>
          )}
        </div>
      )}
    </div>
  );
}

function Kanban({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<{ columns: string[]; byColumn: Record<string, any[]> } | null>(null);
  const [view, setView] = useState<"kanban" | "calendario">("kanban");
  useEffect(() => { fetch("/api/production/kanban", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}); }, []);
  if (!data) return <p className="text-sm text-muted">Carregando…</p>;
  const allCards = data.columns.flatMap((c) => data.byColumn[c] ?? []);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setView("kanban")} className={`rounded-full px-3 py-1 text-xs ${view === "kanban" ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>Kanban</button>
        <button onClick={() => setView("calendario")} className={`rounded-full px-3 py-1 text-xs ${view === "calendario" ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>Calendário</button>
        <span className="ml-2 flex items-center gap-3 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-red-500" /> urgente (≤1d)</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-amber-500" /> próximo (≤3d)</span>
        </span>
      </div>
      {view === "kanban" ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {data.columns.map((col) => (
            <div key={col} className="rounded-xl border border-line bg-surface-2 p-2">
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{ART_LABEL[col] ?? col} <span className="text-muted/60">({data.byColumn[col]?.length ?? 0})</span></p>
              <div className="space-y-2">
                {(data.byColumn[col] ?? []).map((c) => (
                  <button key={c.id} onClick={() => onOpen(c.id)} className={`block w-full rounded-lg border-l-4 bg-bg/70 p-2 text-left text-xs ${URG[c.urgency] ?? "border-line"}`}>
                    <p className="font-medium">{c.contactName}</p>
                    <p className="text-[10px] text-muted">{c.shortCode} · {STATUS_LABEL[c.status] ?? c.status}</p>
                    {c.daysLeft != null && <p className={`text-[10px] font-semibold ${c.urgency === "urgent" ? "text-red-300" : c.urgency === "soon" ? "text-amber-300" : "text-muted"}`}>{c.daysLeft < 0 ? `atrasado ${-c.daysLeft}d` : c.daysLeft === 0 ? "vence hoje" : `faltam ${c.daysLeft}d`}</p>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DesignCalendar cards={allCards} onOpen={onOpen} />
      )}
    </div>
  );
}

function DesignCalendar({ cards, onOpen }: { cards: any[]; onOpen: (id: string) => void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const byDay: Record<string, any[]> = {};
  const noDate: any[] = [];
  for (const c of cards) {
    if (!c.dueDate) { noDate.push(c); continue; }
    const key = String(c.dueDate).slice(0, 10);
    (byDay[key] ??= []).push(c);
  }
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay(); // 0=dom
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);
  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) { const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`; cells.push({ day: d, key }); }
  const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-md border border-line px-3 py-1 text-sm hover:border-brand">←</button>
        <p className="text-sm font-semibold capitalize">{monthLabel}</p>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-md border border-line px-3 py-1 text-sm hover:border-brand">→</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WD.map((w) => <div key={w} className="px-1 py-1 text-center text-[10px] uppercase text-muted">{w}</div>)}
        {cells.map((cell, i) => (
          <div key={i} className={`min-h-[84px] rounded-lg border p-1 ${cell ? "border-line bg-bg/40" : "border-transparent"} ${cell?.key === todayKey ? "ring-1 ring-brand" : ""}`}>
            {cell && (
              <>
                <p className="px-0.5 text-[10px] text-muted">{cell.day}</p>
                <div className="space-y-0.5">
                  {(byDay[cell.key] ?? []).slice(0, 4).map((c) => (
                    <button key={c.id} onClick={() => onOpen(c.id)} className={`block w-full truncate rounded border-l-2 bg-bg/70 px-1 py-0.5 text-left text-[10px] ${URG[c.urgency] ?? "border-line"}`} title={`${c.contactName} · ${c.shortCode}`}>
                      {c.contactName}
                    </button>
                  ))}
                  {(byDay[cell.key]?.length ?? 0) > 4 && <p className="px-1 text-[9px] text-muted">+{(byDay[cell.key]!.length - 4)}</p>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {noDate.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase text-muted">Sem prazo definido ({noDate.length})</p>
          <div className="flex flex-wrap gap-1">
            {noDate.map((c) => (
              <button key={c.id} onClick={() => onOpen(c.id)} className="rounded-lg border border-line bg-bg/60 px-2 py-1 text-[11px] hover:border-brand">{c.contactName} <span className="text-muted">{c.shortCode}</span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NfTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [data, setData] = useState<{ pending: any[]; generated: any[] } | null>(null);
  useEffect(() => { fetch("/api/production/nf/pending", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setData({ pending: d?.pending ?? [], generated: d?.generated ?? [] })).catch(() => setData({ pending: [], generated: [] })); }, []);
  if (data === null) return <p className="text-sm text-muted">Carregando…</p>;
  if (data.pending.length === 0 && data.generated.length === 0) return <p className="rounded-2xl border border-line bg-surface p-8 text-center text-muted">Nenhum pedido com nota fiscal. 👍</p>;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Pendentes ({data.pending.length})</p>
        {data.pending.length === 0 ? <p className="text-sm text-muted">Nenhuma NF pendente.</p> : data.pending.map((o) => {
          const missing = [["nome", o.contactName], ["CPF", o.fiscalCpf], ["telefone", o.contactPhone]].filter(([, v]) => !v).map(([k]) => k);
          return (
            <button key={o.id} onClick={() => onOpen(o.id)} className="card flex w-full items-center justify-between gap-3 p-4 text-left">
              <div><p className="font-medium">{o.contactName} <span className="ml-1 text-xs text-muted">{o.shortCode}</span></p>
                <p className="text-xs text-muted">{brl(o.totalCents)}{o.paymentStatus === "partial" ? " · sinal pago" : o.paymentStatus === "none" ? " · aguardando pagamento" : ""}</p></div>
              {missing.length > 0
                ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">faltam: {missing.join(", ")}</span>
                : <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-300">pronto p/ gerar</span>}
            </button>
          );
        })}
      </div>
      {data.generated.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-green-300">Geradas ({data.generated.length})</p>
          {data.generated.map((o) => (
            <button key={o.id} onClick={() => onOpen(o.id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-green-500/30 bg-green-500/5 p-4 text-left hover:border-green-400">
              <div>
                <p className="font-medium">{o.contactName} <span className="ml-1 text-xs text-muted">{o.shortCode}</span></p>
                <p className="text-xs text-green-200/80">{o.nfNumber ? `NF nº ${o.nfNumber}` : ""}{o.nfKey ? ` · chave ${String(o.nfKey).slice(0, 12)}…` : ""}{o.nfAuthorizedBy ? ` · autorizado por ${o.nfAuthorizedBy}` : ""}</p>
              </div>
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">gerada</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CancelamentosTab({ onOpen, onChanged }: { onOpen: (id: string) => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [estorno, setEstorno] = useState<any | null>(null);
  const load = () => fetch("/api/production/cancel-requests", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  if (items === null) return <p className="text-sm text-muted">Carregando…</p>;
  if (items.length === 0) return <p className="rounded-2xl border border-line bg-surface p-8 text-center text-muted">Nenhum cancelamento aguardando estorno. 👍</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Pedidos cancelados com pagamento eletrônico (Pix/cartão). Faça o estorno por fora, lance aqui com o comprovante — a NFS-e vinculada é cancelada automaticamente.</p>
      {items.map((o) => {
        const pagoEletronico = (o.payments ?? []).filter((p: any) => p.status === "paid" && p.kind !== "estorno" && (["mp", "infinitepay"].includes(p.provider) || ["card", "card_machine", "pix", "pix_machine"].includes(p.method)));
        const totalPago = pagoEletronico.reduce((s: number, p: any) => s + Number(p.amountCents ?? 0), 0);
        return (
          <div key={o.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button onClick={() => onOpen(o.id)} className="text-left">
                <p className="font-medium">{o.contactName} <span className="ml-1 text-xs text-muted">{o.shortCode}</span></p>
                <p className="text-xs text-muted">Total {brl(o.totalCents)} · pago eletrônico {brl(totalPago)}</p>
              </button>
              <button onClick={() => setEstorno({ ...o, totalPago })} className="btn-grad px-3 py-1.5 text-xs">Lançar estorno</button>
            </div>
            {pagoEletronico.map((p: any) => (
              <p key={p.id} className="mt-1 text-[11px] text-red-200/80">{p.provider} · {brl(p.amountCents)} {p.paidAt ? `· ${new Date(p.paidAt).toLocaleDateString("pt-BR")}` : ""}</p>
            ))}
          </div>
        );
      })}
      {estorno && <EstornoModal order={estorno} onClose={() => setEstorno(null)} onDone={() => { setEstorno(null); load(); onChanged(); }} />}
    </div>
  );
}

function EstornoModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const dialog = useDialog();
  const [amount, setAmount] = useState(((order.totalPago ?? Number(order.totalCents)) / 100).toFixed(2).replace(".", ","));
  const [method, setMethod] = useState("pix");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const cents = toCents(amount);
    if (cents <= 0) { dialog.toast("Informe o valor do estorno", "error"); return; }
    if (!file) { const ok = await dialog.confirm("Lançar o estorno SEM anexar comprovante?"); if (!ok) return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("amountCents", String(cents)); fd.append("method", method); if (notes.trim()) fd.append("notes", notes.trim());
      if (file) fd.append("file", file);
      const res = await fetch(`/api/production/${order.id}/estorno`, { method: "POST", body: fd, credentials: "include" });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao lançar estorno", "error"); return; }
      const nf = d?.nfse;
      dialog.toast(nf?.status === "cancelada" ? "Estorno lançado e NFS-e cancelada ✅" : nf?.motivo ? `Estorno lançado. NFS-e: ${nf.motivo}` : "Estorno lançado e pedido cancelado ✅", "success");
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Lançar estorno — {order.shortCode}</h3>
        <p className="mt-1 text-xs text-muted">Após confirmar, o pedido é cancelado e a NFS-e vinculada (se houver) é cancelada automaticamente.</p>
        <div className="mt-3 space-y-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Valor estornado (R$)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="input-base" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Forma</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="input-base">
              <option value="pix">Pix</option><option value="card">Cartão</option><option value="cash">Dinheiro</option>
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Observações</span><input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-base" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Comprovante (PDF/imagem)</span><input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full text-xs" /></label>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={submit} className="btn-grad flex-1 disabled:opacity-50">{busy ? "Lançando…" : "Confirmar estorno + cancelar"}</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

/** Modal de autorização de desconto (admin/gerente/supervisor → código 4 dígitos). */
function DiscountAuthModal({ discountCents, orderId, onClose, onConfirmed }: { discountCents: number; orderId?: string | null; onClose: () => void; onConfirmed: (v: { requestId: string; code: string; adminName: string }) => void }) {
  const dialog = useDialog();
  const [admins, setAdmins] = useState<any[]>([]);
  const [adminId, setAdminId] = useState("");
  const [reqId, setReqId] = useState<string | null>(null);
  const [reqName, setReqName] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/production/auth-admins", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setAdmins(d?.items ?? [])).catch(() => {}); }, []);

  async function requestCode() {
    if (!adminId) { dialog.toast("Escolha quem autoriza", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/production/discount-auth", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ adminMembershipId: adminId, discountCents, orderId: orderId ?? null }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao enviar código", "error"); return; }
      setReqId(d?.requestId ?? null); setReqName(d?.adminName ?? "");
      dialog.toast(`Código enviado no WhatsApp de ${d?.adminName ?? "autorizador"} ✅`, "success");
    } finally { setBusy(false); }
  }
  function confirm() {
    if (!reqId || code.trim().length !== 4) { dialog.toast("Digite o código de 4 dígitos", "error"); return; }
    onConfirmed({ requestId: reqId, code: code.trim(), adminName: reqName });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Autorizar desconto de {brl(discountCents)}</h3>
        <p className="mt-1 text-xs text-muted">Só admin, gerente, supervisor ou dono pode liberar. A pessoa recebe um código de 4 dígitos no WhatsApp.</p>
        <div className="mt-3 space-y-2">
          <select value={adminId} onChange={(e) => setAdminId(e.target.value)} disabled={!!reqId} className="input-base disabled:opacity-60">
            <option value="">— quem autoriza —</option>
            {admins.map((a) => <option key={a.membershipId} value={a.membershipId} disabled={!a.hasWhatsapp}>{a.name} · {a.role}{a.hasWhatsapp ? "" : " (sem WhatsApp)"}</option>)}
          </select>
          {!reqId ? (
            <button disabled={busy || !adminId} onClick={requestCode} className="btn-grad w-full disabled:opacity-50">{busy ? "Enviando…" : "Enviar código"}</button>
          ) : (
            <>
              <p className="text-xs text-green-300">Código enviado para {reqName}.</p>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0000" className="input-base text-center font-mono text-lg tracking-[0.5em]" />
              <div className="flex gap-2">
                <button onClick={requestCode} className="rounded-xl border border-line px-3 py-2 text-xs text-muted transition hover:text-fg">Reenviar</button>
                <button disabled={code.length !== 4} onClick={confirm} className="btn-grad flex-1 disabled:opacity-50">Confirmar</button>
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">cancelar</button>
      </div>
    </div>
  );
}

/** Modal "Gerar pagamento" da entrada/saldo de um pedido (4 meios, valor editável). */
function PaymentModal({ orderId, defaultAmountCents, kind = "entrada", totalCents, paidCents, onClose, onDone }: { orderId: string; defaultAmountCents: number; kind?: "entrada" | "saldo"; totalCents?: number; paidCents?: number; onClose: () => void; onDone: () => void }) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [amount, setAmount] = useState((Math.max(0, defaultAmountCents) / 100).toFixed(2).replace(".", ","));
  const amountCents = toCents(amount);
  const restante = totalCents != null ? Math.max(0, totalCents - (paidCents ?? 0)) : null;
  const METHODS: Array<{ key: string; label: string; desc: string }> = [
    { key: "card_machine", label: "Cartão maquininha", desc: "Passa na máquina física — marca pago." },
    { key: "pix_machine", label: "Pix maquininha", desc: "Pix na máquina/manual — marca pago." },
    { key: "pix_infinity", label: "Pix InfinitePay", desc: "Gera link e envia ao cliente." },
    { key: "pix_mp", label: "Pix Mercado Pago", desc: "Gera QR + copia-e-cola (na hora)." },
  ];
  async function gerar(method: string) {
    if (amountCents <= 0) { dialog.toast("Informe o valor a cobrar", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/payments/production/${orderId}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ kind, method, amountCents }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      if (d?.status === "paid") { dialog.toast("Pagamento registrado ✅", "success"); onDone(); return; }
      setResult({ method, ...d });
      dialog.toast(method === "pix_mp" ? "Pix gerado ✅" : "Link gerado ✅", "success");
      onDone();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Gerar pagamento</h3>
        {!result ? (
          <>
            <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase text-muted">Valor a cobrar (R$)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="input-base text-lg font-semibold" />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span>Sugestão {kind === "saldo" ? "(saldo)" : "(entrada)"}: <b>{brl(defaultAmountCents)}</b></span>
              {totalCents != null && <button onClick={() => setAmount((totalCents / 100).toFixed(2).replace(".", ","))} className="rounded-full border border-line px-2 py-0.5 hover:border-brand">Total {brl(totalCents)}</button>}
              {restante != null && restante !== totalCents && <button onClick={() => setAmount((restante / 100).toFixed(2).replace(".", ","))} className="rounded-full border border-line px-2 py-0.5 hover:border-brand">Restante {brl(restante)}</button>}
            </div>
            <p className="mt-2 text-[11px] text-muted">Pode cobrar a entrada, o saldo ou qualquer valor (até maior que o total).</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {METHODS.map((m) => (
                <button key={m.key} disabled={busy || amountCents <= 0} onClick={() => gerar(m.key)} className="rounded-xl border border-line bg-surface-2 p-3 text-left transition hover:border-brand disabled:opacity-50">
                  <p className="text-sm font-semibold">{m.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{m.desc}</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-3 space-y-2">
            {result.qrCodeBase64 && <img src={`data:image/png;base64,${result.qrCodeBase64}`} alt="QR Pix" className="mx-auto h-44 w-44" />}
            {result.qrCode && <textarea readOnly value={result.qrCode} onClick={(e) => (e.target as HTMLTextAreaElement).select()} className="input-base h-20 font-mono text-[10px]" />}
            {result.qrCode && <button onClick={() => { navigator.clipboard?.writeText(result.qrCode); dialog.toast("Copia-e-cola copiado ✅", "success"); }} className="w-full rounded-lg bg-brand py-1.5 text-xs font-semibold text-white">Copiar copia-e-cola</button>}
            {result.link && <a href={result.link} target="_blank" rel="noreferrer" className="block truncate rounded-lg border border-line px-3 py-2 text-xs text-sky-300 hover:underline">{result.link}</a>}
            {result.link && <button onClick={() => { navigator.clipboard?.writeText(result.link); dialog.toast("Link copiado ✅", "success"); }} className="w-full rounded-lg bg-brand py-1.5 text-xs font-semibold text-white">Copiar link</button>}
            <p className="text-[11px] text-muted">A confirmação do pagamento chega pelo webhook do provedor.</p>
          </div>
        )}
        <button onClick={onClose} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">fechar</button>
      </div>
    </div>
  );
}

function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog();
  const [o, setO] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [payModal, setPayModal] = useState<{ amountCents: number; kind: "entrada" | "saldo" } | null>(null);
  const stages = useActiveStages();
  const load = () => fetch(`/api/production/${id}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setO(d.order)).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function setStatus(status: string) {
    if (status === "cancelado" && !(await dialog.confirm("Cancelar este pedido?"))) return;
    setBusy(true);
    const res = await fetch(`/api/production/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    const d = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao mudar status", "error"); return; }
    const ns = d?.order?.status;
    if (status === "cancelado" && ns === "cancelamento_solicitado") dialog.toast("Pedido com pagamento eletrônico (Pix/cartão) → enviado para a aba Cancelamentos p/ estorno.", "info");
    else if (ns === "cancelado") dialog.toast("Pedido cancelado", "success");
    load(); onChanged();
  }
  async function upload(kind: "client_asset" | "art", file: File) {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch(`/api/production/${id}/files?kind=${kind}`, { method: "POST", body: fd, credentials: "include" });
    if (!res.ok) { dialog.toast("Falha no upload", "error"); return; }
    dialog.toast(kind === "art" ? "Arte enviada ao cliente ✅" : "Arquivo anexado", "success"); load(); onChanged();
  }
  async function setPayment(paymentStatus: string) {
    setBusy(true);
    await fetch(`/api/production/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ paymentStatus }) });
    setBusy(false);
    dialog.toast(paymentStatus === "paid" ? "Pagamento confirmado ✅" : paymentStatus === "partial" ? "Sinal/entrada registrado" : "Pagamento em aberto", "success");
    load(); onChanged();
  }
  async function review(decision: "approved" | "rejected") {
    let comment: string | null = null;
    if (decision === "rejected") {
      const r = await dialog.prompt({ title: "Reprovar arte", message: "O que precisa ajustar?", placeholder: "Descreva os ajustes" });
      if (r === null) return; comment = r.trim(); if (!comment) { dialog.toast("Descreva o ajuste", "error"); return; }
    }
    await fetch(`/api/production/${id}/art-review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ decision, comment }) });
    dialog.toast(decision === "approved" ? "Arte aprovada ✅" : "Arte reprovada", "success"); load(); onChanged();
  }

  if (!o) return null;
  const assets = (o.files ?? []).filter((f: any) => f.kind === "client_asset");
  const arts = (o.files ?? []).filter((f: any) => f.kind === "art");
  const proofs = (o.files ?? []).filter((f: any) => f.kind === "payment_proof");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-base font-semibold">{o.contactName} <span className="text-xs text-muted">{o.shortCode}</span></h3>
            <p className="text-xs text-muted">{brl(o.totalCents)}{o.dueDate ? ` · prazo ${new Date(o.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""} · {o.delivery ? "entrega" : "retirada"}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg">✕</button>
        </div>

        {/* pipeline */}
        <div className="mt-4">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Status da produção</p>
          <div className="flex flex-wrap gap-1.5">
            {stages.filter((s) => s !== "entrega" || o.delivery).map((s) => (
              <button key={s} disabled={busy} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-xs ${o.status === s ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{STATUS_LABEL[s]}</button>
            ))}
            <button disabled={busy || o.status === "cancelado"} onClick={() => setStatus("cancelado")} className={`rounded-full px-3 py-1 text-xs ${o.status === "cancelado" ? "bg-red-500/30 text-red-200" : o.status === "cancelamento_solicitado" ? "bg-amber-500/30 text-amber-200" : "border border-line text-red-300 hover:border-red-400"}`}>{o.status === "cancelado" ? "Cancelado" : o.status === "cancelamento_solicitado" ? "Cancelamento solicitado" : "Cancelar"}</button>
          </div>
          {o.status === "cancelamento_solicitado" && (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">⏳ Cancelamento solicitado — este pedido tem pagamento eletrônico (Pix/cartão). Faça o estorno na aba <b>Cancelamentos</b> (com comprovante); ao confirmar, o pedido é cancelado e a NFS-e vinculada é cancelada automaticamente.</p>
          )}
        </div>

        {/* comprovante de pagamento (Pix) recebido pelo WhatsApp */}
        {(proofs.length > 0 || o.paymentProofUrl) && (
          <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
            <p className="text-sm font-medium text-emerald-200">💸 Comprovante de pagamento recebido <span className="ml-1 text-[10px] uppercase text-emerald-300/80">aguardando conferência</span></p>
            <div className="mt-1 space-y-1">
              {(proofs.length ? proofs : [{ id: "p", url: o.paymentProofUrl, name: "comprovante" }]).map((f: any) => (
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-emerald-200 hover:underline">📎 {f.name ?? "comprovante"}{f.createdAt ? ` — ${new Date(f.createdAt).toLocaleString("pt-BR")}` : ""}</a>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-emerald-300/70">Confira o pagamento e marque a baixa abaixo.</p>
          </div>
        )}

        {/* pagamento — baixa pelo operador */}
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Pagamento
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase ${o.paymentStatus === "paid" ? "bg-green-500/20 text-green-300" : o.paymentStatus === "partial" ? "bg-sky-500/20 text-sky-200" : "bg-amber-500/20 text-amber-200"}`}>
                {o.paymentStatus === "paid" ? "pago" : o.paymentStatus === "partial" ? "sinal pago · produzir" : "aguardando pagamento"}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button disabled={busy || o.paymentStatus === "none"} onClick={() => setPayment("none")} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-brand disabled:opacity-40">Em aberto</button>
              <button disabled={busy || o.paymentStatus === "partial"} onClick={() => setPayment("partial")} className="rounded-md border border-line px-2 py-1 text-xs text-amber-200 hover:border-amber-400 disabled:opacity-40">Sinal/parcial</button>
              <button disabled={busy || o.paymentStatus === "paid"} onClick={() => setPayment("paid")} className="rounded-md border border-line px-2 py-1 text-xs text-green-300 hover:border-green-400 disabled:opacity-40">Marcar pago</button>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-muted">Total {brl(o.totalCents)}{Number(o.discountCents) > 0 ? ` · desconto ${brl(o.discountCents)}${o.discountAuthorizedBy ? ` (aut. ${o.discountAuthorizedBy})` : ""}` : ""}{Number(o.downPaymentCents) > 0 ? ` · pago/entrada ${brl(o.downPaymentCents)}` : ""}.</p>
          {o.paymentStatus !== "paid" && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Number(o.downPaymentCents) <= 0 && <button onClick={() => setPayModal({ amountCents: Number(o.downPaymentCents) || Math.round(Number(o.totalCents) / 2), kind: "entrada" })} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white">Gerar pagamento (entrada)</button>}
              <button onClick={() => setPayModal({ amountCents: Math.max(0, Number(o.totalCents) - Number(o.downPaymentCents)), kind: "saldo" })} className="rounded-md border border-brand px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/10">Gerar pagamento (saldo)</button>
            </div>
          )}
          {(o.payments ?? []).length > 0 && (
            <div className="mt-2 space-y-0.5 border-t border-line/50 pt-2">
              {(o.payments ?? []).map((p: any) => (
                <p key={p.id} className="text-[10px] text-muted">{p.kind === "estorno" ? "↩ estorno" : p.kind} · {p.provider} · {brl(p.amountCents)} · <span className={p.status === "paid" ? "text-green-300" : p.status === "failed" ? "text-red-300" : "text-amber-300"}>{p.status}</span>{p.link ? " · link enviado" : ""}</p>
              ))}
            </div>
          )}
        </div>

        {/* arte */}
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Arte <span className="ml-1 rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-muted">{ART_LABEL[o.artStatus] ?? o.artStatus}</span></p>
            <label className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs hover:border-brand">+ Enviar arte
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload("art", f); e.currentTarget.value = ""; }} />
            </label>
          </div>
          <div className="mt-2 space-y-1">
            <p className="text-[10px] uppercase text-muted">Arquivos do cliente ({assets.length})
              <label className="ml-2 cursor-pointer text-brand hover:underline">+ anexar<input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload("client_asset", f); e.currentTarget.value = ""; }} /></label>
            </p>
            {assets.map((f: any) => <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-sky-300 hover:underline">📎 {f.name ?? "arquivo"}</a>)}
            {arts.length > 0 && <p className="mt-2 text-[10px] uppercase text-muted">Artes enviadas</p>}
            {arts.map((f: any) => <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-sky-300 hover:underline">🎨 v{f.version} — {f.name ?? "arte"}</a>)}
          </div>
          {(o.artStatus === "enviada" || o.artStatus === "reprovada" || o.artStatus === "aprovada") && (
            <div className="mt-3 flex gap-2">
              <button onClick={() => review("approved")} className="rounded-md border border-line px-3 py-1 text-xs text-green-300 hover:border-green-400">Aprovar (operador)</button>
              <button onClick={() => review("rejected")} className="rounded-md border border-line px-3 py-1 text-xs text-red-300 hover:border-red-400">Reprovar</button>
            </div>
          )}
          {(o.reviews ?? []).length > 0 && (
            <div className="mt-3 space-y-1 border-t border-line/60 pt-2">
              {o.reviews.map((rv: any) => (
                <p key={rv.id} className="text-[11px]"><span className={rv.decision === "approved" ? "text-green-300" : "text-red-300"}>{rv.decision === "approved" ? "✓ Aprovada" : "✗ Reprovada"}</span> <span className="text-muted">({rv.reviewer}) {new Date(rv.createdAt).toLocaleString("pt-BR")}</span>{rv.comment ? ` — ${rv.comment}` : ""}</p>
              ))}
            </div>
          )}
        </div>

        {/* itens */}
        <div className="mt-4">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">Itens</p>
          {(o.items ?? []).map((it: any) => (
            <div key={it.id} className="flex justify-between border-b border-line/40 py-1 text-sm"><span>{it.qty}× {it.description}</span><span className="text-muted">{brl(it.lineTotalCents)}</span></div>
          ))}
        </div>
        {/* grade do pedido (modelos com tamanhos fixos) */}
        <GradeEditor order={o} onChanged={() => { load(); onChanged(); }} />

        {/* ficha técnica */}
        <RosterEditor order={o} onChanged={() => { load(); onChanged(); }} />

        {/* tecido / insumos */}
        <FabricEditor order={o} onChanged={() => { load(); onChanged(); }} />

        {/* assinatura do cliente (colher presencial no balcão) */}
        <SignatureSection order={o} onChanged={() => { load(); onChanged(); }} />

        <NfSection order={o} onChanged={() => { load(); onChanged(); }} />
        {o.notes && <p className="mt-3 rounded-xl border border-line bg-surface-2 p-2 text-xs text-muted">{o.notes}</p>}
      </div>
      {payModal && <PaymentModal orderId={id} defaultAmountCents={payModal.amountCents} kind={payModal.kind} totalCents={Number(o.totalCents)} paidCents={Number(o.downPaymentCents)} onClose={() => { setPayModal(null); load(); onChanged(); }} onDone={() => { load(); onChanged(); }} />}
    </div>
  );
}

function NfSection({ order, onChanged }: { order: any; onChanged: () => void }) {
  const dialog = useDialog();
  const [cpf, setCpf] = useState(order.fiscalCpf ?? "");
  const [address, setAddress] = useState(order.fiscalAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [nfseOn, setNfseOn] = useState(false);
  // modal de autorização (gerar sem pagamento total)
  const [authOpen, setAuthOpen] = useState(false);
  const [admins, setAdmins] = useState<any[]>([]);
  const [adminId, setAdminId] = useState("");
  const [reqId, setReqId] = useState<string | null>(null);
  const [reqName, setReqName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [nfDoc, setNfDoc] = useState<any | null>(null); // documento fiscal vinculado (status real)

  useEffect(() => { fetch("/api/fiscal/nfse/config", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setNfseOn(!!d?.nfseEnabled)).catch(() => {}); }, []);

  const gerada = !!order.nfKey || !!order.nfNumber || (!!order.nfUrl && !!order.nfIssuedAt);
  const pago = order.paymentStatus === "paid";
  // quando há NF gerada, busca o status real do documento (autorizada/cancelada)
  useEffect(() => {
    if (!gerada) return;
    fetch("/api/fiscal/nfse", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const docs = (d?.items ?? d ?? []).filter((x: any) => x.productionOrderId === order.id); const sel = docs.find((x: any) => x.status === "cancelada") ?? docs.find((x: any) => x.status === "autorizada") ?? docs[0]; setNfDoc(sel ?? null); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gerada, order.id, order.nfIssuedAt]);
  const cancelada = nfDoc?.status === "cancelada";

  async function saveFiscalSilent() {
    await fetch(`/api/production/${order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ fiscalCpf: cpf.trim() || null, fiscalAddress: address.trim() || null }) }).catch(() => {});
  }

  async function emitir(auth?: { authRequestId: string; authCode: string }) {
    setBusy(true);
    try {
      await saveFiscalSilent();
      const res = await fetch(`/api/fiscal/nfse/from-order/${order.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(auth ?? {}) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return false; }
      if (d?.status === "autorizada") dialog.toast(d?.authorizedBy ? `NFS-e gerada (autorizada por ${d.authorizedBy}) ✅` : "NFS-e emitida e enviada ✅", "success");
      else { dialog.toast(`NFS-e não autorizada: ${d?.motivo ?? d?.status ?? "erro"}`, "error"); onChanged(); return false; }
      onChanged(); return true;
    } finally { setBusy(false); }
  }

  async function gerarNfse() {
    if (!cpf.trim()) { dialog.toast("Informe o CPF do cliente", "error"); return; }
    if (pago) {
      if (!(await dialog.confirm("Gerar a NFS-e deste pedido e enviar ao cliente (WhatsApp/e-mail)?"))) return;
      await emitir();
    } else {
      // sem pagamento total → exige autorização
      setBusy(true);
      try {
        const r = await fetch("/api/fiscal/nfse/auth-admins", { credentials: "include", headers: { "x-no-loading": "1" } });
        setAdmins((await r.json().catch(() => [])) ?? []);
      } finally { setBusy(false); }
      setReqId(null); setReqName(null); setCode(""); setAdminId(""); setAuthOpen(true);
    }
  }

  async function requestCode() {
    if (!adminId) { dialog.toast("Escolha quem vai autorizar", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/fiscal/nfse/from-order/${order.id}/request-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ adminMembershipId: adminId }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao enviar o código", "error"); return; }
      setReqId(d?.requestId ?? null); setReqName(d?.adminName ?? null);
      dialog.toast(`Código enviado no WhatsApp de ${d?.adminName ?? "autorizador"} ✅`, "success");
    } finally { setBusy(false); }
  }

  async function confirmAuth() {
    if (!reqId || code.trim().length !== 4) { dialog.toast("Digite o código de 4 dígitos", "error"); return; }
    const ok = await emitir({ authRequestId: reqId, authCode: code.trim() });
    if (ok) setAuthOpen(false);
  }

  async function uploadNf(file: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/production/${order.id}/nf`, { method: "POST", body: fd, credentials: "include" });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha no upload da NF", "error"); return; }
      dialog.toast("NF anexada e enviada ao cliente ✅", "success"); onChanged();
    } finally { setBusy(false); }
  }

  async function findDoc(statuses: string[]) {
    const lr = await fetch("/api/fiscal/nfse", { credentials: "include", headers: { "x-no-loading": "1" } });
    const list = await lr.json().catch(() => null);
    return (list?.items ?? list ?? []).find((x: any) => x.productionOrderId === order.id && statuses.includes(x.status));
  }
  async function verPdf() {
    setBusy(true);
    try {
      if (order.nfUrl) { window.open(order.nfUrl, "_blank"); return; }
      const doc = nfDoc ?? await findDoc(["autorizada", "cancelada"]);
      if (!doc) { dialog.toast("NFS-e não encontrada p/ este pedido", "error"); return; }
      window.open(`/api/fiscal/nfse/${doc.id}/danfse`, "_blank");
    } finally { setBusy(false); }
  }
  async function cancelarNfse() {
    const just = await dialog.prompt("Motivo do cancelamento (mín. 15 caracteres):");
    if (just == null) return;
    if (String(just).trim().length < 15) { dialog.toast("Justificativa de no mínimo 15 caracteres", "error"); return; }
    setBusy(true);
    try {
      const doc = await findDoc(["autorizada"]);
      if (!doc) { dialog.toast("NFS-e autorizada não encontrada p/ este pedido", "error"); return; }
      const res = await fetch(`/api/fiscal/nfse/${doc.id}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ justificativa: String(just).trim() }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      if (d?.status === "cancelada") { dialog.toast("NFS-e cancelada ✅", "success"); setNfDoc((p: any) => ({ ...(p ?? {}), id: doc.id, status: "cancelada", cancelMotivo: String(just).trim() })); }
      else dialog.toast(`Não cancelada: ${d?.motivo ?? d?.status ?? "erro"}`, "error");
      onChanged();
    } finally { setBusy(false); }
  }

  if (gerada) {
    const cls = cancelada ? "border-red-500/40 bg-red-500/10" : "border-green-500/40 bg-green-500/10";
    return (
      <div className={`mt-4 rounded-lg border p-3 ${cls}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm font-semibold ${cancelada ? "text-red-300" : "text-green-300"}`}>{cancelada ? "🚫 NFS-e cancelada" : "✅ NFS-e gerada"}</p>
          {!cancelada && <button disabled={busy} onClick={cancelarNfse} className="rounded-md border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:border-red-400 disabled:opacity-50">{busy ? "..." : "Cancelar NFS-e"}</button>}
        </div>
        <div className={`mt-1 space-y-0.5 text-xs ${cancelada ? "text-red-200/90" : "text-green-200/90"}`}>
          {order.nfNumber && <p>Nº DPS: <span className="font-mono">{order.nfNumber}</span></p>}
          {order.nfKey && <p className="break-all">Chave: <span className="font-mono">{order.nfKey}</span></p>}
          {order.nfIssuedAt && <p className="opacity-70">Emitida em {new Date(order.nfIssuedAt).toLocaleString("pt-BR")}</p>}
          {cancelada && <p className="font-medium">Esta nota foi cancelada na SEFAZ.{nfDoc?.cancelMotivo ? ` Motivo: ${nfDoc.cancelMotivo}` : ""}</p>}
          {order.nfAuthorizedBy && !cancelada && <p className="text-amber-300">NF gerada por token autorizado por {order.nfAuthorizedBy}</p>}
        </div>
        <div className="mt-1 flex flex-wrap gap-3">
          <button disabled={busy} onClick={verPdf} className="text-xs text-sky-300 hover:underline disabled:opacity-50">📄 Ver PDF da NF</button>
          {order.nfUrl && <a href={order.nfUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-300 hover:underline">⬇ Baixar</a>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Nota fiscal <span className="text-amber-300">(pendente)</span></p>
        <button disabled={busy} onClick={gerarNfse} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "..." : "Gerar NFS-e"}</button>
      </div>
      {!nfseOn && <p className="mt-1 text-[11px] text-amber-300">⚠ NFS-e ainda não está habilitada. Ative em <a href="/app/fiscal" className="underline">Configuração › Nota fiscal</a> (certificado + código de serviço) antes de emitir.</p>}
      {!pago && <p className="mt-1 text-[11px] text-amber-300">⚠ Pagamento não está total — a emissão exige autorização (código de 4 dígitos de um admin/gerente/supervisor).</p>}
      <p className="mt-1 text-[11px] text-amber-200">Dados do cliente p/ emitir a NF (nome: <b>{order.contactName || "—"}</b>):</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF (obrigatório)" className="input-base" />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Endereço (opcional)" className="input-base sm:col-span-2" />
      </div>
      <div className="mt-2 flex gap-2">
        <label className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs hover:border-brand">{busy ? "..." : "Anexar NF manual (PDF)"}
          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadNf(f); e.currentTarget.value = ""; }} />
        </label>
      </div>

      {authOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAuthOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Autorizar emissão sem pagamento total</h3>
            <p className="mt-1 text-xs text-muted">Escolha quem vai autorizar. A pessoa recebe um código de 4 dígitos no WhatsApp; digite-o aqui para gerar a NFS-e.</p>
            <div className="mt-3 space-y-2">
              <select value={adminId} onChange={(e) => setAdminId(e.target.value)} disabled={!!reqId} className="input-base disabled:opacity-60">
                <option value="">— quem autoriza —</option>
                {admins.map((a) => <option key={a.membershipId} value={a.membershipId} disabled={!a.hasWhatsapp}>{a.name} · {a.role}{a.hasWhatsapp ? "" : " (sem WhatsApp)"}</option>)}
              </select>
              {!reqId ? (
                <button disabled={busy || !adminId} onClick={requestCode} className="btn-grad w-full disabled:opacity-50">{busy ? "Enviando…" : "Enviar código"}</button>
              ) : (
                <>
                  <p className="text-xs text-green-300">Código enviado para {reqName}. Peça os 4 dígitos e informe abaixo.</p>
                  <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0000" className="input-base text-center font-mono text-lg tracking-[0.5em]" />
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={requestCode} className="rounded-xl border border-line px-3 py-2 text-xs text-muted transition hover:text-fg disabled:opacity-50">Reenviar</button>
                    <button disabled={busy || code.length !== 4} onClick={confirmAuth} className="btn-grad flex-1 disabled:opacity-50">{busy ? "Gerando…" : "Confirmar e gerar NFS-e"}</button>
                  </div>
                </>
              )}
            </div>
            <button onClick={() => setAuthOpen(false)} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

type RosterRow = { playerName: string; number: string; size: string; qty: number; modelKey?: string };
type GradeModel = { key: string; label: string; sizes: string[] };

/** Lê a grade do pedido (modelos com tamanhos). [] = sem grade. */
function parseGrade(order: any): GradeModel[] {
  const g = order?.sizeGrade;
  if (!Array.isArray(g)) return [];
  return g.filter((m: any) => m && typeof m.key === "string").map((m: any) => ({ key: String(m.key), label: String(m.label ?? m.key), sizes: Array.isArray(m.sizes) ? m.sizes.map((s: any) => String(s)) : [] }));
}
function RosterEditor({ order, onChanged }: { order: any; onChanged: () => void }) {
  const dialog = useDialog();
  const grade = parseGrade(order);
  const hasGrade = grade.length > 0;
  const byKey = new Map(grade.map((m) => [m.key, m]));
  const [rows, setRows] = useState<RosterRow[]>(() => (order.roster ?? []).map((r: any) => ({ playerName: r.playerName ?? "", number: r.number ?? "", size: r.size ?? "", qty: r.qty ?? 1, modelKey: r.modelKey ?? (hasGrade ? grade[0]!.key : undefined) })));
  const [open, setOpen] = useState((order.roster ?? []).length > 0);
  const [busy, setBusy] = useState(false);
  const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);

  function setRow(i: number, patch: Partial<RosterRow>) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  function addRow() { setRows((rs) => [...rs, { playerName: "", number: "", size: "", qty: 1, modelKey: hasGrade ? grade[0]!.key : undefined }]); }
  function delRow(i: number) { setRows((rs) => rs.filter((_, idx) => idx !== i)); }

  async function save() {
    // com grade: valida modelo + tamanho de cada linha preenchida
    if (hasGrade) {
      for (const r of rows.filter((x) => x.playerName.trim())) {
        const m = r.modelKey ? byKey.get(r.modelKey) : undefined;
        if (!m) { dialog.toast(`Escolha o modelo de "${r.playerName.trim()}"`, "error"); return; }
        if (m.sizes.length && !m.sizes.includes(r.size)) { dialog.toast(`Escolha o tamanho de "${r.playerName.trim()}" (${m.label})`, "error"); return; }
      }
    }
    setBusy(true);
    try {
      const payload = rows.filter((r) => r.playerName.trim()).map((r) => ({ playerName: r.playerName.trim(), number: r.number.trim() || null, size: r.size.trim() || null, modelKey: hasGrade ? (r.modelKey ?? null) : null, qty: Math.max(1, Math.trunc(Number(r.qty) || 1)) }));
      const res = await fetch(`/api/production/${order.id}/roster`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ rows: payload }) });
      if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha ao salvar ficha técnica", "error"); return; }
      dialog.toast("Ficha técnica salva ✅", "success"); onChanged();
    } finally { setBusy(false); }
  }

  const cols = hasGrade ? "grid-cols-[1fr_48px_110px_88px_44px_24px]" : "grid-cols-[1fr_56px_72px_56px_28px]";
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Ficha técnica {totalQty > 0 && <span className="ml-1 text-[11px] text-muted">({rows.length} jogador(es) · {totalQty} peça(s))</span>}{hasGrade && <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">grade fixa</span>}</p>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-brand hover:underline">{open ? "ocultar" : "abrir"}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className={`grid ${cols} gap-2 text-[10px] uppercase text-muted`}>
            <span>Jogador</span><span>Nº</span>{hasGrade && <span>Modelo</span>}<span>Tam.</span><span>Qtd</span><span></span>
          </div>
          {rows.map((r, i) => {
            const m = r.modelKey ? byKey.get(r.modelKey) : undefined;
            return (
              <div key={i} className={`grid ${cols} gap-2`}>
                <input value={r.playerName} onChange={(e) => setRow(i, { playerName: e.target.value })} placeholder="Nome" className="rounded border border-line bg-bg/40 px-2 py-1 text-sm" />
                <input value={r.number} onChange={(e) => setRow(i, { number: e.target.value })} placeholder="10" className="rounded border border-line bg-bg/40 px-2 py-1 text-sm" />
                {hasGrade && (
                  <select value={r.modelKey ?? ""} onChange={(e) => setRow(i, { modelKey: e.target.value, size: "" })} className="rounded border border-line bg-bg/40 px-1 py-1 text-sm">
                    {grade.map((gm) => <option key={gm.key} value={gm.key}>{gm.label}</option>)}
                  </select>
                )}
                {hasGrade ? (
                  <select value={r.size} onChange={(e) => setRow(i, { size: e.target.value })} className="rounded border border-line bg-bg/40 px-1 py-1 text-sm">
                    <option value="">—</option>
                    {(m?.sizes ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : (
                  <input value={r.size} onChange={(e) => setRow(i, { size: e.target.value })} placeholder="M" className="rounded border border-line bg-bg/40 px-2 py-1 text-sm" />
                )}
                <input type="number" min={1} value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} className="rounded border border-line bg-bg/40 px-2 py-1 text-sm" />
                <button onClick={() => delRow(i)} className="text-red-300 hover:text-red-200" title="remover">✕</button>
              </div>
            );
          })}
          <div className="flex gap-2">
            <button onClick={addRow} className="rounded-md border border-line px-3 py-1 text-xs hover:border-brand">+ jogador</button>
            <button disabled={busy} onClick={save} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "..." : "Salvar ficha"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Editor da GRADE do pedido: modelos (label) com tamanhos permitidos. O
 *  operador pode digitar os tamanhos ou puxar de uma tabela de medidas
 *  cadastrada (GraficaSizeChart via /api/production/catalog). */
function GradeEditor({ order, onChanged }: { order: any; onChanged: () => void }) {
  const dialog = useDialog();
  const [models, setModels] = useState<GradeModel[]>(() => parseGrade(order));
  const [open, setOpen] = useState(parseGrade(order).length > 0);
  const [charts, setCharts] = useState<Array<{ name: string; sizes: string[] }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/production/catalog`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const cs = (d?.sizeCharts ?? []).map((c: any) => ({ name: c.name as string, sizes: Array.isArray(c.rows) ? c.rows.map((row: any) => String(row?.size ?? row)).filter(Boolean) : [] }));
        setCharts(cs);
      })
      .catch(() => {});
  }, [open]);

  function setModel(i: number, patch: Partial<GradeModel>) { setModels((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m))); }
  function addModel() { setModels((ms) => [...ms, { key: "", label: "", sizes: [] }]); }
  function delModel(i: number) { setModels((ms) => ms.filter((_, idx) => idx !== i)); }

  async function save() {
    setBusy(true);
    try {
      const payload = models.filter((m) => m.label.trim()).map((m) => ({ key: m.key || null, label: m.label.trim(), sizes: m.sizes }));
      const res = await fetch(`/api/production/${order.id}/grade`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ models: payload }) });
      if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha ao salvar grade", "error"); return; }
      dialog.toast("Grade salva ✅", "success"); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Grade do pedido {models.length > 0 && <span className="ml-1 text-[11px] text-muted">({models.length} modelo(s))</span>}</p>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-brand hover:underline">{open ? "ocultar" : "abrir"}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-3">
          <p className="text-[11px] text-muted">Defina os modelos (ex.: Camisa, Short) e os tamanhos de cada um. O cliente preenche a lista escolhendo dessas opções. Sem grade, o tamanho fica como texto livre.</p>
          {models.map((m, i) => (
            <div key={i} className="rounded-lg border border-line/60 bg-bg/30 p-2">
              <div className="flex items-center gap-2">
                <input value={m.label} onChange={(e) => setModel(i, { label: e.target.value })} placeholder="Nome do modelo (ex.: Camisa Oficial)" className="flex-1 rounded border border-line bg-bg/40 px-2 py-1 text-sm" />
                <button onClick={() => delModel(i)} className="text-red-300 hover:text-red-200" title="remover modelo">✕</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={m.sizes.join(", ")}
                  onChange={(e) => setModel(i, { sizes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  placeholder="Tamanhos: PP, P, M, G, GG"
                  className="flex-1 min-w-[180px] rounded border border-line bg-bg/40 px-2 py-1 text-sm"
                />
                {charts.length > 0 && (
                  <select onChange={(e) => { const c = charts.find((x) => x.name === e.target.value); if (c) setModel(i, { sizes: c.sizes }); e.currentTarget.selectedIndex = 0; }} className="rounded border border-line bg-bg/40 px-2 py-1 text-xs">
                    <option value="">puxar tabela…</option>
                    {charts.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.sizes.length})</option>)}
                  </select>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={addModel} className="rounded-md border border-line px-3 py-1 text-xs hover:border-brand">+ modelo</button>
            <button disabled={busy} onClick={save} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "..." : "Salvar grade"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Captura presencial da assinatura do cliente no balcão (canvas → PNG).
 *  Usa a rota admin /production/:id/customer-signature. Mostra a assinatura
 *  já colhida (pelo cliente no portal ou aqui) quando existir. */
function SignatureSection({ order, onChanged }: { order: any; onChanged: () => void }) {
  const dialog = useDialog();
  const [pad, setPad] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!; const rect = c.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (c.width / rect.width), y: (e.clientY - rect.top) * (c.height / rect.height) };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) { drawing.current = true; setHasInk(true); const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(e: React.PointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; const ctx = canvasRef.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  function end() { drawing.current = false; }
  function clear() { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setHasInk(false); }

  async function save() {
    if (!hasInk) { dialog.toast("Peça pro cliente assinar primeiro", "error"); return; }
    setBusy(true);
    try {
      const dataUrl = canvasRef.current!.toDataURL("image/png");
      const res = await fetch(`/api/production/${order.id}/customer-signature`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ signatureDataUrl: dataUrl }) });
      if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha ao salvar assinatura", "error"); return; }
      dialog.toast("Assinatura registrada ✅", "success"); setPad(false); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Assinatura do cliente</p>
        {!order.customerSignatureUrl && !pad && <button onClick={() => setPad(true)} className="rounded-md border border-line px-3 py-1 text-xs hover:border-brand">✍️ Colher assinatura</button>}
      </div>
      {order.customerSignatureUrl ? (
        <div className="mt-2 rounded-lg border border-green-500/30 bg-green-500/5 p-2">
          <p className="text-[11px] text-green-300">✓ Assinado{order.customerSignedAt ? ` em ${new Date(order.customerSignedAt).toLocaleString("pt-BR")}` : ""}</p>
          <img src={order.customerSignatureUrl} alt="assinatura" className="mt-1 h-16 rounded bg-white p-1" />
        </div>
      ) : pad ? (
        <div className="mt-2">
          <canvas ref={canvasRef} width={400} height={150} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} className="w-full touch-none rounded-lg border border-line bg-white" />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={clear} className="rounded-md border border-line px-3 py-1 text-xs hover:border-brand">limpar</button>
            <button disabled={busy} onClick={save} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "..." : "Confirmar assinatura"}</button>
            <button onClick={() => { clear(); setPad(false); }} className="text-xs text-muted hover:text-fg">cancelar</button>
          </div>
          <p className="mt-1 text-[10px] text-muted">Peça o cliente assinar na tela (tablet/touch). Comprovação simples de retirada — sem certificado.</p>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-muted">Ainda não assinado. O cliente também pode assinar pelo portal dele quando o pedido ficar pronto.</p>
      )}
    </div>
  );
}

function FabricEditor({ order, onChanged }: { order: any; onChanged: () => void }) {
  const dialog = useDialog();
  const consumed = !!order.fabricConsumedAt;
  const [rows, setRows] = useState<Array<{ productId: string; productName: string; qty: number; productStock?: number }>>(() => (order.fabrics ?? []).map((f: any) => ({ productId: f.productId, productName: f.productName ?? "Produto", qty: f.qty ?? 0, productStock: f.productStock })));
  const [open, setOpen] = useState((order.fabrics ?? []).length > 0);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function search(term: string) {
    setQ(term);
    if (term.trim().length < 2) { setResults([]); return; }
    const res = await fetch(`/api/products?q=${encodeURIComponent(term.trim())}&activeOnly=1`, { credentials: "include", headers: { "x-no-loading": "1" } });
    const d = await res.json().catch(() => null);
    setResults((d?.items ?? []).slice(0, 8));
  }
  function add(p: any) {
    if (rows.some((r) => r.productId === p.id)) { setQ(""); setResults([]); return; }
    setRows((rs) => [...rs, { productId: p.id, productName: p.name, qty: 1, productStock: p.stockQty }]);
    setQ(""); setResults([]);
  }
  function setQty(i: number, qty: number) { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, qty } : r))); }
  function del(i: number) { setRows((rs) => rs.filter((_, idx) => idx !== i)); }

  async function save() {
    setBusy(true);
    try {
      const payload = rows.filter((r) => r.qty > 0).map((r) => ({ productId: r.productId, qty: Math.max(0, Math.trunc(r.qty)) }));
      const res = await fetch(`/api/production/${order.id}/fabrics`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ rows: payload }) });
      if (!res.ok) { dialog.toast("Falha ao salvar tecidos", "error"); return; }
      dialog.toast("Tecidos salvos ✅", "success"); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Tecido / insumos {consumed ? <span className="ml-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">baixado do estoque</span> : <span className="ml-1 text-[11px] text-muted">(baixa ao entrar em produção)</span>}</p>
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-brand hover:underline">{open ? "ocultar" : "abrir"}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {rows.map((r, i) => (
            <div key={r.productId} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{r.productName}{r.productStock != null && <span className="ml-1 text-[10px] text-muted">(estoque: {r.productStock})</span>}</span>
              <input type="number" min={0} disabled={consumed} value={r.qty} onChange={(e) => setQty(i, Number(e.target.value))} className="w-20 rounded border border-line bg-bg/40 px-2 py-1 text-sm disabled:opacity-60" />
              {!consumed && <button onClick={() => del(i)} className="text-red-300 hover:text-red-200" title="remover">✕</button>}
            </div>
          ))}
          {rows.length === 0 && <p className="text-[11px] text-muted">Nenhum tecido vinculado.</p>}
          {!consumed && (
            <>
              <div className="relative">
                <input value={q} onChange={(e) => search(e.target.value)} placeholder="Buscar tecido/insumo no estoque…" className="input-base" />
                {results.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-xl border border-line bg-surface shadow-xl">
                    {results.map((p) => (
                      <button key={p.id} onClick={() => add(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-line/40">
                        <span className="truncate">{p.name}</span>
                        <span className="text-[10px] text-muted">estoque {p.stockQty ?? 0}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button disabled={busy} onClick={save} className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{busy ? "..." : "Salvar tecidos"}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LotesTab({ orders, onOpen }: { orders: any[]; onOpen: (id: string) => void }) {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/production/batches", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const free = orders.filter((o) => !o.batchId && !["finalizado", "cancelado"].includes(o.status));

  async function create() {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (!name.trim()) { dialog.toast("Dê um nome ao lote", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/production/batches", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim(), orderIds: ids }) });
      if (!res.ok) { dialog.toast("Falha ao criar lote", "error"); return; }
      dialog.toast("Lote criado ✅", "success"); setCreating(false); setName(""); setPicked({}); load();
    } finally { setBusy(false); }
  }
  async function setStatus(id: string, status: string) { setBusy(true); try { await fetch(`/api/production/batches/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) }); load(); } finally { setBusy(false); } }
  async function remove(id: string) { const ok = await dialog.confirm({ title: "Excluir lote", message: "Os pedidos voltam a ficar soltos. Confirma?" }); if (!ok) return; await fetch(`/api/production/batches/${id}`, { method: "DELETE", credentials: "include" }); load(); }

  const BATCH_LABEL: Record<string, string> = { aberto: "Aberto", producao: "Em produção", concluido: "Concluído", cancelado: "Cancelado" };
  if (items === null) return <p className="text-sm text-muted">Carregando…</p>;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Agrupe pedidos pra produzir e avançar juntos. Ao marcar o lote como "Em produção", os pedidos em etapas iniciais avançam pra Produção.</p>
        <button onClick={() => setCreating((v) => !v)} className="rounded-xl border border-line px-3 py-1.5 text-sm transition hover:border-brand/60 hover:text-brand">{creating ? "cancelar" : "+ Novo lote"}</button>
      </div>

      {creating && (
        <div className="card">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do lote (ex.: Sublimação 12/06)" className="input-base" />
          <p className="mt-3 text-[10px] uppercase text-muted">Pedidos disponíveis ({free.length})</p>
          <div className="mt-1 max-h-52 space-y-1 overflow-y-auto">
            {free.length === 0 ? <p className="text-xs text-muted">Nenhum pedido livre pra agrupar.</p> : free.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 p-2 text-sm">
                <input type="checkbox" checked={!!picked[o.id]} onChange={(e) => setPicked((p) => ({ ...p, [o.id]: e.target.checked }))} />
                <span className="flex-1">{o.contactName} <span className="text-xs text-muted">{o.shortCode}</span></span>
                <span className="text-[10px] text-muted">{STATUS_LABEL[o.status] ?? o.status}{o.dueDate ? ` · ${new Date(o.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}</span>
              </label>
            ))}
          </div>
          <button disabled={busy} onClick={create} className="btn-grad mt-3 disabled:opacity-50">{busy ? "..." : "Criar lote"}</button>
        </div>
      )}

      {items.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-8 text-center text-muted">Nenhum lote ainda.</p> : items.map((b) => (
        <div key={b.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{b.name} <span className="ml-1 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand">{BATCH_LABEL[b.status] ?? b.status}</span></p>
              <p className="text-xs text-muted">{b.orderCount} pedido(s) · {brl(b.totalCents)}{b.nextDue ? ` · prazo ${new Date(b.nextDue).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {["aberto", "producao", "concluido"].map((s) => (
                <button key={s} disabled={busy} onClick={() => setStatus(b.id, s)} className={`rounded-full px-3 py-1 ${b.status === s ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{BATCH_LABEL[s]}</button>
              ))}
              <button disabled={busy} onClick={() => remove(b.id)} className="rounded-full border border-line px-3 py-1 text-red-300 hover:border-red-400">Excluir</button>
            </div>
          </div>
          <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
            {(b.orders ?? []).map((o: any) => (
              <button key={o.id} onClick={() => onOpen(o.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-line/40">
                <span>{o.contactName} <span className="text-xs text-muted">{o.shortCode}</span></span>
                <span className="text-[10px] uppercase text-muted">{STATUS_LABEL[o.status] ?? o.status}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NewOrder({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  const [dueDate, setDueDate] = useState(""); const [delivery, setDelivery] = useState(false);
  const [downPayment, setDownPayment] = useState(""); const [needsInvoice, setNeedsInvoice] = useState(false);
  const [fiscalCpf, setFiscalCpf] = useState(""); const [fiscalAddress, setFiscalAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Array<{ description: string; qty: string; price: string; sizes?: Record<string, number>; prodName?: string }>>([{ description: "", qty: "1", price: "" }]);
  const [busy, setBusy] = useState(false);
  // cliente: autocomplete na base + cadastro automático no backend se novo
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [custSugs, setCustSugs] = useState<any[]>([]);
  const [custOpen, setCustOpen] = useState(false);
  const custTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function searchCustomer(term: string) {
    setName(term); setCustomerId(null); setCustOpen(true);
    if (custTimer.current) clearTimeout(custTimer.current);
    if (term.trim().length < 2) { setCustSugs([]); return; }
    custTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/customers?q=${encodeURIComponent(term.trim())}&limit=8`, { credentials: "include", headers: { "x-no-loading": "1" } });
        const d = await r.json().catch(() => null);
        setCustSugs(d?.items ?? []);
      } catch { setCustSugs([]); }
    }, 220);
  }
  function pickCustomer(c: any) {
    setCustOpen(false); setCustSugs([]);
    setName(c.name ?? ""); setPhone(c.phone || c.whatsappPhone || ""); setEmail(c.email ?? "");
    if (c.document) setFiscalCpf(c.document);
    setCustomerId(c.id);
  }
  // desconto (com autorização) + gerar pagamento
  const [discount, setDiscount] = useState("");
  const [discAuth, setDiscAuth] = useState<{ requestId: string; code: string; adminName: string } | null>(null);
  const [discModal, setDiscModal] = useState(false);
  const [payFor, setPayFor] = useState<{ orderId: string; amountCents: number } | null>(null);
  // autocomplete do item (tabela de valores + PDV) e modal de tamanhos
  const [sugRow, setSugRow] = useState<number | null>(null);
  const [sugs, setSugs] = useState<any[]>([]);
  const [catSizes, setCatSizes] = useState<string[]>(["P", "M", "G", "GG", "XG"]);
  const [sizesModal, setSizesModal] = useState<{ row: number; name: string; tiers: any[] } | null>(null);
  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function searchItem(i: number, term: string) {
    setItem(i, { description: term }); setSugRow(i);
    if (sugTimer.current) clearTimeout(sugTimer.current);
    if (term.trim().length < 2) { setSugs([]); return; }
    sugTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/production/catalog/search?q=${encodeURIComponent(term.trim())}`, { credentials: "include", headers: { "x-no-loading": "1" } });
        const d = await res.json().catch(() => null);
        if (res.ok) { setSugs(d?.items ?? []); if (Array.isArray(d?.sizes) && d.sizes.length) setCatSizes(d.sizes); }
      } catch { setSugs([]); }
    }, 220);
  }
  function pickSug(i: number, s: any) {
    setSugs([]); setSugRow(null);
    if (s.source === "tabela") { setSizesModal({ row: i, name: s.name, tiers: s.tiers ?? [] }); }
    else { setItem(i, { description: s.name, price: s.priceCents ? (s.priceCents / 100).toFixed(2).replace(".", ",") : "" }); }
  }
  function applySizes(row: number, name: string, breakdown: Record<string, number>, total: number, unitCents: number) {
    const bd = Object.entries(breakdown).filter(([, q]) => q > 0).map(([s, q]) => `${s}:${q}`).join(", ");
    const sizes = Object.fromEntries(Object.entries(breakdown).filter(([, q]) => q > 0));
    setItem(row, { description: bd ? `${name} (${bd})` : name, qty: String(Math.max(1, total)), price: (unitCents / 100).toFixed(2).replace(".", ","), sizes, prodName: name });
    setSizesModal(null);
  }
  // entrada: % padrão configurável (gráfica). Pré-preenche a entrada com esse % do
  // total até o operador editar manualmente.
  const [downPct, setDownPct] = useState(50);
  const [downTouched, setDownTouched] = useState(false);
  // teto de desconto do vendedor (% do subtotal). Acima exige autorização.
  // Owner/admin recebem 100 do backend (não sofrem limite).
  const [maxDiscPct, setMaxDiscPct] = useState(0);
  // Input de "desconto em %" — quando o user digita aqui, atualizamos o R$
  // calculado. Quando edita R$, atualizamos o %. Estado separado pra evitar
  // loop e flicker de arredondamento.
  const [discountPct, setDiscountPct] = useState("");
  const gross = items.reduce((s, it) => s + toCents(it.price) * (Number(it.qty) || 0), 0);
  const discountCents = Math.min(gross, Math.max(0, toCents(discount)));
  const appliedDiscPct = gross > 0 ? (discountCents / gross) * 100 : 0;
  const needsAuthForDiscount = discountCents > 0 && appliedDiscPct > maxDiscPct + 1e-6;
  const total = Math.max(0, gross - discountCents);
  const setItem = (i: number, patch: any) => setItems((a) => a.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  useEffect(() => {
    fetch("/api/inbox/settings", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d.graficaDownPaymentPct === "number") setDownPct(d.graficaDownPaymentPct); }).catch(() => {});
    fetch("/api/production/max-discount-pct", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && typeof d.maxPct === "number") setMaxDiscPct(d.maxPct); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (downTouched || downPct <= 0 || total <= 0) return;
    const cents = Math.round((total * downPct) / 100);
    setDownPayment((cents / 100).toFixed(2).replace(".", ","));
  }, [total, downPct, downTouched]);
  const remainingCents = Math.max(0, total - toCents(downPayment));
  // se mudar o desconto, invalida a autorização anterior
  useEffect(() => { setDiscAuth(null); }, [discount]);

  async function save(opts?: { thenPay?: boolean }): Promise<void> {
    if (name.trim().length < 2) { dialog.toast("Informe o cliente", "error"); return; }
    const its = items.filter((it) => it.description.trim()).map((it) => ({ description: it.description.trim(), qty: Math.max(1, Number(it.qty) || 1), unitPriceCents: toCents(it.price) }));
    if (!its.length) { dialog.toast("Adicione ao menos um item", "error"); return; }
    // Só exige autorização se o desconto passar do teto configurado (gráfica).
    // Owner/admin recebem maxDiscPct=100 do backend e nunca abrem o modal.
    if (needsAuthForDiscount && !discAuth) { dialog.toast(`Desconto de ${appliedDiscPct.toFixed(2)}% passa do seu limite (${maxDiscPct}%). Solicite autorização.`, "error"); setDiscModal(true); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/production", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ contactName: name.trim(), contactPhone: phone.trim() || null, contactEmail: email.trim() || null, customerId: customerId ?? null, dueDate: dueDate || null, delivery, downPaymentCents: toCents(downPayment), needsInvoice, fiscalCpf: needsInvoice ? (fiscalCpf.trim() || null) : null, fiscalAddress: needsInvoice ? (fiscalAddress.trim() || null) : null, notes: notes.trim() || null, discountCents, discountAuthRequestId: discAuth?.requestId ?? null, discountAuthCode: discAuth?.code ?? null, items: its }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao salvar", "error"); return; }
      // grava o detalhamento de tamanhos na ficha técnica (roster) do pedido
      const orderId = d?.order?.id;
      const rosterRows: Array<{ playerName: string; size: string; qty: number }> = [];
      for (const it of items) {
        if (!it.sizes) continue;
        const nm = (it.prodName || it.description.replace(/\s*\([^)]*\)\s*$/, "")).trim() || "Item";
        for (const [size, q] of Object.entries(it.sizes)) if (q > 0) rosterRows.push({ playerName: nm, size, qty: q });
      }
      if (orderId && rosterRows.length) {
        await fetch(`/api/production/${orderId}/roster`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ rows: rosterRows }) }).catch(() => undefined);
      }
      if (opts?.thenPay && orderId && toCents(downPayment) > 0) { setPayFor({ orderId, amountCents: toCents(downPayment) }); return; }
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Novo pedido de produção</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="relative block"><span className="mb-1 block text-[10px] uppercase text-muted">Cliente {customerId ? <span className="text-green-300">· cadastrado</span> : ""}</span>
            <input value={name} onChange={(e) => searchCustomer(e.target.value)} onFocus={() => { if (name.trim().length >= 2 && !customerId) searchCustomer(name); }} onBlur={() => setTimeout(() => setCustOpen(false), 150)} autoComplete="off" placeholder="Nome (busca na base)…" className="input-base" />
            {custOpen && custSugs.length > 0 && (
              <div className="absolute z-40 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
                {custSugs.map((c) => (
                  <button type="button" key={c.id} onMouseDown={(e) => { e.preventDefault(); pickCustomer(c); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-line">
                    <span className="font-medium">{c.name}</span>{c.phone || c.whatsappPhone ? <span className="text-muted"> · {c.phone || c.whatsappPhone}</span> : null}{c.document ? <span className="text-muted"> · {c.document}</span> : null}
                  </button>
                ))}
              </div>
            )}
          </label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">WhatsApp</span><input value={phone} onChange={(e) => { setPhone(e.target.value); setCustomerId(null); }} className="input-base" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">E-mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} className="input-base" /></label>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-muted">Itens</span><button onClick={() => setItems((a) => [...a, { description: "", qty: "1", price: "" }])} className="text-xs text-brand hover:underline">+ item</button></div>
          {items.map((it, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <div className="relative flex-1">
                <input
                  value={it.description}
                  onChange={(e) => searchItem(i, e.target.value)}
                  onFocus={() => { if (it.description.trim().length >= 2) searchItem(i, it.description); }}
                  onBlur={() => setTimeout(() => setSugRow((r) => (r === i ? null : r)), 150)}
                  placeholder="Buscar produto (tabela de valores ou PDV)…"
                  autoComplete="off"
                  className="input-base"
                />
                {sugRow === i && sugs.length > 0 && (
                  <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
                    {sugs.map((s) => (
                      <button type="button" key={`${s.source}-${s.id}`} onMouseDown={(e) => { e.preventDefault(); pickSug(i, s); }} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-line">
                        <span>{s.name}{s.category ? <span className="text-muted"> · {s.category}</span> : null}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${s.source === "tabela" ? "bg-brand/20 text-brand" : "bg-line text-muted"}`}>{s.source === "tabela" ? "tabela" : "PDV"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input type="number" min={1} value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} className="w-16 rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" />
              <input value={it.price} onChange={(e) => setItem(i, { price: e.target.value })} inputMode="decimal" placeholder="R$ unit." className="w-28 rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" />
              {items.length > 1 && <button onClick={() => setItems((a) => a.filter((_, idx) => idx !== i))} className="text-muted hover:text-red-300">✕</button>}
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Prazo de entrega</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-base" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Entrada (R$){downPct > 0 ? ` · sugestão ${downPct}%` : ""}</span><input value={downPayment} onChange={(e) => { setDownTouched(true); setDownPayment(e.target.value); }} inputMode="decimal" className="input-base" /></label>
          <div className="flex flex-col items-start justify-end"><span className="text-sm">Total: <b className="text-lg">{brl(total)}</b></span>{discountCents > 0 && <span className="text-[11px] text-green-300">desconto {brl(discountCents)} (de {brl(gross)})</span>}{total > 0 && toCents(downPayment) > 0 && toCents(downPayment) < total && <span className="text-[11px] text-muted">Restante: {brl(remainingCents)}</span>}</div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Desconto (R$)</span>
            <input
              value={discount}
              onChange={(e) => {
                const v = e.target.value;
                setDiscount(v);
                // recalcula o % equivalente quando o user digita R$
                const cents = Math.min(gross, Math.max(0, toCents(v)));
                setDiscountPct(gross > 0 ? ((cents / gross) * 100).toFixed(2).replace(".", ",") : "");
              }}
              inputMode="decimal"
              placeholder="0,00"
              className="w-32 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Desconto (%)</span>
            <input
              value={discountPct}
              onChange={(e) => {
                const v = e.target.value;
                setDiscountPct(v);
                // recalcula R$ equivalente quando o user digita %
                const pct = Math.max(0, Math.min(100, parseFloat(v.replace(",", ".")) || 0));
                const cents = Math.round((gross * pct) / 100);
                setDiscount((cents / 100).toFixed(2).replace(".", ","));
              }}
              inputMode="decimal"
              placeholder="0"
              className="w-24 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"
            />
          </label>
          {discountCents > 0 && (
            needsAuthForDiscount
              ? (discAuth
                  ? <span className="rounded-full bg-green-500/15 px-2 py-1 text-[11px] font-semibold text-green-300">✓ {appliedDiscPct.toFixed(2)}% — autorizado por {discAuth.adminName}</span>
                  : <button onClick={() => setDiscModal(true)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 hover:border-amber-400">Pedir autorização ({appliedDiscPct.toFixed(2)}% &gt; limite {maxDiscPct}%)</button>)
              : <span className="rounded-full bg-brand/15 px-2 py-1 text-[11px] font-semibold text-brand">{appliedDiscPct.toFixed(2)}% — dentro do seu limite ({maxDiscPct}%)</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} className="h-4 w-4" /> Vai entregar (não é retirada)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={needsInvoice} onChange={(e) => setNeedsInvoice(e.target.checked)} className="h-4 w-4" /> Pediu nota fiscal</label>
        </div>
        {needsInvoice && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="mb-2 text-[11px] text-amber-200">Para emitir a NF precisamos do nome (já informado acima) e do CPF do cliente. Endereço é opcional. Pode completar depois na aba Notas fiscais.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">CPF</span><input value={fiscalCpf} onChange={(e) => setFiscalCpf(e.target.value)} className="input-base" /></label>
              <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] uppercase text-muted">Endereço (opcional)</span><input value={fiscalAddress} onChange={(e) => setFiscalAddress(e.target.value)} className="input-base" /></label>
            </div>
          </div>
        )}
        <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase text-muted">Observações</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input-base" /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => save()} className="btn-grad flex-1 disabled:opacity-50">{busy ? "Salvando…" : "Criar pedido"}</button>
          <button disabled={busy || toCents(downPayment) <= 0} onClick={() => save({ thenPay: true })} title={toCents(downPayment) <= 0 ? "Informe a entrada" : ""} className="rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/10 disabled:opacity-50">Criar e cobrar entrada</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
      </div>
      {discModal && <DiscountAuthModal discountCents={discountCents} onClose={() => setDiscModal(false)} onConfirmed={(v) => { setDiscAuth(v); setDiscModal(false); dialog.toast(`Desconto autorizado por ${v.adminName} ✅`, "success"); }} />}
      {payFor && <PaymentModal orderId={payFor.orderId} defaultAmountCents={payFor.amountCents} kind="entrada" totalCents={total} onClose={() => { setPayFor(null); onSaved(); }} onDone={() => {}} />}
      {sizesModal && (
        <SizesModal
          name={sizesModal.name}
          tiers={sizesModal.tiers}
          sizes={catSizes}
          onClose={() => setSizesModal(null)}
          onConfirm={(bd, total, unit) => applySizes(sizesModal.row, sizesModal.name, bd, total, unit)}
        />
      )}
    </div>
  );
}

/** Modal de tamanhos: informa quantidade por tamanho; o preço unitário sai da FAIXA pela qtd total. */
function SizesModal({ name, tiers, sizes, onConfirm, onClose }: { name: string; tiers: any[]; sizes: string[]; onConfirm: (bd: Record<string, number>, total: number, unitCents: number) => void; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const total = sizes.reduce((s, sz) => s + (Number(qtys[sz]) || 0), 0);
  const unit = priceForQty(tiers, total);
  const line = total * unit;
  const sorted = [...(tiers ?? [])].filter((t) => t && t.minQty > 0).sort((a, b) => a.minQty - b.minQty);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">{name}</h3>
        <p className="mt-1 text-xs text-muted">Informe a quantidade por tamanho. O preço por unidade é definido pela faixa da quantidade total.</p>
        {sorted.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sorted.map((t) => (
              <span key={t.minQty} className={`rounded-full border px-2 py-0.5 text-[10px] ${total >= t.minQty ? "border-brand bg-brand/15 text-brand" : "border-line text-muted"}`}>{t.minQty}+ {brl(t.priceCents)}</span>
            ))}
          </div>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {sizes.map((sz) => (
            <label key={sz} className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">{sz}</span>
              <input type="number" min={0} value={qtys[sz] ?? ""} onChange={(e) => setQtys((q) => ({ ...q, [sz]: e.target.value }))} placeholder="0" className="input-base" />
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <span>Total: <b>{total}</b> un · unit. <b>{brl(unit)}</b></span>
          <span className="text-base font-semibold">{brl(line)}</span>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={total < 1} onClick={() => onConfirm(Object.fromEntries(sizes.map((s) => [s, Number(qtys[s]) || 0])), total, unit)} className="btn-grad flex-1 disabled:opacity-50">Adicionar ao pedido</button>
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

/** Botão que gera/mostra o link de um painel TV/kiosk (recepção ou produção). */
function KioskLinkButton({ kind = "recepcao" }: { kind?: "recepcao" | "producao" }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = kind === "producao" ? "Painel produção" : "Painel recepção";

  function buildUrl(token: string) { return `${window.location.origin}/k/${kind}/${token}`; }
  async function openPanel() {
    setOpen(true); setBusy(true);
    try {
      let r = await fetch("/api/kiosk/token", { credentials: "include", headers: { "x-no-loading": "1" } });
      let d = await r.json().catch(() => null);
      let token = d?.token as string | null;
      if (!token) { r = await fetch("/api/kiosk/token", { method: "POST", credentials: "include" }); d = await r.json().catch(() => null); token = d?.token ?? null; }
      setUrl(token ? buildUrl(token) : null);
    } finally { setBusy(false); }
  }
  async function rotate() {
    if (!(await dialog.confirm("Gerar um link NOVO? O link atual deixa de funcionar."))) return;
    setBusy(true);
    try { const r = await fetch("/api/kiosk/token", { method: "POST", credentials: "include" }); const d = await r.json().catch(() => null); setUrl(d?.token ? buildUrl(d.token) : null); } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={openPanel} className="rounded-xl border border-line px-3 py-2 text-sm font-medium transition hover:border-brand/60 hover:text-brand">📺 {label}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">{kind === "producao" ? "Painel de produção (TV)" : "Painel de recepção (TV)"}</h3>
            <p className="mt-1 text-xs text-muted">Abra este link no navegador da TV/computador {kind === "producao" ? "da produção" : "da recepção"}. Atualiza sozinho e não precisa de login.</p>
            {busy ? <p className="mt-4 text-sm text-muted">Gerando…</p> : url ? (
              <>
                <input readOnly value={url} onClick={(e) => (e.target as HTMLInputElement).select()} className="input-base mt-3 font-mono text-xs" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => { navigator.clipboard?.writeText(url); dialog.toast("Link copiado ✅", "success"); }} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Copiar</button>
                  <a href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Abrir ↗</a>
                  <button onClick={rotate} className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-fg">Gerar link novo</button>
                </div>
              </>
            ) : <p className="mt-4 text-sm text-red-300">Não foi possível gerar o link.</p>}
            <button onClick={() => setOpen(false)} className="mt-3 w-full text-center text-xs text-muted hover:text-fg">fechar</button>
          </div>
        </div>
      )}
    </>
  );
}

// ===================== ABA TABELAS (gráfica): valores + medidas =====================
function TabelasTab() {
  const dialog = useDialog();
  const [data, setData] = useState<{ priceItems: any[]; sizeCharts: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [newChartKey, setNewChartKey] = useState(0);
  const load = () => fetch("/api/production/catalog", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => setData(d ?? { priceItems: [], sizeCharts: [] })).catch(() => {});
  useEffect(() => { load(); }, []);

  async function seed() {
    if (!(await dialog.confirm("Aplicar a tabela 2025 (valores + medidas)? Itens com o mesmo nome são atualizados; os demais são mantidos."))) return;
    setBusy(true);
    try {
      const r = await fetch("/api/production/catalog/seed-2025", { method: "POST", credentials: "include" });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      dialog.toast(`Aplicado: ${d.priceItems} itens, ${d.sizeCharts} medidas ✅`, "success"); load();
    } finally { setBusy(false); }
  }

  if (!data) return <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Carregando…</p>;

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <p className="text-sm font-semibold">Tabelas da gráfica</p>
          <p className="text-xs text-muted">A IA usa estes valores (por faixa de quantidade) e medidas para atender sozinha. Exclusivo do nicho gráfica.</p>
        </div>
        <button disabled={busy} onClick={seed} className="rounded-lg border border-brand px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/10 disabled:opacity-50">Aplicar tabela 2025</button>
      </div>

      <section>
        <p className="mb-2 text-sm font-semibold">Tabela de valores (preço por quantidade)</p>
        <div className="space-y-2">
          {data.priceItems.map((it) => <PriceItemCard key={it.id} item={it} onSaved={load} />)}
          <PriceItemCard key={`new-${newKey}`} item={null} onSaved={() => { setNewKey((k) => k + 1); load(); }} />
        </div>
      </section>

      <section>
        <p className="mb-2 text-sm font-semibold">Tabela de medidas</p>
        <div className="space-y-2">
          {data.sizeCharts.map((c) => <SizeChartCard key={c.id} chart={c} onSaved={load} />)}
          <SizeChartCard key={`newc-${newChartKey}`} chart={null} onSaved={() => { setNewChartKey((k) => k + 1); load(); }} />
        </div>
      </section>
    </div>
  );
}

function PriceItemCard({ item, onSaved }: { item: any | null; onSaved: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [unitLabel, setUnitLabel] = useState(item?.unitLabel ?? "");
  const [tiers, setTiers] = useState<{ minQty: string; price: string }[]>(
    (Array.isArray(item?.tiers) ? item!.tiers : []).map((t: any) => ({ minQty: String(t.minQty), price: (t.priceCents / 100).toFixed(2) })),
  );
  const [busy, setBusy] = useState(false);
  const isNew = !item?.id;

  function setTier(i: number, k: "minQty" | "price", v: string) { setTiers((t) => t.map((x, idx) => (idx === i ? { ...x, [k]: v } : x))); }
  function addTier() { setTiers((t) => [...t, { minQty: "", price: "" }]); }
  function rmTier(i: number) { setTiers((t) => t.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!name.trim()) { dialog.toast("Informe o nome", "error"); return; }
    const payload = {
      id: item?.id ?? null, name: name.trim(), category: category.trim() || null, unitLabel: unitLabel.trim() || null,
      tiers: tiers.map((t) => ({ minQty: Math.trunc(Number(t.minQty) || 0), priceCents: toCents(t.price) })).filter((t) => t.minQty > 0),
    };
    setBusy(true);
    try {
      const r = await fetch("/api/production/catalog/price-item", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      if (isNew) { setName(""); setCategory(""); setUnitLabel(""); setTiers([]); }
      dialog.toast("Salvo ✅", "success"); onSaved();
    } finally { setBusy(false); }
  }
  async function del() {
    if (!item?.id) return;
    if (!(await dialog.confirm(`Excluir "${item.name}"?`))) return;
    const r = await fetch(`/api/production/catalog/price-item/${item.id}/delete`, { method: "POST", credentials: "include" });
    if (r.ok) { dialog.toast("Excluído", "success"); onSaved(); } else dialog.toast("Falha", "error");
  }

  return (
    <div className={`rounded-xl border p-3 transition ${isNew ? "border-dashed border-line bg-surface-2" : "border-line bg-surface hover:border-brand/50"}`}>
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isNew ? "+ Novo item (ex.: Camisa Polo)" : "Nome"} className="input-base" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoria (ex.: Camisas)" className="input-base" />
        <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="Unidade p/ IA (ex.: camisa)" className="input-base" />
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-1 rounded-lg border border-line bg-bg/40 px-2 py-1">
            <input value={t.minQty} onChange={(e) => setTier(i, "minQty", e.target.value.replace(/\D/g, ""))} placeholder="qtd" inputMode="numeric" className="w-12 bg-transparent text-center text-xs outline-none" />
            <span className="text-[10px] text-muted">+ un. R$</span>
            <input value={t.price} onChange={(e) => setTier(i, "price", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" inputMode="decimal" className="w-16 bg-transparent text-center text-xs outline-none" />
            <button onClick={() => rmTier(i)} className="text-[10px] text-muted hover:text-red-300">✕</button>
          </div>
        ))}
        <button onClick={addTier} className="rounded-lg border border-line px-2 py-1 text-[11px] text-brand hover:border-brand">+ faixa</button>
      </div>
      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={save} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{isNew ? "Adicionar" : "Salvar"}</button>
        {!isNew && <button onClick={del} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">Excluir</button>}
      </div>
    </div>
  );
}

function SizeChartCard({ chart, onSaved }: { chart: any | null; onSaved: () => void }) {
  const dialog = useDialog();
  const [name, setName] = useState(chart?.name ?? "");
  const [rows, setRows] = useState<{ size: string; comprimento: string; largura: string }[]>(
    (Array.isArray(chart?.rows) ? chart!.rows : []).map((r: any) => ({ size: r.size ?? "", comprimento: r.comprimento ?? "", largura: r.largura ?? "" })),
  );
  const [busy, setBusy] = useState(false);
  const isNew = !chart?.id;

  function setRow(i: number, k: "size" | "comprimento" | "largura", v: string) { setRows((rs) => rs.map((x, idx) => (idx === i ? { ...x, [k]: v } : x))); }
  function addRow() { setRows((rs) => [...rs, { size: "", comprimento: "", largura: "" }]); }
  function rmRow(i: number) { setRows((rs) => rs.filter((_, idx) => idx !== i)); }

  async function save() {
    if (!name.trim()) { dialog.toast("Informe o nome da grade", "error"); return; }
    const payload = { id: chart?.id ?? null, name: name.trim(), rows: rows.filter((r) => r.size.trim()).map((r) => ({ size: r.size.trim(), comprimento: r.comprimento.trim() || null, largura: r.largura.trim() || null })) };
    setBusy(true);
    try {
      const r = await fetch("/api/production/catalog/size-chart", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      if (isNew) { setName(""); setRows([]); }
      dialog.toast("Salvo ✅", "success"); onSaved();
    } finally { setBusy(false); }
  }
  async function del() {
    if (!chart?.id) return;
    if (!(await dialog.confirm(`Excluir a grade "${chart.name}"?`))) return;
    const r = await fetch(`/api/production/catalog/size-chart/${chart.id}/delete`, { method: "POST", credentials: "include" });
    if (r.ok) { dialog.toast("Excluído", "success"); onSaved(); } else dialog.toast("Falha", "error");
  }

  return (
    <div className={`rounded-xl border p-3 transition ${isNew ? "border-dashed border-line bg-surface-2" : "border-line bg-surface hover:border-brand/50"}`}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isNew ? "+ Nova grade (ex.: Masculina)" : "Nome da grade"} className="w-full rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-sm sm:w-64" />
      <div className="mt-2 space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <input value={r.size} onChange={(e) => setRow(i, "size", e.target.value)} placeholder="Tamanho" className="w-24 rounded-lg border border-line bg-bg/40 px-2 py-1 text-xs" />
            <input value={r.comprimento} onChange={(e) => setRow(i, "comprimento", e.target.value)} placeholder="Comprimento" className="w-28 rounded-lg border border-line bg-bg/40 px-2 py-1 text-xs" />
            <input value={r.largura} onChange={(e) => setRow(i, "largura", e.target.value)} placeholder="Largura" className="w-28 rounded-lg border border-line bg-bg/40 px-2 py-1 text-xs" />
            <button onClick={() => rmRow(i)} className="text-[10px] text-muted hover:text-red-300">✕</button>
          </div>
        ))}
        <button onClick={addRow} className="rounded-lg border border-line px-2 py-1 text-[11px] text-brand hover:border-brand">+ tamanho</button>
      </div>
      <div className="mt-2 flex gap-2">
        <button disabled={busy} onClick={save} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{isNew ? "Adicionar" : "Salvar"}</button>
        {!isNew && <button onClick={del} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10">Excluir</button>}
      </div>
    </div>
  );
}
