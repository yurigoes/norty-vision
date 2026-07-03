"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SupplierResetPassword() {
  const router = useRouter();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pwd !== pwd2) { setErr("As senhas não conferem"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      router.push("/f");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-bg/60 p-8">
        <h1 className="text-2xl font-semibold">Defina sua senha</h1>
        <p className="text-sm text-muted">Crie uma senha pessoal para os próximos acessos.</p>
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-muted">Nova senha</span>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase text-muted">Confirmar senha</span>
          <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
          {busy ? "Salvando..." : "Salvar senha"}
        </button>
      </form>
    </main>
  );
}
