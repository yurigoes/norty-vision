"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface OrgBrand {
  id: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  themeMode?: string | null;
}

/**
 * Branding da empresa (contratante): logo e cor principal.
 * A logo aparece no sistema da empresa e, de forma absoluta, no portal do
 * cliente. A cor principal sobrescreve o tema base (--brand).
 */
export function OrgBrandingCard({ initial }: { initial: OrgBrand | null }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? "#7c3aed");
  const [themeMode, setThemeMode] = useState(initial?.themeMode ?? "system");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/organizations/me/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          logoUrl: logoUrl.trim() || null,
          primaryColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : null,
          themeMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      setMsg("Branding atualizado.");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/organizations/me/logo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha no upload");
      setLogoUrl(data.url);
      setMsg("Logo enviada.");
      router.refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
        Marca da empresa
      </h2>
      <p className="mt-1 text-xs text-muted">
        Logo e cor principal usadas no sistema e no portal do cliente.
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-20 w-full items-center justify-center rounded-xl border border-line bg-surface-2 p-2">
            {logoUrl ? (
              <img src={logoUrl} alt="logo" className="max-h-16 w-auto object-contain" />
            ) : (
              <span className="text-xs text-muted">sem logo</span>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full rounded-xl border border-line py-2 text-xs transition hover:border-brand/60 hover:text-brand disabled:opacity-50"
          >
            Enviar logo
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Logo por link (opcional)</span>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="input-base"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Cor principal</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : "#7c3aed"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-8 w-12 cursor-pointer rounded-lg border border-line bg-transparent"
              />
              <input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#RRGGBB"
                className="input-base w-32"
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Tema do slug da empresa</span>
            <select
              value={themeMode}
              onChange={(e) => setThemeMode(e.target.value)}
              className="input-base"
            >
              <option value="system">Padrão (claro)</option>
              <option value="light">Sempre claro</option>
              <option value="dark">Sempre escuro</option>
            </select>
            <span className="mt-1 block text-[10px] text-muted">
              Predomina em toda a marca da empresa: vitrine e portais (cliente, funcionário, fornecedor). O visitante ainda pode alternar manualmente.
            </span>
          </label>
          {err && <p className="text-xs text-red-300">{err}</p>}
          {msg && <p className="text-xs text-green-300">{msg}</p>}
          <button
            onClick={save}
            disabled={busy}
            className="btn-grad disabled:opacity-50"
          >
            {busy ? "Salvando..." : "Salvar marca"}
          </button>
        </div>
      </div>
    </section>
  );
}
