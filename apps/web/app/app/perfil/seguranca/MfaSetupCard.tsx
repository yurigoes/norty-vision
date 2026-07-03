"use client";

import { useState } from "react";

type Step = "idle" | "scanning" | "verifying" | "active";

export function MfaSetupCard() {
  const [step, setStep] = useState<Step>("idle");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        setError(data?.error?.message ?? "Falha ao iniciar setup");
        return;
      }
      const data = (await res.json()) as { qrCodeDataUrl: string };
      setQrDataUrl(data.qrCodeDataUrl);
      setStep("scanning");
    } finally {
      setLoading(false);
    }
  }

  async function enable() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\D/g, "") }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as any;
        setError(data?.error?.message ?? "Código inválido");
        return;
      }
      setStep("active");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-bg/60 p-6 backdrop-blur-sm">
      <h2 className="text-lg font-semibold">Autenticação em dois fatores (TOTP)</h2>

      {step === "idle" && (
        <>
          <p className="mt-2 text-sm text-muted">
            Clique abaixo pra gerar o QR code. Use Google Authenticator, Authy
            ou 1Password no celular.
          </p>
          <button
            type="button"
            onClick={startSetup}
            disabled={loading}
            className="mt-4 rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Gerando..." : "Ativar 2FA"}
          </button>
        </>
      )}

      {step === "scanning" && qrDataUrl && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">
            1. Abra seu app autenticador no celular.<br />
            2. Escaneie o QR code abaixo.<br />
            3. Digite o código de 6 dígitos que aparece no app pra confirmar.
          </p>
          <div className="flex justify-center rounded-lg bg-white p-4">
            <img src={qrDataUrl} alt="QR code 2FA" className="h-48 w-48" />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
              Código de 6 dígitos
            </span>
            <input
              type="text"
              pattern="\d{6}"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              autoFocus
              className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-center text-2xl tracking-widest text-fg outline-none transition focus:border-brand"
            />
          </label>
          {error && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={enable}
            disabled={loading || code.length !== 6}
            className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Validando..." : "Confirmar e ativar"}
          </button>
        </div>
      )}

      {step === "active" && (
        <div className="mt-4 rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-100">
          <p className="font-semibold">2FA ativada com sucesso!</p>
          <p className="mt-2 text-green-200/80">
            A partir do próximo login você precisará informar o código de 6
            dígitos do app autenticador. Guarde o celular em local seguro — se
            perder, contate o master da plataforma pra reset.
          </p>
        </div>
      )}
    </div>
  );
}
