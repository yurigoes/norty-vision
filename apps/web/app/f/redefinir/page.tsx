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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(680px 460px at 78% 6%, rgba(37,99,235,.16), transparent 60%), radial-gradient(560px 460px at 12% 96%, rgba(6,182,212,.14), transparent 58%)",
        }}
      />
      <form onSubmit={submit} className="card relative w-full max-w-sm space-y-4 p-8 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.22)]">
        <h1 className="text-2xl font-extrabold tracking-tight">Defina sua senha</h1>
        <p className="text-sm text-muted">Crie uma senha pessoal para os próximos acessos.</p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Nova senha</span>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="input-base" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Confirmar senha</span>
          <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} className="input-base" />
        </label>
        {err && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
        <button type="submit" disabled={busy} className="btn-grad w-full py-3 text-[15px]">
          {busy ? "Salvando..." : "Salvar senha"}
        </button>
      </form>
    </main>
  );
}
