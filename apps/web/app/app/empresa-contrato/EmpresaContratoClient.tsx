"use client";

import { useCallback, useEffect, useState } from "react";

interface Contract { id: string; title: string | null; version: string | null; status: string; acceptedAt: string | null; acceptedByName: string | null; createdAt: string }

export function EmpresaContratoClient() {
  const [items, setItems] = useState<Contract[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/org-contracts", { credentials: "include", cache: "no-store" });
    const d = await r.json(); if (r.ok) setItems(d.items ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function accept(id: string) {
    setErr(null);
    if (name.trim().length < 3) { setErr("Informe o nome de quem está aceitando."); return; }
    if (!accepted) { setErr("Marque o aceite."); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/org-contracts/${id}/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim(), doc: doc || null }) });
      const d = await r.json(); if (!r.ok) throw new Error(d?.error?.message ?? "Falha");
      setAccepting(null); setName(""); setDoc(""); setAccepted(false); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!loaded) return <p className="text-sm text-muted">Carregando...</p>;
  if (items.length === 0) return <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhum contrato no momento.</p>;

  return (
    <div className="space-y-3">
      {items.map((c) => (
        <div key={c.id} className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">{c.title}{c.version ? ` · v${c.version}` : ""}</p>
              <p className="text-xs text-muted">
                {c.status === "accepted" ? `Aceito por ${c.acceptedByName ?? ""} em ${c.acceptedAt ? new Date(c.acceptedAt).toLocaleString("pt-BR") : ""}` : "Pendente de aceite"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a href={`/api/org-contracts/${c.id}/html`} target="_blank" rel="noreferrer" className="rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">Ler / imprimir</a>
              {c.status === "accepted"
                ? <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-green-300">aceito</span>
                : <button onClick={() => setAccepting(accepting === c.id ? null : c.id)} className="btn-grad !py-1.5">{accepting === c.id ? "Fechar" : "Aceitar"}</button>}
            </div>
          </div>
          {accepting === c.id && c.status !== "accepted" && (
            <div className="mt-4 space-y-2 border-t border-line/50 pt-4">
              <p className="text-xs text-muted">Leia o contrato (botão "Ler / imprimir") antes de aceitar.</p>
              <div className="flex flex-wrap gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome completo" className="input-base flex-1" />
                <input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="CPF (opcional)" className="input-base w-40" />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>Li e concordo com todos os termos deste contrato. Este aceite eletrônico tem validade legal (Lei 14.063/2020).</span>
              </label>
              {err && <p className="text-xs text-red-300">{err}</p>}
              <button onClick={() => accept(c.id)} disabled={busy} className="btn-grad px-5">{busy ? "Registrando..." : "Aceitar contrato"}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
