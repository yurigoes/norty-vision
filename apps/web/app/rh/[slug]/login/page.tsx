"use client";

import { use, useState } from "react";
import { PortalAuthLayout } from "../../../../components/PortalAuthLayout";
import { useOrgBrand } from "../../../../lib/useOrgBrand";
import { rememberOrgSlug, safeNext } from "../../../../lib/orgMemory";

/** Máscara de CPF enquanto digita: 000.000.000-00 */
function formatCpf(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Portal do FUNCIONÁRIO com escopo na empresa (CPF se repete entre empresas —
 * sem o slug o login genérico não acha ninguém). Ponto, holerite e
 * solicitações. Depois de entrar, "Sair" volta pra esta mesma tela.
 */
export default function EmployeeSlugLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { brand } = useOrgBrand(slug);
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cpfDigits = cpf.replace(/\D/g, "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/employee/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cpf: cpfDigits, password, orgSlug: slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no login");
      rememberOrgSlug(slug);
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      window.location.assign(data.mustReset ? "/rh/redefinir" : (next ?? "/rh"));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const company = brand?.name ?? "sua empresa";

  return (
    <PortalAuthLayout
      portal="funcionario"
      slug={slug}
      title="Portal do funcionário"
      subtitle={`Equipe ${company} — entre com seu CPF e senha.`}
      headline={
        <>
          O portal da{" "}
          <span className="bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            sua equipe
          </span>
          .
        </>
      }
      tagline={`Ponto, holerite, férias e solicitações da equipe ${company}.`}
      hint="Primeiro acesso? Use o seu CPF (só números) como senha."
    >
      <form onSubmit={submit} noValidate>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">CPF</span>
          <input
            value={cpf}
            onChange={(e) => setCpf(formatCpf(e.target.value))}
            inputMode="numeric"
            autoComplete="username"
            placeholder="000.000.000-00"
            required
            className="input-base py-3 text-lg tracking-wide"
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

        {err && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
          >
            {err}
          </p>
        )}

        <button
          disabled={busy || cpfDigits.length !== 11 || !password}
          className="btn-grad mt-5 w-full py-3.5 text-[15px]"
        >
          {busy ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </PortalAuthLayout>
  );
}
