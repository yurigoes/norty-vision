"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
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

  const inputClass =
    "mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-sm text-fg outline-none transition placeholder:text-text-3 focus:border-brand focus:ring-2 focus:ring-brand/20";

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/norty-vision.png" alt="Norty Vision" className="h-9 w-auto object-contain" />
        </div>
        <div className="relative my-auto">
          <h2 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight">
            A{" "}
            <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
              visão
            </span>{" "}
            completa do seu negócio.
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            Agenda, leads, vendas, financeiro e atendimento em um único painel inteligente.
          </p>
          <div className="mt-8 flex flex-col gap-3.5">
            {[
              "Agenda e leads em tempo real",
              "PDV, caixa e financeiro integrados",
              "Atendimento com IA multicanal",
            ].map((f) => (
              <div key={f} className="flex items-center gap-3 text-slate-200">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand/25 text-blue-400">
                  <Check size={14} />
                </span>
                {f}
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-xs text-slate-500">© 2026 Norty Vision</div>
      </aside>

      {/* FORM */}
      <main className="grid place-items-center bg-bg p-6 md:p-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center md:hidden">
            <Link href="/" aria-label="Voltar" className="transition-opacity hover:opacity-80">
              <BrandLogoClient size="lg" />
            </Link>
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight">
            {masterMode ? "Acesso master" : "Entrar na sua conta"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {masterMode
              ? "Apenas para o dono da plataforma."
              : "Acesse para gerenciar agenda, leads e disparos."}
          </p>

          {error && (
            <div className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
            <label className="block">
              <span className="block text-xs font-semibold text-muted">E-mail</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="voce@empresa.com.br"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-muted">Senha</span>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                autoComplete="current-password"
                placeholder="••••••••"
                className={inputClass}
              />
            </label>

            {mfaRequired && (
              <label className="block">
                <span className="block text-xs font-semibold text-muted">
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
                  className={`${inputClass} text-center text-2xl tracking-widest`}
                />
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-semibold text-white shadow-[0_8px_22px_-8px_rgb(var(--brand)/0.7)] transition-all duration-150 hover:brightness-[1.06] active:scale-[.98] disabled:pointer-events-none disabled:opacity-50"
              style={{ background: "var(--grad-brand)" }}
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-between text-sm">
            <Link href="/recuperar-senha" className="text-muted transition-colors hover:text-fg">
              Esqueci minha senha
            </Link>
            <Link href="/" className="text-muted transition-colors hover:text-fg">
              ← voltar
            </Link>
          </div>

          {/* acesso master só no apex (yugochat.com.br); nunca no slug de empresa */}
          {!companySlug && (
            <div className="mt-8 border-t border-line pt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setMasterMode(!masterMode);
                  setError(null);
                  setMfaRequired(false);
                }}
                className="text-xs text-muted transition-colors hover:text-brand"
              >
                {masterMode
                  ? "← Voltar para login normal"
                  : "Acessar como master da plataforma"}
              </button>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-text-3">
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
        </div>
      </main>
    </div>
  );
}
