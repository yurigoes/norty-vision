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
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-line bg-bg/60 p-6">
        <div className="mb-5 flex justify-center">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="h-12 w-auto max-w-[200px] object-contain" />
          ) : (
            <span className="text-lg font-bold" style={{ color: "rgb(var(--brand))" }}>{brand?.name ?? "Acesso da equipe"}</span>
          )}
        </div>
        <h1 className="text-2xl font-semibold">Equipe / administração</h1>
        <p className="mt-1 text-sm text-muted">{brand?.name ? `Acesso interno da ${brand.name}.` : "Acesso interno da empresa."}</p>
        <label className="mt-5 block">
          <span className="mb-1 block text-xs uppercase text-muted">E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs uppercase text-muted">Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        {needMfa && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs uppercase text-muted">Código 2FA</span>
            <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
          </label>
        )}
        {err && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}
