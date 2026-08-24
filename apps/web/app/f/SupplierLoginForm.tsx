"use client";

import { useEffect, useState } from "react";
import { orgSlugFromHost } from "../../lib/orgSlug";
import { PortalAuthLayout } from "../../components/PortalAuthLayout";
import { useOrgBrand } from "../../lib/useOrgBrand";
import { rememberOrgSlug, safeNext } from "../../lib/orgMemory";

type Mode = "password" | "otp";

/**
 * Form do portal do FORNECEDOR (médicos e laboratórios). `slug` explícito
 * (rota /f/[slug]/login) tem prioridade; senão deriva do subdomínio. Sem slug
 * (apex) orienta a usar o endereço da empresa — fornecedor pertence a uma
 * empresa.
 */
export function SupplierLoginForm({ slug: slugProp }: { slug?: string }) {
  const [slug, setSlug] = useState<string | null>(slugProp ?? null);
  const { brand } = useOrgBrand(slug);
  const [mode, setMode] = useState<Mode>("otp");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSlug(slugProp ?? orgSlugFromHost());
  }, [slugProp]);

  const withSlug = (b: Record<string, unknown>) => (slug ? { ...b, orgSlug: slug } : b);
  const noOrgMsg = "Acesse pelo endereço da sua empresa (ex.: /f/suaempresa/login).";

  function finish(data: any) {
    if (slug) rememberOrgSlug(slug);
    if (data?.mustReset) {
      window.location.assign("/f/redefinir");
      return;
    }
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    window.location.assign(next ?? "/f");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(withSlug({ identifier: identifier.trim(), password })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(!slug ? noOrgMsg : data?.error?.message ?? "Falha no login");
      finish(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(withSlug({ identifier: identifier.trim() })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(!slug ? noOrgMsg : data?.error?.message ?? "Falha ao enviar código");
      setOtpSent(true);
      setPhoneMasked(data.phoneMasked ?? "");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/supplier-portal/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(withSlug({ identifier: identifier.trim(), code: code.trim() })),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Código inválido");
      finish(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const errorBox = err && (
    <p
      role="alert"
      className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
    >
      {err}
    </p>
  );

  const form = (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl border border-line bg-surface-2 p-1 text-xs">
        <button
          type="button"
          onClick={() => {
            setMode("otp");
            setErr(null);
          }}
          className={`flex-1 rounded-lg px-3 py-2.5 font-semibold transition ${mode === "otp" ? "text-white shadow-sm" : "text-muted hover:text-fg"}`}
          style={mode === "otp" ? { background: "var(--grad-brand)" } : undefined}
        >
          Código por WhatsApp
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("password");
            setErr(null);
          }}
          className={`flex-1 rounded-lg px-3 py-2.5 font-semibold transition ${mode === "password" ? "text-white shadow-sm" : "text-muted hover:text-fg"}`}
          style={mode === "password" ? { background: "var(--grad-brand)" } : undefined}
        >
          Senha
        </button>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-muted">CPF/CNPJ ou telefone</span>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          inputMode="numeric"
          className="input-base py-3"
        />
      </label>

      {mode === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Senha</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="input-base py-3"
            />
            <span className="mt-1.5 block text-[11px] text-text-3">
              No primeiro acesso, use seu CPF/CNPJ (só números).
            </span>
          </label>
          {errorBox}
          <button type="submit" disabled={busy} className="btn-grad w-full py-3.5 text-[15px]">
            {busy ? "Entrando..." : "Entrar"}
          </button>
        </form>
      ) : !otpSent ? (
        <div className="space-y-4">
          {errorBox}
          <button
            type="button"
            onClick={requestOtp}
            disabled={busy || !identifier.trim()}
            className="btn-grad w-full py-3.5 text-[15px]"
          >
            {busy ? "Enviando..." : "Enviar código por WhatsApp"}
          </button>
        </div>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-4">
          <p className="text-xs text-muted">Enviamos um código para o WhatsApp {phoneMasked}.</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Código</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="input-base py-3 text-center text-xl tracking-[0.4em]"
            />
          </label>
          {errorBox}
          <button type="submit" disabled={busy} className="btn-grad w-full py-3.5 text-[15px]">
            {busy ? "Verificando..." : "Entrar"}
          </button>
          <button
            type="button"
            onClick={requestOtp}
            disabled={busy}
            className="w-full text-xs text-muted transition-colors hover:text-fg"
          >
            Reenviar código
          </button>
        </form>
      )}
    </div>
  );

  const company = brand?.name ?? "sua empresa";

  // sem empresa no endereço (apex): não há marca nem escopo — tela simples
  // orientando a usar o link da empresa.
  if (!slug) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center px-5 py-10">
        <div className="card w-full max-w-sm p-7">
          <h1 className="text-2xl font-extrabold tracking-tight">Portal do fornecedor</h1>
          <p className="mt-1.5 text-sm text-muted">Acesso para médicos e laboratórios.</p>
          <div className="mt-6">{form}</div>
          <p className="mt-5 text-center text-[11px] text-text-3">{noOrgMsg}</p>
        </div>
      </main>
    );
  }

  return (
    <PortalAuthLayout
      portal="fornecedor"
      slug={slug}
      title="Portal do fornecedor"
      subtitle={`${company} — médicos e laboratórios.`}
      headline={
        <>
          Seus pedidos,{" "}
          <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            sem telefone
          </span>
          .
        </>
      }
      tagline={`Pedidos, produção e repasses com a ${company} em tempo real.`}
    >
      {form}
    </PortalAuthLayout>
  );
}
