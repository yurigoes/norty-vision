"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandLogoClient } from "../../components/BrandLogoClient";
import { orgSlugFromHost } from "../../lib/orgSlug";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterMode, setMasterMode] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  // slug da empresa quando acessado pelo subdomínio dela. Nesse caso o login é
  // ISOLADO àquela empresa e o acesso master NÃO aparece (master só no apex).
  const [companySlug, setCompanySlug] = useState<string | null>(null);
  useEffect(() => { setCompanySlug(orgSlugFromHost()); }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    // no subdomínio de empresa o master nunca é permitido
    const useMaster = masterMode && !companySlug;
    const payload: Record<string, unknown> = {
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
      mfaCode: mfaRequired
        ? String(form.get("mfaCode") ?? "").trim()
        : undefined,
    };
    // login da equipe isolado por slug quando vem pelo subdomínio da empresa
    if (!useMaster && companySlug) payload.orgSlug = companySlug;

    const endpoint = useMaster ? "/api/platform-auth/login" : "/api/auth/login";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { code?: string; message?: string } }
          | null;
        if (data?.error?.code === "MFA_REQUIRED") {
          setMfaRequired(true);
          setError("Informe o código de 6 dígitos do seu app autenticador.");
        } else {
          setError(data?.error?.message ?? "Falha no login");
        }
        setLoading(false);
        return;
      }
      router.push(useMaster ? "/app/platform" : "/app");
    } catch {
      setError("Erro de conexao");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="text-center">
        <Link
          href="/"
          className="mb-12 inline-block transition-opacity hover:opacity-80"
          aria-label="Voltar"
        >
          <BrandLogoClient size="lg" />
        </Link>
        <h1 className="text-2xl font-semibold">
          {masterMode ? "Acesso master" : "Entrar na sua conta"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {masterMode
            ? "Apenas para o dono da plataforma."
            : "Acesse para gerenciar agenda, leads e disparos."}
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-10 space-y-4" noValidate>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            E-mail
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-fg outline-none transition placeholder:text-muted focus:border-brand"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
            Senha
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-fg outline-none transition placeholder:text-muted focus:border-brand"
          />
        </label>

        {mfaRequired && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
              Código 2FA (6 dígitos)
            </span>
            <input
              type="text"
              name="mfaCode"
              required
              pattern="\d{6}"
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              placeholder="000000"
              className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-center text-2xl tracking-widest text-fg outline-none transition placeholder:text-muted focus:border-brand"
            />
          </label>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link href="/recuperar-senha" className="text-muted hover:text-fg">
          Esqueci minha senha
        </Link>
        <Link href="/" className="text-muted hover:text-fg">
          ← voltar
        </Link>
      </div>

      {/* acesso master só no apex (yugochat.com.br); nunca no slug de empresa */}
      {!companySlug && (
        <div className="mt-10 border-t border-line pt-6 text-center">
          <button
            type="button"
            onClick={() => {
              setMasterMode(!masterMode);
              setError(null);
              setMfaRequired(false);
            }}
            className="text-xs text-muted hover:text-brand"
          >
            {masterMode
              ? "← Voltar para login normal"
              : "Acessar como master da plataforma"}
          </button>
        </div>
      )}

      <p className="mt-12 text-center text-xs text-muted">
        Ao entrar, você concorda com nossos{" "}
        <Link href="/termos" className="underline">
          termos
        </Link>{" "}
        e{" "}
        <Link href="/privacidade" className="underline">
          política de privacidade
        </Link>
        .
      </p>
    </main>
  );
}
