"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Store {
  id: string;
  slug: string;
  name: string;
  catalogEnabled?: boolean;
  catalogHeadline?: string | null;
  catalogWhatsapp?: string | null;
}
interface Lead {
  id: string;
  storeId: string;
  customerName: string;
  customerPhone: string;
  message: string | null;
  items: Array<{ name: string; qty: number; unitPriceCents: number }>;
  totalCents: string;
  status: string;
  createdAt: string;
}

function brl(cents: number | string): string {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const STATUS_LABEL: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  converted: "Convertido",
  dismissed: "Descartado",
};

export function CatalogClient({ stores, leads, orgSlug }: { stores: Store[]; leads: Lead[]; orgSlug?: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Lojas</h2>
        <div className="space-y-4">
          {stores.map((s) => (
            <StoreCard key={s.id} store={s} origin={origin} orgSlug={orgSlug ?? null} onSaved={() => startTransition(() => router.refresh())} />
          ))}
          {stores.length === 0 && <p className="text-sm text-muted">Nenhuma loja cadastrada.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Pedidos da vitrine ({leads.length})</h2>
        {leads.length === 0 ? (
          <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum pedido ainda.</p>
        ) : (
          <div className="space-y-3">
            {leads.map((l) => (
              <LeadCard key={l.id} lead={l} onChanged={() => startTransition(() => router.refresh())} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StoreCard({ store, origin, orgSlug, onSaved }: { store: Store; origin: string; orgSlug: string | null; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(!!store.catalogEnabled);
  const [headline, setHeadline] = useState(store.catalogHeadline ?? "");
  const [whatsapp, setWhatsapp] = useState(store.catalogWhatsapp ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // catálogo público é endereçado pelo slug da EMPRESA (único entre tenants)
  const url = `${origin}/loja/${orgSlug ?? store.slug}`;

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch(`/api/marketplace/stores/${store.id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogEnabled: enabled, catalogHeadline: headline || null, catalogWhatsapp: whatsapp || null }),
        credentials: "include",
      });
      if (res.ok) { setSaved(true); onSaved(); }
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-xl border border-line bg-bg/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{store.name}</p>
          <p className="text-xs text-muted">/{store.slug}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span>{enabled ? "Publicada" : "Desativada"}</span>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
        </label>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Chamada (headline)</span>
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Ex.: Coleção 2026 com até 10x" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">WhatsApp dos pedidos</span>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value.replace(/\D/g, ""))} placeholder="DDD + número" inputMode="tel" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
        </label>
      </div>

      {enabled && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs">
          <span className="truncate text-muted">{url}</span>
          <a href={url} target="_blank" rel="noreferrer" className="shrink-0 text-brand hover:underline">abrir</a>
          <button onClick={() => navigator.clipboard?.writeText(url)} className="shrink-0 text-brand hover:underline">copiar</button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Salvando..." : "Salvar"}
        </button>
        {saved && <span className="text-xs text-green-300">✓ salvo</span>}
      </div>
    </div>
  );
}

function LeadCard({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function setStatus(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/marketplace/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        credentials: "include",
      });
      if (res.ok) onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium">{lead.customerName}</p>
          <p className="text-xs text-muted">{lead.customerPhone} · {new Date(lead.createdAt).toLocaleString("pt-BR")}</p>
        </div>
        <span className="rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-muted">{STATUS_LABEL[lead.status] ?? lead.status}</span>
      </div>
      {Array.isArray(lead.items) && lead.items.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {lead.items.map((i) => `${i.qty}× ${i.name}`).join(" · ")} — <strong>{brl(lead.totalCents)}</strong>
        </p>
      )}
      {lead.message && <p className="mt-1 text-xs text-muted">“{lead.message}”</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`https://wa.me/55${lead.customerPhone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1 text-xs hover:border-brand">WhatsApp</a>
        <button disabled={busy} onClick={() => setStatus("contacted")} className="rounded-lg border border-line px-3 py-1 text-xs hover:border-brand disabled:opacity-50">Contatado</button>
        <button disabled={busy} onClick={() => setStatus("converted")} className="rounded-lg border border-green-500/40 px-3 py-1 text-xs text-green-300 hover:bg-green-500/10 disabled:opacity-50">Convertido</button>
        <button disabled={busy} onClick={() => setStatus("dismissed")} className="rounded-lg border border-line px-3 py-1 text-xs text-muted hover:text-red-300 disabled:opacity-50">Descartar</button>
      </div>
    </div>
  );
}
