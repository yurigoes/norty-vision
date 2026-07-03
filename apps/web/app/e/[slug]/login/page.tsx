"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Brand {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
  themeMode?: string | null;
}

function applyBrandColor(hex: string | null) {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const int = parseInt(hex.slice(1), 16);
    document.documentElement.style.setProperty("--brand", `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`);
  }
}
function applyTheme(mode: string | null | undefined) {
  if (mode !== "light" && mode !== "dark") return;
  try { if (localStorage.getItem("yugo-theme")) return; } catch { return; }
  const r = document.documentElement; r.classList.remove("light", "dark"); r.classList.add(mode);
}

/**
 * Login da Equipe/administração com escopo no slug da empresa. Só passa quem
 * tem membership ativo NESTA empresa (o backend rejeita os demais, mesmo admin
 * de outra). Segue a marca e o tema da empresa. O master continua só no apex.
 */
export default function TeamSlugLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/organizations/public/by-slug/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const org: Brand | undefined = d?.organization;
        if (org) { setBrand(org); applyBrandColor(org.primaryColor); applyTheme(org.themeMode); }
      })
      .catch(() => undefined);
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ email: email.trim(), password, mfaCode: mfaCode || undefined, orgSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === "MFA_REQUIRED") { setNeedMfa(true); setErr("Informe o código 2FA."); return; }
        throw new Error(data?.error?.message ?? "Falha no login");
      }
      router.push("/app");
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
            Toque a operação{" "}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              por dentro
            </span>
            .
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            {brand?.name ? `Acesso interno da ${brand.name} — agenda, vendas e financeiro.` : "Acesso interno da empresa — agenda, vendas e financeiro."}
          </p>
        </div>
        <div className="relative text-xs text-slate-500">Acesso restrito · YUGO</div>
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
          <h1 className="text-2xl font-extrabold tracking-tight">Equipe / administração</h1>
          <p className="mt-1 text-sm text-muted">{brand?.name ? `Acesso interno da ${brand.name}.` : "Acesso interno da empresa."}</p>
          <label className="mt-5 block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-base" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Senha</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" />
          </label>
          {needMfa && (
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-semibold text-muted">Código 2FA</span>
              <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" className="input-base text-center text-lg tracking-widest" />
            </label>
          )}
          {err && <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
          <button disabled={busy} className="btn-grad mt-5 w-full py-3 text-[15px]">{busy ? "Entrando..." : "Entrar"}</button>
        </form>
      </main>
    </div>
  );
}
