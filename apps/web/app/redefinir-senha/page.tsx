"use client";

import { useState, type FormEvent, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { BrandLogoClient } from "../../components/BrandLogoClient";

function RedefinirSenhaInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    if (newPassword !== confirm) {
      setError("As senhas não conferem.");
      setLoading(false);
      return;
    }
    if (newPassword.length < 12) {
      setError("Senha precisa de no mínimo 12 caracteres.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(data?.error?.message ?? "Falha ao redefinir senha");
        setLoading(false);
        return;
      }
      setSuccess(true);
      setLoading(false);
      setTimeout(() => router.push("/login"), 1500);
    } catch {
      setError("Erro de conexão");
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        Link inválido. <Link href="/recuperar-senha" className="underline">Pedir novo link</Link>.
      </p>
    );
  }

  if (success) {
    return (
      <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-6 text-sm text-green-100">
        <p className="font-semibold">Senha redefinida com sucesso!</p>
        <p className="mt-2">Redirecionando para o login...</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Nova senha (mín 12 caracteres, com letra maiúscula, minúscula e número)
        </span>
        <input
          type="password"
          name="newPassword"
          required
          minLength={12}
          autoFocus
          autoComplete="new-password"
          className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-fg outline-none transition focus:border-brand"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted">
          Confirmar nova senha
        </span>
        <input
          type="password"
          name="confirm"
          required
          minLength={12}
          autoComplete="new-password"
          className="w-full rounded-lg border border-line bg-bg/60 px-4 py-3 text-fg outline-none transition focus:border-brand"
        />
      </label>
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
        {loading ? "Salvando..." : "Redefinir senha"}
      </button>
    </form>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-12 self-center transition-opacity hover:opacity-80">
        <BrandLogoClient size="md" />
      </Link>
      <h1 className="text-2xl font-semibold text-center">Nova senha</h1>
      <p className="mt-2 text-center text-sm text-muted">
        Defina uma senha forte. Ela vai substituir a anterior imediatamente.
      </p>
      <div className="mt-10">
        <Suspense fallback={<p className="text-center text-muted">Carregando...</p>}>
          <RedefinirSenhaInner />
        </Suspense>
      </div>
      <Link
        href="/login"
        className="mt-6 text-center text-sm text-muted hover:text-fg"
      >
        ← voltar para login
      </Link>
    </main>
  );
}
