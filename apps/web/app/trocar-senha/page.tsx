"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TrocarSenhaPrimeiroAcesso() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next.length < 8) { setErr("A nova senha precisa ter ao menos 8 caracteres."); return; }
    if (next !== confirm) { setErr("As senhas não conferem."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao trocar a senha");
      router.push("/app");
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 rounded-2xl p-8">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Defina uma nova senha</h1>
          <p className="mt-1 text-sm text-muted">
            No primeiro acesso é obrigatório trocar a senha temporária por uma pessoal.
          </p>
        </div>
        <Field label="Senha atual" value={current} onChange={setCurrent} />
        <Field label="Nova senha" value={next} onChange={setNext} />
        <Field label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
        {err && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>}
        <button type="submit" disabled={busy} className="btn-grad w-full py-2.5 text-sm">
          {busy ? "Salvando..." : "Salvar e continuar"}
        </button>
      </form>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete="new-password"
        className="input-base"
      />
    </label>
  );
}
