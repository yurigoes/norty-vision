"use client";

import { useState } from "react";

export function ContactForm() {
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", segment: "otica", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (f.name.trim().length < 2 || !f.email.includes("@")) { setErr("Preencha nome e e-mail válidos."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, phone: f.phone || null, company: f.company || null, message: f.message || null }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha ao enviar");
      setDone(true);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-8 text-center">
        <p className="text-lg font-semibold text-green-200">✓ Recebemos seu contato!</p>
        <p className="mt-2 text-sm text-muted">Nossa equipe vai falar com você em breve. Obrigado pelo interesse 💙</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-line bg-bg/60 p-6 backdrop-blur-sm sm:grid-cols-2">
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Seu nome" className="rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-sm outline-none focus:border-brand" />
      <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Seu e-mail" type="email" className="rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-sm outline-none focus:border-brand" />
      <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="WhatsApp" className="rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-sm outline-none focus:border-brand" />
      <input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Empresa (opcional)" className="rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-sm outline-none focus:border-brand" />
      <select value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} className="rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-sm outline-none focus:border-brand sm:col-span-2">
        <option value="otica">Ótica</option>
        <option value="clinica">Clínica / Consultório</option>
        <option value="varejo">Varejo / Loja</option>
        <option value="outro">Outro</option>
      </select>
      <textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Conte um pouco da sua operação (opcional)" rows={3} className="rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-sm outline-none focus:border-brand sm:col-span-2" />
      {err && <p className="text-sm text-red-300 sm:col-span-2">{err}</p>}
      <button disabled={busy} className="rounded-lg bg-brand py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50 sm:col-span-2">
        {busy ? "Enviando..." : "Quero conhecer o yugochat"}
      </button>
    </form>
  );
}
