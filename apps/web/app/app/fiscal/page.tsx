"use client";

import { useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

export default function FiscalPage() {
  const dialog = useDialog();
  const [c, setC] = useState<any>(null);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/fiscal/config", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setC).catch(() => {});
  useEffect(() => { load(); }, []);
  const set = (k: string, v: any) => setC((s: any) => ({ ...s, [k]: v }));
  async function save() {
    const res = await fetch("/api/fiscal/config", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(c) });
    if (!res.ok) { dialog.toast("Falha ao salvar", "error"); return; }
    dialog.toast("Config fiscal salva ✅", "success"); load();
  }
  async function onCert(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!pwd.trim()) { dialog.toast("Digite a senha do certificado antes de subir", "error"); e.currentTarget.value = ""; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      const res = await fetch("/api/fiscal/cert", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ pfx: reader.result, password: pwd }) });
      const d = await res.json().catch(() => null); setBusy(false); setPwd("");
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao validar o certificado", "error"); return; }
      dialog.toast("Certificado A1 carregado ✅", "success"); load();
    };
    reader.readAsDataURL(file);
  }
  if (!c) return <main className="max-w-4xl"><p className="text-sm text-muted">Carregando…</p></main>;
  return (
    <main className="max-w-4xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Financeiro · Fiscal</p>
        <h1 className="mt-1 text-2xl font-semibold">Nota fiscal (NFC-e)</h1>
        <p className="mt-1 text-muted">Configuração do emitente + certificado A1. Ambiente atual: <b>{c.ambiente === 1 ? "Produção" : "Homologação (teste)"}</b>.</p>
      </header>

      <section className="card mb-5">
        <p className="mb-3 text-sm font-semibold">Dados do emitente</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="CNPJ" v={c.cnpj} on={(v) => set("cnpj", v)} />
          <Inp label="Inscrição Estadual" v={c.ie} on={(v) => set("ie", v)} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Regime (CRT)</span>
            <select value={c.crt} onChange={(e) => set("crt", Number(e.target.value))} className="input-base"><option value={1}>Simples Nacional</option><option value={2}>Simples (excesso)</option><option value={3}>Regime Normal</option></select></label>
          <Inp label="Razão social" v={c.razaoSocial} on={(v) => set("razaoSocial", v)} />
          <Inp label="Nome fantasia" v={c.nomeFantasia} on={(v) => set("nomeFantasia", v)} />
          <Inp label="Fone" v={c.fone} on={(v) => set("fone", v)} />
        </div>
      </section>

      <section className="card mb-5">
        <p className="mb-3 text-sm font-semibold">Endereço (vai no XML)</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="Logradouro" v={c.logradouro} on={(v) => set("logradouro", v)} />
          <Inp label="Número" v={c.numero} on={(v) => set("numero", v)} />
          <Inp label="Complemento" v={c.complemento} on={(v) => set("complemento", v)} />
          <Inp label="Bairro" v={c.bairro} on={(v) => set("bairro", v)} />
          <Inp label="Município" v={c.municipio} on={(v) => set("municipio", v)} />
          <Inp label="Cód. IBGE do município" v={c.cmun} on={(v) => set("cmun", v)} />
          <Inp label="UF" v={c.uf} on={(v) => set("uf", v)} />
          <Inp label="CEP" v={c.cep} on={(v) => set("cep", v)} />
        </div>
      </section>

      <section className="card mb-5">
        <p className="mb-3 text-sm font-semibold">NFC-e</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Ambiente</span>
            <select value={c.ambiente} onChange={(e) => set("ambiente", Number(e.target.value))} className="input-base"><option value={2}>Homologação (teste)</option><option value={1}>Produção</option></select></label>
          <Inp label="Série" v={String(c.nfceSerie)} on={(v) => set("nfceSerie", Number(v) || 1)} />
          <Inp label="Próximo número" v={String(c.nfceNext)} on={(v) => set("nfceNext", Number(v) || 1)} />
          <Inp label="ID do CSC (idCSC)" v={c.cscId} on={(v) => set("cscId", v)} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Token CSC {c.cscSet ? "(definido — vazio mantém)" : ""}</span><input type="password" value={c.cscToken ?? ""} onChange={(e) => set("cscToken", e.target.value)} className="input-base" /></label>
        </div>
        <p className="mt-2 text-[11px] text-muted">O <b>CSC</b> (Código de Segurança do Contribuinte) é gerado no portal da SEFAZ do seu estado e é obrigatório pro QR Code da NFC-e. Sem ele, dá pra testar só em homologação parcial.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Inp label="URL autorizador — homologação (opcional)" v={c.nfceUrlHom} on={(v) => set("nfceUrlHom", v)} />
          <Inp label="URL autorizador — produção (opcional)" v={c.nfceUrlProd} on={(v) => set("nfceUrlProd", v)} />
        </div>
        <p className="mt-1 text-[11px] text-muted">Deixe vazio pra usar o autorizador padrão da sua UF. Preencha só se a SEFAZ do seu estado usar um endpoint diferente (ex.: estado novo ainda não mapeado).</p>
      </section>

      <section className="card mb-5">
        <p className="mb-3 text-sm font-semibold">NF-e (modelo 55)</p>
        <p className="mb-3 text-[11px] text-muted">Para vendas com destinatário (CNPJ/CPF + endereço), ex.: operações entre empresas. Numeração e série são <b>separadas</b> da NFC-e.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Inp label="Série NF-e" v={String(c.nfeSerie)} on={(v) => set("nfeSerie", Number(v) || 1)} />
          <Inp label="Próximo número NF-e" v={String(c.nfeNext)} on={(v) => set("nfeNext", Number(v) || 1)} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Inp label="URL autorizador NF-e — homologação (opcional)" v={c.nfeUrlHom} on={(v) => set("nfeUrlHom", v)} />
          <Inp label="URL autorizador NF-e — produção (opcional)" v={c.nfeUrlProd} on={(v) => set("nfeUrlProd", v)} />
        </div>
        <p className="mt-1 text-[11px] text-muted">A NF-e usa webservices diferentes da NFC-e. Vazio = autorizador padrão da sua UF (BA própria; demais via SVRS). Preencha só se a SEFAZ usar outro endpoint.</p>
      </section>

      <section className="card mb-5">
        <p className="mb-1 text-sm font-semibold">Certificado A1 (e-CNPJ) — assina o XML</p>
        <p className="mb-3 text-[11px] text-muted">Mesmo .pfx/.p12 do e-CNPJ. Fica cifrado no servidor; a senha nunca é exibida de volta.</p>
        {c.a1?.configured ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
            <span className={c.a1.expired ? "text-red-300" : "text-green-300"}>{c.a1.expired ? "⚠ vencido" : "✓ ativo"}</span>
            <span><b>{c.a1.subject}</b></span>
            {c.a1.notAfter && <span className="text-muted">válido até {new Date(c.a1.notAfter).toLocaleDateString("pt-BR")}</span>}
          </div>
        ) : <p className="text-[11px] text-muted">Nenhum certificado configurado.</p>}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Senha do certificado</span><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="input-base" /></label>
          <label className="cursor-pointer rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">{busy ? "Validando…" : c.a1?.configured ? "Trocar .pfx" : "Subir .pfx"}<input type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={onCert} /></label>
        </div>
      </section>

      <button onClick={save} className="btn-grad">Salvar configuração</button>
      <p className="mt-4 text-[11px] text-muted">⚠ Emissão da NFC-e (assinatura + envio à SEFAZ + DANFCe) é a próxima fase. Esta tela é a fundação (emitente, A1, CSC, ambiente). Comece sempre em <b>homologação</b>.</p>

      <NfseSection ambiente={c.ambiente} />
    </main>
  );
}

/** NFS-e (Sistema Nacional): configuração + emissão de teste (produção restrita). */
function NfseSection({ ambiente }: { ambiente: number }) {
  const dialog = useDialog();
  const [cfg, setCfg] = useState<any>(null);
  const [list, setList] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState(""); const [valor, setValor] = useState("");
  const [tomNome, setTomNome] = useState(""); const [tomDoc, setTomDoc] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [servSug, setServSug] = useState<any[]>([]);
  const loadCfg = () => fetch("/api/fiscal/nfse/config", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setCfg(d ?? {})).catch(() => setCfg({}));
  const loadList = () => fetch("/api/fiscal/nfse", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setList(d?.items ?? [])).catch(() => {});
  useEffect(() => { loadCfg(); loadList(); }, []);
  const setC = (k: string, v: any) => setCfg((s: any) => ({ ...s, [k]: v }));

  async function saveCfg() {
    setBusy(true);
    try {
      const res = await fetch("/api/fiscal/nfse/config", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ nfseEnabled: !!cfg.nfseEnabled, nfseAmbiente: cfg.nfseAmbiente === "" || cfg.nfseAmbiente == null ? null : Number(cfg.nfseAmbiente), nfseMunicipio: cfg.nfseMunicipio || null, nfseOpSimpNac: Number(cfg.nfseOpSimpNac ?? 1), nfseRegEspTrib: Number(cfg.nfseRegEspTrib ?? 0), nfseCodServico: cfg.nfseCodServico || null, nfseAliqIss: cfg.nfseAliqIss != null && cfg.nfseAliqIss !== "" ? Number(cfg.nfseAliqIss) : null, nfseUrlHom: cfg.nfseUrlHom || null, nfseUrlProd: cfg.nfseUrlProd || null }) });
      if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
      dialog.toast("Config NFS-e salva ✅", "success"); loadCfg();
    } finally { setBusy(false); }
  }
  async function searchServ(t: string) {
    setC("nfseCodServico", t);
    if (t.trim().length < 2) { setServSug([]); return; }
    try { const r = await fetch(`/api/fiscal/ref/servicos?q=${encodeURIComponent(t.trim())}`, { credentials: "include", headers: { "x-no-loading": "1" } }); const d = await r.json().catch(() => null); setServSug(r.ok ? (d?.items ?? []) : []); } catch { setServSug([]); }
  }
  async function emitirTeste() {
    if (!desc.trim() || !valor.trim()) { dialog.toast("Informe descrição e valor", "error"); return; }
    setBusy(true); setResult(null);
    try {
      const cents = Math.round((Number(String(valor).replace(/\./g, "").replace(",", ".")) || 0) * 100);
      const res = await fetch("/api/fiscal/nfse/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ descricaoServico: desc.trim(), valorCents: cents, tomador: (tomNome || tomDoc) ? { nome: tomNome || null, doc: tomDoc || null } : null }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setResult(`✗ ${d?.error?.message ?? "falha"}`); return; }
      setResult(d?.status === "autorizada" ? `✓ Autorizada — chave ${d?.chave ?? "?"} (DPS ${d?.nDPS})` : `✗ Rejeitada (DPS ${d?.nDPS}): ${d?.motivo ?? "?"}`);
      loadList();
    } finally { setBusy(false); }
  }

  if (!cfg) return null;
  const codNum = String(cfg.nfseCodServico ?? "").replace(/\D/g, "");
  const ambEff = cfg.nfseAmbiente ?? ambiente; // ambiente efetivo da NFS-e

  return (
    <section className="mt-8 rounded-xl border border-brand/30 bg-brand/5 p-5">
      <h2 className="text-lg font-semibold">NFS-e (Sistema Nacional)</h2>
      <p className="mt-1 text-xs text-muted">Para serviços (gráfica/confecção). Usa o mesmo A1 da NFC-e, por API + mTLS. Ambiente: <b>{ambEff === 1 ? "Produção (nota real)" : "Produção restrita (teste)"}</b>.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!cfg.nfseEnabled} onChange={(e) => setC("nfseEnabled", e.target.checked)} className="h-4 w-4" /> NFS-e habilitada</label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Ambiente da NFS-e (independe da NFC-e)</span>
          <select value={cfg.nfseAmbiente == null ? "" : String(cfg.nfseAmbiente)} onChange={(e) => setC("nfseAmbiente", e.target.value === "" ? null : Number(e.target.value))} className="input-base">
            <option value="">Usar ambiente global ({ambiente === 1 ? "Produção" : "Homologação"})</option>
            <option value="2">Homologação (produção restrita)</option>
            <option value="1">Produção (emite nota REAL)</option>
          </select>
          {Number(cfg.nfseAmbiente) === 1 && <span className="mt-1 block text-[10px] text-red-300">⚠ Produção: cada emissão gera uma NFS-e fiscal válida. Para testar, emita valor baixo e cancele depois.</span>}
        </label>
        <Inp label="Código IBGE do município (7)" v={cfg.nfseMunicipio ?? ""} on={(v) => setC("nfseMunicipio", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Optante Simples Nacional</span>
          <select value={String(cfg.nfseOpSimpNac ?? 1)} onChange={(e) => setC("nfseOpSimpNac", e.target.value)} className="input-base">
            <option value="1">1 — Não optante</option><option value="2">2 — Optante MEI</option><option value="3">3 — Optante (ME/EPP)</option>
          </select>
        </label>
        <div className="relative block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Código de tributação nacional (6 díg)</span>
          <input value={cfg.nfseCodServico ?? ""} onChange={(e) => searchServ(e.target.value)} onBlur={() => setTimeout(() => setServSug([]), 150)} placeholder="ex.: 130501 (6 díg) ou busque por 'confecção'" className="input-base" />
          {servSug.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
              {servSug.map((s) => (
                <button type="button" key={s.codigo} onMouseDown={(e) => { e.preventDefault(); setC("nfseCodServico", s.codigo); setServSug([]); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-2"><span className="font-mono text-brand">{s.codigo}</span> — {s.descricao}</button>
              ))}
            </div>
          )}
          {codNum.length >= 1 && <p className="mt-1 text-[10px] text-muted">cTribNac enviado: <b>{codNum.length < 6 ? codNum.padEnd(6, "0") : codNum.slice(0, 6)}</b></p>}
          <span className="mt-1 block text-[10px] text-amber-300/80">É o código de 6 dígitos da <b>lista nacional</b> (não o subitem da LC116). Se faltar o desdobro, complete os 6 dígitos.</span>
        </div>
        <Inp label="Alíquota ISS (%)" v={cfg.nfseAliqIss != null ? String(cfg.nfseAliqIss) : ""} on={(v) => setC("nfseAliqIss", v)} />
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">URL base da API (produção restrita) — opcional</span>
          <input value={cfg.nfseUrlHom ?? ""} onChange={(e) => setC("nfseUrlHom", e.target.value)} placeholder={cfg.defaultHom ?? "https://adn.producaorestrita.nfse.gov.br/contribuintes"} className="input-base" />
          <span className="mt-1 block text-[10px] text-muted">Vazio = usa o padrão. Confira a base exata no Swagger: <code>adn.producaorestrita.nfse.gov.br/contribuintes/docs</code>. As rotas são <code>/nfse</code>, <code>/dps</code>, <code>/parametros_municipais</code>.</span>
        </label>
      </div>
      <button onClick={saveCfg} disabled={busy} className="btn-grad mt-3">Salvar NFS-e</button>

      <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
        <p className="text-sm font-semibold">Emitir DPS {ambEff === 1 ? "(PRODUÇÃO — nota real)" : "de teste (produção restrita)"}</p>
        <p className="mt-1 text-[11px] text-muted">{ambEff === 1 ? "⚠ Em produção cada emissão é uma NFS-e fiscal válida. Use valor baixo e cancele depois." : "Gera uma DPS de teste. Vamos iterar nas rejeições da SEFAZ Nacional até validar."}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Inp label="Descrição do serviço" v={desc} on={setDesc} />
          <Inp label="Valor (R$)" v={valor} on={setValor} />
          <Inp label="Tomador — nome (opcional)" v={tomNome} on={setTomNome} />
          <Inp label="Tomador — CPF/CNPJ (opcional)" v={tomDoc} on={setTomDoc} />
        </div>
        <button onClick={emitirTeste} disabled={busy} className="mt-3 rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand/10 disabled:opacity-50">{busy ? "Emitindo…" : "Emitir DPS de teste"}</button>
        {result && <p className={`mt-3 rounded-lg border px-3 py-2 text-sm ${result.startsWith("✓") ? "border-green-500/40 bg-green-500/10 text-green-200" : "border-red-500/40 bg-red-500/10 text-red-200"}`}>{result}</p>}
      </div>

      {list.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Últimas NFS-e</p>
          <div className="space-y-1">
            {list.slice(0, 10).map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs">
                <span>DPS {o.nDps} · {o.totalCents != null ? `R$ ${(Number(o.totalCents) / 100).toFixed(2)}` : ""}{o.chave ? ` · ${String(o.chave).slice(0, 12)}…` : ""}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${o.status === "autorizada" ? "bg-green-500/20 text-green-300" : o.status === "rejeitada" ? "bg-red-500/20 text-red-300" : "bg-line text-muted"}`}>{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Inp({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">{label}</span><input value={v ?? ""} onChange={(e) => on(e.target.value)} className="input-base" /></label>;
}
