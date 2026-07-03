"use client";

import { useState } from "react";

export default function MinhaContaPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) { setMsg({ kind: "err", text: "A nova senha precisa ter ao menos 8 caracteres." }); return; }
    if (next !== confirm) { setMsg({ kind: "err", text: "As senhas não conferem." }); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao trocar a senha");
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ kind: "ok", text: "Senha alterada ✅" });
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-lg">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Minha conta</p>
        <h1 className="mt-1 text-3xl font-semibold">Trocar senha</h1>
        <p className="mt-2 text-sm text-muted">Você pode alterar sua senha quando quiser. Mínimo de 8 caracteres.</p>
      </header>

      <form onSubmit={submit} className="card space-y-4 p-6">
        <Field label="Senha atual" value={current} onChange={setCurrent} />
        <Field label="Nova senha" value={next} onChange={setNext} />
        <Field label="Confirmar nova senha" value={confirm} onChange={setConfirm} />
        {msg && (
          <p className={`rounded-lg border px-3 py-2 text-sm ${msg.kind === "ok" ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-200" : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200"}`}>{msg.text}</p>
        )}
        <button type="submit" disabled={busy} className="btn-grad w-full py-2.5">
          {busy ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>

      <p className="mt-4 text-xs text-muted">
        Se você também acessa o <b>portal do funcionário</b>, a senha é a mesma — trocar aqui vale para os dois.
      </p>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} required autoComplete="new-password"
        className="input-base" />
    </label>
  );
}
