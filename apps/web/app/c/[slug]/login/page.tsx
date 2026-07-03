"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Modos de login do portal do cliente.
// Por padrão começa em "phone" (telefone + OTP WhatsApp) — cliente comum prefere
// não dar CPF. Quem quiser pode trocar pra "doc-code" (CPF + OTP) ou "password".
type IdMode = "phone" | "doc"; // identificador
type Step = "input" | "code" | "password";

interface Brand {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

function applyBrandColor(hex: string | null) {
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const int = parseInt(hex.slice(1), 16);
    document.documentElement.style.setProperty(
      "--brand",
      `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`,
    );
  }
}

// Formata telefone enquanto digita: (XX) XXXXX-XXXX
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function formatDoc(raw: string): string {
  // CPF (11) ou CNPJ (14) — máscara genérica deixa o usuário ver
  return raw.replace(/\D/g, "").slice(0, 14);
}

export default function PortalSlugLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [brandLoading, setBrandLoading] = useState(true);

  const [idMode, setIdMode] = useState<IdMode>("phone");
  const [step, setStep] = useState<Step>("input");

  const [phone, setPhone] = useState("");
  const [document, setDocument] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const [masked, setMasked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/organizations/public/by-slug/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const org: Brand | undefined = d?.organization;
        if (org) {
          setBrand(org);
          applyBrandColor(org.primaryColor);
        }
      })
      .finally(() => setBrandLoading(false));
  }, [slug]);

  const idDigits = idMode === "phone" ? phone.replace(/\D/g, "") : document.replace(/\D/g, "");
  const idValid = idMode === "phone" ? idDigits.length >= 10 : idDigits.length >= 11;

  async function requestCode() {
    setLoading(true); setError(null);
    try {
      const url = idMode === "phone" ? "/api/portal/auth/request-code-phone" : "/api/portal/auth/request-code";
      const payload = idMode === "phone" ? { phone, orgSlug: slug } : { document, orgSlug: slug };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Falha"); return; }
      if (!data.sent) {
        setError(idMode === "phone"
          ? "Telefone não encontrado. Verifique o número ou procure a loja."
          : "Documento não encontrado ou sem WhatsApp. Procure a loja.");
        return;
      }
      setMasked(data.masked);
      setStep("code");
    } finally { setLoading(false); }
  }

  async function verifyCode() {
    setLoading(true); setError(null);
    try {
      const url = idMode === "phone" ? "/api/portal/auth/verify-code-phone" : "/api/portal/auth/verify-code";
      const payload = idMode === "phone" ? { phone, code, orgSlug: slug } : { document, code, orgSlug: slug };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document, password, orgSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error?.message ?? "Credenciais inválidas"); return; }
      router.push(data.mustReset ? "/c/redefinir" : "/c");
    } finally { setLoading(false); }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        {brand?.logoUrl ? (
          <img src={brand.logoUrl} alt={brand.name} className="mx-auto h-14 w-auto max-w-[220px] object-contain" />
        ) : brandLoading ? (
          <span className="opacity-0">•</span>
        ) : (
          <span className="text-2xl font-bold" style={{ color: "rgb(var(--brand))" }}>{brand?.name ?? "Painel do cliente"}</span>
        )}
        <h1 className="mt-6 text-2xl font-extrabold tracking-tight">Painel do cliente</h1>
        <p className="mt-1 text-sm text-muted">
          {brand?.name ? `Acompanhe suas compras e parcelas na ${brand.name}.` : "Acompanhe suas compras e parcelas do crediário."}
        </p>
      </div>

      <div className="card p-6 sm:p-7">
        {step === "input" && (
          <>
            {/* Toggle de modo: telefone (default) ou CPF/CNPJ */}
            <div className="mb-4 flex rounded-xl border border-line bg-surface-2 p-1 text-sm">
              <button
                onClick={() => { setIdMode("phone"); setError(null); }}
                className={`flex-1 rounded-lg py-1.5 font-medium transition ${idMode === "phone" ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-fg"}`}
              >📱 Telefone</button>
              <button
                onClick={() => { setIdMode("doc"); setError(null); }}
                className={`flex-1 rounded-lg py-1.5 font-medium transition ${idMode === "doc" ? "bg-surface text-brand shadow-sm" : "text-muted hover:text-fg"}`}
              >🪪 CPF / CNPJ</button>
            </div>

            {idMode === "phone" ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">Telefone (com DDD)</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  inputMode="numeric"
                  placeholder="(71) 99999-9999"
                  className="input-base"
                  autoFocus
                />
                <p className="mt-1.5 text-[11px] text-muted">Enviamos um código de 6 dígitos pelo WhatsApp.</p>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">CPF / CNPJ</span>
                <input
                  value={document}
                  onChange={(e) => setDocument(formatDoc(e.target.value))}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  className="input-base"
                  autoFocus
                />
              </label>
            )}

            <div className="mt-4 space-y-2">
              <button
                onClick={requestCode}
                disabled={loading || !idValid}
                className="btn-grad w-full py-2.5 text-[15px]"
              >
                {loading ? "Enviando..." : "Receber código no WhatsApp"}
              </button>
              {idMode === "doc" && (
                <button
                  onClick={() => setStep("password")}
                  disabled={!idValid}
                  className="w-full rounded-xl border border-line bg-surface py-2.5 text-sm font-medium text-fg transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
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
              placeholder="000000"
              className="input-base text-center font-mono text-lg tracking-widest"
              autoFocus
            />
            <button
              onClick={verifyCode}
              disabled={loading || code.length !== 6}
              className="btn-grad w-full py-2.5 text-[15px]"
            >
              {loading ? "Verificando..." : "Entrar"}
            </button>
            <button onClick={() => { setStep("input"); setCode(""); }} className="w-full text-xs text-muted transition-colors hover:text-fg">voltar</button>
          </div>
        )}

        {step === "password" && (
          <div className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              className="input-base"
              autoFocus
            />
            <button
              onClick={loginPassword}
              disabled={loading || !password}
              className="btn-grad w-full py-2.5 text-[15px]"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
            <button onClick={() => { setStep("input"); setPassword(""); }} className="w-full text-xs text-muted transition-colors hover:text-fg">usar WhatsApp</button>
          </div>
        )}

        {error && <p className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger">{error}</p>}
      </div>

      <p className="mt-6 text-center text-[11px] text-muted">Portal seguro por YUGO</p>
    </main>
  );
}
