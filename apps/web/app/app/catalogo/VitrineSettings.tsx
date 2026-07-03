"use client";

import { useRef, useState } from "react";

export interface VitrineData {
  vitrineHeadline?: string | null;
  vitrineSubheadline?: string | null;
  vitrineAbout?: string | null;
  bannerImageUrl?: string | null;
  bannerLinkUrl?: string | null;
  bannerEnabled?: boolean;
  bannerStartsAt?: string | null;
  bannerEndsAt?: string | null;
  vitrineAddress?: string | null;
  vitrineMapsUrl?: string | null;
  vitrineHours?: string | null;
  socialInstagram?: string | null;
  socialFacebook?: string | null;
  socialWhatsapp?: string | null;
  socialWebsite?: string | null;
}

function isoToLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function VitrineSettings({
  initial,
  slug,
  rootDomain,
}: {
  initial: VitrineData;
  slug: string | null;
  rootDomain: string;
}) {
  const [headline, setHeadline] = useState(initial.vitrineHeadline ?? "");
  const [subheadline, setSubheadline] = useState(initial.vitrineSubheadline ?? "");
  const [about, setAbout] = useState(initial.vitrineAbout ?? "");
  const [bannerUrl, setBannerUrl] = useState<string | null>(initial.bannerImageUrl ?? null);
  const [bannerLink, setBannerLink] = useState(initial.bannerLinkUrl ?? "");
  const [bannerEnabled, setBannerEnabled] = useState(!!initial.bannerEnabled);
  const [startsAt, setStartsAt] = useState(isoToLocal(initial.bannerStartsAt));
  const [endsAt, setEndsAt] = useState(isoToLocal(initial.bannerEndsAt));
  const [address, setAddress] = useState(initial.vitrineAddress ?? "");
  const [mapsUrl, setMapsUrl] = useState(initial.vitrineMapsUrl ?? "");
  const [hours, setHours] = useState(initial.vitrineHours ?? "");
  const [instagram, setInstagram] = useState(initial.socialInstagram ?? "");
  const [facebook, setFacebook] = useState(initial.socialFacebook ?? "");
  const [whatsapp, setWhatsapp] = useState(initial.socialWhatsapp ?? "");
  const [website, setWebsite] = useState(initial.socialWebsite ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function uploadBanner(file: File) {
    setUploading(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/organizations/me/banner", { method: "POST", body: fd, credentials: "include" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.url) { setErr(d?.error?.message ?? "Falha no upload"); return; }
      setBannerUrl(d.url);
    } finally { setUploading(false); }
  }

  async function save() {
    setSaving(true); setErr(null); setSaved(false);
    try {
      const res = await fetch("/api/organizations/me/vitrine", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          vitrineHeadline: headline.trim() || null,
          vitrineSubheadline: subheadline.trim() || null,
          vitrineAbout: about.trim() || null,
          bannerImageUrl: bannerUrl,
          bannerLinkUrl: bannerLink.trim() || null,
          bannerEnabled,
          bannerStartsAt: localToIso(startsAt),
          bannerEndsAt: localToIso(endsAt),
          vitrineAddress: address.trim() || null,
          vitrineMapsUrl: mapsUrl.trim() || null,
          vitrineHours: hours.trim() || null,
          socialInstagram: instagram.trim() || null,
          socialFacebook: facebook.trim() || null,
          socialWhatsapp: whatsapp.trim() || null,
          socialWebsite: website.trim() || null,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(d?.error?.message ?? "Falha ao salvar"); return; }
      setSaved(true);
    } finally { setSaving(false); }
  }

  return (
    <section className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Vitrine / Landing da empresa</h2>
          <p className="mt-1 text-xs text-muted">
            A página que abre no seu subdomínio, com a sua marca. Capriche na frase de efeito.
          </p>
        </div>
        {slug && (
          <a href={`https://${slug}.${rootDomain}`} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-brand hover:underline">
            abrir vitrine ↗
          </a>
        )}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Frase de efeito (título)</span>
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={140} placeholder="Ex.: Enxergue o mundo com estilo" className="input-base" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Subtítulo</span>
          <input value={subheadline} onChange={(e) => setSubheadline(e.target.value)} maxLength={240} placeholder="Ex.: As melhores marcas, exame de vista e crediário próprio." className="input-base" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Sobre a loja</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={2000} rows={3} placeholder="Conte um pouco da sua loja, diferenciais, horário de atendimento..." className="input-base" />
        </label>
      </div>

      {/* Banner promocional */}
      <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Banner promocional (flutuante)</h3>
          <label className="flex items-center gap-2 text-sm">
            <span>{bannerEnabled ? "Ativo" : "Desativado"}</span>
            <input type="checkbox" checked={bannerEnabled} onChange={(e) => setBannerEnabled(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
          </label>
        </div>

        {bannerUrl && (
          <img src={bannerUrl} alt="Banner" className="mt-3 max-h-40 w-auto rounded-lg border border-line object-contain" />
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadBanner(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="rounded-xl border border-line px-4 py-2 text-sm transition hover:border-brand/60 hover:text-brand disabled:opacity-50">
            {uploading ? "Enviando..." : bannerUrl ? "Trocar imagem" : "Carregar imagem"}
          </button>
          {bannerUrl && <button onClick={() => setBannerUrl(null)} className="text-xs text-muted hover:text-red-300">remover</button>}
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Link ao clicar (opcional)</span>
          <input value={bannerLink} onChange={(e) => setBannerLink(e.target.value)} placeholder="https://..." className="input-base" />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Começa em (opcional)</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="input-base" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Termina em (opcional)</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="input-base" />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-muted">Sem datas = aparece sempre (enquanto ativo). O banner aparece flutuando ao abrir a vitrine.</p>
      </div>

      {/* Atendimento: endereço, horário, redes */}
      <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Atendimento (aparece em "Onde nos encontrar")</h3>
        <div className="mt-3 grid gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Endereço</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, nº, bairro, cidade - UF" className="input-base" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Link do Google Maps (opcional — se vazio, usa o endereço)</span>
            <input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="https://maps.google.com/..." className="input-base" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Horário de funcionamento</span>
            <textarea value={hours} onChange={(e) => setHours(e.target.value)} rows={2} placeholder="Seg a Sex: 9h às 18h&#10;Sáb: 9h às 13h" className="input-base" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Instagram (@ ou link)</span>
              <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@sualoja" className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Facebook (usuário ou link)</span>
              <input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="sualoja" className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">WhatsApp (com DDD)</span>
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} inputMode="tel" placeholder="11999998888" className="input-base" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Site (opcional)</span>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className="input-base" />
            </label>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">O nível de satisfação aparece automático na vitrine a partir das avaliações dos seus clientes (mín. 3 respostas).</p>
      </div>

      {err && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{err}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-grad disabled:opacity-50">
          {saving ? "Salvando..." : "Salvar vitrine"}
        </button>
        {saved && <span className="text-xs text-green-300">✓ salvo</span>}
      </div>
    </section>
  );
}
