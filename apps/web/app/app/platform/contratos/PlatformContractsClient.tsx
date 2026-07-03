"use client";

import { useCallback, useState } from "react";

interface Template { id: string; version: string; title: string; description: string | null; bodyMarkdown: string; kind: string; isActive: boolean }
interface Contract { id: string; organizationId: string; organizationName: string; title: string | null; version: string | null; status: string; acceptedAt: string | null; acceptedByName: string | null; createdAt: string }
interface Org { id: string; name: string }

const KIND_LABEL: Record<string, string> = { onboarding: "Onboarding", aditivo: "Aditivo", servico_extra: "Serviço extra" };

export function PlatformContractsClient({ initialTemplates, initialContracts, orgs }: { initialTemplates: Template[]; initialContracts: Contract[]; orgs: Org[] }) {
  const [tab, setTab] = useState<"contratos" | "modelos">("contratos");
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [contracts, setContracts] = useState<Contract[]>(initialContracts);

  const reloadTemplates = useCallback(async () => {
    const r = await fetch("/api/platform/contract-templates", { credentials: "include", cache: "no-store" }); const d = await r.json(); if (r.ok) setTemplates(d.items ?? []);
  }, []);
  const reloadContracts = useCallback(async () => {
    const r = await fetch("/api/platform/contracts", { credentials: "include", cache: "no-store" }); const d = await r.json(); if (r.ok) setContracts(d.items ?? []);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 border-b border-line">
        <Tab active={tab === "contratos"} onClick={() => setTab("contratos")}>Contratos</Tab>
        <Tab active={tab === "modelos"} onClick={() => setTab("modelos")}>Modelos</Tab>
      </div>
      {tab === "contratos"
        ? <Contratos contracts={contracts} templates={templates} orgs={orgs} onChanged={reloadContracts} />
        : <Modelos templates={templates} onChanged={reloadTemplates} />}
    </div>
  );
}

function Contratos({ contracts, templates, orgs, onChanged }: { contracts: Contract[]; templates: Template[]; orgs: Org[]; onChanged: () => void }) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function assign() {
    if (!orgId || !templateId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/platform/contracts", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ organizationId: orgId, templateId }) });
      const d = await r.json(); if (!r.ok) throw new Error(d?.error?.message ?? "Falha");
      setMsg("Contrato enviado à empresa."); onChanged();
    } catch (e: any) { setMsg(`Erro: ${e.message}`); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    await fetch(`/api/platform/contracts/${id}/cancel`, { method: "PATCH", credentials: "include" }); onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-bg/60 p-4">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Empresa</span>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Modelo</span>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
            {templates.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.title} (v{t.version})</option>)}
          </select>
        </label>
        <button onClick={assign} disabled={busy || !templateId} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Enviar contrato</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>

      {contracts.length === 0 ? <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum contrato enviado.</p> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Contrato</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Aceite</th><th className="px-4 py-3"></th>
            </tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="border-t border-line/50">
                  <td className="px-4 py-3 font-medium">{c.organizationName}</td>
                  <td className="px-4 py-3">{c.title}{c.version ? ` · v${c.version}` : ""}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${c.status === "accepted" ? "bg-green-500/20 text-green-300" : c.status === "canceled" ? "bg-red-500/20 text-red-300" : "bg-orange-500/20 text-orange-300"}`}>
                      {c.status === "accepted" ? "aceito" : c.status === "canceled" ? "cancelado" : "pendente"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{c.acceptedAt ? `${c.acceptedByName ?? ""} · ${new Date(c.acceptedAt).toLocaleString("pt-BR")}` : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <a href={`/api/platform/contracts/${c.id}/html`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">Ver</a>
                      {c.status === "pending" && <button onClick={() => cancel(c.id)} className="text-xs text-muted hover:text-red-300">Cancelar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Modelos({ templates, onChanged }: { templates: Template[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ version: "1.0", title: "", description: "", kind: "onboarding", bodyMarkdown: "", isActive: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openCreate() { setCreating(true); setEditing(null); setF({ version: "1.0", title: "", description: "", kind: "onboarding", bodyMarkdown: TEMPLATE_HINT, isActive: true }); }
  function openEdit(t: Template) { setEditing(t); setCreating(false); setF({ version: t.version, title: t.title, description: t.description ?? "", kind: t.kind, bodyMarkdown: t.bodyMarkdown, isActive: t.isActive }); }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const url = editing ? `/api/platform/contract-templates/${editing.id}` : "/api/platform/contract-templates";
      const r = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(f) });
      const d = await r.json(); if (!r.ok) throw new Error(d?.error?.message ?? "Falha");
      setCreating(false); setEditing(null); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const open = creating || editing;
  return (
    <div className="space-y-4">
      {!open && <button onClick={openCreate} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Novo modelo</button>}

      {open && (
        <div className="space-y-3 rounded-xl border border-line bg-bg/60 p-5">
          <h2 className="text-lg font-semibold">{editing ? "Editar modelo" : "Novo modelo"}</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Inp label="Título" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
            <Inp label="Versão" value={f.version} onChange={(v) => setF({ ...f, version: v })} />
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
                <option value="onboarding">Onboarding</option><option value="aditivo">Aditivo</option><option value="servico_extra">Serviço extra</option>
              </select>
            </label>
          </div>
          <Inp label="Descrição" value={f.description} onChange={(v) => setF({ ...f, description: v })} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Conteúdo (markdown + variáveis)</span>
            <textarea value={f.bodyMarkdown} onChange={(e) => setF({ ...f, bodyMarkdown: e.target.value })} rows={12} className="w-full rounded border border-line bg-bg/60 px-3 py-2 font-mono text-xs" />
          </label>
          <p className="text-[11px] text-muted">Variáveis: {"{{contratante.razao_social}}"}, {"{{contratante.cnpj}}"}, {"{{contratante.email}}"}, {"{{contratante.telefone}}"}, {"{{data.hoje}}"}.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Ativo</label>
          {err && <p className="text-xs text-red-300">{err}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => { setCreating(false); setEditing(null); }} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
            <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar</button>
          </div>
        </div>
      )}

      {templates.length === 0 ? <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum modelo.</p> : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/60 p-4">
              <div>
                <p className="font-medium">{t.title} <span className="ml-1 rounded-full bg-line px-2 py-0.5 text-[10px] uppercase text-muted">{KIND_LABEL[t.kind] ?? t.kind}</span>{!t.isActive && <span className="ml-1 text-[10px] text-muted">(inativo)</span>}</p>
                <p className="text-xs text-muted">v{t.version}{t.description ? ` · ${t.description}` : ""}</p>
              </div>
              <button onClick={() => openEdit(t)} className="text-xs text-brand hover:underline">Editar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TEMPLATE_HINT = `# Contrato de Prestação de Serviços

**CONTRATANTE:** {{contratante.razao_social}}, CNPJ {{contratante.cnpj}}, e-mail {{contratante.email}}.

**CONTRATADA:** [sua empresa aqui], inscrita no CNPJ [...].

## 1. Objeto
Licença de uso da plataforma yugochat conforme o plano contratado.

## 2. Vigência
Este contrato vigora a partir de {{data.hoje}}.

## 3. Foro
Fica eleito o foro da comarca de [cidade].`;

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{children}</button>;
}
function Inp({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
    </label>
  );
}
