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
            <span className="text-lg font-extrabold tracking-tight" style={{ color: "rgb(var(--brand))" }}>{brand?.name ?? "Acesso da equipe"}</span>
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
  );
}
