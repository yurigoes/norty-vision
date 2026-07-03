"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogoClient } from "../../../components/BrandLogoClient";
import { orgSlugFromHost } from "../../../lib/orgSlug";

type Mode = "choose" | "code" | "password";

export default function PortalLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [document, setDocument] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // empresa pelo subdomínio (zito.yugochat.com.br); no apex o backend escopa na yugo
  const [orgSlug, setOrgSlug] = useState<string | null>(null);
  useEffect(() => { setOrgSlug(orgSlugFromHost()); }, []);
  const withSlug = (b: Record<string, unknown>) => (orgSlug ? { ...b, orgSlug } : b);

  async function requestCode() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portal/auth/request-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSlug({ document })),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
      if (!data.sent) { setError("Documento não encontrado ou sem WhatsApp. Procure a loja."); return; }
      setMasked(data.masked);
      setMode("code");
    } finally { setLoading(false); }
  }

  async function verifyCode() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portal/auth/verify-code", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSlug({ document, code })),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Código inválido"); return; }
      router.push("/c");
    } finally { setLoading(false); }
  }

  async function loginPassword() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portal/auth/login-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSlug({ document, password })),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Credenciais inválidas"); return; }
      router.push(data.mustReset ? "/c/redefinir" : "/c");
    } finally { setLoading(false); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-10 text-center">
        <BrandLogoClient size="lg" />
        <h1 className="mt-6 text-2xl font-semibold">Painel do cliente</h1>
        <p className="mt-1 text-sm text-muted">Acompanhe suas compras e parcelas do crediário.</p>
      </div>

      <div className="glass rounded-2xl p-6">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">CPF / CNPJ</span>
          <input
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            disabled={mode !== "choose"}
            placeholder="000.000.000-00"
            className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm disabled:opacity-60"
          />
        </label>

        {mode === "choose" && (
          <div className="mt-4 space-y-2">
            <button onClick={requestCode} disabled={loading || document.length < 11} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Enviando..." : "Receber código no WhatsApp"}
            </button>
            <button onClick={() => setMode("password")} disabled={document.length < 11} className="w-full rounded-lg border border-line py-2.5 text-sm disabled:opacity-50">
              Entrar com senha
            </button>
          </div>
        )}

        {mode === "code" && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">Enviamos um código para {masked}.</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-center font-mono text-lg tracking-widest"
            />
            <button onClick={verifyCode} disabled={loading || code.length !== 6} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Verificando..." : "Entrar"}
            </button>
            <button onClick={() => setMode("choose")} className="w-full text-xs text-muted hover:text-fg">voltar</button>
          </div>
        )}

        {mode === "password" && (
          <div className="mt-4 space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
            />
            <button onClick={loginPassword} disabled={loading || !password} className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Entrando..." : "Entrar"}
            </button>
            <button onClick={() => setMode("choose")} className="w-full text-xs text-muted hover:text-fg">usar WhatsApp</button>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
      </div>
    </main>
  );
}
