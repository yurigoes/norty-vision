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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(680px 460px at 78% 6%, rgba(37,99,235,.16), transparent 60%), radial-gradient(560px 460px at 12% 96%, rgba(6,182,212,.14), transparent 58%)",
        }}
      />
      <form onSubmit={submit} className="card relative w-full max-w-sm p-8 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.22)]">
        <div className="mb-5 flex justify-center">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="h-12 w-auto max-w-[200px] object-contain" />
          ) : (
            <span className="text-lg font-extrabold tracking-tight" style={{ color: "rgb(var(--brand))" }}>{brand?.name ?? "Portal do funcionário"}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Portal do funcionário</h1>
        <p className="mt-1 text-sm text-muted">{brand?.name ? `Equipe ${brand.name} — entre com seu CPF e senha.` : "Entre com seu CPF e senha."}</p>
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
