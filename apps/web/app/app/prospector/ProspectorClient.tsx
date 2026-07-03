"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

const PRESETS: Array<{ label: string; k: string; v: string }> = [
  { label: "Óticas", k: "shop", v: "optician" },
  { label: "Gráficas / cópias", k: "shop", v: "copyshop" },
  { label: "Roupas", k: "shop", v: "clothes" },
  { label: "Calçados", k: "shop", v: "shoes" },
  { label: "Farmácias", k: "amenity", v: "pharmacy" },
  { label: "Restaurantes", k: "amenity", v: "restaurant" },
  { label: "Padarias", k: "shop", v: "bakery" },
  { label: "Salões de beleza", k: "shop", v: "hairdresser" },
  { label: "Academias", k: "leisure", v: "fitness_centre" },
  { label: "Pet shops", k: "shop", v: "pet" },
];
const FREQ: Record<string, string> = { manual: "Manual", daily: "Diária", weekly: "Semanal" };

async function jget(url: string) { const r = await fetch(url, { credentials: "include", headers: { "x-no-loading": "1" } }); return r.ok ? r.json() : null; }

export function ProspectorClient({ isMaster = false }: { isMaster?: boolean }) {
  const dialog = useDialog();
  const [tab, setTab] = useState<"camp" | "optout" | "cnpj">("camp");
  const [items, setItems] = useState<any[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [resultsOf, setResultsOf] = useState<any | null>(null);
  const load = () => jget("/api/prospector/campaigns").then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  async function run(c: any) {
    dialog.toast("Buscando no OpenStreetMap…", "info");
    const r = await fetch(`/api/prospector/campaigns/${c.id}/run`, { method: "POST", credentials: "include" });
    const d = await r.json().catch(() => null);
    if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    dialog.toast(`${d?.found ?? 0} novos encontrados (na fila de Leads novos)`, "success"); load();
  }
  async function del(c: any) {
    if (!(await dialog.confirm(`Excluir a campanha "${c.name}"?`))) return;
    await fetch(`/api/prospector/campaigns/${c.id}`, { method: "DELETE", credentials: "include" }); load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <nav className="flex flex-wrap gap-1 border-b border-line">
          <button onClick={() => setTab("camp")} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === "camp" ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>Campanhas</button>
          <button onClick={() => setTab("optout")} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === "optout" ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>Não perturbe (opt-out)</button>
          <button onClick={() => setTab("cnpj")} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === "cnpj" ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>Base CNPJ</button>
        </nav>
        {tab === "camp" && <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Campanha</button>}
      </div>

      {tab === "cnpj" ? <CnpjBase isMaster={isMaster} /> : tab === "optout" ? <Optout /> : items === null ? <p className="text-sm text-muted">Carregando…</p> : items.length === 0 ? (
        <p className="rounded-xl border border-line bg-bg/60 p-8 text-center text-muted">Nenhuma campanha. Crie uma com nicho + cidade.</p>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-bg/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{c.name} <span className="ml-1 text-xs text-muted">{c.city}{c.state ? `/${c.state}` : ""}</span></p>
                  <p className="text-xs text-muted">{(c.osmFilters ?? []).map((f: any) => `${f.k}=${f.v}`).join(", ")} · {FREQ[c.frequency] ?? c.frequency} · limite {c.limitPerRun}{c.autoCreateLead ? " · cria lead automático" : ""}{c.enrichCnpjAuto ? " · enriquece CNPJ" : ""}</p>
                  <p className="text-[11px] text-muted">{c.lastRunAt ? `Última busca: ${new Date(c.lastRunAt).toLocaleString("pt-BR")} · ${c.lastCount === -1 ? "falhou" : `${c.lastCount ?? 0} novos`}` : "Nunca rodou"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => run(c)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Rodar agora</button>
                  <button onClick={() => setResultsOf(c)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Resultados</button>
                  <button onClick={() => del(c)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-red-300 hover:border-red-400">Excluir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <NewCampaign onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {resultsOf && <Results campaign={resultsOf} onClose={() => setResultsOf(null)} />}
    </div>
  );
}

function NewCampaign({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const [src, setSrc] = useState<"osm" | "cnpj">("osm");
  const [name, setName] = useState(""); const [city, setCity] = useState(""); const [preset, setPreset] = useState(0);
  const [customK, setCustomK] = useState(""); const [customV, setCustomV] = useState("");
  const [cnae, setCnae] = useState(""); const [uf, setUf] = useState("");
  const [freq, setFreq] = useState("manual"); const [limit, setLimit] = useState("50"); const [auto, setAuto] = useState(true);
  const [enrich, setEnrich] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save() {
    const filter = src === "cnpj" ? { k: "cnae", v: cnae.replace(/\D/g, "") } : (preset === -1 ? { k: customK.trim(), v: customV.trim() } : PRESETS[preset]);
    if (!name.trim() || !city.trim() || !filter?.k || !filter?.v) { dialog.toast(src === "cnpj" ? "Preencha nome, município e CNAE" : "Preencha nome, cidade e nicho", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/prospector/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim(), source: src, city: city.trim(), state: src === "cnpj" ? (uf.trim().toUpperCase() || null) : null, osmFilters: [filter], frequency: freq, limitPerRun: Number(limit) || 50, autoCreateLead: auto, enrichCnpjAuto: enrich }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      onSaved();
    } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Nova campanha de prospecção</h3>
        <div className="mt-3 space-y-3">
          <div className="flex gap-1 rounded-lg border border-line bg-bg/40 p-1 text-sm">
            <button onClick={() => setSrc("osm")} className={`flex-1 rounded-md px-3 py-1 ${src === "osm" ? "bg-brand text-white" : "text-muted"}`}>OpenStreetMap</button>
            <button onClick={() => setSrc("cnpj")} className={`flex-1 rounded-md px-3 py-1 ${src === "cnpj" ? "bg-brand text-white" : "text-muted"}`}>Base CNPJ (Receita)</button>
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={src === "cnpj" ? "Nome (ex.: Óticas Feira CNAE 4774-1)" : "Nome (ex.: Óticas Feira de Santana)"} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
          {src === "osm" ? (
            <>
              <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Nicho</span>
                <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
                  {PRESETS.map((p, i) => <option key={i} value={i}>{p.label} ({p.k}={p.v})</option>)}
                  <option value={-1}>Outro (personalizado)…</option>
                </select>
              </label>
              {preset === -1 && (
                <div className="grid grid-cols-2 gap-2">
                  <input value={customK} onChange={(e) => setCustomK(e.target.value)} placeholder="tag OSM (ex.: shop)" className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
                  <input value={customV} onChange={(e) => setCustomV(e.target.value)} placeholder="valor (ex.: jewelry)" className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input value={cnae} onChange={(e) => setCnae(e.target.value)} placeholder="CNAE (ex.: 4774100 ou 4774)" className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
              <input value={uf} onChange={(e) => setUf(e.target.value)} placeholder="UF (ex.: BA)" maxLength={2} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            </div>
          )}
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder={src === "cnpj" ? "Município (ex.: Feira de Santana)" : "Cidade (ex.: Feira de Santana)"} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Frequência</span>
              <select value={freq} onChange={(e) => setFreq(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Limite/rodada</span><input value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="h-4 w-4" /> Criar lead automaticamente (vai pra fila de Leads novos)</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} className="mt-0.5 h-4 w-4" /> <span>Enriquecer por CNPJ (BrasilAPI) <span className="block text-[11px] text-muted">Quando o registro tiver CNPJ, busca razão social, CNAE e situação; descarta empresas baixadas. {src === "osm" ? "Poucos registros do OSM têm CNPJ." : "Recomendado pra base CNPJ."}</span></span></label>
        </div>
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Criar campanha"}</button>
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-fg">cancelar</button>
        </div>
      </div>
    </div>
  );
}

function Results({ campaign, onClose }: { campaign: any; onClose: () => void }) {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const load = () => jget(`/api/prospector/campaigns/${campaign.id}/results`).then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [campaign.id]);
  function hasCnpj(r: any): boolean {
    if (r.cnpj) return true;
    const cands = [r.externalRef, r.raw?.cnpj, r.raw?.["ref:vatin"], r.raw?.["operator:cnpj"]];
    return cands.some((c: any) => String(c ?? "").replace(/\D/g, "").length === 14);
  }
  async function enrich(r: any) {
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/prospector/results/${r.id}/enrich`, { method: "POST", credentials: "include" });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao enriquecer", "error"); return; }
      dialog.toast(`Enriquecido${d?.result?.situacao ? ` · ${d.result.situacao}` : ""} ✅`, "success"); load();
    } finally { setBusyId(null); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-bg p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold">Resultados — {campaign.name}</h3><button onClick={onClose} className="text-muted hover:text-fg">✕</button></div>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {items === null ? <p className="text-sm text-muted">Carregando…</p> : items.length === 0 ? <p className="text-sm text-muted">Sem resultados ainda. Clique em "Rodar agora".</p> : items.map((r) => {
            const statusCls = r.status === "virou_lead" ? "bg-green-500/15 text-green-300" : r.status === "descartado" ? "bg-red-500/15 text-red-300" : "bg-line text-muted";
            const ativa = !r.situacao || r.situacao.toUpperCase() === "ATIVA";
            return (
              <div key={r.id} className="rounded-lg border border-line bg-bg/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{r.name}</p>
                  <div className="flex items-center gap-1.5">
                    {r.situacao && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ativa ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>{r.situacao}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusCls}`}>{r.status === "virou_lead" ? "virou lead" : r.status}</span>
                  </div>
                </div>
                <p className="text-xs text-muted">{[r.cnpj ? `CNPJ ${r.cnpj}` : null, r.phone, r.address, r.website].filter(Boolean).join(" · ") || "sem telefone/endereço"}</p>
                {hasCnpj(r) && (
                  <div className="mt-1.5">
                    <button disabled={busyId === r.id} onClick={() => enrich(r)} className="rounded-md border border-line px-2.5 py-1 text-[11px] hover:border-brand disabled:opacity-50">{busyId === r.id ? "consultando…" : r.enrichedAt ? "🔄 reconsultar CNPJ" : "🔎 enriquecer por CNPJ"}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CnpjBase({ isMaster }: { isMaster: boolean }) {
  const dialog = useDialog();
  const [count, setCount] = useState<number | null>(null);
  const [csv, setCsv] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => jget("/api/prospector/cnpj/count").then((d) => setCount(d?.count ?? 0)).catch(() => setCount(0));
  useEffect(() => { load(); }, []);
  async function importar() {
    if (csv.trim().length < 10) { dialog.toast("Cole as linhas do CSV", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/prospector/cnpj/import", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ csv }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      dialog.toast(`${d?.imported ?? 0} registros importados ✅`, "success"); setCsv(""); load();
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="text-sm">Base CNPJ (Receita) carregada: <b>{count === null ? "…" : count.toLocaleString("pt-BR")}</b> empresas.</p>
        <p className="mt-1 text-xs text-muted">É uma base <b>global</b> da plataforma (compartilhada). As campanhas com fonte "Base CNPJ" buscam por <b>CNAE + município</b> aqui. Dado público da Receita; respeita opt-out.</p>
      </div>

      <CnpjLookup />

      {isMaster ? (
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <p className="text-sm font-medium">Importar base (master)</p>
          <p className="mt-1 text-xs text-muted">CSV por linha: <code>cnpj;razao;fantasia;cnae;uf;municipio;telefone;email;situacao</code>. Carregue um subconjunto filtrado (ex.: por UF) dos Dados Abertos da Receita.</p>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} placeholder="40029474000180;Ótica Exemplo;Ótica X;4774100;BA;Feira de Santana;7530000000;contato@otica.com;ATIVA" className="mt-2 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 font-mono text-xs" />
          <button disabled={busy} onClick={importar} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Importando…" : "Importar"}</button>
        </div>
      ) : (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">A base CNPJ é carregada pelo suporte do sistema (master). Para grandes volumes, a carga é feita por script na VPS a partir dos arquivos públicos da Receita.</p>
      )}
    </div>
  );
}

/** Consulta ad-hoc de um CNPJ na BrasilAPI (operador com o CNPJ em mãos).
 *  Mostra os dados e permite jogar na fila de Leads novos com 1 clique. */
function CnpjLookup() {
  const dialog = useDialog();
  const [cnpj, setCnpj] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any | null>(null);
  async function lookup(createLead: boolean) {
    if (cnpj.replace(/\D/g, "").length !== 14) { dialog.toast("Informe um CNPJ válido (14 dígitos)", "error"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/prospector/cnpj/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ cnpj: cnpj.replace(/\D/g, ""), createLead }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) { dialog.toast(d?.error?.message ?? "CNPJ não encontrado", "error"); setRes(null); return; }
      setRes(d);
      if (createLead && d?.leadId) dialog.toast("Lead criado na fila ✅", "success");
      else if (createLead && !d?.active) dialog.toast("Empresa baixada — lead não criado", "info");
    } finally { setBusy(false); }
  }
  const c = res?.company;
  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-sm font-medium">Consultar um CNPJ (BrasilAPI)</p>
      <p className="mt-1 text-xs text-muted">Tem o CNPJ em mãos? Busque os dados ao vivo (grátis, sem precisar da base importada) e jogue na fila de leads.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="flex-1 min-w-[200px] rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        <button disabled={busy} onClick={() => lookup(false)} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-brand disabled:opacity-50">{busy ? "…" : "Consultar"}</button>
        <button disabled={busy} onClick={() => lookup(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Consultar + criar lead</button>
      </div>
      {c && (
        <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{c.nomeFantasia || c.razaoSocial || "—"}</p>
            {c.situacao && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${res.active ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>{c.situacao}</span>}
          </div>
          {c.razaoSocial && c.nomeFantasia && <p className="text-xs text-muted">{c.razaoSocial}</p>}
          <p className="mt-1 text-xs text-muted">{[c.cnaePrincipal ? `CNAE ${c.cnaePrincipal}` : null, c.telefone, [c.logradouro, c.numero, c.bairro, c.municipio, c.uf].filter(Boolean).join(", ") || null, c.email].filter(Boolean).join(" · ")}</p>
          {res.leadId && <p className="mt-1 text-[11px] text-green-300">✓ Lead na fila de Leads novos</p>}
        </div>
      )}
    </div>
  );
}

function Optout() {
  const dialog = useDialog();
  const [items, setItems] = useState<any[] | null>(null);
  const [val, setVal] = useState("");
  const load = () => jget("/api/prospector/optout").then((d) => setItems(d?.items ?? [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  async function add() {
    if (val.trim().length < 3) return;
    const r = await fetch("/api/prospector/optout", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ value: val.trim(), kind: "phone" }) });
    if (r.ok) { setVal(""); dialog.toast("Adicionado ao não-perturbe", "success"); load(); } else dialog.toast("Falha", "error");
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">Telefones/CNPJs que NÃO devem ser prospectados (respeito à LGPD). São ignorados em toda busca.</p>
      <div className="flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Telefone (ou CNPJ)" className="flex-1 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        <button onClick={add} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Adicionar</button>
      </div>
      {items === null ? <p className="text-sm text-muted">Carregando…</p> : items.length === 0 ? <p className="text-sm text-muted">Lista vazia.</p> : (
        <div className="flex flex-wrap gap-2">{items.map((o) => <span key={o.id} className="rounded-full border border-line px-3 py-1 text-xs">{o.value}</span>)}</div>
      )}
    </div>
  );
}
