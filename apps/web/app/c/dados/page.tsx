"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function PortalDados() {
  const router = useRouter();
  const [c, setC] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/me", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/c/login"); return null; } return r.json(); })
      .then((d) => { if (d) setC(d.customer ?? {}); })
      .finally(() => setLoading(false));
  }, [router]);

  async function uploadAvatar(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/portal/upload", { method: "POST", body: fd, credentials: "include" });
    const data = await res.json();
    if (res.ok) setC((prev: any) => ({ ...prev, avatarUrl: data.url }));
  }

  async function save() {
    setSaving(true); setMsg(null);
    const res = await fetch("/api/portal/profile", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        email: c.email ?? null, phone: c.phone ?? null, whatsappPhone: c.whatsappPhone ?? null,
        city: c.city ?? null, state: c.state ?? null, postalCode: c.postalCode ?? null,
        addressLine: c.addressLine ?? null, addressNumber: c.addressNumber ?? null,
        addressComplement: c.addressComplement ?? null, neighborhood: c.neighborhood ?? null,
        avatarUrl: c.avatarUrl ?? null,
      }),
    });
    setSaving(false);
    setMsg(res.ok ? "Dados salvos!" : "Falha ao salvar");
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center text-muted">Carregando...</div>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/c" className="text-sm font-medium text-brand hover:underline">← voltar</Link>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Meus dados</h1>

      <div className="card mt-6 flex items-center gap-4">
        {c.avatarUrl
          ? <img src={c.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
          : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-2 text-2xl text-muted">?</div>}
        <label className="cursor-pointer rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/50 hover:text-brand">
          Trocar foto
          <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
        </label>
      </div>

      <div className="card mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Email" value={c.email} onChange={(v) => setC({ ...c, email: v })} />
        <Field label="Telefone" value={c.phone} onChange={(v) => setC({ ...c, phone: v })} />
        <Field label="WhatsApp" value={c.whatsappPhone} onChange={(v) => setC({ ...c, whatsappPhone: v })} />
        <Field label="CEP" value={c.postalCode} onChange={(v) => setC({ ...c, postalCode: v })} />
        <Field label="Endereço" value={c.addressLine} onChange={(v) => setC({ ...c, addressLine: v })} />
        <Field label="Número" value={c.addressNumber} onChange={(v) => setC({ ...c, addressNumber: v })} />
        <Field label="Complemento" value={c.addressComplement} onChange={(v) => setC({ ...c, addressComplement: v })} />
        <Field label="Bairro" value={c.neighborhood} onChange={(v) => setC({ ...c, neighborhood: v })} />
        <Field label="Cidade" value={c.city} onChange={(v) => setC({ ...c, city: v })} />
        <Field label="UF" value={c.state} onChange={(v) => setC({ ...c, state: v })} />
      </div>

      {msg && <p className="mt-4 text-sm font-medium text-success">{msg}</p>}
      <button onClick={save} disabled={saving} className="btn-grad mt-6 px-6 py-2.5">
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: any; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="input-base" />
    </label>
  );
}
