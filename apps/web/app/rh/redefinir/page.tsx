"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RedefinirSenha() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr("Mínimo 8 caracteres."); return; }
    if (password !== confirm) { setErr("As senhas não conferem."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/employee/set-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) { if (res.status === 401) { router.push("/rh/login"); return; } throw new Error(data?.error?.message ?? "Falha"); }
      router.push("/rh");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-bg/60 p-6">
        <h1 className="text-2xl font-semibold">Crie sua senha</h1>
        <p className="mt-1 text-sm text-muted">Defina uma senha pessoal para o seu primeiro acesso.</p>
        <label className="mt-5 block"><span className="mb-1 block text-xs uppercase text-muted">Nova senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block"><span className="mb-1 block text-xs uppercase text-muted">Confirmar senha</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        {err && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando..." : "Salvar e entrar"}</button>
      </form>
    </main>
  );
}
