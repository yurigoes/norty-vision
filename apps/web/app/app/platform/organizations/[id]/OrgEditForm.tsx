"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Org {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  document: string | null;
  documentType: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  planCode: string;
  primaryColor?: string | null;
  logoUrl?: string | null;
  maxExtraWhatsapp?: number | null;
  portalConfig?: string[] | null;
  callcenterConfig?: string[] | null;
  niche?: string | null;
  productSkin?: string | null;
}

const STATUS = ["active", "trialing", "suspended", "canceled"];
const NICHES = ["", "otica", "grafica", "generico"];
// "" = plataforma normal; "central-de-leads" = casca enxuta do produto Central de Leads.
const PRODUCT_SKINS = ["", "central-de-leads"];
const PORTAL_FEATURES: Array<{ key: string; label: string }> = [
  { key: "crediario", label: "Crediário" },
  { key: "os", label: "Ordens de serviço" },
  { key: "pedidos", label: "Meus pedidos (produção)" },
  { key: "chamados", label: "Chamados" },
  { key: "contratos", label: "Contratos" },
];
const CALLCENTER_BUTTONS: Array<{ key: string; label: string }> = [
  { key: "vender", label: "Vender" },
  { key: "agenda", label: "Agenda" },
];

export function OrgEditForm({ org }: { org: Org }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: org.name ?? "",
    slug: org.slug ?? "",
    legalName: org.legalName ?? "",
    document: org.document ?? "",
    documentType: org.documentType ?? "cnpj",
    contactEmail: org.contactEmail ?? "",
    contactPhone: org.contactPhone ?? "",
    status: org.status ?? "active",
    planCode: org.planCode ?? "",
    niche: org.niche ?? "",
    primaryColor: org.primaryColor ?? "",
    logoUrl: org.logoUrl ?? "",
    maxExtraWhatsapp: String(org.maxExtraWhatsapp ?? 0),
    productSkin: org.productSkin ?? "",
  });
  const [portal, setPortal] = useState<Record<string, boolean>>(() => {
    const cfg = org.portalConfig;
    const map: Record<string, boolean> = {};
    for (const ft of PORTAL_FEATURES) map[ft.key] = Array.isArray(cfg) ? cfg.includes(ft.key) : true;
    return map;
  });
  const [callcenter, setCallcenter] = useState<Record<string, boolean>>(() => {
    const cfg = org.callcenterConfig;
    const map: Record<string, boolean> = {};
    for (const b of CALLCENTER_BUTTONS) map[b.key] = Array.isArray(cfg) ? cfg.includes(b.key) : true;
    return map;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function set(k: keyof typeof f, v: string) { setF((s) => ({ ...s, [k]: v })); }

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const body: any = {
        name: f.name.trim(),
        slug: f.slug.trim().toLowerCase(),
        legalName: f.legalName.trim() || null,
        document: f.document.trim() || null,
        documentType: f.documentType || null,
        contactEmail: f.contactEmail.trim() || null,
        contactPhone: f.contactPhone.trim() || null,
        status: f.status,
        planCode: f.planCode.trim() || undefined,
        niche: f.niche.trim() || null,
        productSkin: f.productSkin.trim() || null,
        primaryColor: f.primaryColor.trim() || null,
        logoUrl: f.logoUrl.trim() || null,
        maxExtraWhatsapp: Math.max(0, parseInt(f.maxExtraWhatsapp || "0", 10) || 0),
        portalConfig: PORTAL_FEATURES.filter((ft) => portal[ft.key]).map((ft) => ft.key),
        callcenterConfig: CALLCENTER_BUTTONS.filter((b) => callcenter[b.key]).map((b) => b.key),
      };
      const res = await fetch(`/api/organizations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha ao salvar");
      setMsg("Dados atualizados.");
      router.refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-line bg-bg/60 p-6">
      <h2 className="mb-4 text-lg font-semibold">Editar organização</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" value={f.name} onChange={(v) => set("name", v)} />
        <Field label="Slug" value={f.slug} onChange={(v) => set("slug", v)} mono />
        <Field label="Razão social" value={f.legalName} onChange={(v) => set("legalName", v)} />
        <Field label="Documento" value={f.document} onChange={(v) => set("document", v)} />
        <Select label="Tipo doc" value={f.documentType} onChange={(v) => set("documentType", v)} options={["cnpj", "cpf"]} />
        <Field label="E-mail de contato" value={f.contactEmail} onChange={(v) => set("contactEmail", v)} />
        <Field label="Telefone" value={f.contactPhone} onChange={(v) => set("contactPhone", v)} />
        <Select label="Status" value={f.status} onChange={(v) => set("status", v)} options={STATUS} />
        <Select label="Nicho" value={f.niche} onChange={(v) => set("niche", v)} options={NICHES} />
        <Select label="Produto (skin)" value={f.productSkin} onChange={(v) => set("productSkin", v)} options={PRODUCT_SKINS} />
        <Field label="Plano (código)" value={f.planCode} onChange={(v) => set("planCode", v)} />
        <Field label="Cor principal (#RRGGBB)" value={f.primaryColor} onChange={(v) => set("primaryColor", v)} mono />
        <Field label="Logo (URL)" value={f.logoUrl} onChange={(v) => set("logoUrl", v)} />
        <Field label="Nºs WhatsApp extras (call center)" value={f.maxExtraWhatsapp} onChange={(v) => set("maxExtraWhatsapp", v.replace(/\D/g, ""))} />
      </div>
      <p className="mt-2 text-xs text-muted">Quantas instâncias extras de WhatsApp esta empresa pode criar (além da principal). 0 = só a principal.</p>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-semibold">Portal do cliente</p>
        <p className="mt-1 text-xs text-muted">Recursos que aparecem no portal do cliente desta empresa.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {PORTAL_FEATURES.map((ft) => (
            <label key={ft.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!portal[ft.key]} onChange={(e) => setPortal((m) => ({ ...m, [ft.key]: e.target.checked }))} />
              {ft.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm font-semibold">Botões do Atendimento (call center)</p>
        <p className="mt-1 text-xs text-muted">Quais ações aparecem no atendimento desta empresa.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {CALLCENTER_BUTTONS.map((b) => (
            <label key={b.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!callcenter[b.key]} onChange={(e) => setCallcenter((m) => ({ ...m, [b.key]: e.target.checked }))} />
              {b.label}
            </label>
          ))}
        </div>
      </div>

      {err && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{err}</p>}
      {msg && <p className="mt-3 text-sm text-green-600 dark:text-green-300">{msg}</p>}
      <div className="mt-4">
        <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm outline-none focus:border-brand ${mono ? "font-mono text-xs" : ""}`}
      />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm outline-none focus:border-brand">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
