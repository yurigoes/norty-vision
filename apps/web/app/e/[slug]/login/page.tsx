"use client";

import { use, useState } from "react";
import { PortalAuthLayout } from "../../../../components/PortalAuthLayout";
import { useOrgBrand } from "../../../../lib/useOrgBrand";
import { rememberOrgSlug, safeNext } from "../../../../lib/orgMemory";

/**
 * Login da EQUIPE/ADMINISTRAÇÃO com escopo no slug da empresa. Só passa quem
 * tem membership ativo NESTA empresa (o backend rejeita os demais, mesmo admin
 * de outra). Segue a marca e o tema da empresa. O master continua só no apex.
 *
 * Depois de entrar vai pro `?next=` (a página que o usuário tentou abrir antes
 * da sessão expirar) ou pro painel. O slug fica lembrado no aparelho, então
 * "Sair" volta exatamente pra esta tela — e não pro /login genérico.
 */
export default function TeamSlugLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { brand } = useOrgBrand(slug);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: email.trim(),
          password,
          mfaCode: mfaCode || undefined,
          orgSlug: slug,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === "MFA_REQUIRED") {
          setNeedMfa(true);
          setErr("Informe o código 2FA do seu aplicativo autenticador.");
          return;
        }
        throw new Error(data?.error?.message ?? "Falha no login");
      }
      rememberOrgSlug(slug);
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      window.location.assign(next ?? "/app");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const company = brand?.name ?? "sua empresa";

  return (
    <PortalAuthLayout
      portal="equipe"
      slug={slug}
      title="Entrar na operação"
      subtitle={`Acesso interno da ${company} — agenda, vendas e financeiro.`}
      headline={
        <>
          Toque a operação{" "}
          <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            por dentro
          </span>
          .
        </>
      }
      tagline={`Agenda, vendas, caixa e financeiro da ${company} num painel só.`}
      hint={
        <a href="/recuperar-senha" className="transition-colors hover:text-fg">
          Esqueci minha senha
        </a>
      }
    >
      <form onSubmit={submit} noValidate>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            placeholder="voce@empresa.com.br"
            required
            className="input-base py-3"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">Senha</span>
          <span className="relative block">
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
              className="input-base py-3 pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted transition hover:text-fg"
            >
              {showPass ? "ocultar" : "ver"}
            </button>
          </span>
        </label>

        {needMfa && (
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">Código 2FA</span>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className="input-base py-3 text-center text-lg tracking-[0.4em]"
            />
          </label>
        )}

        {err && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
          >
            {err}
          </p>
        )}

        <button disabled={busy} className="btn-grad mt-5 w-full py-3.5 text-[15px]">
          {busy ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </PortalAuthLayout>
  );
}
