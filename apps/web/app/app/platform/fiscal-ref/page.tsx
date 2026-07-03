"use client";

import { useEffect, useState } from "react";

export default function FiscalRefPage() {
  const [counts, setCounts] = useState<{ ncm: number; cest: number; servicos: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function load() {
    fetch("/api/fiscal/ref/counts", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setCounts(d ?? null)).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function importNcm(file: File) {
    setBusy("ncm"); setMsg(null);
    try {
      const json = await file.text();
      const res = await fetch("/api/fiscal/ref/ncm", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ json }) });
      const d = await res.json().catch(() => null);
      setMsg(res.ok ? `✓ NCM importado: ${d?.count ?? 0}` : `✗ ${d?.error?.message ?? "falha"}`);
      load();
    } finally { setBusy(null); }
  }
  async function seed() {
    setBusy("seed"); setMsg(null);
    try {
      const res = await fetch("/api/fiscal/ref/seed", { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      setMsg(res.ok ? `✓ CEST: ${d?.cest ?? 0} · serviços LC116: ${d?.servicos ?? 0}` : `✗ ${d?.error?.message ?? "falha"}`);
      load();
    } finally { setBusy(null); }
  }

  return (
    <main className="max-w-3xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Master · Fiscal</p>
        <h1 className="mt-1 text-3xl font-semibold">Tabelas fiscais (NCM / CEST / LC116)</h1>
        <p className="mt-2 text-muted">Tabelas oficiais globais usadas no auto-preenchimento dos produtos e na NFS-e. Importação feita uma vez (atualize quando sair versão nova).</p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card title="NCM" value={counts ? counts.ncm.toLocaleString("pt-BR") : "—"} />
        <Card title="CEST × NCM" value={counts ? counts.cest.toLocaleString("pt-BR") : "—"} />
        <Card title="Serviços LC116" value={counts ? counts.servicos.toLocaleString("pt-BR") : "—"} />
      </div>

      {msg && <p className="mb-4 rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">{msg}</p>}

      <section className="space-y-4">
        <div className="rounded-xl border border-line bg-bg/60 p-5">
          <h2 className="text-sm font-semibold">NCM (Siscomex)</h2>
          <p className="mt-1 text-xs text-muted">Suba o JSON oficial da Tabela NCM vigente (Portal Único Siscomex). ~15 mil itens.</p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">
            {busy === "ncm" ? "Importando…" : "Subir JSON do NCM"}
            <input type="file" accept="application/json,.json" className="hidden" disabled={!!busy} onChange={(e) => e.target.files?.[0] && importNcm(e.target.files[0])} />
          </label>
        </div>

        <div className="rounded-xl border border-line bg-bg/60 p-5">
          <h2 className="text-sm font-semibold">CEST + Serviços (LC116)</h2>
          <p className="mt-1 text-xs text-muted">Tabelas oficiais já embutidas no sistema (Convênio 142/18 e LC 116/03). Clique para semear/atualizar.</p>
          <button onClick={seed} disabled={!!busy} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === "seed" ? "Semeando…" : "Semear CEST + LC116"}
          </button>
        </div>
      </section>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{title}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
