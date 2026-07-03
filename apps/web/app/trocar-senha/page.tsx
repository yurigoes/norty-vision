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
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-bg/60 p-6">
        <div>
          <h1 className="text-xl font-semibold">Defina uma nova senha</h1>
          <p className="mt-1 text-sm text-muted">
            No primeiro acesso é obrigatório trocar a senha temporária por uma pessoal.
          </p>
        </div>
        <Field label="Senha atual" value={current} onChange={setCurrent} />
        <Field label="Nova senha" value={next} onChange={setNext} />
        <Field label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">
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
        className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}
