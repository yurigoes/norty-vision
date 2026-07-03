"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BrandLogoClient } from "../../components/BrandLogoClient";

export default function RecuperarSenhaPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(data?.error?.message ?? "Falha ao processar pedido");
        setLoading(false);
        return;
      }
      setSent(true);
      setLoading(false);
    } catch {
      setError("Erro de conexão");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-12 self-center transition-opacity hover:opacity-80">
        <BrandLogoClient size="md" />
      </Link>
      <h1 className="text-2xl font-semibold text-center">Recuperar senha</h1>
      <p className="mt-2 text-center text-sm text-muted">
        Informe o e-mail cadastrado. Se existir conta, enviaremos um link
        válido por 30 minutos.
      </p>

      {sent ? (
        <div className="mt-10 rounded-lg border border-green-500/40 bg-green-500/10 p-6 text-sm text-green-100">
          <p className="font-semibold">E-mail enviado (se a conta existir).</p>
          <p className="mt-2 text-green-200/80">
            Verifique sua caixa de entrada e a pasta de spam. O link funciona
            por 30 minutos.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-10 space-y-4">
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-fg outline-none transition placeholder:text-muted focus:border-brand"
          />
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
            {loading ? "Enviando..." : "Enviar link"}
          </button>
        </form>
      )}

      <Link
        href="/login"
        className="mt-6 text-center text-sm text-muted hover:text-fg"
      >
        ← voltar para login
      </Link>
    </main>
  );
}
