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
      <Link href="/" className="mb-8 self-center transition-opacity hover:opacity-80">
        <BrandLogoClient size="lg" />
      </Link>
      <div className="glass rounded-2xl p-8">
        <h1 className="text-center text-2xl font-extrabold tracking-tight">Recuperar senha</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Informe o e-mail cadastrado. Se existir conta, enviaremos um link
          válido por 30 minutos.
        </p>

        {sent ? (
          <div className="mt-8 rounded-xl border border-success/40 bg-success/10 p-6 text-sm text-success">
            <p className="font-semibold">E-mail enviado (se a conta existir).</p>
            <p className="mt-2 text-success/80">
              Verifique sua caixa de entrada e a pasta de spam. O link funciona
              por 30 minutos.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="voce@empresa.com.br"
              className="input-base py-3"
            />
            {error && (
              <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-grad w-full py-3 text-sm shadow-[0_10px_28px_-10px_rgb(var(--brand)/0.7)]"
            >
              {loading ? "Enviando..." : "Enviar link"}
            </button>
          </form>
        )}
      </div>

      <Link
        href="/login"
        className="mt-6 text-center text-sm text-muted transition-colors hover:text-fg"
      >
        ← voltar para login
      </Link>
    </main>
  );
}
