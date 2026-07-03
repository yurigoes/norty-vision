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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(680px 460px at 78% 6%, rgba(37,99,235,.16), transparent 60%), radial-gradient(560px 460px at 12% 96%, rgba(6,182,212,.14), transparent 58%)",
        }}
      />
      <form onSubmit={submit} className="card relative w-full max-w-sm p-8 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.22)]">
        <h1 className="text-2xl font-extrabold tracking-tight">Crie sua senha</h1>
        <p className="mt-1 text-sm text-muted">Defina uma senha pessoal para o seu primeiro acesso.</p>
        <label className="mt-5 block"><span className="mb-1.5 block text-xs font-semibold text-muted">Nova senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" />
        </label>
        <label className="mt-3 block"><span className="mb-1.5 block text-xs font-semibold text-muted">Confirmar senha</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input-base" />
        </label>
        {err && <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
        <button disabled={busy} className="btn-grad mt-5 w-full py-3 text-[15px]">{busy ? "Salvando..." : "Salvar e entrar"}</button>
      </form>
    </main>
  );
}
