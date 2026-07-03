"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Member {
  id: string;
  email: string;
  name: string;
  role: "owner" | "support";
  status: string;
}

export function TeamClient({ initial, selfId }: { initial: Member[]; selfId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [nf, setNf] = useState({ name: "", email: "", role: "support" as "owner" | "support" });
  const [tempPassword, setTempPassword] = useState<{ email: string; pass: string } | null>(null);

  async function setRole(m: Member, role: "owner" | "support") {
    setBusyId(m.id);
    setErr(null);
    try {
      const res = await fetch(`/api/platform/team/${m.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao alterar papel");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(m: Member, status: "active" | "inactive") {
    setBusyId(m.id); setErr(null);
    try {
      const res = await fetch(`/api/platform/team/${m.id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusyId(null); }
  }

  async function resetPassword(m: Member) {
    setBusyId(m.id); setErr(null); setTempPassword(null);
    try {
      const res = await fetch(`/api/platform/team/${m.id}/reset-password`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setTempPassword({ email: m.email, pass: data.tempPassword });
    } catch (e: any) { setErr(e.message); } finally { setBusyId(null); }
  }

  async function createMember() {
    setErr(null); setTempPassword(null);
    if (nf.name.trim().length < 2 || !nf.email.includes("@")) { setErr("Informe nome e e-mail válidos."); return; }
    try {
      const res = await fetch("/api/platform/team", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: nf.name.trim(), email: nf.email.trim(), role: nf.role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      setTempPassword({ email: nf.email.trim(), pass: data.tempPassword });
      setCreating(false); setNf({ name: "", email: "", role: "support" });
      router.refresh();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-3">
      {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{err}</p>}

      {tempPassword && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-4 text-sm">
          <p className="font-semibold text-green-100">Senha provisória de {tempPassword.email}:</p>
          <p className="mt-1 font-mono text-lg">{tempPassword.pass}</p>
          <p className="mt-1 text-xs text-muted">Anote e repasse com segurança — não será mostrada de novo. O membro define a senha/2FA no primeiro acesso.</p>
          <button onClick={() => setTempPassword(null)} className="mt-2 text-xs text-muted hover:underline">fechar</button>
        </div>
      )}

      {!creating ? (
        <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Novo membro</button>
      ) : (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-bg/60 p-4">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Nome</span>
            <input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">E-mail</span>
            <input value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" /></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Papel</span>
            <select value={nf.role} onChange={(e) => setNf({ ...nf, role: e.target.value as any })} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
              <option value="support">Suporte master</option><option value="owner">Dono (acesso total)</option>
            </select></label>
          <button onClick={createMember} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Criar</button>
          <button onClick={() => setCreating(false)} className="text-xs text-muted">cancelar</button>
        </div>
      )}
      {initial.map((m) => {
        const isSelf = m.id === selfId;
        return (
          <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {m.name} {isSelf && <span className="text-xs text-muted">(você)</span>}
                {m.status === "inactive" && <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-[10px] uppercase text-red-300">inativo</span>}
              </p>
              <p className="truncate text-xs text-muted">{m.email}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${m.role === "owner" ? "bg-brand/20 text-brand" : "bg-line text-muted"}`}>
                {m.role === "owner" ? "dono" : "suporte"}
              </span>
              {!isSelf && (
                <>
                  <select
                    value={m.role}
                    disabled={busyId === m.id}
                    onChange={(e) => setRole(m, e.target.value as "owner" | "support")}
                    className="rounded border border-line bg-bg/60 px-2 py-1 text-xs"
                  >
                    <option value="owner">Dono (acesso total)</option>
                    <option value="support">Suporte master</option>
                  </select>
                  <button disabled={busyId === m.id} onClick={() => resetPassword(m)} className="rounded border border-line px-2 py-1 text-xs hover:border-brand disabled:opacity-50">Resetar senha</button>
                  {m.status === "active"
                    ? <button disabled={busyId === m.id} onClick={() => setStatus(m, "inactive")} className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-red-300 disabled:opacity-50">Inativar</button>
                    : <button disabled={busyId === m.id} onClick={() => setStatus(m, "active")} className="rounded border border-line px-2 py-1 text-xs text-green-300 disabled:opacity-50">Reativar</button>}
                </>
              )}
            </div>
          </div>
        );
      })}
      {initial.length === 0 && (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum master cadastrado.</p>
      )}
    </div>
  );
}
