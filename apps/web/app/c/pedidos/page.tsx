"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STATUS_LABEL: Record<string, string> = { novo: "Pedido", arte: "Arte", costura: "Costura", producao: "Produção", separacao: "Separação", pronto: "Pronto", entrega: "Entrega", finalizado: "Finalizado", cancelado: "Cancelado" };
const ART_LABEL: Record<string, string> = { aguardando_arquivos: "Aguardando seus arquivos", arquivos_recebidos: "Arquivos recebidos", em_producao: "Arte em produção", enviada: "Arte para sua aprovação", aprovada: "Arte aprovada", reprovada: "Aguardando ajustes" };
function brl(c: number | string): string { return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

export default function PedidosPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<any[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/portal/production-orders", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => d && setOrders(d.items ?? []))
      .catch(() => setOrders([]));
  }, [router]);
  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Meus pedidos</h1>
        <Link href="/c" className="text-sm text-muted hover:text-fg">← voltar</Link>
      </div>
      {orders === null ? <p className="text-muted">Carregando…</p>
        : orders.length === 0 ? <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-muted">Você ainda não tem pedidos.</p>
        : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-xl border border-line bg-bg/60">
                <button onClick={() => setOpenId(openId === o.id ? null : o.id)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                  <div>
                    <p className="font-medium">{o.shortCode}</p>
                    <p className="text-xs text-muted">{brl(o.totalCents)}{o.dueDate ? ` · prazo ${new Date(o.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[10px]">
                    <span className="rounded-full bg-brand/15 px-2 py-0.5 font-semibold uppercase text-brand">{STATUS_LABEL[o.status] ?? o.status}</span>
                    {o.artStatus === "enviada" && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-semibold uppercase text-amber-300">aprovar arte</span>}
                  </div>
                </button>
                {openId === o.id && <Detail order={o} onChanged={load} />}
              </div>
            ))}
          </div>
        )}
    </main>
  );
}

function Detail({ order, onChanged }: { order: any; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const assets = (order.files ?? []).filter((f: any) => f.kind === "client_asset");
  const arts = (order.files ?? []).filter((f: any) => f.kind === "art");
  const latestArt = arts[0];
  const lastReview = (order.reviews ?? [])[0];

  async function upload(file: File) {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/portal/production-orders/${order.id}/files`, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) { setMsg("Falha no envio do arquivo"); return; }
      setMsg("Arquivo enviado ✅"); onChanged();
    } finally { setBusy(false); }
  }
  async function review(decision: "approved" | "rejected") {
    if (decision === "rejected" && comment.trim().length < 3) { setMsg("Descreva o que precisa ajustar"); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/portal/production-orders/${order.id}/art-review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ decision, comment: decision === "rejected" ? comment.trim() : null }) });
      if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error?.message ?? "Falha"); return; }
      setRejecting(false); setComment(""); onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-line/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Arte: <span className="text-fg">{ART_LABEL[order.artStatus] ?? order.artStatus}</span></p>

      {/* itens */}
      <div className="mt-2">
        {(order.items ?? []).map((it: any) => (
          <div key={it.id} className="flex justify-between border-b border-line/40 py-1 text-sm"><span>{it.qty}× {it.description}</span><span className="text-muted">{brl(it.lineTotalCents)}</span></div>
        ))}
      </div>

      {/* seus arquivos */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">Seus arquivos (logo, referência)</p>
          <label className="cursor-pointer rounded-md border border-line px-2 py-1 text-xs hover:border-brand">{busy ? "..." : "+ enviar arquivo"}
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
          </label>
        </div>
        {assets.map((f: any) => <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-sky-300 hover:underline">📎 {f.name ?? "arquivo"}</a>)}
        {assets.length === 0 && <p className="text-[11px] text-muted">Envie sua logo/arquivos pra produção começar a arte.</p>}
      </div>

      {/* arte enviada + aprovação */}
      {latestArt && (
        <div className="mt-4 rounded-lg border border-line bg-bg/40 p-3">
          <p className="text-xs font-medium">Arte (v{latestArt.version}) — <a href={latestArt.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">ver / baixar</a></p>
          {/* preview se for imagem */}
          {/\.(png|jpe?g|webp|gif)$/i.test(latestArt.url) && <img src={latestArt.url} alt="arte" className="mt-2 max-h-64 rounded-lg border border-line" />}
          {order.artStatus === "enviada" && (
            rejecting ? (
              <div className="mt-3 space-y-2">
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="O que precisa ajustar?" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => review("rejected")} className="rounded-lg bg-red-500/80 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Enviar ajustes</button>
                  <button onClick={() => setRejecting(false)} className="rounded-lg border border-line px-3 py-2 text-sm text-muted">cancelar</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button disabled={busy} onClick={() => review("approved")} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">✓ Aprovar arte</button>
                <button onClick={() => setRejecting(true)} className="rounded-lg border border-line px-4 py-2 text-sm text-red-300 hover:border-red-400">Pedir ajuste</button>
              </div>
            )
          )}
          {order.artStatus === "aprovada" && <p className="mt-2 text-xs text-green-300">✓ Você aprovou esta arte. Já vamos produzir!</p>}
          {order.artStatus === "reprovada" && <p className="mt-2 text-xs text-amber-300">Pedido de ajuste enviado. Em breve mandamos a nova versão.</p>}
        </div>
      )}

      {order.nfUrl && (
        <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3">
          <a href={order.nfUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-sky-300 hover:underline">📄 Baixar nota fiscal</a>
        </div>
      )}
      {lastReview && <p className="mt-2 text-[11px] text-muted">Última resposta: {lastReview.decision === "approved" ? "aprovada" : "ajuste pedido"}{lastReview.comment ? ` — ${lastReview.comment}` : ""}</p>}

      {/* Lista padronizada (jogadores/nomes/tamanhos) — cliente preenche enquanto em "novo" ou "arte" */}
      {["novo", "arte"].includes(order.status) && <RosterForm order={order} onChanged={onChanged} />}

      {/* Assinatura simplificada na finalização */}
      {["pronto", "embalagem", "entrega"].includes(order.status) && !order.customerSignatureUrl && <SignaturePad order={order} onChanged={onChanged} />}
      {order.customerSignatureUrl && (
        <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-xs text-green-300">✓ Você confirmou o recebimento em {order.customerSignedAt ? new Date(order.customerSignedAt).toLocaleString("pt-BR") : ""}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={order.customerSignatureUrl} alt="assinatura" className="mt-2 h-16 rounded bg-white p-1" />
        </div>
      )}

      {msg && <p className="mt-2 text-xs text-brand">{msg}</p>}
    </div>
  );
}

/** Formulário de lista padronizada — nome / nº / tamanho / qtd. Cliente
 *  preenche de uma vez quando o pedido ainda está em arte. */
function RosterForm({ order, onChanged }: { order: any; onChanged: () => void }) {
  // Grade do pedido (modelos com tamanhos fixos). [] = lista de texto livre.
  const grade: Array<{ key: string; label: string; sizes: string[] }> = Array.isArray(order?.sizeGrade)
    ? order.sizeGrade.filter((m: any) => m && typeof m.key === "string").map((m: any) => ({ key: String(m.key), label: String(m.label ?? m.key), sizes: Array.isArray(m.sizes) ? m.sizes.map((s: any) => String(s)) : [] }))
    : [];
  const hasGrade = grade.length > 0;
  const byKey = new Map(grade.map((m) => [m.key, m]));
  const firstKey = hasGrade ? grade[0]!.key : undefined;
  const initial = (order.roster ?? []).length > 0
    ? order.roster.map((r: any) => ({ playerName: r.playerName, number: r.number ?? "", size: r.size ?? "", qty: r.qty ?? 1, modelKey: r.modelKey ?? firstKey }))
    : [{ playerName: "", number: "", size: "", qty: 1, modelKey: firstKey }];
  const [rows, setRows] = useState<Array<{ playerName: string; number: string; size: string; qty: number; modelKey?: string }>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  function setRow(i: number, k: "playerName" | "number" | "size" | "qty" | "modelKey", v: any) { setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, [k]: v } : r)); }
  function addRow() { setRows((rs) => [...rs, { playerName: "", number: "", size: "", qty: 1, modelKey: firstKey }]); }
  function delRow(i: number) { setRows((rs) => rs.filter((_, idx) => idx !== i)); }
  async function save() {
    const filled = rows.filter((r) => r.playerName.trim().length > 0);
    if (hasGrade) {
      for (const r of filled) {
        const m = r.modelKey ? byKey.get(r.modelKey) : undefined;
        if (!m) { setMsg(`Escolha o modelo de "${r.playerName.trim()}"`); return; }
        if (m.sizes.length && !m.sizes.includes(r.size)) { setMsg(`Escolha o tamanho de "${r.playerName.trim()}" (${m.label})`); return; }
      }
    }
    const valid = filled.map((r) => ({ playerName: r.playerName.trim(), number: r.number || null, size: r.size || null, modelKey: hasGrade ? (r.modelKey ?? null) : null, qty: Math.max(1, Number(r.qty) || 1) }));
    if (!valid.length) { setMsg("Adicione ao menos uma linha com nome"); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/portal/production-orders/${order.id}/roster`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ rows: valid }) });
      if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error?.message ?? "Falha ao salvar"); return; }
      setMsg(`Lista salva (${valid.length} ${valid.length === 1 ? "linha" : "linhas"}) ✅`);
      onChanged();
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 rounded-lg border border-line bg-bg/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Lista de jogadores / peças</p>
      <p className="mt-1 text-[11px] text-muted">Preencha um por linha. Você pode salvar parcialmente e voltar depois — enquanto o pedido estiver em <i>arte</i>.{hasGrade && " Escolha o modelo e o tamanho nas listas."}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-muted">
            <tr><th className="text-left">Nome</th><th className="w-12">Nº</th>{hasGrade && <th className="w-28">Modelo</th>}<th className="w-20">Tam.</th><th className="w-12">Qtd</th><th className="w-8"></th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const m = r.modelKey ? byKey.get(r.modelKey) : undefined;
              return (
                <tr key={i} className="border-t border-line/30">
                  <td className="py-1 pr-1"><input value={r.playerName} onChange={(e) => setRow(i, "playerName", e.target.value)} placeholder="Nome" className="w-full rounded border border-line bg-bg/40 px-2 py-1" /></td>
                  <td className="py-1 pr-1"><input value={r.number} onChange={(e) => setRow(i, "number", e.target.value)} placeholder="10" className="w-full rounded border border-line bg-bg/40 px-2 py-1" /></td>
                  {hasGrade && (
                    <td className="py-1 pr-1"><select value={r.modelKey ?? ""} onChange={(e) => setRow(i, "modelKey", e.target.value)} className="w-full rounded border border-line bg-bg/40 px-1 py-1">{grade.map((gm) => <option key={gm.key} value={gm.key}>{gm.label}</option>)}</select></td>
                  )}
                  <td className="py-1 pr-1">
                    {hasGrade ? (
                      <select value={r.size} onChange={(e) => setRow(i, "size", e.target.value)} className="w-full rounded border border-line bg-bg/40 px-1 py-1"><option value="">—</option>{(m?.sizes ?? []).map((s) => <option key={s} value={s}>{s}</option>)}</select>
                    ) : (
                      <input value={r.size} onChange={(e) => setRow(i, "size", e.target.value)} placeholder="M" className="w-full rounded border border-line bg-bg/40 px-2 py-1" />
                    )}
                  </td>
                  <td className="py-1 pr-1"><input type="number" min={1} value={r.qty} onChange={(e) => setRow(i, "qty", Number(e.target.value))} className="w-full rounded border border-line bg-bg/40 px-2 py-1" /></td>
                  <td className="py-1 text-right"><button onClick={() => delRow(i)} className="text-muted hover:text-red-300">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={addRow} className="rounded border border-line px-3 py-1 text-xs hover:border-brand">+ adicionar linha</button>
        <button onClick={save} disabled={busy} className="ml-auto rounded bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar lista"}</button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-muted">{msg}</p>}
    </div>
  );
}

/** Pad de assinatura SIMPLIFICADO (canvas, sem certificado). Cliente confirma
 *  recebimento/retirada arrastando o dedo/mouse. PNG → server. */
function SignaturePad({ order, onChanged }: { order: any; onChanged: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [hasInk, setHasInk] = useState(false);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true; setHasInk(true);
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function end() { drawing.current = false; }
  function clear() { const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setHasInk(false); }
  async function save() {
    if (!hasInk) { setMsg("Faça sua assinatura antes de salvar"); return; }
    setBusy(true); setMsg(null);
    try {
      const dataUrl = canvasRef.current!.toDataURL("image/png");
      const res = await fetch(`/api/portal/production-orders/${order.id}/customer-signature`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ signatureDataUrl: dataUrl }) });
      if (!res.ok) { const d = await res.json().catch(() => null); setMsg(d?.error?.message ?? "Falha ao salvar assinatura"); return; }
      onChanged();
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  }, []);
  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">Confirmar recebimento — assinatura</p>
      <p className="mt-1 text-[11px] text-muted">Assine no quadro abaixo confirmando que conferiu / retirou o pedido. Sem certificado digital — é só uma comprovação visual.</p>
      <canvas
        ref={canvasRef}
        width={400} height={150}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        className="mt-2 w-full touch-none rounded-lg border border-line bg-white"
        style={{ aspectRatio: "400/150" }}
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={clear} className="rounded border border-line px-3 py-1 text-xs text-muted hover:border-amber-400">limpar</button>
        <button onClick={save} disabled={busy} className="ml-auto rounded bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Confirmar e assinar"}</button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-red-300">{msg}</p>}
    </div>
  );
}
