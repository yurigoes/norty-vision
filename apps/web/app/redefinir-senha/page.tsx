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
      <p className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
        Link inválido. <Link href="/recuperar-senha" className="underline">Pedir novo link</Link>.
      </p>
    );
  }

  if (success) {
    return (
      <div className="rounded-xl border border-success/40 bg-success/10 p-6 text-sm text-success">
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
          className="input-base py-3"
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
          className="input-base py-3"
        />
      </label>
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
        {loading ? "Salvando..." : "Redefinir senha"}
      </button>
    </form>
  );
}

export default function RedefinirSenhaPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 self-center transition-opacity hover:opacity-80">
        <BrandLogoClient size="lg" />
      </Link>
      <div className="glass rounded-2xl p-8">
        <h1 className="text-center text-2xl font-extrabold tracking-tight">Nova senha</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Defina uma senha forte. Ela vai substituir a anterior imediatamente.
        </p>
        <div className="mt-8">
          <Suspense fallback={<p className="text-center text-muted">Carregando...</p>}>
            <RedefinirSenhaInner />
          </Suspense>
        </div>
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
