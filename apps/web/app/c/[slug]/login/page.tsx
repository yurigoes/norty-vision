"use client";

import { use, useState } from "react";
import { PortalAuthLayout } from "../../../../components/PortalAuthLayout";
import { useOrgBrand } from "../../../../lib/useOrgBrand";
import { rememberOrgSlug, safeNext } from "../../../../lib/orgMemory";

// Por padrão começa em "phone" (telefone + código no WhatsApp) — cliente comum
// prefere não dar CPF. Quem quiser troca pra CPF/CNPJ (código ou senha).
type IdMode = "phone" | "doc";
type Step = "input" | "code" | "password";

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function formatDoc(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 14);
}

/**
 * Portal do CLIENTE com escopo na empresa: compras, crediário, ordens de
 * serviço e chamados. Entrada por telefone + código no WhatsApp (padrão) ou
 * CPF/CNPJ com código/senha.
 */
export default function PortalSlugLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { brand } = useOrgBrand(slug);

  const [idMode, setIdMode] = useState<IdMode>("phone");
  const [step, setStep] = useState<Step>("input");
  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idDigits = idMode === "phone" ? phone.replace(/\D/g, "") : document.replace(/\D/g, "");
  const idValid = idMode === "phone" ? idDigits.length >= 10 : idDigits.length >= 11;

  function finish(fallback: string) {
    rememberOrgSlug(slug);
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    window.location.assign(next ?? fallback);
  }

  async function requestCode() {
    setLoading(true);
    setError(null);
    try {
      const url = idMode === "phone" ? "/api/portal/auth/request-code-phone" : "/api/portal/auth/request-code";
      const payload = idMode === "phone" ? { phone, orgSlug: slug } : { document, orgSlug: slug };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Falha");
        return;
      }
      if (!data.sent) {
        setError(
          idMode === "phone"
            ? "Telefone não encontrado. Verifique o número ou procure a loja."
            : "Documento não encontrado ou sem WhatsApp. Procure a loja.",
        );
        return;
      }
      setMasked(data.masked);
      setStep("code");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setLoading(true);
    setError(null);
    try {
      const url = idMode === "phone" ? "/api/portal/auth/verify-code-phone" : "/api/portal/auth/verify-code";
      const payload = idMode === "phone" ? { phone, code, orgSlug: slug } : { document, code, orgSlug: slug };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Código inválido");
        return;
      }
      finish("/c");
    } finally {
      setLoading(false);
    }
  }

  async function loginPassword() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portal/auth/login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, password, orgSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Credenciais inválidas");
        return;
      }
      if (data.mustReset) {
        rememberOrgSlug(slug);
        window.location.assign("/c/redefinir");
        return;
      }
      finish("/c");
    } finally {
      setLoading(false);
    }
  }

  const company = brand?.name ?? "sua loja";

  return (
    <PortalAuthLayout
      portal="cliente"
      slug={slug}
      title="Painel do cliente"
      subtitle={`Acompanhe suas compras e parcelas na ${company}.`}
      headline={
        <>
          Seu crediário,{" "}
          <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            na palma
          </span>{" "}
          da mão.
        </>
      }
      tagline={`Compras, parcelas, boletos e ordens de serviço da ${company}.`}
    >
      <div className="card p-5 sm:p-6">
        {step === "input" && (
          <>
            <div className="mb-4 flex rounded-xl border border-line bg-surface-2 p-1 text-sm">
              <button
                type="button"
                onClick={() => {
                  setIdMode("phone");
                  setError(null);
                }}
                className={`flex-1 rounded-lg py-2 font-medium transition ${idMode === "phone" ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-fg"}`}
              >
                Telefone
              </button>
              <button
                type="button"
                onClick={() => {
                  setIdMode("doc");
                  setError(null);
                }}
                className={`flex-1 rounded-lg py-2 font-medium transition ${idMode === "doc" ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-fg"}`}
              >
                CPF / CNPJ
              </button>
            </div>

            {idMode === "phone" ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                  Telefone (com DDD)
                </span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  inputMode="numeric"
                  placeholder="(71) 99999-9999"
                  className="input-base py-3 text-lg"
                  autoFocus
                />
                <span className="mt-1.5 block text-[11px] text-muted">
                  Enviamos um código de 6 dígitos pelo WhatsApp.
                </span>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
                  CPF / CNPJ
                </span>
                <input
                  value={document}
                  onChange={(e) => setDocument(formatDoc(e.target.value))}
                  inputMode="numeric"
                  placeholder="00000000000"
                  className="input-base py-3 text-lg"
                  autoFocus
                />
              </label>
            )}

            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={requestCode}
                disabled={loading || !idValid}
                className="btn-grad w-full py-3 text-[15px]"
              >
                {loading ? "Enviando..." : "Receber código no WhatsApp"}
              </button>
              {idMode === "doc" && (
                <button
                  type="button"
                  onClick={() => setStep("password")}
                  disabled={!idValid}
                  className="w-full rounded-xl border border-line bg-surface py-3 text-sm font-medium text-fg transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
                >
                  Entrar com senha
                </button>
              )}
            </div>
          </>
        )}

        {step === "code" && (
          <div className="space-y-3">
            <p className="text-xs text-muted">Enviamos um código para {masked}. Vale por 10 minutos.</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="input-base py-3 text-center font-mono text-xl tracking-[0.4em]"
              autoFocus
            />
            <button
              type="button"
              onClick={verifyCode}
              disabled={loading || code.length !== 6}
              className="btn-grad w-full py-3 text-[15px]"
            >
              {loading ? "Verificando..." : "Entrar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("input");
                setCode("");
              }}
              className="w-full text-xs text-muted transition-colors hover:text-fg"
            >
              voltar
            </button>
          </div>
        )}

        {step === "password" && (
          <div className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              autoComplete="current-password"
              className="input-base py-3"
              autoFocus
            />
            <button
              type="button"
              onClick={loginPassword}
              disabled={loading || !password}
              className="btn-grad w-full py-3 text-[15px]"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("input");
                setPassword("");
              }}
              className="w-full text-xs text-muted transition-colors hover:text-fg"
            >
              usar WhatsApp
            </button>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </PortalAuthLayout>
  );
}
