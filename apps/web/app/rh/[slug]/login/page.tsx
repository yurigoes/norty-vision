"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Brand {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

function applyBrandColor(hex: string | null) {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const int = parseInt(hex.slice(1), 16);
    document.documentElement.style.setProperty("--brand", `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`);
  }
}

export default function EmployeeSlugLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/organizations/public/by-slug/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const org: Brand | undefined = d?.organization;
        if (org) { setBrand(org); applyBrandColor(org.primaryColor); }
      })
      .catch(() => undefined);
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/employee/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ cpf: cpf.replace(/\D/g, ""), password, orgSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no login");
      router.push(data.mustReset ? "/rh/redefinir" : "/rh");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-bg/60 p-6">
        <div className="mb-5 flex justify-center">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="h-12 w-auto max-w-[200px] object-contain" />
          ) : (
            <span className="text-lg font-bold" style={{ color: "rgb(var(--brand))" }}>{brand?.name ?? "Portal do funcionário"}</span>
          )}
        </div>
        <h1 className="text-2xl font-semibold">Portal do funcionário</h1>
        <p className="mt-1 text-sm text-muted">{brand?.name ? `Equipe ${brand.name} — entre com seu CPF e senha.` : "Entre com seu CPF e senha."}</p>
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
