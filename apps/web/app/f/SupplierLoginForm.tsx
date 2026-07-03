"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { orgSlugFromHost } from "../../lib/orgSlug";

type Mode = "password" | "otp";
interface Brand { name: string; logoUrl: string | null; primaryColor: string | null }

function applyBrandColor(hex: string | null) {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const int = parseInt(hex.slice(1), 16);
    document.documentElement.style.setProperty("--brand", `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`);
  }
}

/**
 * Form do portal do fornecedor. `slug` explícito (rota /f/[slug]/login) tem
 * prioridade; senão deriva do subdomínio. Sem slug (apex) orienta a usar o
 * endereço da empresa — fornecedor pertence a uma empresa.
 */
export function SupplierLoginForm({ slug: slugProp }: { slug?: string }) {
  const router = useRouter();
  const [slug, setSlug] = useState<string | null>(slugProp ?? null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [mode, setMode] = useState<Mode>("otp");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = slugProp ?? orgSlugFromHost();
    setSlug(s);
    if (s) {
      fetch(`/api/organizations/public/by-slug/${s}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { const o = d?.organization; if (o) { setBrand(o); applyBrandColor(o.primaryColor); } })
        .catch(() => undefined);
    }
  }, [slugProp]);

  const withSlug = (b: Record<string, unknown>) => (slug ? { ...b, orgSlug: slug } : b);
  const noOrgMsg = "Acesse pelo endereço da sua empresa (ex.: suaempresa.yugochat.com.br).";

  function finish(data: any) { router.push(data.mustReset ? "/f/redefinir" : "/f"); }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(withSlug({ identifier: identifier.trim(), password })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(!slug ? noOrgMsg : data?.error?.message ?? "Falha no login");
      finish(data);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function requestOtp() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/auth/request-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(withSlug({ identifier: identifier.trim() })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(!slug ? noOrgMsg : data?.error?.message ?? "Falha ao enviar código");
      setOtpSent(true); setPhoneMasked(data.phoneMasked ?? "");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/auth/verify-otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(withSlug({ identifier: identifier.trim(), code: code.trim() })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Código inválido");
      finish(data);
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
      <div className="card relative w-full max-w-sm space-y-5 p-8 shadow-[0_24px_50px_-18px_rgba(15,23,42,0.22)]">
        <div className="text-center">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="mx-auto mb-3 h-12 w-auto max-w-[200px] object-contain" />
          ) : (
            <img src="/brand/norty-vision.png" alt="Norty Vision" className="mx-auto mb-3 h-9 w-auto object-contain" />
          )}
          <h1 className="text-2xl font-extrabold tracking-tight">Portal do fornecedor</h1>
          <p className="mt-1 text-sm text-muted">{brand?.name ? `${brand.name} — médicos e laboratórios.` : "Acesso para médicos e laboratórios."}</p>
        </div>

        <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1 text-xs">
          <button onClick={() => { setMode("otp"); setErr(null); }} className={`flex-1 rounded-lg px-3 py-2 font-semibold transition ${mode === "otp" ? "text-white shadow-sm" : "text-muted hover:text-fg"}`} style={mode === "otp" ? { background: "var(--grad-brand)" } : undefined}>Código por WhatsApp</button>
          <button onClick={() => { setMode("password"); setErr(null); }} className={`flex-1 rounded-lg px-3 py-2 font-semibold transition ${mode === "password" ? "text-white shadow-sm" : "text-muted hover:text-fg"}`} style={mode === "password" ? { background: "var(--grad-brand)" } : undefined}>Senha</button>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">CPF/CNPJ ou telefone</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="input-base" />
        </label>

        {mode === "password" ? (
          <form onSubmit={submitPassword} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted">Senha</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" />
              <span className="mt-1.5 block text-[11px] text-text-3">No primeiro acesso, use seu CPF/CNPJ (só números).</span>
            </label>
            {err && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
            <button type="submit" disabled={busy} className="btn-grad w-full py-3 text-[15px]">{busy ? "Entrando..." : "Entrar"}</button>
          </form>
        ) : !otpSent ? (
          <div className="space-y-4">
            {err && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
            <button onClick={requestOtp} disabled={busy || !identifier.trim()} className="btn-grad w-full py-3 text-[15px]">{busy ? "Enviando..." : "Enviar código por WhatsApp"}</button>
          </div>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-xs text-muted">Enviamos um código para o WhatsApp {phoneMasked}.</p>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted">Código</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} className="input-base text-center text-2xl tracking-widest" />
            </label>
            {err && <p className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{err}</p>}
            <button type="submit" disabled={busy} className="btn-grad w-full py-3 text-[15px]">{busy ? "Verificando..." : "Entrar"}</button>
            <button type="button" onClick={requestOtp} disabled={busy} className="w-full text-xs text-muted transition-colors hover:text-fg">Reenviar código</button>
          </form>
        )}
      </div>
    </main>
  );
}
