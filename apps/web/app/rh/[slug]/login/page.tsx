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
    <div className="grid min-h-screen grid-cols-[1.05fr_0.95fr] max-md:grid-cols-1">
      {/* MARCA — painel premium com arte/gradiente */}
      <aside className="relative flex flex-col overflow-hidden bg-[#060a15] p-12 text-white max-md:hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(900px 500px at 70% 8%, rgba(37,99,235,.45), transparent 60%), radial-gradient(720px 520px at 8% 92%, rgba(6,182,212,.30), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto max-w-[200px] object-contain" />
          ) : (
            <img src="/brand/norty-vision.png" alt="Norty Vision" className="h-9 w-auto object-contain" />
          )}
        </div>
        <div className="relative my-auto">
          <h2 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight">
            O portal da{" "}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              sua equipe
            </span>
            .
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            {brand?.name ? `Ponto, holerite e solicitações da equipe ${brand.name}.` : "Ponto, holerite e solicitações num só lugar."}
          </p>
        </div>
        <div className="relative text-xs text-slate-500">Portal seguro por YUGO</div>
      </aside>

      {/* FORM */}
      <main className="grid place-items-center bg-bg p-6 md:p-10">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex justify-center md:hidden">
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="h-12 w-auto max-w-[200px] object-contain" />
            ) : (
              <img src="/brand/norty-vision.png" alt="Norty Vision" className="h-9 w-auto object-contain" />
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
    </div>
  );
}
