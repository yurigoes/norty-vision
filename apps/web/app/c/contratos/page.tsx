"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Contract {
  id: string;
  status: string;
  signedAt: string | null;
  renderedBodyMarkdown: string | null;
  template: { title: string; bodyMarkdown: string; biometricRequired: boolean; signatureMode: string };
}

export default function PortalContratos() {
  const router = useRouter();
  const [items, setItems] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<Contract | null>(null);

  function load() {
    fetch("/api/portal/contracts", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => { if (d) setItems(d.items ?? []); })
      .finally(() => setLoading(false));
  }
  useEffect(load, [router]);

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted">Carregando...</div>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/c" className="text-sm text-brand hover:underline">← voltar</Link>
      <h1 className="mt-4 text-2xl font-semibold">Meus contratos</h1>

      {items.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">
          Nenhum contrato pendente.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-bg/60 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{c.template.title}</p>
                  <p className="text-xs text-muted">
                    {c.status === "signed"
                      ? `Assinado em ${c.signedAt ? new Date(c.signedAt).toLocaleString("pt-BR") : ""}`
                      : "Pendente de assinatura"}
                  </p>
                </div>
                {c.status === "signed" ? (
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">assinado</span>
                    <a
                      href={`/api/portal/contracts/${c.id}/html`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand"
                    >
                      Baixar / Imprimir
                    </a>
                  </div>
                ) : (
                  <button onClick={() => setSigning(c)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
                    Assinar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {signing && (
        <SignModal
          contract={signing}
          onClose={() => setSigning(null)}
          onSigned={() => { setSigning(null); setLoading(true); load(); }}
        />
      )}
    </main>
  );
}

function SignModal({ contract, onClose, onSigned }: { contract: Contract; onClose: () => void; onSigned: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // canvas drawing
  function pos(e: any, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches?.[0];
    const cx = t ? t.clientX : e.clientX;
    const cy = t ? t.clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  }
  function start(e: any) {
    e.preventDefault();
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = pos(e, c); ctx.beginPath(); ctx.moveTo(p.x, p.y);
    setDrawing(true);
  }
  function move(e: any) {
    if (!drawing) return;
    e.preventDefault();
    const c = canvasRef.current!; const ctx = c.getContext("2d")!;
    const p = pos(e, c);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.lineTo(p.x, p.y); ctx.stroke();
    setHasSignature(true);
  }
  function end() { setDrawing(false); }
  function clear() {
    const c = canvasRef.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasSignature(false);
  }

  async function uploadSelfie(file: File) {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/portal/upload", { method: "POST", body: fd, credentials: "include" });
    const data = await res.json();
    if (res.ok) setSelfieUrl(data.url);
  }

  async function dataUrlToUpload(): Promise<string | null> {
    const c = canvasRef.current!;
    return new Promise((resolve) => {
      c.toBlob(async (blob) => {
        if (!blob) return resolve(null);
        const fd = new FormData();
        fd.append("file", new File([blob], "signature.png", { type: "image/png" }));
        const res = await fetch("/api/portal/upload", { method: "POST", body: fd, credentials: "include" });
        const data = await res.json();
        resolve(res.ok ? data.url : null);
      }, "image/png");
    });
  }

  async function submit() {
    setError(null);
    if (!hasSignature) { setError("Desenhe sua assinatura."); return; }
    if (contract.template.biometricRequired && !selfieUrl) { setError("Envie a selfie segurando o documento."); return; }
    if (!accepted) { setError("Marque o aceite."); return; }
    setBusy(true);
    try {
      const signatureImageUrl = await dataUrlToUpload();
      if (!signatureImageUrl) { setError("Falha ao salvar assinatura"); return; }
      const res = await fetch(`/api/portal/contracts/${contract.id}/sign`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ signatureImageUrl, selfieUrl: selfieUrl ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
      onSigned();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-bg p-6">
        <h2 className="text-lg font-semibold">{contract.template.title}</h2>

        <iframe
          src={`/api/portal/contracts/${contract.id}/html`}
          title="Contrato"
          className="mt-3 h-64 w-full rounded-lg border border-line bg-white"
        />

        {contract.template.biometricRequired && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">Selfie segurando seu documento</p>
            {selfieUrl ? (
              <div className="flex items-center gap-2"><span className="text-sm text-green-300">✓ enviada</span>
                <button onClick={() => setSelfieUrl(null)} className="text-xs text-muted hover:text-red-300">trocar</button>
              </div>
            ) : (
              <label className="inline-block cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">
                Tirar selfie
                <input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => e.target.files?.[0] && uploadSelfie(e.target.files[0])} />
              </label>
            )}
          </div>
        )}

        <div className="mt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">Sua assinatura</p>
          <canvas
            ref={canvasRef}
            width={440}
            height={160}
            className="w-full touch-none rounded-lg border border-line bg-white"
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
          <button onClick={clear} className="mt-1 text-xs text-muted hover:text-fg">limpar</button>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>Li e concordo com todas as cláusulas. Esta assinatura eletrônica + biometria têm validade legal (Lei 14.063/2020).</span>
        </label>

        {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Assinando..." : "Assinar contrato"}
          </button>
        </div>
      </div>
    </div>
  );
}
