"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogoClient } from "../../../components/BrandLogoClient";
import { orgSlugFromHost } from "../../../lib/orgSlug";

export default function EmployeeLogin() {
  const router = useRouter();
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // o funcionário pertence a uma empresa: o slug vem do subdomínio (ex.:
  // zito.yugochat.com.br). No domínio genérico não há empresa → login não acha.
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  useEffect(() => { setOrgSlug(orgSlugFromHost()); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/employee/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, ""), password, ...(orgSlug ? { orgSlug } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (!orgSlug) {
          throw new Error("Acesse pelo endereço da sua empresa (ex.: suaempresa.yugochat.com.br) para entrar.");
        }
        throw new Error(data?.error?.message ?? "Falha no login");
      }
      router.push(data.mustReset ? "/rh/redefinir" : "/rh");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-bg/60 p-6">
        <div className="mb-5 flex justify-center"><BrandLogoClient size="md" /></div>
        <h1 className="text-2xl font-semibold">Portal do funcionário</h1>
        <p className="mt-1 text-sm text-muted">Entre com seu CPF e senha.</p>
        <label className="mt-5 block">
          <span className="mb-1 block text-xs uppercase text-muted">CPF</span>
          <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs uppercase text-muted">Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        {err && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Entrando..." : "Entrar"}</button>
        <p className="mt-3 text-center text-xs text-muted">Primeiro acesso? Use o CPF como senha.</p>
      </form>
    </main>
  );
}
