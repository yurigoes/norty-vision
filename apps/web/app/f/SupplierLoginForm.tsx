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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-bg/60 p-8">
        <div className="text-center">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt={brand.name} className="mx-auto mb-3 h-12 w-auto max-w-[200px] object-contain" />
          ) : null}
          <h1 className="text-2xl font-semibold">Portal do fornecedor</h1>
          <p className="mt-1 text-sm text-muted">{brand?.name ? `${brand.name} — médicos e laboratórios.` : "Acesso para médicos e laboratórios."}</p>
        </div>

        <div className="flex gap-1 rounded-lg border border-line p-1 text-xs">
          <button onClick={() => { setMode("otp"); setErr(null); }} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${mode === "otp" ? "bg-brand text-white" : "text-muted hover:text-fg"}`}>Código por WhatsApp</button>
          <button onClick={() => { setMode("password"); setErr(null); }} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${mode === "password" ? "bg-brand text-white" : "text-muted hover:text-fg"}`}>Senha</button>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs uppercase text-muted">CPF/CNPJ ou telefone</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>

        {mode === "password" ? (
          <form onSubmit={submitPassword} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs uppercase text-muted">Senha</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
              <span className="mt-1 block text-[11px] text-muted">No primeiro acesso, use seu CPF/CNPJ (só números).</span>
            </label>
            {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">{busy ? "Entrando..." : "Entrar"}</button>
          </form>
        ) : !otpSent ? (
          <div className="space-y-4">
            {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
            <button onClick={requestOtp} disabled={busy || !identifier.trim()} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">{busy ? "Enviando..." : "Enviar código por WhatsApp"}</button>
          </div>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <p className="text-xs text-muted">Enviamos um código para o WhatsApp {phoneMasked}.</p>
            <label className="block">
              <span className="mb-1 block text-xs uppercase text-muted">Código</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-center text-lg tracking-widest" />
            </label>
            {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">{busy ? "Verificando..." : "Entrar"}</button>
            <button type="button" onClick={requestOtp} disabled={busy} className="w-full text-xs text-muted hover:text-fg">Reenviar código</button>
          </form>
        )}
      </div>
    </main>
  );
}
