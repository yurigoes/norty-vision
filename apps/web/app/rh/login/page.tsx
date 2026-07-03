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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(680px 460px at 78% 6%, rgba(37,99,235,.16), transparent 60%), radial-gradient(560px 460px at 12% 96%, rgba(6,182,212,.14), transparent 58%)",
        }}
      />
      <form onSubmit={submit} className="card relative w-full max-w-sm p-8 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.22)]">
        <div className="mb-5 flex justify-center"><BrandLogoClient size="md" /></div>
        <h1 className="text-2xl font-extrabold tracking-tight">Portal do funcionário</h1>
        <p className="mt-1 text-sm text-muted">Entre com seu CPF e senha.</p>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">CPF</span>
          <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" className="input-base" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" />
        </label>
        {err && <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
        <button disabled={busy} className="btn-grad mt-5 w-full py-3 text-[15px]">{busy ? "Entrando..." : "Entrar"}</button>
        <p className="mt-4 text-center text-xs text-text-3">Primeiro acesso? Use o CPF como senha.</p>
      </form>
    </main>
  );
}
