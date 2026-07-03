"use client";

import { useEffect, useRef, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

type Channel = "email" | "whatsapp" | "both";
type Category = "info" | "low" | "warning" | "critical";

const CATEGORIES: Array<{ value: Category; label: string; color: string }> = [
  { value: "info", label: "Novidade", color: "#2563eb" },
  { value: "low", label: "Informativo", color: "#0d9488" },
  { value: "warning", label: "Promoção", color: "#f59e0b" },
  { value: "critical", label: "Última chance", color: "#dc2626" },
];

const TEMPLATES: Record<string, { subject: string; body: string }> = {
  promo: {
    subject: "🔥 Promoção especial pra você, {{cliente.nome}}!",
    body: "Olá {{cliente.nome}}!\n\nPreparamos uma promoção imperdível na {{empresa.nome}}. Aproveite enquanto dura!\n\nVenha conferir 👇",
  },
  novidade: {
    subject: "✨ Novidade na {{empresa.nome}}",
    body: "Oi {{cliente.nome}}!\n\nChegaram novidades na {{empresa.nome}} que combinam com você. Passa pra ver!",
  },
};

export function MalaDiretaClient() {
  const dialog = useDialog();
  const [channel, setChannel] = useState<Channel>("both");
  const [category, setCategory] = useState<Category>("warning");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const wantEmail = channel === "email" || channel === "both";
  const wantWhats = channel === "whatsapp" || channel === "both";

  useEffect(() => {
    if (!wantEmail) { setPreviewHtml(null); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/messaging/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ subject, body, category }),
        });
        const d = await res.json();
        if (res.ok) setPreviewHtml(d.html);
      } catch { /* ignora */ }
    }, 500);
    return () => clearTimeout(t);
  }, [subject, body, category, wantEmail]);

  function applyTemplate(k: string) {
    const t = TEMPLATES[k];
    if (t) { setSubject(t.subject); setBody(t.body); }
  }

  async function uploadImage(file: File) {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/broadcast/image", { method: "POST", credentials: "include", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha no upload");
      setImageUrl(d.url);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function send() {
    if (!(await dialog.confirm({ message: "Disparar a mala direta para todos os clientes elegíveis?", confirmLabel: "Disparar", tone: "danger" }))) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/api/broadcast/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel,
          subject: wantEmail ? (subject || null) : null,
          body,
          imageUrl: wantWhats ? (imageUrl || null) : null,
          category,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha no envio");
      const partes = [
        d.queuedWhats ? `${d.queuedWhats} WhatsApp` : null,
        d.queuedEmail ? `${d.queuedEmail} email` : null,
      ].filter(Boolean).join(" + ");
      setMsg(`📨 ${d.queued} mensagem(ns) na fila (${partes}). O envio acontece em segundo plano, com intervalo de segurança entre cada número (anti-ban). Tempo estimado: ~${d.etaMinutes} min. Pode fechar a página.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <span className="mb-1 block text-[10px] uppercase text-muted">Canal</span>
          <div className="flex gap-2">
            {(["email", "whatsapp", "both"] as Channel[]).map((c) => (
              <button key={c} onClick={() => setChannel(c)} className={`rounded-full border px-3 py-1 text-xs transition ${channel === c ? "border-brand bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"}`}>
                {c === "email" ? "E-mail" : c === "whatsapp" ? "WhatsApp" : "Ambos"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-[10px] uppercase text-muted">Modelo pronto</span>
          <div className="flex gap-2">
            <button onClick={() => applyTemplate("promo")} className="rounded-lg border border-line px-3 py-1 text-xs transition hover:border-brand">Promoção</button>
            <button onClick={() => applyTemplate("novidade")} className="rounded-lg border border-line px-3 py-1 text-xs transition hover:border-brand">Novidade</button>
          </div>
        </div>

        {wantEmail && (
          <>
            <div>
              <span className="mb-1 block text-[10px] uppercase text-muted">Tipo (cor do e-mail)</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button key={c.value} onClick={() => setCategory(c.value)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${category === c.value ? "border-transparent text-white" : "border-line text-muted hover:text-fg"}`} style={category === c.value ? { background: c.color } : undefined}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Assunto (e-mail)</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input-base" />
            </label>
          </>
        )}

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Mensagem</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="input-base font-mono text-xs" />
          <span className="mt-1 block text-[10px] text-muted">Variáveis: {"{{cliente.nome}}"} {"{{empresa.nome}}"}</span>
        </label>

        {wantWhats && (
          <div>
            <span className="mb-1 block text-[10px] uppercase text-muted">Imagem (WhatsApp)</span>
            <div className="flex items-center gap-3">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-16 w-16 rounded-lg border border-line object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-line text-[10px] text-muted">sem imagem</div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand disabled:opacity-50">Enviar imagem</button>
              {imageUrl && <button onClick={() => setImageUrl("")} className="text-xs text-muted hover:text-red-300">remover</button>}
            </div>
          </div>
        )}

        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
        {msg && <p className="rounded-lg border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-200">{msg}</p>}

        <button onClick={send} disabled={busy || (!body.trim() && !imageUrl)} className="btn-grad disabled:opacity-50">
          {busy ? "Enviando..." : "Disparar mala direta"}
        </button>
      </div>

      {wantEmail && (
        <div>
          <span className="mb-1 block text-[10px] uppercase text-muted">Pré-visualização do e-mail</span>
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            {previewHtml ? (
              <iframe title="preview" srcDoc={previewHtml} className="h-[520px] w-full" />
            ) : (
              <div className="flex h-[520px] items-center justify-center text-xs text-muted">gerando prévia...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
