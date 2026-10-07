"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";
import { PageHeader } from "../../../components/PageHeader";
import { PUNCH_FIELDS, type PunchForm, emptyPunchForm, punchesToForm, formToTimes } from "../../../lib/punch";
import { Inconsistencias } from "./Inconsistencias";

type Emp = { id: string; name: string; cpf: string | null; pis: string | null; matricula: string | null; matEsocial: string | null; cargo: string | null; scheduleCode: string | null; active: boolean; faceEnrolled?: boolean; barcode?: string | null; hrEmployeeId?: string | null; allowedDeviceIds?: string[] };
type Punch = { id: string; nsr: string; employeeId: string; punchedAt: string; origin: string; source: string; offline: boolean; hash: string; photoUrl?: string | null; faceScore?: number | null; faceMatch?: boolean | null; livenessOk?: boolean | null; fraudFlags?: string[] | null };

// ---- EAN-13: codifica em módulos e renderiza SVG (sem dependência) ----
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function ean13Svg(code: string): string {
  const d = (code || "").replace(/\D/g, "").padStart(13, "0").slice(0, 13);
  const parity = EAN_PARITY[Number(d[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(d[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(d[i])];
  bits += "101";
  const mw = 2, H = 70, quiet = 10;
  const w = bits.length * mw + quiet * 2;
  let rects = "";
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") rects += `<rect x="${quiet + i * mw}" y="0" width="${mw}" height="${H}" fill="#000"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H + 18}" viewBox="0 0 ${w} ${H + 18}"><rect width="${w}" height="${H + 18}" fill="#fff"/>${rects}<text x="${w / 2}" y="${H + 14}" font-family="monospace" font-size="13" text-anchor="middle">${d}</text></svg>`;
}
function printCracha(e: Emp, employer: string) {
  if (!e.barcode) return;
  const svg = ean13Svg(e.barcode);
  const w = window.open("", "_blank", "width=400,height=560");
  if (!w) return;
  w.document.write(`<html><head><title>Cracha ${e.name}</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;text-align:center}.card{border:1px solid #ccc;border-radius:16px;padding:24px;max-width:320px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}p{margin:2px 0;color:#444;font-size:13px}.bc{margin-top:16px}</style></head><body><div class="card"><div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888">${employer || ""}</div><h1>${e.name}</h1>${e.cargo ? `<p>${e.cargo}</p>` : ""}${e.cpf ? `<p>CPF ${e.cpf}</p>` : ""}${e.matricula ? `<p>Matricula ${e.matricula}</p>` : ""}<div class="bc">${svg}</div><p style="margin-top:8px;color:#888">Aproxime do leitor para bater o ponto</p></div><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export default function PontoPage() {
  const dialog = useDialog();
  const [tab, setTab] = useState<"bater" | "marcacoes" | "tempo" | "espelho" | "inconsistencias" | "solicitacoes" | "trocas" | "escalas" | "banco" | "ferias" | "fechamento" | "eventos" | "funcionarios" | "empregadores" | "dispositivos" | "avisos" | "config">("bater");
  const [emps, setEmps] = useState<Emp[]>([]);
  const load = () => fetch("/api/ponto/employees", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setEmps(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <main className="max-w-5xl">
      {/* O RH montava este topo à mão. No Vision o cabeçalho é um
          componente só — a conferência `pageHeader` cobra isso de todas as
          101 telas, e foi ela que pegou a diferença no porte. */}
      <PageHeader
        className="print:hidden"
        eyebrow="Pessoas · Ponto"
        title="Ponto eletrônico"
        description="Marcação imutável (horário do servidor + NSR + hash) e jornada derivada — Portaria 671 (Fases 0–1)."
      />
      <nav className="mb-6 flex flex-wrap gap-1 rounded-lg border border-line bg-bg/60 p-1 text-sm print:hidden">
        {([["bater", "Bater ponto"], ["marcacoes", "Marcações"], ["tempo", "Tempo real"], ["espelho", "Espelho"], ["inconsistencias", "Inconsistências"], ["solicitacoes", "Solicitações"], ["trocas", "Trocas"], ["escalas", "Escalas"], ["banco", "Banco de horas"], ["ferias", "Férias"], ["fechamento", "Fechamento"], ["eventos", "Eventos / Webhook"], ["funcionarios", "Funcionários (marcação)"], ["empregadores", "Empregadores"], ["dispositivos", "Dispositivos"], ["avisos", "Avisos"], ["config", "Empregador"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1 ${tab === k ? "bg-brand text-white" : "text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </nav>

      {tab === "bater" && <Bater emps={emps} dialog={dialog} />}
      {tab === "marcacoes" && <Marcacoes emps={emps} dialog={dialog} />}
      {tab === "tempo" && <TempoReal dialog={dialog} />}
      {tab === "espelho" && <><EspelhosContabil dialog={dialog} /><Espelho emps={emps} dialog={dialog} /></>}
      {tab === "inconsistencias" && <Inconsistencias dialog={dialog} Ajuste={EspelhoAjusteModal} />}
      {tab === "solicitacoes" && <SolicitacoesPonto dialog={dialog} />}
      {tab === "trocas" && <TrocasRh dialog={dialog} />}
      {tab === "escalas" && <Escalas dialog={dialog} />}
      {tab === "banco" && <Banco emps={emps} dialog={dialog} />}
      {tab === "ferias" && <Ferias emps={emps} dialog={dialog} />}
      {tab === "fechamento" && <Fechamento dialog={dialog} />}
      {tab === "eventos" && <Eventos dialog={dialog} />}
      {tab === "funcionarios" && <Funcionarios emps={emps} onChanged={load} dialog={dialog} />}
      {tab === "empregadores" && <Empregadores dialog={dialog} />}
      {tab === "dispositivos" && <Dispositivos dialog={dialog} />}
      {tab === "avisos" && <Avisos emps={emps} dialog={dialog} />}
      {tab === "config" && <Config dialog={dialog} />}
    </main>
  );
}

const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FRAUD_LABEL: Record<string, string> = {
  gps_impreciso: "GPS impreciso ou ausente",
  rosto_divergente: "Rosto não conferiu com o cadastro",
  rosto_baixa_confianca: "Rosto bateu por pouco (baixa confiança) — revisar",
};

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
}
/** Carrega a imagem, reduz pra largura máx e exporta JPEG (reduz o tamanho do upload). */
function downscaleImage(file: File, maxW: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
function monthRange() {
  const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), 1); const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

// ----- parsers do lançamento manual de batidas (ajuste/migração) -----
function normDay(s: string): string | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function normTime(s: string): string | null {
  const m = /^(\d{1,2})[:hH](\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
/** "08:00 12:00 13:00 18:00" / "08:00,12:00" → ["08:00","12:00",...] */
function parseTimes(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((t) => normTime(t)).filter((t): t is string => !!t);
}
/** Cada linha: "DATA hora hora ..." (DATA = AAAA-MM-DD ou DD/MM/AAAA). */
function parseLancamentoMassa(raw: string): { day: string; times: string[] }[] {
  const out: { day: string; times: string[] }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) continue;
    const day = normDay(parts[0]!);
    if (!day) continue;
    const times = parts.slice(1).map((t) => normTime(t)).filter((t): t is string => !!t);
    if (times.length) out.push({ day, times });
  }
  return out;
}

function Bater({ emps, dialog }: { emps: Emp[]; dialog: any }) {
  const [empId, setEmpId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);
  async function punch() {
    if (!empId) { dialog.toast("Escolha o funcionário", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/punch", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, pin: pin || undefined, origin: "web" }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao registrar", "error"); return; }
      setLast(d); setPin("");
      dialog.toast("Ponto registrado ✅", "success");
    } finally { setBusy(false); }
  }
  return (
    <section className="rounded-xl border border-line bg-bg/60 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] uppercase text-muted">Funcionário</span>
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
            <option value="">— selecione —</option>
            {emps.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}{e.matricula ? ` (${e.matricula})` : ""}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">PIN (se exigido)</span>
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
      </div>
      <button disabled={busy} onClick={punch} className="mt-4 w-full rounded-lg bg-brand py-3 text-base font-semibold text-white disabled:opacity-50">{busy ? "Registrando…" : "Registrar ponto"}</button>
      {last && (
        <div className="mt-4 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm">
          <p className="font-semibold text-green-200">Comprovante de marcação</p>
          <p className="mt-1">{last.employeeName} · NSR <b>{last.nsr}</b></p>
          <p>{new Date(last.punchedAt).toLocaleString("pt-BR")}</p>
          <p className="mt-1 break-all text-[10px] text-muted">hash: {last.hash}</p>
        </div>
      )}
    </section>
  );
}

function Marcacoes({ emps, dialog }: { emps: Emp[]; dialog: any }) {
  const [items, setItems] = useState<Punch[]>([]);
  const [empId, setEmpId] = useState("");
  const [employers, setEmployers] = useState<any[]>([]);
  const [afdEmployer, setAfdEmployer] = useState("");
  const nameOf = (id: string) => emps.find((e) => e.id === id)?.name ?? "—";
  useEffect(() => {
    const q = empId ? `?employeeId=${empId}` : "";
    fetch(`/api/ponto/punches${q}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  }, [empId]);
  useEffect(() => { fetch("/api/ponto/employers", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => { const its = d?.items ?? []; setEmployers(its); const def = its.find((e: any) => e.isDefault) ?? its[0]; if (def) setAfdEmployer(def.id); }).catch(() => {}); }, []);
  async function baixarAfd() {
    // AFD é por empregador (CNPJ). Sem seleção, usa o padrão.
    const q = afdEmployer ? `?employerId=${afdEmployer}` : "";
    const res = await fetch(`/api/ponto/afd${q}`, { credentials: "include" });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) { dialog.toast(d?.error?.message ?? "Falha ao gerar AFD", "error"); return; }
    const slug = (d.employer?.name ?? "AFD").replace(/[^\w]+/g, "_").slice(0, 30);
    const blob = new Blob([d.content ?? ""], { type: "text/plain;charset=iso-8859-1" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `AFD_${slug}.txt`; a.click(); URL.revokeObjectURL(a.href);
    if (d.signed && d.p7s) {
      const bin = atob(d.p7s); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const sigBlob = new Blob([bytes], { type: "application/pkcs7-signature" });
      const sa = document.createElement("a"); sa.href = URL.createObjectURL(sigBlob); sa.download = "AFD.txt.p7s"; sa.click(); URL.revokeObjectURL(sa.href);
    }
    dialog.toast(`AFD gerado (${d.counts?.t7 ?? 0} marcações)${d.signed ? " + assinatura .p7s" : d.complete === false ? " — sem assinatura" : ""}`, "success");
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <option value="">Todos os funcionários</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {employers.length > 1 && (
          <select value={afdEmployer} onChange={(e) => setAfdEmployer(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" title="AFD é por empregador (CNPJ)">
            {employers.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.isDefault ? " (padrão)" : ""}</option>)}
          </select>
        )}
        <button onClick={baixarAfd} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand" title="AFD do empregador selecionado (NSR/hash por CNPJ)">Baixar AFD{employers.length > 1 ? " (por empresa)" : ""}</button>
      </div>
      {items.length === 0 ? <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Sem marcações.</p> : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="table-cards w-full text-sm">
            <thead className="bg-bg/40 text-left text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">NSR</th><th className="px-3 py-2">Funcionário</th><th className="px-3 py-2">Data/hora</th><th className="px-3 py-2">Origem</th><th className="px-3 py-2">Verificação</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-line/60">
                  <td className="px-3 py-2 font-mono">{p.nsr}</td>
                  <td className="px-3 py-2">{nameOf(p.employeeId)}</td>
                  <td className="px-3 py-2">{new Date(p.punchedAt).toLocaleString("pt-BR")}{p.offline ? " (offline)" : ""}</td>
                  <td className="px-3 py-2 text-muted">{p.origin}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.faceMatch === true && <span className="text-green-300" title={`similaridade ${p.faceScore ?? "?"}%`}>rosto ✓</span>}
                    {p.faceMatch === false && <span className="text-red-300" title={`similaridade ${p.faceScore ?? "?"}%`}>rosto ✗</span>}
                    {p.livenessOk === true && <span className="ml-1 text-green-300">vivo ✓</span>}
                    {p.livenessOk === false && <span className="ml-1 text-amber-300">vivo ?</span>}
                    {Array.isArray(p.fraudFlags) && p.fraudFlags.length > 0 && <span className="ml-1 text-amber-300" title={p.fraudFlags.map((f) => FRAUD_LABEL[f] ?? f).join(" · ")}>⚠ {p.fraudFlags.length}</span>}
                    {p.photoUrl !== undefined && p.photoUrl !== null && <a href={`/api/ponto/punches/${p.id}/selfie`} target="_blank" rel="noreferrer" className="ml-1 underline">selfie</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Funcionarios({ emps, onChanged, dialog }: { emps: Emp[]; onChanged: () => void; dialog: any }) {
  const [f, setF] = useState({ name: "", cpf: "", pis: "", matricula: "", matEsocial: "", cargo: "", scheduleCode: "", pin: "" });
  const [enrollFor, setEnrollFor] = useState<Emp | null>(null);
  const [devFor, setDevFor] = useState<Emp | null>(null);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  async function save() {
    if (!f.name.trim()) { dialog.toast("Informe o nome", "error"); return; }
    const res = await fetch("/api/ponto/employees", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(f) });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    setF({ name: "", cpf: "", pis: "", matricula: "", matEsocial: "", cargo: "", scheduleCode: "", pin: "" });
    onChanged(); dialog.toast("Funcionário salvo ✅", "success");
  }
  async function dedupe() {
    const ok = await dialog.confirm("Unir registros de ponto duplicados (mesmo CPF)? As batidas, assinaturas, banco de horas e férias dos duplicados são migrados para o registro principal.");
    if (!ok) return;
    const res = await fetch("/api/ponto/employees/dedupe", { method: "POST", credentials: "include" });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    onChanged(); dialog.toast(d?.merged ? `${d.merged} duplicado(s) unido(s) ✅` : "Nenhum duplicado encontrado", "success");
  }
  async function zerarMarcacoes() {
    const ok = await dialog.confirm("ATENÇÃO: isto APAGA TODAS as marcações (batidas), justificativas, banco de horas e assinaturas de espelho de TODA a empresa. Ação IRREVERSÍVEL, feita para refazer a migração de ponto. Os espelhos são recalculados do zero a partir das batidas. Continuar?");
    if (!ok) return;
    const typed = window.prompt('Confirme digitando ZERAR (em maiúsculas) para apagar tudo:');
    if (typed !== "ZERAR") { dialog.toast("Cancelado — texto não confere", "error"); return; }
    const res = await fetch("/api/ponto/punches/wipe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ justifications: true, bank: true, signatures: true }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    onChanged(); dialog.toast(`Zerado ✅ — ${d?.punches ?? 0} batidas, ${d?.justifications ?? 0} justificativas, ${d?.bank ?? 0} banco, ${d?.signatures ?? 0} assinaturas`, "success");
  }
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Funcionários (marcação)</p>
        <div className="flex items-center gap-2">
          <button onClick={dedupe} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Unir duplicados (CPF)</button>
          <button onClick={zerarMarcacoes} className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-400 hover:bg-red-500/10">Zerar marcações (migração)</button>
        </div>
      </div>
      <div className="mb-4 rounded-xl border border-line bg-bg/60 p-5">
        <p className="mb-3 text-sm font-semibold">Novo funcionário</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="Nome" v={f.name} on={(v) => set("name", v)} />
          <Inp label="CPF" v={f.cpf} on={(v) => set("cpf", v)} />
          <Inp label="PIS" v={f.pis} on={(v) => set("pis", v)} />
          <Inp label="Matrícula" v={f.matricula} on={(v) => set("matricula", v)} />
          <Inp label="Matrícula eSocial" v={f.matEsocial} on={(v) => set("matEsocial", v)} />
          <Inp label="Cargo" v={f.cargo} on={(v) => set("cargo", v)} />
          <Inp label="Cód. horário contratual" v={f.scheduleCode} on={(v) => set("scheduleCode", v)} />
          <Inp label="PIN (opcional)" v={f.pin} on={(v) => set("pin", v)} />
        </div>
        <button onClick={save} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Salvar</button>
      </div>
      <div className="space-y-2">
        {emps.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
            <span>{e.name} <span className="text-xs text-muted">{e.cargo ?? ""}{e.matricula ? ` · mat ${e.matricula}` : ""}</span>{e.faceEnrolled && <span className="ml-2 text-[10px] text-green-300">rosto ✓</span>}</span>
            <div className="flex items-center gap-2">
              {!e.active && <span className="text-[10px] text-muted">inativo</span>}
              {e.allowedDeviceIds && e.allowedDeviceIds.length > 0 && <span className="text-[10px] text-amber-300" title="Restrito a terminais liberados">🔒 {e.allowedDeviceIds.length} term.</span>}
              {e.barcode && <button onClick={() => printCracha(e, "")} className="rounded border border-line px-2 py-0.5 text-xs hover:border-brand">Crachá</button>}
              <button onClick={() => setDevFor(e)} className="rounded border border-line px-2 py-0.5 text-xs hover:border-brand">Terminais</button>
              <button onClick={() => setEnrollFor(e)} className="rounded border border-line px-2 py-0.5 text-xs hover:border-brand">{e.faceEnrolled ? "Refazer rosto" : "Cadastrar rosto"}</button>
            </div>
          </div>
        ))}
      </div>
      {enrollFor && <FaceEnroll emp={enrollFor} onClose={() => setEnrollFor(null)} onDone={() => { setEnrollFor(null); onChanged(); }} dialog={dialog} />}
      {devFor && <DevicesEditor emp={devFor} onClose={() => setDevFor(null)} onDone={() => { setDevFor(null); onChanged(); }} dialog={dialog} />}
    </section>
  );
}

function DevicesEditor({ emp, onClose, onDone, dialog }: { emp: Emp; onClose: () => void; onDone: () => void; dialog: any }) {
  const [devices, setDevices] = useState<Array<{ id: string; name: string; code?: string | null }>>([]);
  const [sel, setSel] = useState<Set<string>>(new Set(emp.allowedDeviceIds ?? []));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/ponto/devices", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setDevices(d?.items ?? [])).catch(() => {});
  }, []);
  function toggle(id: string) { setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  async function save() {
    setBusy(true);
    const res = await fetch(`/api/ponto/employees/${emp.id}/devices`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ deviceIds: [...sel] }) });
    setBusy(false);
    if (!res.ok) { dialog.toast("Falha ao salvar", "error"); return; }
    dialog.toast(sel.size ? `Restrito a ${sel.size} terminal(is) ✅` : "Sem restrição (todos os terminais) ✅", "success");
    onDone();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Terminais liberados — {emp.name}</h3>
        <p className="mt-1 text-xs text-muted">Marque os terminais onde este funcionário <b>pode</b> bater o ponto. Deixe <b>tudo desmarcado</b> = sem restrição (pode bater em qualquer terminal da empresa). Não afeta terminais de empresas onde ele está alocado.</p>
        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {devices.length === 0 ? <p className="text-sm text-muted">Nenhum terminal cadastrado.</p> : devices.map((d) => (
            <label key={d.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
              <span>{d.name}{d.code ? <span className="text-xs text-muted"> · {d.code}</span> : null}</span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}

function FaceEnroll({ emp, onClose, onDone, dialog }: { emp: Emp; onClose: () => void; onDone: () => void; dialog: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" } }).then((s) => { streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s; }).catch(() => dialog.toast("Câmera indisponível", "error"));
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);
  async function capture() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = 480; c.height = Math.round((v.videoHeight / v.videoWidth) * 480);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    const selfie = c.toDataURL("image/jpeg", 0.8);
    setBusy(true);
    const res = await fetch(`/api/ponto/employees/${emp.id}/face`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ selfie }) });
    setBusy(false);
    if (!res.ok) { dialog.toast("Falha ao cadastrar rosto", "error"); return; }
    dialog.toast("Rosto cadastrado ✅", "success"); onDone();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-sm font-semibold">Cadastrar rosto — {emp.name}</p>
        <p className="mb-3 text-[11px] text-muted">Olhe para a câmera com o rosto bem iluminado e centralizado.</p>
        <video ref={videoRef} autoPlay playsInline muted className="aspect-square w-full rounded-xl bg-black object-cover" />
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-line py-2 text-sm">Cancelar</button>
          <button disabled={busy} onClick={capture} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Capturar"}</button>
        </div>
      </div>
    </div>
  );
}

function MachinesPanel({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<{ label: string; key: string } | null>(null);
  const load = () => fetch("/api/ponto/machines", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function create() {
    if (label.trim().length < 2) { dialog.toast("Informe um nome para a máquina", "error"); return; }
    const res = await fetch("/api/ponto/machines", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ label: label.trim() }) });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.key) { dialog.toast("Falha ao criar", "error"); return; }
    setNewKey({ label: d.label, key: d.key }); setLabel(""); load();
  }
  async function revoke(id: string, revoke: boolean) {
    const res = await fetch(`/api/ponto/machines/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ revoke }) });
    if (res.ok) load();
  }
  return (
    <div className="mt-3 rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-sm font-semibold">Computadores homologados</p>
      <p className="mb-2 text-[11px] text-muted">Gere uma chave por computador, abra o portal nessa máquina e cole a chave em <b>“Homologar este computador”</b>. Só máquinas homologadas (não revogadas) podem enviar solicitações.</p>
      <div className="flex flex-wrap items-end gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome (ex.: PC Recepção Matriz)" className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        <button onClick={create} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Gerar chave</button>
      </div>
      {newKey && (
        <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="text-amber-200">Chave de <b>{newKey.label}</b> (copie agora — não será exibida de novo):</p>
          <code className="mt-1 block break-all rounded bg-bg/60 px-2 py-1 font-mono">{newKey.key}</code>
          <button onClick={() => { navigator.clipboard?.writeText(newKey.key); dialog.toast("Copiada ✅", "success"); }} className="mt-1 rounded border border-line px-2 py-0.5">Copiar</button>
        </div>
      )}
      <div className="mt-3 space-y-1">
        {items.length === 0 ? <p className="text-xs text-muted">Nenhuma máquina homologada.</p> : items.map((m) => (
          <div key={m.id} className={`flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm ${m.revokedAt ? "opacity-60" : ""}`}>
            <span>{m.label} {m.revokedAt && <span className="ml-1 text-[10px] uppercase text-red-300">revogada</span>}<span className="block text-[11px] text-muted">{m.lastSeenAt ? `visto ${new Date(m.lastSeenAt).toLocaleString("pt-BR")}` : "nunca usado"}</span></span>
            <button onClick={() => revoke(m.id, !m.revokedAt)} className={`rounded border px-2 py-0.5 text-xs ${m.revokedAt ? "border-green-500/50 text-green-300" : "border-red-500/50 text-red-300"}`}>{m.revokedAt ? "Reativar" : "Revogar"}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BankRequestsPanel({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const load = () => fetch("/api/ponto/bank-requests", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function respond(id: string, approve: boolean) {
    let note: string | undefined;
    if (!approve) { const r = await dialog.prompt({ title: "Negar solicitação", message: "Motivo (opcional):" }); if (r === null) return; note = r ?? undefined; }
    const res = await fetch(`/api/ponto/bank-requests/${id}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ approve, note }) });
    if (!res.ok) { dialog.toast("Falha ao responder", "error"); return; }
    dialog.toast(approve ? "Saldo liberado ao funcionário ✅" : "Solicitação negada", "success"); load();
  }
  const pend = items.filter((i) => i.status === "pending");
  return (
    <div className="mt-6 rounded-xl border border-line bg-bg/60 p-5">
      <p className="mb-1 text-sm font-semibold">Solicitações de saldo do banco de horas {pend.length > 0 && <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">{pend.length} pendente(s)</span>}</p>
      <p className="mb-3 text-[11px] text-muted">Funcionários pedem para ver o saldo quando a empresa o mantém oculto. Apenas o RH vê e responde aqui (o líder não vê).</p>
      {items.length === 0 ? <p className="text-sm text-muted">Nenhuma solicitação.</p> : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{r.employeeName}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${r.status === "pending" ? "bg-amber-500/20 text-amber-300" : r.status === "approved" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>{r.status === "pending" ? "pendente" : r.status === "approved" ? "liberado" : "negado"}</span>
                <div className="text-[11px] text-muted">{new Date(r.requestedAt).toLocaleString("pt-BR")}{r.reason ? ` · "${r.reason}"` : ""}{r.responseNote ? ` · RH: ${r.responseNote}` : ""}</div>
              </div>
              {r.status === "pending" && (
                <div className="flex gap-2">
                  <button onClick={() => respond(r.id, true)} className="rounded border border-green-500/50 px-2 py-0.5 text-xs text-green-300 hover:bg-green-500/10">Liberar saldo</button>
                  <button onClick={() => respond(r.id, false)} className="rounded border border-red-500/50 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10">Negar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Config({ dialog }: { dialog: any }) {
  const [c, setC] = useState<any>({ tpIdtEmpregador: 1, idtEmpregador: "", razaoOuNome: "", repAProcesso: "", caepf: "", cno: "", timezone: "-0300" });
  useEffect(() => { fetch("/api/ponto/config", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setC(d)).catch(() => {}); }, []);
  const set = (k: string, v: any) => setC((s: any) => ({ ...s, [k]: v }));
  async function save() {
    const res = await fetch("/api/ponto/config", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(c) });
    if (!res.ok) { dialog.toast("Falha ao salvar", "error"); return; }
    dialog.toast("Config salva ✅", "success");
  }
  return (
    <section className="rounded-xl border border-line bg-bg/60 p-5">
      <p className="mb-3 text-sm font-semibold">Dados do empregador (cabeçalho do AFD/AEJ)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
          <select value={c.tpIdtEmpregador} onChange={(e) => set("tpIdtEmpregador", Number(e.target.value))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"><option value={1}>CNPJ</option><option value={2}>CPF</option></select></label>
        <Inp label="CNPJ/CPF" v={c.idtEmpregador} on={(v) => set("idtEmpregador", v)} />
        <Inp label="Razão social / nome" v={c.razaoOuNome} on={(v) => set("razaoOuNome", v)} />
        <Inp label="Nº processo convenção/acordo (REP-A)" v={c.repAProcesso} on={(v) => set("repAProcesso", v)} />
        <Inp label="CAEPF (se houver)" v={c.caepf} on={(v) => set("caepf", v)} />
        <Inp label="CNO (se houver)" v={c.cno} on={(v) => set("cno", v)} />
        <Inp label="Local de prestação de serviços" v={c.localPrestacao} on={(v) => set("localPrestacao", v)} />
        <Inp label="CPF do responsável (inclusões/alterações)" v={c.responsavelCpf} on={(v) => set("responsavelCpf", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo ident. desenvolvedor (PTRP)</span>
          <select value={c.devTpIdt ?? 1} onChange={(e) => set("devTpIdt", Number(e.target.value))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"><option value={1}>CNPJ</option><option value={2}>CPF</option></select></label>
        <Inp label="CNPJ/CPF do desenvolvedor do software" v={c.devIdt} on={(v) => set("devIdt", v)} />
      </div>
      <p className="mt-2 text-[11px] text-muted">Se não houver convenção/acordo depositado, deixe em branco — o AFD/AEJ usa "9"×17 automaticamente. O CNPJ do desenvolvedor (PTRP) vem da configuração do servidor e vai no cabeçalho do AFD.</p>

      <p className="mb-3 mt-6 text-sm font-semibold">Reconhecimento facial e prova de vida (Fase 3)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Provedor facial</span>
          <select value={c.faceProvider ?? "none"} onChange={(e) => set("faceProvider", e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"><option value="none">Desligado</option><option value="http">Serviço HTTP (self-hosted/adaptador)</option></select></label>
        <Inp label="URL do serviço facial" v={c.faceProviderUrl} on={(v) => set("faceProviderUrl", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Chave do serviço {c.faceProviderKeySet ? "(definida — deixe vazio p/ manter)" : ""}</span><input type="password" value={c.faceProviderKey ?? ""} onChange={(e) => set("faceProviderKey", e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
        <Inp label="Similaridade mínima (0-100)" v={String(c.faceThreshold ?? 60)} on={(v) => set("faceThreshold", Number(v) || 0)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.requireFace} onChange={(e) => set("requireFace", e.target.checked)} /> Exigir reconhecimento facial</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.requireLiveness} onChange={(e) => set("requireLiveness", e.target.checked)} /> Exigir prova de vida (liveness)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.faceEnforce} onChange={(e) => set("faceEnforce", e.target.checked)} /> Bloquear marcação se o rosto não conferir (senão, só sinaliza)</label>
      </div>
      <p className="mt-2 text-[11px] text-muted">Plugável: aponte para um serviço self-hosted (CompreFace/DeepFace) ou um adaptador (AWS Rekognition) que receba {`{ reference, probe }`} em base64 e devolva {`{ similarity }`}. Cadastre o rosto de cada funcionário na aba Funcionários.</p>

      <p className="mt-4 mb-1 text-sm font-semibold">Cálculo legal (CLT)</p>
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.nightReducedHour !== false} onChange={(e) => set("nightReducedHour", e.target.checked)} /> Hora noturna reduzida (52min30s = 1h) — art. 73 §1º</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.dsrLossEnabled !== false} onChange={(e) => set("dsrLossEnabled", e.target.checked)} /> Perder DSR em semana com falta injustificada</label>
        <div className="sm:w-72"><Inp label="Banco de horas: prazo de compensação (meses)" v={String(c.bankExpiryMonths ?? 6)} on={(v) => set("bankExpiryMonths", Number(v) || 0)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.showBankToEmployee !== false} onChange={(e) => set("showBankToEmployee", e.target.checked)} /> Mostrar o saldo do banco de horas ao funcionário (no portal)</label>
        <p className="text-[11px] text-muted">Se desligado, o funcionário não vê o saldo no portal e pode <b>solicitar ao RH</b> — só o RH vê e responde (o líder não vê).</p>
      </div>

      <p className="mt-4 mb-1 text-sm font-semibold">Bloqueio de solicitações no portal</p>
      <p className="mb-2 text-[11px] text-muted">O funcionário sempre pode <b>consultar</b>. Estas regras bloqueiam apenas <b>solicitações</b> (justificativas, férias, trocas, ajuste de ponto, documentos, etc.).</p>
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.requestsRestrictHours} onChange={(e) => set("requestsRestrictHours", e.target.checked)} /> Permitir solicitações somente em horário definido</label>
        {c.requestsRestrictHours && (
          <div className="flex flex-wrap items-end gap-2 pl-6">
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Início</span><input type="time" value={c.requestsWindowStart ?? "08:00"} onChange={(e) => set("requestsWindowStart", e.target.value)} className="rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Fim</span><input type="time" value={c.requestsWindowEnd ?? "18:00"} onChange={(e) => set("requestsWindowEnd", e.target.value)} className="rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-sm" /></label>
            <div className="flex items-center gap-1">{["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d, i) => { const days = String(c.requestsWindowDays ?? "1,2,3,4,5").split(",").filter(Boolean); const on = days.includes(String(i)); return <button key={i} type="button" onClick={() => { const s = new Set(days); on ? s.delete(String(i)) : s.add(String(i)); set("requestsWindowDays", [...s].sort().join(",")); }} className={`rounded px-2 py-1 text-[11px] ${on ? "bg-brand text-white" : "border border-line text-muted"}`}>{d}</button>; })}</div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.requestsRestrictMachine} onChange={(e) => set("requestsRestrictMachine", e.target.checked)} /> Permitir solicitações somente em computador homologado da empresa</label>
      </div>
      {c.requestsRestrictMachine && <MachinesPanel dialog={dialog} />}
      <BankRequestsPanel dialog={dialog} />
      <p className="mt-1 text-[11px] text-muted">Desligue se a convenção coletiva (CCT) da categoria dispensar a redução da hora noturna ou tratar o DSR de forma diferente. Afeta o espelho, o fechamento e o AEJ.</p>

      <p className="mt-6 mb-1 text-sm font-semibold">Alertas automáticos de ponto</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.alertsEnabled !== false} onChange={(e) => set("alertsEnabled", e.target.checked)} /> Ligar alertas (avisa o funcionário e o gestor)</label>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Inp label="WhatsApp do gestor (resumo diário)" v={c.alertWhatsapp ?? ""} on={(v) => set("alertWhatsapp", v)} />
        <Inp label="E-mail do gestor (resumo diário)" v={c.alertEmail ?? ""} on={(v) => set("alertEmail", v)} />
        <Inp label="Hora do resumo diário (0–23)" v={String(c.alertSummaryHour ?? 20)} on={(v) => set("alertSummaryHour", Number(v) || 0)} />
        <Inp label="Limite de hora extra semanal (min)" v={String(c.overtimeWeeklyAlertMin ?? 600)} on={(v) => set("overtimeWeeklyAlertMin", Number(v) || 0)} />
        <Inp label="E-mail da contabilidade (lote de espelhos)" v={c.accountantEmail ?? ""} on={(v) => set("accountantEmail", v)} />
      </div>
      <p className="mt-1 text-[11px] text-muted">Esse e-mail também libera o <b>Portal do Contador</b> em <code>/contador</code> (login por código de uso único, somente leitura): fechamentos, AFD, AEJ e espelhos por CNPJ.</p>
      <p className="mt-1 text-[11px] text-muted">O funcionário é avisado (WhatsApp/e-mail do cadastro) quando não registra a entrada ou esquece a saída. O gestor recebe um resumo diário das divergências e, às segundas, quem passou do limite de hora extra na semana.</p>

      <FaceTestButton dialog={dialog} />
      <p className="mt-1 text-[11px] text-muted">Use o teste pra calibrar a <b>Similaridade mínima</b>: capture o rosto de alguém cadastrado e veja a pontuação. Ajuste o limiar abaixo da pontuação de acertos e acima da de estranhos.</p>

      <PontoBackground c={c} dialog={dialog} onSaved={() => fetch("/api/ponto/config", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => r.json()).then(setC).catch(() => {})} />

      <PontoCert dialog={dialog} />

      <p className="mb-3 mt-6 text-sm font-semibold">Webhook de eventos (Fase 5)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Inp label="URL do webhook (POST a cada marcação)" v={c.webhookUrl} on={(v) => set("webhookUrl", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Segredo {c.webhookSecretSet ? "(definido — vazio mantém)" : ""}</span><input type="password" value={c.webhookSecret ?? ""} onChange={(e) => set("webhookSecret", e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
      </div>
      <p className="mt-2 text-[11px] text-muted">Enviamos um POST JSON {`{ event, orgId, at, data }`} a cada marcação, assinado em HMAC-SHA256 no header <b>x-ponto-signature</b>. Evento: <code>ponto.punch.created</code>.</p>

      <button onClick={save} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Salvar</button>
    </section>
  );
}

function PontoBackground({ c, dialog, onSaved }: { c: any; dialog: any; onSaved: () => void }) {
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 20_000_000) { dialog.toast("Imagem acima de 20MB", "error"); return; }
    setBusy(true);
    try {
      // Reduz/recomprime no navegador (máx 2560px, JPEG) — evita estourar o limite
      // de upload e deixa o kiosk mais leve. Fallback: usa o arquivo original.
      const dataUrl = await downscaleImage(file, 2560, 0.85).catch(() => null) ?? await fileToDataUrl(file);
      const res = await fetch("/api/ponto/background", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ image: dataUrl, until: until || undefined }) });
      if (!res.ok) { dialog.toast("Falha ao subir imagem", "error"); return; }
      dialog.toast("Fundo atualizado ✅", "success"); onSaved();
    } finally { setBusy(false); e.currentTarget.value = ""; }
  }
  async function remove() {
    const res = await fetch("/api/ponto/config", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ bgImageUrl: "", bgUntil: null }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast("Fundo removido", "success"); onSaved();
  }
  return (
    <div className="mt-6">
      <p className="mb-1 text-sm font-semibold">Imagem de fundo do painel de marcação</p>
      <p className="mb-3 text-[11px] text-muted">Recomendado: <b>1920×1080</b> (Full HD) ou <b>2560×1440</b> — proporção 16:9 horizontal, alta resolução, JPG/PNG/WebP até 8MB. Imagens menores podem ficar borradas em TV.</p>
      <div className="flex flex-wrap items-center gap-3">
        {c.bgImageUrl ? <img src={c.bgImageUrl} alt="fundo" className="h-20 w-36 rounded-lg border border-line object-cover" /> : <div className="flex h-20 w-36 items-center justify-center rounded-lg border border-dashed border-line text-[11px] text-muted">sem fundo</div>}
        <div className="flex flex-col gap-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Exibir até (opcional)</span><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
          <div className="flex gap-2">
            <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">{busy ? "Enviando…" : "Subir imagem"}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} /></label>
            {c.bgImageUrl && <button onClick={remove} className="rounded-lg border border-red-500/50 px-3 py-2 text-sm text-red-300">Remover</button>}
          </div>
          {c.bgUntil && <span className="text-[11px] text-muted">Ativo até {new Date(c.bgUntil).toLocaleDateString("pt-BR")}</span>}
        </div>
      </div>
    </div>
  );
}

/** Baixa o espelho de ponto dia-a-dia em CSV (abre no Excel; BOM + ;). */
function csvEspelho(data: any, range: { from: string; to: string }) {
  const WDc = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const rows: string[] = [];
  rows.push(`Espelho de ponto;${data.employee?.name ?? ""}`);
  rows.push(`Empregador;${data.employer ?? ""}`);
  rows.push(`Período;${range.from} a ${range.to}`);
  rows.push("");
  rows.push("Dia;Semana;Marcações;Previsto;Trabalhado;Extra;Atraso;Falta;Noturno(red);Saldo;DSR;Justificado");
  for (const d of data.days as any[]) {
    rows.push([
      d.day, WDc[d.wd], (d.punches || []).join(" "),
      d.hm.expectedMin, d.hm.workedMin, d.extraMin ? d.hm.extraMin : "", d.lateMin ? d.hm.lateMin : "",
      d.faltaMin && !d.justified ? d.hm.faltaMin : "", d.nightReducedMin ? d.hm.nightReducedMin : "",
      d.hm.balanceMin, d.dsrLost ? "perdido" : "", d.justified ? "sim" : "",
    ].join(";"));
  }
  const t = data.totals.hm;
  rows.push("");
  rows.push(`Totais;;;${t.expectedMin};${t.workedMin};${t.extraMin};${t.lateMin};${t.faltaMin};${t.nightReducedMin};${t.balanceMin};${data.totals.dsrLostWeeks || 0};`);
  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = `espelho-${(data.employee?.name || "func").replace(/\s+/g, "_")}-${range.from}_${range.to}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}

/** Abre uma janela limpa só com o espelho de ponto e dispara a impressão (sem a sidebar do app). */
function printEspelho(data: any, range: { from: string; to: string }) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const rows = (data.days as any[]).map((d) => {
    const div = d.divergence ? ' style="background:#fff7ed"' : "";
    return `<tr${div}><td>${d.day.slice(8)}/${d.day.slice(5, 7)} ${WD[d.wd]}${d.justified ? " ✅" : ""}${d.dsrLost ? " (DSR)" : ""}</td>`
      + `<td class="mono">${esc(d.punches.join(" ") || (d.isWorkDay ? "—" : "folga"))}</td>`
      + `<td>${d.hm.expectedMin}</td><td>${d.hm.workedMin}</td><td>${d.extraMin ? d.hm.extraMin : ""}</td>`
      + `<td>${d.lateMin ? d.hm.lateMin : ""}${d.incomplete ? " ⚠" : ""}</td><td>${d.faltaMin && !d.justified ? d.hm.faltaMin : ""}</td>`
      + `<td>${d.nightReducedMin ? d.hm.nightReducedMin : ""}</td><td>${d.hm.balanceMin}</td></tr>`;
  }).join("");
  const t = data.totals.hm;
  w.document.write(`<html><head><meta charset="utf-8"><title>Espelho de ponto — ${esc(data.employee.name)}</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;color:#111;margin:24px}
  h1{font-size:18px;margin:0 0 2px} .sub{color:#444;font-size:13px;margin:1px 0}
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}
  th,td{border:1px solid #ddd;padding:4px 6px;text-align:left}
  th{background:#f3f4f6;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
  tfoot td{font-weight:700;border-top:2px solid #999}
  .mono{font-family:ui-monospace,monospace} .note{color:#666;font-size:10px;margin-top:8px}
  @media print{body{margin:0}}
</style></head><body>
  <h1>Espelho de ponto</h1>
  <p class="sub">${esc(data.employer)} · ${esc(data.employee.name)}${data.employee.cargo ? " — " + esc(data.employee.cargo) : ""}${data.schedule ? " · escala " + esc(data.schedule.name) : " · sem escala"}</p>
  <p class="sub">Período ${esc(range.from)} a ${esc(range.to)}${data.employee.cpf ? " · CPF " + esc(data.employee.cpf) : ""}</p>
  <table className="table-cards">
    <thead><tr><th>Dia</th><th>Marcações</th><th>Prev.</th><th>Trab.</th><th>Extra</th><th>Atraso</th><th>Falta</th><th>Not.</th><th>Saldo</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">Totais</td><td>${t.expectedMin}</td><td>${t.workedMin}</td><td>${t.extraMin}</td><td>${t.lateMin}</td><td>${t.faltaMin}</td><td>${t.nightReducedMin}</td><td>${t.balanceMin}</td></tr></tfoot>
  </table>
  <p class="note">Horas em hh:mm. ⚠ = marcação incompleta. ✅ = justificativa aprovada. Not. = hora noturna com redução legal (52min30s). (DSR) = descanso semanal perdido por falta injustificada${data.totals.dsrLostWeeks ? ` — ${data.totals.dsrLostWeeks} no período` : ""}. Documento gerado em ${new Date().toLocaleString("pt-BR")}.</p>
  <div style="display:flex;gap:40px;margin-top:48px">
    <div style="flex:1;text-align:center"><div style="border-top:1px solid #333;padding-top:6px;font-size:12px">${esc(data.employee.name)}${data.employee.cpf ? "<br>CPF " + esc(data.employee.cpf) : ""}<br><span style="color:#666;font-size:10px">Assinatura do funcionário</span></div></div>
    <div style="flex:1;text-align:center"><div style="border-top:1px solid #333;padding-top:6px;font-size:12px">${esc(data.employer || "")}<br><span style="color:#666;font-size:10px">Responsável / Gestor</span></div></div>
  </div>
  <script>window.onload=()=>{window.print()}</script>
</body></html>`);
  w.document.close();
}

const JKIND: Record<string, string> = { atraso: "Atraso", falta: "Falta", saida_antecipada: "Saída antecipada", abono: "Abono / atestado", extra: "Hora extra", ajuste: "Ajuste de horário", outro: "Correção / outro" };
const PROP_LBL: Record<string, string> = { in: "Entrada", break_in: "Saída intervalo", break_out: "Retorno", out: "Saída" };
function SolicitacoesPonto({ dialog }: { dialog: any }) {
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/ponto/justificativas?status=${status}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  async function review(id: string, approve: boolean) {
    let note: string | undefined;
    if (!approve) { const r = await dialog.prompt?.("Motivo da recusa (opcional):"); note = r ?? undefined; }
    const res = await fetch(`/api/ponto/justificativas/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ approve, note }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast(approve ? "Aprovada ✅" : "Recusada", "success"); load();
  }
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`rounded-full px-3 py-1 text-sm ${status === s ? "bg-brand text-white" : "border border-line text-muted hover:border-brand"}`}>{s === "pending" ? "Pendentes" : s === "approved" ? "Aprovadas" : "Recusadas"}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{loading ? "Carregando…" : `${items.length} solicitação(ões)`}</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Nada por aqui.</p> : items.map((j) => (
          <div key={j.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-bg/60 p-3 text-sm">
            <div>
              <p className="font-medium">{j.employeeName || "—"} · {JKIND[j.kind] ?? j.kind} · {new Date(j.day).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{j.reason}</p>
              {j.kind === "ajuste" && j.proposed && (
                <p className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  {["in", "break_in", "break_out", "out"].filter((k) => j.proposed?.[k]).map((k) => (
                    <span key={k} className="rounded bg-brand/15 px-1.5 py-0.5 font-medium text-brand">{PROP_LBL[k]}: {j.proposed[k]}</span>
                  ))}
                  <span className="text-muted">(ao aprovar, vira batida no espelho)</span>
                </p>
              )}
              <div className="mt-1 flex items-center gap-3 text-xs">
                {j.attachmentUrl && <a href={j.attachmentUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver anexo</a>}
                {j.reviewNote && <span className="text-muted">obs.: {j.reviewNote}</span>}
              </div>
            </div>
            {j.status === "pending" ? (
              <div className="flex shrink-0 gap-2">
                <button onClick={() => review(j.id, true)} className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white">Aprovar</button>
                <button onClick={() => review(j.id, false)} className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-red-300">Recusar</button>
              </div>
            ) : <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${j.status === "approved" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>{j.status === "approved" ? "aprovada" : "recusada"}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function EspelhosContabil({ dialog }: { dialog: any }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/ponto/espelho/assinaturas?refMonth=${month}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, [month]);
  useEffect(() => { load(); }, [load]);
  async function enviar() {
    const ok = await dialog.confirm(`Enviar o lote de espelhos de ${month} à contabilidade por e-mail?`);
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/espelho/enviar-contabilidade", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ refMonth: month }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao enviar", "error"); return; }
      dialog.toast(`Enviado à contabilidade (${d?.to}) ✅`, "success");
    } finally { setBusy(false); }
  }
  return (
    <section className="mb-4 rounded-xl border border-line bg-bg/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Espelhos do mês (contabilidade)</p>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-2 py-1.5 text-sm" />
        {data && <span className="rounded-full bg-bg/40 px-3 py-1 text-xs text-muted">{data.signed}/{data.total} assinados</span>}
        <a href={`/api/ponto/espelho/lote.pdf?refMonth=${month}`} target="_blank" rel="noreferrer" className="ml-auto rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Baixar lote (PDF)</a>
        <button onClick={enviar} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Enviando…" : "Enviar à contabilidade"}</button>
        <button onClick={() => setOpen((v) => !v)} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">{open ? "ocultar" : "ver lista"}</button>
      </div>
      <p className="mt-1 text-[11px] text-muted">Gera um PDF único com o espelho de todos os funcionários ativos (com carimbo de assinatura e hash). Configure o e-mail do contador no Empregador.</p>
      {open && data && (
        <div className="mt-3 space-y-1">
          {data.items.map((i: any) => (
            <div key={i.employeeId} className="flex items-center justify-between rounded border border-line/60 bg-bg/40 px-3 py-1.5 text-sm">
              <span>{i.name}{i.cargo ? <span className="text-xs text-muted"> · {i.cargo}</span> : null}</span>
              <span className={`text-xs ${i.signed ? "text-green-300" : "text-amber-200"}`}>{i.signed ? `assinado${i.a1Signed ? " (A1)" : ""}${i.signedAt ? " · " + new Date(i.signedAt).toLocaleDateString("pt-BR") : ""}` : "pendente"}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Espelho({ emps, dialog }: { emps: Emp[]; dialog: any }) {
  const [empId, setEmpId] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [range, setRange] = useState(monthRange());
  const [data, setData] = useState<any>(null);
  const [just, setJust] = useState({ day: "", kind: "atraso", reason: "" });
  const [pday, setPday] = useState("");
  const [ptimes, setPtimes] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editDay, setEditDay] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PunchForm>(emptyPunchForm());
  const [editSnack, setEditSnack] = useState(false);
  const [bank, setBank] = useState<any>(null);
  // Pra "Lançar/ajustar batidas" (caixa abaixo do espelho): substitui as do dia
  // por padrão — antes era OFF e duplicava se você relançasse o mesmo dia.
  const [pReplace, setPReplace] = useState(true);
  const [bulkReplace, setBulkReplace] = useState(true);
  const load = () => {
    if (!empId) { setData(null); return; }
    fetch(`/api/ponto/espelho?employeeId=${empId}&from=${range.from}&to=${range.to}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  };
  const loadBank = () => {
    if (!empId) { setBank(null); return; }
    fetch(`/api/ponto/banco?employeeId=${empId}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then(setBank).catch(() => {});
  };
  useEffect(() => { load(); loadBank(); }, [empId, range.from, range.to]);
  const bankByDay = new Map<string, any[]>();
  for (const m of (bank?.items ?? [])) { const k = String(m.day).slice(0, 10); (bankByDay.get(k) ?? bankByDay.set(k, []).get(k)!).push(m); }
  async function lancarSaldo(d: any, mode: "bank" | "he" | "descontar" | "atraso_bh") {
    let minutes = 0, kind = "inclusion", reason = "";
    if (mode === "he") {
      // Horas extras: lança APENAS o extraMin (não o balance, pra não dobrar com atraso compensado)
      minutes = d.extraMin || 0; kind = "he"; reason = "horas extras (espelho)";
    } else if (mode === "descontar") {
      const avail = bank?.balanceMin ?? 0;
      if (avail <= 0) { dialog.alert("Sem saldo no BH+ para descontar deste funcionário."); return; }
      minutes = -Math.min(Math.abs(d.balanceMin), avail); kind = "compensation"; reason = "compensação do BH+ (espelho)";
    } else if (mode === "atraso_bh") {
      // Atraso/saída antecipada vira BH NEGATIVO (banco devedor) — não exige saldo prévio
      const negMins = -(d.lateMin + d.earlyMin);
      minutes = negMins; kind = "inclusion"; reason = "atraso/saída antecipada → BH− (espelho)";
    } else {
      // Saldo do dia: positivo ou negativo direto pro BH (sem compensar)
      minutes = d.balanceMin; kind = "inclusion"; reason = `saldo do dia → ${d.balanceMin >= 0 ? "BH+" : "BH−"} (espelho)`;
    }
    if (!minutes) return;
    const label =
      mode === "he" ? "lançar como horas extras (HE)"
      : mode === "descontar" ? "descontar do banco de horas"
      : mode === "atraso_bh" ? "lançar atraso no BH− (banco devedor)"
      : "lançar no banco de horas";
    if (!(await dialog.confirm({ title: "Lançamento de saldo", message: `Confirmar ${label}: ${hmMin(minutes)} no dia ${d.day.slice(8)}/${d.day.slice(5, 7)}?` }))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/banco", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, day: d.day, minutes, kind, reason }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(j?.error?.message ?? "Falha no lançamento", "error"); return; }
      dialog.toast("Lançado ✅", "success"); loadBank();
    } finally { setBusy(false); }
  }
  async function removerLanc(id: string) {
    if (!(await dialog.confirm({ title: "Remover lançamento", message: "Remover este lançamento do banco/HE?", tone: "danger" }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ponto/banco/${id}/delete`, { method: "POST", credentials: "include" });
      if (!res.ok) { dialog.toast("Falha ao remover", "error"); return; }
      dialog.toast("Removido", "success"); loadBank();
    } finally { setBusy(false); }
  }
  async function enviarJustificativa() {
    if (!empId || !just.day || !just.reason.trim()) { dialog.toast("Preencha dia e motivo", "error"); return; }
    const res = await fetch("/api/ponto/justificativas", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, ...just }) });
    if (!res.ok) { dialog.toast("Falha ao enviar", "error"); return; }
    setJust({ day: "", kind: "atraso", reason: "" }); dialog.toast("Justificativa enviada ✅", "success"); load();
  }
  async function lancarDia() {
    const times = parseTimes(ptimes);
    if (!empId || !pday || !times.length) { dialog.toast("Informe a data e ao menos um horário (ex.: 08:00 12:00 13:00 18:00)", "error"); return; }
    // verifica se já há batidas naquele dia — se sim e usuário quer substituir,
    // avisa que vai anular pra evitar surpresa
    const existing = data?.days?.find((d: any) => d.day === pday)?.punches ?? [];
    if (existing.length && pReplace) {
      if (!(await dialog.confirm({ title: "Substituir batidas?", message: `O dia ${pday.slice(8)}/${pday.slice(5, 7)} já tem ${existing.length} batida(s). As anteriores serão ANULADAS (não apagadas — Portaria 671) e as novas registradas.`, confirmLabel: "Substituir" }))) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/punches/manual", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, days: [{ day: pday, times }], replaceDay: pReplace }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao lançar", "error"); return; }
      setPtimes(""); dialog.toast(`${d?.created ?? times.length} batida(s) lançada(s) ✅${d?.voided ? ` · ${d.voided} anteriores anuladas` : ""}`, "success"); load();
    } finally { setBusy(false); }
  }
  async function lancarMassa() {
    const days = parseLancamentoMassa(bulkText);
    const total = days.reduce((n, d) => n + d.times.length, 0);
    if (!empId || !days.length) { dialog.toast("Cole ao menos uma linha válida (ex.: 2026-05-01 08:00 12:00 13:00 18:00)", "error"); return; }
    if (!(await dialog.confirm(`Lançar ${total} batida(s) em ${days.length} dia(s) para este funcionário?${bulkReplace ? " Dias com batidas existentes serão substituídos." : ""}`))) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/punches/manual", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, motivo: "migração de ponto", days, replaceDay: bulkReplace }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao lançar", "error"); return; }
      setBulkText(""); setBulkOpen(false); dialog.toast(`${d?.created ?? total} batida(s) lançada(s) ✅${d?.voided ? ` · ${d.voided} anteriores anuladas` : ""}`, "success"); load();
    } finally { setBusy(false); }
  }
  function openEdit(d: any) { const { form, snack } = punchesToForm(d.punches ?? []); setEditDay(d.day); setEditForm(form); setEditSnack(snack); }
  async function saveEdit() {
    const times = formToTimes(editForm, editSnack);
    if (!empId || !editDay || !times.length) { dialog.toast("Informe ao menos a entrada", "error"); return; }
    setBusy(true);
    try {
      // replaceDay: anula as batidas anteriores do dia (não duplica) e grava só esta edição
      const res = await fetch("/api/ponto/punches/manual", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, days: [{ day: editDay, times }], replaceDay: true }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao alterar", "error"); return; }
      setEditDay(null); dialog.toast("Batidas atualizadas ✅", "success"); load();
    } finally { setBusy(false); }
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <option value="">— funcionário —</option>
          {emps.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className="text-sm">De <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" /></label>
        <label className="text-sm">Até <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" /></label>
        {/* O RH abre a grade SOZINHO ao escolher o funcionário. Aqui é botão:
            abrir em tela cheia automaticamente esconderia o espelho do Vision —
            com o CSV, a impressão e o espelho assinado — e não haveria como
            voltar a ele sem fechar a grade. Os dois caminhos ficam disponíveis. */}
        {empId && <button onClick={() => setAdjustOpen(true)} className="ml-auto rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:opacity-90">Ajustar ponto (tela cheia)</button>}
        {data && <button onClick={() => csvEspelho(data, range)} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">CSV</button>}
        {data && <button onClick={() => printEspelho(data, range)} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Imprimir / PDF</button>}
        {data && empId && <a href={`/api/ponto/espelho/recibo.pdf?employeeId=${empId}&refMonth=${range.from.slice(0, 7)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Espelho assinado</a>}
      </div>

      {adjustOpen && empId && (
        data
          ? <EspelhoAjusteModal empId={empId} data={data} range={range} dialog={dialog} onClose={() => setAdjustOpen(false)} onSaved={load} />
          : <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg text-sm text-muted">Carregando…</div>
      )}

      {!data ? <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Selecione um funcionário e o período.</p> : (
        <div className="rounded-xl border border-line bg-bg/60 p-4 print:border-0 print:bg-white print:text-black">
          <div className="mb-3">
            <p className="text-lg font-semibold">Espelho de ponto</p>
            <p className="text-sm text-muted print:text-black">{data.employer} · {data.employee.name}{data.employee.cargo ? ` — ${data.employee.cargo}` : ""}{data.schedule ? ` · escala ${data.schedule.name}` : " · sem escala"}</p>
            <p className="text-xs text-muted print:text-black">Período {range.from} a {range.to}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="table-cards w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted print:text-black"><tr>
                <th className="px-2 py-1">Dia</th><th className="px-2 py-1">Marcações</th><th className="px-2 py-1">Prev.</th><th className="px-2 py-1">Trab.</th><th className="px-2 py-1">Extra</th><th className="px-2 py-1">Atraso</th><th className="px-2 py-1">Falta</th><th className="px-2 py-1">Not.</th><th className="px-2 py-1">Saldo</th><th className="px-2 py-1 print:hidden"></th>
              </tr></thead>
              <tbody>
                {data.days.map((d: any) => (
                  <Fragment key={d.day}>
                  <tr className={`border-t border-line/60 ${d.divergence ? "bg-amber-500/10" : ""} ${d.faltaMin && !d.justified ? "bg-red-500/5" : ""} ${!d.isWorkDay ? "text-muted" : ""}`}>
                    <td className="px-2 py-1 whitespace-nowrap">{d.day.slice(8)}/{d.day.slice(5, 7)} <span className="text-[10px]">{WD[d.wd]}</span>{d.justified ? " ✅" : ""}{d.dsrLost ? <span title="DSR perdido (falta injustificada na semana)" className="ml-1 rounded bg-red-500/20 px-1 text-[9px] font-semibold text-red-300">DSR</span> : null}</td>
                    <td className="px-2 py-1 font-mono text-xs">{d.punches.join(" ") || (d.isWorkDay ? "—" : "folga")}</td>
                    <td className="px-2 py-1">{d.hm.expectedMin}</td>
                    <td className="px-2 py-1">{d.hm.workedMin}</td>
                    <td className="px-2 py-1">{d.extraMin ? d.hm.extraMin : ""}</td>
                    <td className="px-2 py-1">{d.lateMin ? d.hm.lateMin : ""}{d.incomplete ? " ⚠" : ""}</td>
                    <td className="px-2 py-1">{d.faltaMin && !d.justified ? d.hm.faltaMin : ""}</td>
                    <td className="px-2 py-1" title={d.nightMin && d.nightReducedMin !== d.nightMin ? `relógio ${d.hm.nightMin}` : ""}>{d.nightReducedMin ? d.hm.nightReducedMin : ""}</td>
                    <td className={`px-2 py-1 ${d.balanceMin < 0 ? "text-red-400 print:text-black" : "text-green-400 print:text-black"}`}>{d.hm.balanceMin}</td>
                    <td className="px-2 py-1 text-right print:hidden">
                      {d.isWorkDay && (editDay === d.day
                        ? <button onClick={() => setEditDay(null)} className="text-[11px] text-muted hover:text-fg">fechar</button>
                        : <button onClick={() => openEdit(d)} className="text-[11px] text-brand hover:underline">editar</button>)}
                    </td>
                  </tr>
                  {editDay === d.day && (
                    <tr className="border-t border-line/40 bg-bg/40 print:hidden">
                      <td colSpan={10} className="px-2 py-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <span className="w-full text-xs text-muted">Batidas do dia {d.day.slice(8)}/{d.day.slice(5, 7)}:</span>
                          {PUNCH_FIELDS.filter((pf) => !("snack" in pf && pf.snack) || editSnack).map((pf) => (
                            <label key={pf.key} className="text-[10px] uppercase text-muted">
                              {pf.label}
                              <input type="time" value={editForm[pf.key]} onChange={(e) => setEditForm((s) => ({ ...s, [pf.key]: e.target.value }))}
                                className="mt-0.5 block w-[100px] rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm outline-none focus:border-brand" />
                            </label>
                          ))}
                          <label className="flex items-center gap-1 text-[11px] text-muted">
                            <input type="checkbox" checked={editSnack} onChange={(e) => setEditSnack(e.target.checked)} className="h-3.5 w-3.5 rounded border-line" />
                            tem lanche (BH 2h)
                          </label>
                          <button onClick={saveEdit} disabled={busy} className="ml-auto rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? "Salvando…" : "Alterar"}</button>
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted">Reajustar substitui as batidas anteriores do dia (não duplica). As anuladas ficam guardadas para auditoria (Portaria 671 — nada é apagado).</p>
                        {(() => {
                          const moves = (bankByDay.get(d.day) ?? []).filter((m: any) => m.kind !== "expiry");
                          const avail = bank?.balanceMin ?? 0;
                          const kindLabel = (k: string) => k === "he" ? "Horas extras (HE)" : k === "compensation" ? "Compensação BH−" : "Banco de horas BH+";
                          return (
                            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/30 pt-2">
                              <span className="text-[11px] text-muted">Saldo do dia: <b className={d.balanceMin < 0 ? "text-red-400" : "text-green-400"}>{d.hm.balanceMin}</b></span>
                              {moves.length > 0 ? (
                                moves.map((m: any) => (
                                  <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                                    {kindLabel(m.kind)}: {hmMin(m.minutes)}
                                    <button onClick={() => removerLanc(m.id)} className="text-muted hover:text-red-400" title="remover lançamento">✕</button>
                                  </span>
                                ))
                              ) : (
                                <>
                                  {/* HE: só extra mesmo (não soma com balance) */}
                                  {d.extraMin > 0 && (
                                    <button onClick={() => lancarSaldo(d, "he")} disabled={busy} className="rounded-lg border border-amber-500/40 px-3 py-1 text-xs text-amber-300 hover:bg-amber-500/10 disabled:opacity-50" title="Horas extras: vai pra folha de HE, não fica no BH">
                                      HE +{d.hm.extraMin}
                                    </button>
                                  )}
                                  {/* Saldo positivo: dia rendeu mais que o esperado, manda pro BH+ */}
                                  {d.balanceMin > 0 && (
                                    <button onClick={() => lancarSaldo(d, "bank")} disabled={busy} className="rounded-lg border border-green-500/40 px-3 py-1 text-xs text-green-300 hover:bg-green-500/10 disabled:opacity-50" title="Saldo positivo do dia acumula no banco de horas">
                                      BH+ {d.hm.balanceMin}
                                    </button>
                                  )}
                                  {/* Saldo negativo (atraso + saída antecipada + falta): 2 opções
                                       a) descontar do BH+ existente (se tem saldo)
                                       b) lançar como BH- (devedor) — vira "horas a compensar" */}
                                  {d.balanceMin < 0 && (
                                    <>
                                      <button onClick={() => lancarSaldo(d, "descontar")} disabled={busy || avail <= 0} title={avail <= 0 ? "Sem saldo no BH+ para descontar" : `Disponível no BH+: ${hmMin(avail)}`} className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                                        Descontar do BH+ {avail > 0 ? `(disp. ${hmMin(avail)})` : "(sem saldo)"}
                                      </button>
                                      <button onClick={() => lancarSaldo(d, "bank")} disabled={busy} title="Registra o saldo negativo como BH− (banco devedor — ele compensa depois)" className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                                        BH− {d.hm.balanceMin}
                                      </button>
                                    </>
                                  )}
                                  {d.extraMin === 0 && d.balanceMin === 0 && (
                                    <span className="text-[11px] text-muted">sem saldo a lançar</span>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line font-semibold"><tr>
                <td className="px-2 py-1" colSpan={2}>Totais</td>
                <td className="px-2 py-1">{data.totals.hm.expectedMin}</td>
                <td className="px-2 py-1">{data.totals.hm.workedMin}</td>
                <td className="px-2 py-1">{data.totals.hm.extraMin}</td>
                <td className="px-2 py-1">{data.totals.hm.lateMin}</td>
                <td className="px-2 py-1">{data.totals.hm.faltaMin}</td>
                <td className="px-2 py-1">{data.totals.hm.nightReducedMin}</td>
                <td className="px-2 py-1">{data.totals.hm.balanceMin}</td>
              </tr></tfoot>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-muted print:text-black">Horas em hh:mm. ⚠ = marcação incompleta (nº ímpar). ✅ = dia com justificativa aprovada. <b>Not.</b> = hora noturna já com a redução legal (52min30s = 1h ficta; passe o mouse pra ver o relógio). <b>DSR</b> = descanso semanal perdido por falta injustificada na semana{data.totals.dsrLostWeeks ? ` (${data.totals.dsrLostWeeks} no período)` : ""}.</p>
        </div>
      )}

      {empId && (
        <div className="mt-4 rounded-xl border border-line bg-bg/60 p-4 print:hidden">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Lançar / ajustar batidas</p>
            <button onClick={() => setBulkOpen((v) => !v)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">{bulkOpen ? "Fechar lançamento em massa" : "Lançamento em massa (migração)"}</button>
          </div>
          {!bulkOpen ? (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                <input type="date" value={pday} onChange={(e) => setPday(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" />
                <input value={ptimes} onChange={(e) => setPtimes(e.target.value)} placeholder="Horários: 08:00 12:00 13:00 18:00" className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm sm:col-span-3" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={lancarDia} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Lançar batidas do dia</button>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={pReplace} onChange={(e) => setPReplace(e.target.checked)} className="h-3.5 w-3.5 rounded border-line" />
                  substituir as batidas anteriores do dia (recomendado)
                </label>
              </div>
              <p className="mt-1 text-[11px] text-muted">Cada horário vira uma marcação (entrada/saída na ordem). <b>Com "substituir" marcado</b>: anula as batidas anteriores do mesmo dia (não apaga — ficam guardadas pra auditoria) e cria as novas. <b>Sem substituir</b>: somente adiciona (usado pra migração inicial, sem batidas pré-existentes).</p>
            </>
          ) : (
            <>
              <p className="mb-1 text-[11px] text-muted">Uma linha por dia: <code>DATA hora hora hora hora</code>. DATA = <code>2026-05-01</code> ou <code>01/05/2026</code>. Ex.:</p>
              <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={8} placeholder={"2026-05-01 08:00 12:00 13:00 18:00\n2026-05-02 08:00 12:00 13:00 18:00\n02/05/2026 08:00 12:00"} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 font-mono text-xs" />
              {(() => { const dd = parseLancamentoMassa(bulkText); const tot = dd.reduce((n, d) => n + d.times.length, 0); return <p className="mt-1 text-[11px] text-muted">Prévia: {dd.length} dia(s), {tot} batida(s).</p>; })()}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={lancarMassa} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Lançar em massa</button>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" checked={bulkReplace} onChange={(e) => setBulkReplace(e.target.checked)} className="h-3.5 w-3.5 rounded border-line" />
                  substituir dias com batidas existentes
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {empId && (
        <div className="mt-4 rounded-xl border border-line bg-bg/60 p-4 print:hidden">
          <p className="mb-2 text-sm font-semibold">Justificar divergência</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <input type="date" value={just.day} onChange={(e) => setJust((j) => ({ ...j, day: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" />
            <select value={just.kind} onChange={(e) => setJust((j) => ({ ...j, kind: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm">
              {["atraso", "falta", "saida_antecipada", "abono", "extra", "outro"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={just.reason} onChange={(e) => setJust((j) => ({ ...j, reason: e.target.value }))} placeholder="Motivo" className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm sm:col-span-2" />
          </div>
          <button onClick={enviarJustificativa} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Enviar justificativa</button>
          <JustList employeeId={empId} dialog={dialog} />
        </div>
      )}

      {empId && (
        <div className="mt-4 rounded-xl border border-line bg-bg/60 p-4 print:hidden">
          <Afastamentos employeeId={empId} dialog={dialog} onChanged={load} />
        </div>
      )}
    </section>
  );
}

const LEAVE_LABEL: Record<string, string> = { inss_doenca: "INSS / Doença", acidente: "Acidente de trabalho", maternidade: "Licença-maternidade", paternidade: "Licença-paternidade", servico_militar: "Serviço militar", licenca_nr: "Licença não remunerada", outro: "Outro" };
function Afastamentos({ employeeId, dialog, onChanged }: { employeeId: string; dialog: any; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ type: "inss_doenca", startDate: "", endDate: "", reason: "" });
  const load = () => fetch(`/api/ponto/afastamentos?employeeId=${employeeId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d ?? [])).catch(() => {});
  useEffect(() => { load(); }, [employeeId]);
  async function add() {
    if (!f.startDate) { dialog.toast("Informe a data de início", "error"); return; }
    const res = await fetch("/api/ponto/afastamentos", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId, type: f.type, startDate: f.startDate, endDate: f.endDate || null, reason: f.reason || null }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    setF({ type: "inss_doenca", startDate: "", endDate: "", reason: "" }); dialog.toast("Afastamento registrado ✅", "success"); load(); onChanged();
  }
  async function rem(id: string) {
    if (!(await dialog.confirm({ title: "Remover afastamento", message: "Remover este afastamento?", tone: "danger" }))) return;
    await fetch(`/api/ponto/afastamentos/${id}/delete`, { method: "POST", credentials: "include" }); load(); onChanged();
  }
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Afastamentos</p>
      <div className="grid gap-2 sm:grid-cols-5">
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm sm:col-span-2">
          {Object.entries(LEAVE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" title="Início" />
        <input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" title="Fim (em aberto se vazio)" />
        <button onClick={add} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Registrar</button>
      </div>
      <div className="mt-2 space-y-1">
        {items.map((l) => (
          <div key={l.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
            <span><b>{LEAVE_LABEL[l.type] ?? l.type}</b> · {String(l.startDate).slice(0, 10)} {l.endDate ? `→ ${String(l.endDate).slice(0, 10)}` : "(em aberto)"}{l.reason ? ` · ${l.reason}` : ""}</span>
            <button onClick={() => rem(l.id)} className="text-xs text-red-300 hover:underline">remover</button>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">Nos dias do afastamento o espelho não conta falta nem jornada prevista (não infla o absenteísmo).</p>
    </div>
  );
}

function JustList({ employeeId, dialog }: { employeeId: string; dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const load = () => fetch(`/api/ponto/justificativas?employeeId=${employeeId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, [employeeId]);
  async function review(id: string, approve: boolean) {
    const res = await fetch(`/api/ponto/justificativas/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ approve }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast(approve ? "Aprovada ✅" : "Rejeitada", "success"); load();
  }
  if (items.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {items.map((j) => (
        <div key={j.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <span>{String(j.day).slice(0, 10)} · <b>{j.kind}</b> · {j.reason} <span className={`text-[10px] ${j.status === "approved" ? "text-green-400" : j.status === "rejected" ? "text-red-400" : "text-amber-400"}`}>[{j.status}]</span></span>
          {j.status === "pending" && (
            <span className="flex gap-1">
              <button onClick={() => review(j.id, true)} className="rounded border border-green-500/50 px-2 py-0.5 text-xs text-green-300">Aprovar</button>
              <button onClick={() => review(j.id, false)} className="rounded border border-red-500/50 px-2 py-0.5 text-xs text-red-300">Rejeitar</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const SWAP_ST: Record<string, { label: string; cls: string }> = {
  pending_colleague: { label: "Aguardando colega", cls: "bg-amber-500/15 text-amber-300" },
  pending_leader: { label: "Aguardando líder/RH", cls: "bg-sky-500/15 text-sky-300" },
  approved: { label: "Aprovada", cls: "bg-indigo-500/15 text-indigo-300" },
  applied: { label: "Efetivada", cls: "bg-emerald-500/15 text-emerald-300" },
  rejected: { label: "Recusada", cls: "bg-red-500/15 text-red-300" },
  canceled: { label: "Cancelada", cls: "bg-zinc-500/15 text-zinc-300" },
};
function swapBr(iso: string | null) { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }

function Empregadores({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const empty = { id: "", name: "", tpIdtEmpregador: 1, idtEmpregador: "", caepf: "", cnae: "", tpRep: 3, active: true };
  const [f, setF] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const [certs, setCerts] = useState<Record<string, any>>({});
  const loadCerts = (list: any[]) => { for (const e of list) fetch(`/api/ponto/cert?employerId=${e.id}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((s) => s && setCerts((c) => ({ ...c, [e.id]: s }))).catch(() => {}); };
  const load = () => fetch("/api/ponto/employers", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => { const its = d?.items ?? []; setItems(its); loadCerts(its); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function uploadA1(e: any, file: File) {
    const password = await dialog.prompt({ title: `A1 de ${e.name}`, message: "Senha do certificado (.pfx/.p12):" });
    if (password === null) return;
    setBusy(true);
    try {
      const pfx = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      const resp = await fetch("/api/ponto/cert", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employerId: e.id, pfx, password }) });
      const d = await resp.json().catch(() => null);
      if (!resp.ok) { dialog.alert(d?.error?.message ?? "Falha ao enviar o certificado"); return; }
      dialog.toast(`A1 de ${e.name}: ${d?.subject ?? "ok"} ✅`, "success"); loadCerts([e]);
    } finally { setBusy(false); }
  }
  async function removeA1(e: any) {
    if (!(await dialog.confirm({ title: "Remover A1", message: `Remover o certificado de "${e.name}"?`, tone: "danger" }))) return;
    await fetch("/api/ponto/cert/remove", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employerId: e.id }) });
    loadCerts([e]); dialog.toast("Certificado removido", "success");
  }

  async function save() {
    if (!f.name.trim()) { dialog.toast("Informe a razão social/nome", "error"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/employers", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: f.id || undefined, name: f.name.trim(), tpIdtEmpregador: Number(f.tpIdtEmpregador), idtEmpregador: f.idtEmpregador || null, caepf: f.caepf || null, cnae: f.cnae || null, tpRep: Number(f.tpRep), active: f.active }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao salvar", "error"); return; }
      setF(empty); dialog.toast("Empregador salvo ✅", "success"); load();
    } finally { setBusy(false); }
  }
  async function remove(e: any) {
    if (!(await dialog.confirm({ title: "Excluir empregador", message: `Excluir "${e.name}"?`, tone: "danger" }))) return;
    const res = await fetch(`/api/ponto/employers/${e.id}/delete`, { method: "POST", credentials: "include" });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.alert(d?.error?.message ?? "Não foi possível excluir"); return; }
    dialog.toast("Excluído", "success"); load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Empregadores (CNPJs)</h2>
        <p className="text-sm text-muted">Vários empregadores podem bater ponto na mesma matriz (ex.: terceirizadas). Cada funcionário pertence a um empregador; no fechamento dá pra ver tudo junto ou separar por empresa. Cada empregador é uma entidade legal própria (AFD/AEJ/A1 por CNPJ nas próximas fases).</p>
      </div>

      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-2 text-sm font-semibold">{f.id ? "Editar empregador" : "Novo empregador"}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm sm:col-span-2" placeholder="Razão social / nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <label className="text-xs text-muted">Tipo de identificação
            <select className="mt-1 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" value={f.tpIdtEmpregador} onChange={(e) => setF({ ...f, tpIdtEmpregador: e.target.value })}>
              <option value={1}>CNPJ</option><option value={2}>CPF</option><option value={3}>CAEPF</option>
            </select>
          </label>
          <input className="self-end rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" placeholder="CNPJ/CPF (só números)" value={f.idtEmpregador} onChange={(e) => setF({ ...f, idtEmpregador: e.target.value })} />
          <input className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" placeholder="CAEPF (opcional)" value={f.caepf} onChange={(e) => setF({ ...f, caepf: e.target.value })} />
          <input className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" placeholder="CNAE (opcional)" value={f.cnae} onChange={(e) => setF({ ...f, cnae: e.target.value })} />
          <label className="text-xs text-muted">Tipo de REP
            <select className="mt-1 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" value={f.tpRep} onChange={(e) => setF({ ...f, tpRep: e.target.value })}>
              <option value={3}>REP-P (programa)</option><option value={2}>REP-A (alternativo)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 rounded border-line" /> Ativo</label>
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{f.id ? "Salvar" : "Adicionar"}</button>
          {f.id && <button onClick={() => setF(empty)} className="rounded-lg border border-line px-3 py-2 text-sm text-muted">cancelar</button>}
        </div>
      </div>

      <div className="space-y-2">
        {items.map((e) => (
          <div key={e.id} className="rounded-xl border border-line bg-bg/40 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{e.name}</span>
                {e.isDefault && <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">padrão</span>}
                {!e.active && <span className="ml-2 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] text-zinc-300">inativo</span>}
                <span className="ml-2 text-xs text-muted">{e.idtEmpregador ? `${e.tpIdtEmpregador === 1 ? "CNPJ" : e.tpIdtEmpregador === 2 ? "CPF" : "CAEPF"} ${e.idtEmpregador}` : "sem documento"} · {e.employees} func.</span>
              </div>
              <span className="flex gap-2 text-xs">
                <button onClick={() => setF({ id: e.id, name: e.name, tpIdtEmpregador: e.tpIdtEmpregador, idtEmpregador: e.idtEmpregador ?? "", caepf: e.caepf ?? "", cnae: e.cnae ?? "", tpRep: e.tpRep, active: e.active })} className="rounded-md border border-line px-2 py-1 hover:border-brand">editar</button>
                {!e.isDefault && <button onClick={() => remove(e)} className="rounded-md border border-line px-2 py-1 text-red-300 hover:border-red-400">excluir</button>}
              </span>
            </div>
            {/* Certificado A1 (e-CNPJ) por empregador — assina espelho/holerite/AFD desta empresa */}
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/40 pt-2 text-xs">
              <span className="text-muted">Certificado A1:</span>
              {certs[e.id]?.configured
                ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${certs[e.id]?.expired ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}>{certs[e.id]?.expired ? "vencido" : "configurado"}{certs[e.id]?.subject ? ` · ${certs[e.id].subject}` : ""}</span>
                : <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] text-zinc-300">não configurado</span>}
              <label className="cursor-pointer rounded-md border border-line px-2 py-1 hover:border-brand">
                {certs[e.id]?.configured ? "trocar A1" : "enviar A1"}
                <input type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) uploadA1(e, file); ev.currentTarget.value = ""; }} disabled={busy} />
              </label>
              {certs[e.id]?.configured && <button onClick={() => removeA1(e)} className="rounded-md border border-line px-2 py-1 text-red-300 hover:border-red-400">remover A1</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrocasRh({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({}); // swapId -> attachmentUrl
  const [uploading, setUploading] = useState<string | null>(null);
  const load = () => fetch("/api/ponto/shift-swaps", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  async function upload(id: string, file: File) {
    setUploading(id);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "troca");
      const res = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const d = await res.json(); if (res.ok) setFiles((f) => ({ ...f, [id]: d.url }));
      else dialog.alert("Falha no upload do documento.");
    } finally { setUploading(null); }
  }
  async function rhApprove(id: string) {
    if (!(await dialog.confirm("Aprovar esta troca no lugar do líder? Sua aprovação fica registrada e assinada."))) return;
    setBusy(id);
    const res = await fetch(`/api/ponto/shift-swaps/${id}/rh-approve`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
    const d = await res.json().catch(() => ({})); setBusy(null);
    if (!res.ok) { dialog.alert(d?.message ?? "Erro ao aprovar."); return; }
    dialog.toast("Troca aprovada."); load();
  }
  async function apply(id: string) {
    const att = files[id] ?? null;
    if (!att && !(await dialog.confirm({ title: "Efetivar sem anexo?", message: "Nenhum documento foi anexado. Deseja efetivar a troca mesmo assim? A escala dos dois funcionários será atualizada na(s) data(s).", tone: "danger", confirmLabel: "Efetivar" }))) return;
    if (att && !(await dialog.confirm({ title: "Efetivar troca", message: "A escala dos dois funcionários será atualizada na(s) data(s) e o documento será anexado.", confirmLabel: "Efetivar" }))) return;
    setBusy(id);
    const res = await fetch(`/api/ponto/shift-swaps/${id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ attachmentUrl: att }) });
    const d = await res.json().catch(() => ({})); setBusy(null);
    if (!res.ok) { dialog.alert(d?.message ?? "Não foi possível efetivar."); return; }
    dialog.toast("Troca efetivada — escalas atualizadas."); load();
  }

  const typeLabel = (t: string) => (t === "folga" ? "Troca de folga" : "Troca de turno");
  const dot = (on: boolean, a1: boolean, label: string) => (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={on ? (a1 ? "Assinado (ICP-Brasil A1)" : "Assinado (eletrônico)") : "Pendente"}>
      <span className={`h-2 w-2 rounded-full ${on ? (a1 ? "bg-emerald-400" : "bg-amber-400") : "bg-zinc-600"}`} />{label}
    </span>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Trocas de turno / folga</h2>
        <p className="text-sm text-muted">Fluxo com tripla assinatura (solicitante → colega → líder). Quando não há líder direto, o RH aprova. Depois o RH anexa o documento e efetiva — a escala dos dois é trocada automaticamente na(s) data(s).</p>
      </div>
      {items.length === 0 ? <p className="text-sm text-muted">Nenhuma troca em andamento.</p> : (
        <div className="space-y-2">
          {items.map((s) => {
            const st = SWAP_ST[s.status] ?? { label: s.status, cls: "bg-zinc-500/15 text-zinc-300" };
            return (
              <div key={s.id} className="rounded-xl border border-line bg-bg/40 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><strong>{s.requesterName}</strong> ↔ <strong>{s.colleagueName}</strong> · {typeLabel(s.swapType)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                </div>
                <p className="mt-1 text-xs text-muted">Data: {swapBr(s.swapDate)}{s.counterpartDate ? ` · contrapartida ${swapBr(s.counterpartDate)}` : ""}{s.leaderName ? ` · líder ${s.leaderName}` : " · sem líder direto"}{s.reason ? ` · ${s.reason}` : ""}</p>
                {s.ruleWarnings?.length > 0 && <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-300">{s.ruleWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>}
                <div className="mt-2 flex flex-wrap gap-3">{dot(s.requesterSigned, s.requesterA1, "Solicitante")}{dot(s.colleagueSigned, s.colleagueA1, "Colega")}{dot(s.leaderSigned, s.leaderA1, s.approvedByRh ? "RH" : "Líder")}</div>
                {s.rejectReason && <p className="mt-1 text-[11px] text-red-300">Motivo da recusa ({s.rejectedBy}): {s.rejectReason}</p>}
                {s.rhAttachmentUrl && <p className="mt-1 text-xs"><a href={s.rhAttachmentUrl} target="_blank" rel="noreferrer" className="text-brand underline">documento anexado</a>{s.appliedAt ? ` · efetivada` : ""}</p>}

                {s.needsRhApproval && (
                  <button disabled={busy === s.id} onClick={() => rhApprove(s.id)} className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Aprovar (sem líder direto)</button>
                )}
                {s.readyToApply && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">
                      {uploading === s.id ? "Enviando…" : files[s.id] ? "Documento anexado ✓" : "Anexar documento"}
                      <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(s.id, f); }} />
                    </label>
                    <button disabled={busy === s.id} onClick={() => apply(s.id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Efetivar troca</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Escalas({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const empty = { id: "", code: "", name: "", kind: "fixa", toleranceMin: 10, nightStart: "22:00", nightEnd: "05:00", holidayPolicy: "folga", holidayPay: "normal", days: WD.map(() => ["", "", "", ""]) as string[][], anchor: "", anchorEnt: "07:00", anchorSai: "19:00", onDays: 1, offDays: 1, dailyHours: "8" };
  const [f, setF] = useState<any>(empty);
  const load = () => fetch("/api/ponto/schedules", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function save() {
    if (!f.code.trim() || !f.name.trim()) { dialog.toast("Código e nome obrigatórios", "error"); return; }
    let pattern: any = {};
    if (f.kind === "12x36") pattern = { anchor: f.anchor, segments: f.anchorEnt && f.anchorSai ? [[f.anchorEnt, f.anchorSai]] : [] };
    else if (f.kind === "plantao") pattern = { anchor: f.anchor, onDays: Number(f.onDays) || 1, offDays: Number(f.offDays) || 0, segments: f.anchorEnt && f.anchorSai ? [[f.anchorEnt, f.anchorSai]] : [] };
    else if (f.kind === "home_office") pattern = { dailyMinutes: Math.round(parseFloat((f.dailyHours || "8").replace(",", ".")) * 60), days: [1, 2, 3, 4, 5] };
    else if (f.kind === "intermitente") pattern = {};
    else f.days.forEach((row: string[], wd: number) => {
      const segs: string[][] = [];
      if (row[0] && row[1]) segs.push([row[0], row[1]]);
      if (row[2] && row[3]) segs.push([row[2], row[3]]);
      if (segs.length) pattern[String(wd)] = segs;
    });
    const body: any = { code: f.code, name: f.name, kind: f.kind, toleranceMin: Number(f.toleranceMin), nightStart: f.nightStart, nightEnd: f.nightEnd, holidayPolicy: f.holidayPolicy, holidayPay: f.holidayPay, pattern };
    if (f.id) body.id = f.id;
    const res = await fetch("/api/ponto/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    setF(empty); load(); dialog.toast(f.id ? "Escala atualizada ✅" : "Escala salva ✅", "success");
  }
  function editar(s: any) {
    const p = s.pattern ?? {};
    const days = WD.map((_, wd) => { const segs = p[String(wd)] ?? []; return [segs[0]?.[0] ?? "", segs[0]?.[1] ?? "", segs[1]?.[0] ?? "", segs[1]?.[1] ?? ""]; });
    setF({
      id: s.id, code: s.code, name: s.name, kind: s.kind, toleranceMin: s.toleranceMin, nightStart: s.nightStart, nightEnd: s.nightEnd, holidayPolicy: s.holidayPolicy ?? "folga", holidayPay: s.holidayPay ?? "normal", days,
      anchor: p.anchor ?? "", anchorEnt: p.segments?.[0]?.[0] ?? "07:00", anchorSai: p.segments?.[0]?.[1] ?? "19:00",
      onDays: p.onDays ?? 1, offDays: p.offDays ?? 1, dailyHours: p.dailyMinutes ? String(p.dailyMinutes / 60) : "8",
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function toggleActive(s: any) {
    const res = await fetch("/api/ponto/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ id: s.id, code: s.code, name: s.name, kind: s.kind, toleranceMin: s.toleranceMin, nightStart: s.nightStart, nightEnd: s.nightEnd, pattern: s.pattern ?? {}, active: !s.active }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    load(); dialog.toast(s.active ? "Escala desativada" : "Escala reativada", "success");
  }
  const setDay = (wd: number, i: number, v: string) => setF((s: any) => { const days = s.days.map((r: string[]) => [...r]); days[wd][i] = v; return { ...s, days }; });
  return (
    <section>
      <div className="mb-4 rounded-xl border border-line bg-bg/60 p-5">
        <p className="mb-3 text-sm font-semibold">{f.id ? `Editar escala ${f.code}` : "Nova escala"}{f.id && <button onClick={() => setF(empty)} className="ml-2 text-xs text-muted hover:text-fg">(cancelar edição)</button>}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="Código (casa com o do funcionário)" v={f.code} on={(v) => setF((s: any) => ({ ...s, code: v }))} />
          <Inp label="Nome" v={f.name} on={(v) => setF((s: any) => ({ ...s, name: v }))} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
            <select value={f.kind} onChange={(e) => setF((s: any) => ({ ...s, kind: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"><option value="fixa">Fixa (semanal)</option><option value="12x36">12x36</option><option value="plantao">Plantão (ciclo)</option><option value="home_office">Home office (flexível)</option><option value="intermitente">Intermitente</option></select></label>
          <Inp label="Tolerância (min)" v={String(f.toleranceMin)} on={(v) => setF((s: any) => ({ ...s, toleranceMin: v }))} />
          <Inp label="Início noturno" v={f.nightStart} on={(v) => setF((s: any) => ({ ...s, nightStart: v }))} />
          <Inp label="Fim noturno" v={f.nightEnd} on={(v) => setF((s: any) => ({ ...s, nightEnd: v }))} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Feriado</span>
            <select value={f.holidayPolicy} onChange={(e) => setF((s: any) => ({ ...s, holidayPolicy: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"><option value="folga">Folga (não trabalha)</option><option value="trabalha">Trabalha</option><option value="alterna">Alterna (1 sim / 1 não)</option></select></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Pagamento do feriado trabalhado</span>
            <select value={f.holidayPay} onChange={(e) => setF((s: any) => ({ ...s, holidayPay: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm"><option value="normal">Como dia normal</option><option value="dobro">Em dobro (CLT)</option><option value="folga_comp">Folga compensatória</option></select></label>
        </div>
        {f.kind === "fixa" ? (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] uppercase text-muted">Horário por dia (ent1/saí1 · ent2/saí2 — deixe em branco na folga)</p>
            {WD.map((w, wd) => (
              <div key={wd} className="flex items-center gap-2 text-sm">
                <span className="w-10 text-muted">{w}</span>
                {[0, 1, 2, 3].map((i) => (
                  <input key={i} type="time" value={f.days[wd][i]} onChange={(e) => setDay(wd, i, e.target.value)} className="rounded border border-line bg-bg/40 px-2 py-1 text-xs" />
                ))}
              </div>
            ))}
          </div>
        ) : f.kind === "home_office" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Inp label="Horas/dia (alvo, seg–sex)" v={String(f.dailyHours)} on={(v) => setF((s: any) => ({ ...s, dailyHours: v }))} />
            <p className="sm:col-span-2 self-end text-[11px] text-muted">Flexível: sem horário fixo de entrada/saída — conta as horas trabalhadas contra o alvo do dia (sem atraso/saída antecipada).</p>
          </div>
        ) : f.kind === "intermitente" ? (
          <p className="mt-3 text-[11px] text-muted">Intermitente: sem jornada fixa. Conta só o que for batido (não gera falta). Use o banco de horas para ajustes.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Âncora (1º dia de trabalho)</span><input type="date" value={f.anchor} onChange={(e) => setF((s: any) => ({ ...s, anchor: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Entrada</span><input type="time" value={f.anchorEnt} onChange={(e) => setF((s: any) => ({ ...s, anchorEnt: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Saída</span><input type="time" value={f.anchorSai} onChange={(e) => setF((s: any) => ({ ...s, anchorSai: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
            {f.kind === "plantao" && <><Inp label="Dias trabalhados (ciclo)" v={String(f.onDays)} on={(v) => setF((s: any) => ({ ...s, onDays: v }))} /><Inp label="Dias de folga (ciclo)" v={String(f.offDays)} on={(v) => setF((s: any) => ({ ...s, offDays: v }))} /></>}
          </div>
        )}
        <button onClick={save} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{f.id ? "Atualizar escala" : "Salvar escala"}</button>
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
            <span className={s.active ? "" : "opacity-60"}><b>{s.code}</b> — {s.name} <span className="text-xs text-muted">{s.kind} · tol {s.toleranceMin}min</span>{!s.active && <span className="ml-2 text-[10px] text-muted">inativa</span>}</span>
            <span className="flex items-center gap-3 text-xs">
              <button onClick={() => editar(s)} className="text-brand hover:underline">editar</button>
              <button onClick={() => toggleActive(s)} className="text-muted hover:text-fg">{s.active ? "desativar" : "reativar"}</button>
            </span>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhuma escala cadastrada.</p>}
      </div>

      <AtribuirEscala schedules={items} dialog={dialog} />
      <Feriados dialog={dialog} />
    </section>
  );
}

function AtribuirEscala({ schedules, dialog }: { schedules: any[]; dialog: any }) {
  const [emps, setEmps] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [storeId, setStoreId] = useState("");
  const [cargo, setCargo] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [code, setCode] = useState("");
  const load = () => {
    fetch("/api/ponto/employees", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setEmps(d?.items ?? [])).catch(() => {});
    fetch("/api/stores", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setStores(d?.items ?? d ?? [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const cargos = [...new Set(emps.map((e) => e.cargo).filter(Boolean))].sort();
  const filtered = emps.filter((e) => e.active && (!storeId || e.storeId === storeId) && (!cargo || e.cargo === cargo) && (!q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase())));
  const selIds = Object.keys(sel).filter((k) => sel[k]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => sel[e.id]);
  function toggleAll() { setSel((s) => { const n = { ...s }; const v = !allVisibleSelected; filtered.forEach((e) => { n[e.id] = v; }); return n; }); }
  async function apply() {
    if (!selIds.length) { dialog.toast("Selecione ao menos um funcionário", "error"); return; }
    const res = await fetch("/api/ponto/schedules/assign", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ scheduleCode: code, employeeIds: selIds }) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    dialog.toast(`Escala aplicada a ${d?.updated ?? selIds.length} funcionário(s) ✅`, "success");
    setSel({}); load();
  }
  return (
    <div className="mt-6 rounded-xl border border-line bg-bg/60 p-5">
      <p className="mb-1 text-sm font-semibold">Aplicar escala em massa</p>
      <p className="mb-3 text-[11px] text-muted">Filtre por loja/cargo, marque os funcionários e aplique a mesma escala a todos. "Sem escala" remove o vínculo.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Escala</span>
          <select value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
            <option value="">— sem escala (remover) —</option>
            {schedules.filter((s) => s.active).map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Loja</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
            <option value="">todas</option>
            {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Cargo</span>
          <select value={cargo} onChange={(e) => setCargo(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
            <option value="">todos</option>
            {cargos.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Buscar nome</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line/60">
        <div className="flex items-center justify-between border-b border-line/60 bg-bg/40 px-3 py-2 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} /> selecionar todos ({filtered.length})</label>
          <span className="text-muted">{selIds.length} selecionado(s)</span>
        </div>
        {filtered.map((e) => (
          <label key={e.id} className="flex items-center gap-2 border-b border-line/40 px-3 py-1.5 text-sm last:border-0">
            <input type="checkbox" checked={!!sel[e.id]} onChange={(ev) => setSel((s) => ({ ...s, [e.id]: ev.target.checked }))} />
            <span className="flex-1">{e.name}</span>
            <span className="text-[11px] text-muted">{e.cargo ?? ""}{e.scheduleCode ? ` · escala ${e.scheduleCode}` : " · sem escala"}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="px-3 py-3 text-sm text-muted">Nenhum funcionário no filtro.</p>}
      </div>
      <button onClick={apply} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Aplicar a {selIds.length} funcionário(s)</button>
    </div>
  );
}

function Feriados({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ day: "", name: "", recurring: false });
  const load = () => fetch("/api/ponto/holidays", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function add() {
    if (!f.day || !f.name.trim()) { dialog.toast("Data e nome obrigatórios", "error"); return; }
    const res = await fetch("/api/ponto/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(f) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    setF({ day: "", name: "", recurring: false }); load(); dialog.toast("Feriado salvo ✅", "success");
  }
  async function remove(id: string) { await fetch(`/api/ponto/holidays/${id}/delete`, { method: "POST", credentials: "include" }); load(); }
  return (
    <div className="mt-6 rounded-xl border border-line bg-bg/60 p-5">
      <p className="mb-1 text-sm font-semibold">Feriados</p>
      <p className="mb-3 text-[11px] text-muted">No espelho, o feriado vira folga: não gera falta e o que for trabalhado no dia conta como hora extra. Recorrente repete todo ano na mesma data.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Data</span><input type="date" value={f.day} onChange={(e) => setF((s) => ({ ...s, day: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
        <label className="block flex-1 min-w-[180px]"><span className="mb-1 block text-[10px] uppercase text-muted">Nome</span><input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="ex.: Natal, Aniversário da cidade" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.recurring} onChange={(e) => setF((s) => ({ ...s, recurring: e.target.checked }))} /> repete todo ano</label>
        <button onClick={add} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Adicionar</button>
      </div>
      <div className="mt-3 space-y-1">
        {items.map((h) => (
          <div key={h.id} className="flex items-center justify-between rounded-lg border border-line/60 bg-bg/40 px-3 py-2 text-sm">
            <span>{new Date(h.day).toLocaleDateString("pt-BR", { timeZone: "UTC" })} — {h.name}{h.recurring && <span className="ml-2 text-[10px] uppercase text-muted">anual</span>}</span>
            <button onClick={() => remove(h.id)} className="text-xs text-muted hover:text-red-300">remover</button>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhum feriado cadastrado.</p>}
      </div>
    </div>
  );
}

function Dispositivos({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [employers, setEmployers] = useState<any[]>([]);
  const empty = { id: "", name: "", code: "", storeId: "", employerId: "", rustdeskId: "", rustdeskPass: "", notes: "", geoLat: "", geoLng: "", geoRadiusM: 150, requireGeo: false, requireSelfie: false };
  const [f, setF] = useState<any>({ ...empty });
  const [newLink, setNewLink] = useState<string | null>(null);
  const [punchesOf, setPunchesOf] = useState<{ id: string; items: any[] } | null>(null);
  const [emps, setEmps] = useState<Emp[]>([]);
  const load = () => fetch("/api/ponto/devices", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  async function verBatidas(id: string) {
    if (punchesOf?.id === id) { setPunchesOf(null); return; }
    const r = await fetch(`/api/ponto/devices/${id}/punches`, { credentials: "include" }); const j = await r.json().catch(() => null);
    setPunchesOf({ id, items: j?.items ?? [] });
  }
  useEffect(() => {
    load();
    fetch("/api/stores", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setStores(d?.items ?? d ?? [])).catch(() => {});
    fetch("/api/ponto/employers", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setEmployers(d?.items ?? [])).catch(() => {});
    fetch("/api/ponto/employees", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setEmps(d?.items ?? [])).catch(() => {});
  }, []);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "—";
  const empName = (id: string) => employers.find((e) => e.id === id)?.name ?? "—";
  const restritos = emps.filter((e) => e.active && (e.allowedDeviceIds?.length ?? 0) > 0);
  const semRestricao = emps.filter((e) => e.active && (e.allowedDeviceIds?.length ?? 0) === 0).length;
  const quemPodeBater = (deviceId: string) => {
    const libs = restritos.filter((e) => e.allowedDeviceIds!.includes(deviceId)).map((e) => e.name);
    const extras: string[] = [];
    if (semRestricao > 0) extras.push(`+${semRestricao} sem restrição`);
    return [libs.length ? libs.join(", ") : null, extras.join(" · ") || null].filter(Boolean).join(" · ") || "ninguém liberado";
  };
  async function save() {
    if (!f.name.trim()) { dialog.toast("Informe um nome", "error"); return; }
    const body: any = { name: f.name, code: f.code || undefined, storeId: f.storeId || null, employerId: f.employerId || null, rustdeskId: f.rustdeskId || null, notes: f.notes || null, requireGeo: f.requireGeo, requireSelfie: f.requireSelfie, geoRadiusM: Number(f.geoRadiusM) || 150 };
    if (f.rustdeskPass) body.rustdeskPass = f.rustdeskPass;
    if (f.geoLat && f.geoLng) { body.geoLat = Number(f.geoLat); body.geoLng = Number(f.geoLng); }
    const url = f.id ? `/api/ponto/devices/${f.id}` : "/api/ponto/devices";
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    if (!res.ok) { dialog.toast("Falha ao salvar", "error"); return; }
    if (!f.id && d?.token) setNewLink(`${window.location.origin}/ponto-app?d=${d.token}`);
    else { setNewLink(null); dialog.toast("Terminal atualizado ✅", "success"); }
    setF({ ...empty }); load();
  }
  function editar(d: any) { setNewLink(null); setF({ id: d.id, name: d.name, code: d.code ?? "", storeId: d.storeId ?? "", employerId: d.employerId ?? "", rustdeskId: d.rustdeskId ?? "", rustdeskPass: "", notes: d.notes ?? "", geoLat: d.geoLat ?? "", geoLng: d.geoLng ?? "", geoRadiusM: d.geoRadiusM ?? 150, requireGeo: !!d.requireGeo, requireSelfie: !!d.requireSelfie }); }
  async function toggleRevoke(id: string, revoked: boolean) {
    const res = await fetch(`/api/ponto/devices/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ revoked: !revoked }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast(revoked ? "Reativado" : "Revogado", "success"); load();
  }
  async function conectar(d: any) {
    const r = await fetch(`/api/ponto/devices/${d.id}/rustdesk`, { credentials: "include" }); const j = await r.json().catch(() => null);
    if (!j?.rustdeskId) { dialog.toast("Sem RustDesk ID cadastrado neste terminal", "error"); return; }
    navigator.clipboard?.writeText(j.password ? `${j.rustdeskId} / ${j.password}` : j.rustdeskId);
    dialog.toast(`RustDesk ${j.rustdeskId}${j.password ? " (id+senha copiados)" : " (id copiado)"}`, "success");
    try { window.open(`rustdesk://${j.rustdeskId}`, "_blank"); } catch { /* protocolo pode não estar registrado */ }
  }
  function usarMinhaLocalizacao() {
    navigator.geolocation?.getCurrentPosition((p) => setF((s: any) => ({ ...s, geoLat: p.coords.latitude.toFixed(6), geoLng: p.coords.longitude.toFixed(6) })), () => dialog.toast("Não consegui obter a localização", "error"));
  }
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Terminais de ponto (REP)</p>
        <a href="/api/ponto/devices-report" target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Relatório (PDF) p/ fiscalização</a>
      </div>
      <div className="mb-4 rounded-xl border border-line bg-bg/60 p-5">
        <p className="mb-1 text-sm font-semibold">{f.id ? "Editar terminal" : "Novo terminal (tablet/celular no balcão)"}</p>
        <p className="mb-3 text-[11px] text-muted">Cada terminal tem um código único, vínculo de loja/CNPJ e (opcional) o RustDesk pra suporte remoto. O link com token abre o kiosk; o funcionário bate por PIN/rosto, sem login.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="Nome (ex.: Balcão Caixa 1)" v={f.name} on={(v) => setF((s: any) => ({ ...s, name: v }))} />
          <Inp label="Código (vazio = automático)" v={f.code} on={(v) => setF((s: any) => ({ ...s, code: v }))} />
          <label className="text-sm"><span className="mb-1 block text-[10px] uppercase text-muted">Loja</span>
            <select value={f.storeId} onChange={(e) => setF((s: any) => ({ ...s, storeId: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm"><option value="">—</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          {employers.length > 0 && <label className="text-sm"><span className="mb-1 block text-[10px] uppercase text-muted">Empregador (CNPJ)</span>
            <select value={f.employerId} onChange={(e) => setF((s: any) => ({ ...s, employerId: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm"><option value="">—</option>{employers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          </label>}
          <Inp label="RustDesk ID" v={f.rustdeskId} on={(v) => setF((s: any) => ({ ...s, rustdeskId: v }))} />
          <Inp label={f.id ? "RustDesk senha (vazio = manter)" : "RustDesk senha (fixa)"} v={f.rustdeskPass} on={(v) => setF((s: any) => ({ ...s, rustdeskPass: v }))} />
          <Inp label="Latitude da filial" v={String(f.geoLat)} on={(v) => setF((s: any) => ({ ...s, geoLat: v }))} />
          <Inp label="Longitude da filial" v={String(f.geoLng)} on={(v) => setF((s: any) => ({ ...s, geoLng: v }))} />
          <Inp label="Raio permitido (m)" v={String(f.geoRadiusM)} on={(v) => setF((s: any) => ({ ...s, geoRadiusM: v }))} />
          <Inp label="Observação (local físico)" v={f.notes} on={(v) => setF((s: any) => ({ ...s, notes: v }))} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requireGeo} onChange={(e) => setF((s: any) => ({ ...s, requireGeo: e.target.checked }))} /> Exigir GPS no raio</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requireSelfie} onChange={(e) => setF((s: any) => ({ ...s, requireSelfie: e.target.checked }))} /> Exigir selfie</label>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={usarMinhaLocalizacao} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Usar minha localização</button>
          <button onClick={save} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">{f.id ? "Salvar terminal" : "Gerar terminal"}</button>
          {f.id && <button onClick={() => setF({ ...empty })} className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-fg">cancelar</button>}
        </div>
        {newLink && (
          <div className="mt-3 rounded-xl border border-green-500/40 bg-green-500/10 p-3 text-sm">
            <p className="font-semibold text-green-200">Link do terminal (mostrado só agora):</p>
            <p className="mt-1 break-all font-mono text-xs">{newLink}</p>
            <button onClick={() => { navigator.clipboard?.writeText(newLink); dialog.toast("Link copiado", "success"); }} className="mt-2 rounded border border-line px-2 py-1 text-xs">Copiar link</button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {items.map((d) => (
          <div key={d.id} className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span title={d.revoked ? "revogado" : d.online ? "online" : "offline"}>{d.revoked ? "🚫" : d.online ? "🟢" : "⚪"}</span>
                {d.code && <span className="ml-1 font-mono text-xs text-brand">{d.code}</span>}
                <span className="ml-1 font-medium">{d.name}</span>
                <div className="text-[11px] text-muted">{[d.storeId ? storeName(d.storeId) : null, d.employerId ? empName(d.employerId) : null, d.rustdeskId ? `RustDesk ${d.rustdeskId}` : null, d.lastSeenAt ? `visto ${new Date(d.lastSeenAt).toLocaleString("pt-BR")}` : "nunca usado", d.appVersion ? `v${d.appVersion}` : null].filter(Boolean).join(" · ")}</div>
                <div className="mt-0.5 text-[11px] text-muted">👤 Quem pode bater: {quemPodeBater(d.id)}</div>
              </div>
              <span className="flex shrink-0 gap-2 text-xs">
                <button onClick={() => verBatidas(d.id)} className="rounded border border-line px-2 py-0.5 hover:border-brand">{punchesOf?.id === d.id ? "Ocultar" : "Batidas"}</button>
                {d.rustdeskId && <button onClick={() => conectar(d)} className="rounded border border-line px-2 py-0.5 hover:border-brand">Conectar</button>}
                <button onClick={() => editar(d)} className="rounded border border-line px-2 py-0.5 hover:border-brand">Editar</button>
                <button onClick={() => toggleRevoke(d.id, d.revoked)} className={`rounded border px-2 py-0.5 ${d.revoked ? "border-green-500/50 text-green-300" : "border-red-500/50 text-red-300"}`}>{d.revoked ? "Reativar" : "Revogar"}</button>
              </span>
            </div>
            {punchesOf?.id === d.id && (
              <div className="mt-2 rounded-lg border border-line/60 bg-bg/40 p-2">
                <p className="mb-1 text-[10px] uppercase text-muted">Últimas batidas neste terminal (visível só aqui no RH)</p>
                {(punchesOf?.items ?? []).length === 0 ? <p className="text-xs text-muted">Sem batidas.</p> : (
                  <ul className="space-y-0.5 text-xs">
                    {(punchesOf?.items ?? []).map((p) => <li key={p.id} className={p.voided ? "text-muted line-through" : ""}>{new Date(p.at).toLocaleString("pt-BR")} — {p.name}{p.voided ? " (anulada)" : ""}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhum terminal cadastrado.</p>}
      </div>
    </section>
  );
}

function Avisos({ emps, dialog }: { emps: Emp[]; dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState<{ employeeId: string; message: string; until: string }>({ employeeId: "", message: "", until: "" });
  const nameOf = (id: string | null) => (id ? emps.find((e) => e.id === id)?.name ?? "funcionário" : "Geral (todos)");
  const load = () => fetch("/api/ponto/notices", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function create() {
    if (!f.message.trim()) { dialog.toast("Escreva a mensagem", "error"); return; }
    const res = await fetch("/api/ponto/notices", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: f.employeeId || null, message: f.message, until: f.until || undefined }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    setF({ employeeId: "", message: "", until: "" }); load(); dialog.toast("Aviso criado ✅", "success");
  }
  async function del(id: string) {
    const res = await fetch(`/api/ponto/notices/${id}/delete`, { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    load();
  }
  return (
    <section>
      <div className="mb-4 rounded-xl border border-line bg-bg/60 p-5">
        <p className="mb-1 text-sm font-semibold">Novo aviso ao bater o ponto</p>
        <p className="mb-3 text-[11px] text-muted">Aparece no painel quando o funcionário registra o ponto. Escolha um funcionário específico ou deixe "Geral" para todos.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Destinatário</span>
            <select value={f.employeeId} onChange={(e) => setF((s) => ({ ...s, employeeId: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
              <option value="">Geral (todos)</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Exibir até (opcional)</span><input type="date" value={f.until} onChange={(e) => setF((s) => ({ ...s, until: e.target.value }))} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
        </div>
        <textarea value={f.message} onChange={(e) => setF((s) => ({ ...s, message: e.target.value }))} rows={2} placeholder="Mensagem do aviso" className="mt-3 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        <button onClick={create} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Publicar aviso</button>
      </div>
      <div className="space-y-2">
        {items.filter((n) => n.active).map((n) => (
          <div key={n.id} className="flex items-start justify-between rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
            <div><span className="text-xs font-semibold text-brand">{nameOf(n.employeeId)}</span><p>{n.message}</p>{n.until && <span className="text-[10px] text-muted">até {new Date(n.until).toLocaleDateString("pt-BR")}</span>}</div>
            <button onClick={() => del(n.id)} className="rounded border border-red-500/50 px-2 py-0.5 text-xs text-red-300">Remover</button>
          </div>
        ))}
        {items.filter((n) => n.active).length === 0 && <p className="text-sm text-muted">Nenhum aviso ativo.</p>}
      </div>
    </section>
  );
}

function TempoReal({ dialog }: { dialog: any }) {
  const [rt, setRt] = useState<any>(null);
  const [abs, setAbs] = useState<any>(null);
  const ref = new Date().toISOString().slice(0, 7);
  useEffect(() => {
    const load = () => fetch("/api/ponto/realtime", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setRt).catch(() => {});
    load(); const t = setInterval(load, 15000); return () => clearInterval(t);
  }, []);
  async function carregarIa() {
    setAbs({ loading: true });
    const d = await fetch(`/api/ponto/absenteismo/${ref}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setAbs(d ?? { loading: false });
  }
  return (
    <section>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Kpi title="Trabalhando agora" value={String(rt?.presentCount ?? "—")} tone="green" />
        <Kpi title="Funcionários ativos" value={String(rt?.totalActive ?? "—")} />
        <Kpi title="Sem marcação hoje" value={String(rt?.absentCount ?? "—")} tone="amber" />
        <Kpi title="Atualiza a cada" value="15s" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <p className="mb-2 text-sm font-semibold">Trabalhando agora ({rt?.present?.length ?? 0})</p>
          {(rt?.present ?? []).length === 0 ? <p className="text-sm text-muted">Ninguém com ponto aberto.</p> : (
            <ul className="space-y-1 text-sm">{rt.present.map((p: any) => <li key={p.id} className="flex justify-between"><span>🟢 {p.name}</span><span className="text-muted">desde {new Date(p.since).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
          )}
        </div>
        <div className="rounded-xl border border-line bg-bg/60 p-4">
          <p className="mb-2 text-sm font-semibold">Últimas marcações</p>
          {(rt?.lastPunches ?? []).length === 0 ? <p className="text-sm text-muted">Sem marcações hoje.</p> : (
            <ul className="space-y-1 text-sm">{rt.lastPunches.map((p: any, i: number) => <li key={i} className="flex justify-between"><span>{p.name} <span className="text-[10px] text-muted">{p.origin}</span></span><span className="text-muted">{new Date(p.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">IA de absenteísmo — {ref}</p>
          <button onClick={carregarIa} className="rounded-lg border border-line px-3 py-1 text-sm hover:border-brand">Analisar com IA</button>
        </div>
        {abs?.loading && <p className="mt-2 text-sm text-muted">Analisando…</p>}
        {abs?.insight && <p className="mt-2 text-sm leading-relaxed">{abs.insight}</p>}
        {abs && !abs.loading && !abs.insight && <p className="mt-2 text-sm text-muted">{abs.ranked?.length ? "IA indisponível — mostrando ranking abaixo." : "Sem dados no mês."}</p>}
        {abs?.ranked?.length > 0 && (
          <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            {abs.ranked.slice(0, 8).map((r: any, i: number) => <div key={i} className="flex justify-between rounded border border-line bg-bg/40 px-2 py-1"><span>{r.name}</span><span className="text-muted">{hmMin(r.faltaMin)} falta · {r.lateMin}min atraso</span></div>)}
          </div>
        )}
      </div>
    </section>
  );
}

function Kpi({ title, value, tone }: { title: string; value: string; tone?: "green" | "amber" }) {
  const c = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : "";
  return <div className="rounded-xl border border-line bg-bg/60 p-4"><p className="text-[10px] uppercase tracking-wider text-muted">{title}</p><p className={`mt-1 text-2xl font-semibold ${c}`}>{value}</p></div>;
}

function hmMin(min: number) { const s = min < 0 ? "-" : ""; const a = Math.abs(min); return `${s}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`; }

function Banco({ emps, dialog }: { emps: Emp[]; dialog: any }) {
  const [empId, setEmpId] = useState("");
  const [data, setData] = useState<any>(null);
  const [f, setF] = useState({ day: new Date().toISOString().slice(0, 10), hours: "", reason: "" });
  const load = () => { if (!empId) { setData(null); return; } fetch(`/api/ponto/banco?employeeId=${empId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}); };
  useEffect(() => { load(); }, [empId]);
  async function add() {
    const minutes = Math.round(parseFloat((f.hours || "0").replace(",", ".")) * 60);
    if (!empId || !f.day || !minutes) { dialog.toast("Escolha funcionário, data e horas (ex.: 1.5 ou -2)", "error"); return; }
    const res = await fetch("/api/ponto/banco", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, day: f.day, minutes, reason: f.reason }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    setF({ day: f.day, hours: "", reason: "" }); load(); dialog.toast("Lançamento adicionado ✅", "success");
  }
  async function del(id: string) { const res = await fetch(`/api/ponto/banco/${id}/delete`, { method: "POST", credentials: "include" }); if (res.ok) load(); }
  async function expirar() {
    if (!empId) return;
    const ok = await dialog.confirm(`Lançar baixa por vencimento de ${hmMin(data?.expiringMin ?? 0)}? (créditos com mais de ${data?.expiryMonths ?? 6} meses)`);
    if (!ok) return;
    const res = await fetch("/api/ponto/banco/expirar", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId }) });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    dialog.toast("Baixa por vencimento lançada ✅", "success"); load();
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <option value="">Selecione o funcionário</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {data && <span className={`rounded-full px-3 py-1 text-sm font-semibold ${data.balanceMin >= 0 ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>Saldo: {hmMin(data.balanceMin)}</span>}
        {data && data.expiringMin > 0 && <><span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-200" title={`créditos anteriores a ${data.cutoff}`}>A vencer: {hmMin(data.expiringMin)}</span><button onClick={expirar} className="rounded-lg border border-line px-3 py-1 text-xs hover:border-brand">lançar baixa</button></>}
      </div>
      {empId && (
        <div className="mb-4 rounded-xl border border-line bg-bg/60 p-4">
          <p className="mb-2 text-sm font-semibold">Lançar no banco de horas</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Inp label="Data" v={f.day} on={(v) => setF((s) => ({ ...s, day: v }))} />
            <Inp label="Horas (+créd / −débito)" v={f.hours} on={(v) => setF((s) => ({ ...s, hours: v }))} />
            <div className="sm:col-span-2"><Inp label="Motivo" v={f.reason} on={(v) => setF((s) => ({ ...s, reason: v }))} /></div>
          </div>
          <p className="mt-1 text-[11px] text-muted">Ex.: <b>1.5</b> = +1h30 (crédito); <b>-2</b> = compensou 2h (débito).</p>
          <button onClick={add} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Adicionar</button>
        </div>
      )}
      {data?.items?.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="table-cards w-full text-sm">
            <thead className="bg-bg/40 text-left text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">Data</th><th className="px-3 py-2">Horas</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Motivo</th><th></th></tr></thead>
            <tbody>
              {data.items.map((m: any) => (
                <tr key={m.id} className="border-t border-line/60">
                  <td className="px-3 py-2">{new Date(m.day).toLocaleDateString("pt-BR")}</td>
                  <td className={`px-3 py-2 ${m.minutes >= 0 ? "text-green-300" : "text-red-300"}`}>{hmMin(m.minutes)}</td>
                  <td className="px-3 py-2 text-muted">{m.kind}</td>
                  <td className="px-3 py-2 text-muted">{m.reason ?? ""}</td>
                  <td className="px-3 py-2 text-right"><button onClick={() => del(m.id)} className="text-xs text-red-300">remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Ferias({ emps, dialog }: { emps: Emp[]; dialog: any }) {
  const [empId, setEmpId] = useState("");
  const [bal, setBal] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ startDate: new Date().toISOString().slice(0, 10), days: "30", thirteenthAdvance: false, notes: "" });
  const load = () => {
    if (!empId) { setBal(null); setItems([]); return; }
    fetch(`/api/ponto/ferias/saldo?employeeId=${empId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setBal).catch(() => {});
    fetch(`/api/ponto/ferias?employeeId=${empId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  };
  useEffect(() => { load(); }, [empId]);
  async function add() {
    const days = Math.max(1, Math.min(30, parseInt(f.days || "30", 10) || 30));
    if (!empId || !f.startDate) { dialog.toast("Escolha o funcionário e o início", "error"); return; }
    const res = await fetch("/api/ponto/ferias", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, startDate: f.startDate, days, thirteenthAdvance: f.thirteenthAdvance, notes: f.notes }) });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    setF({ ...f, notes: "" }); load(); dialog.toast("Férias agendadas ✅", "success");
  }
  async function setStatus(id: string, status: string) { const res = await fetch(`/api/ponto/ferias/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) }); if (res.ok) load(); }
  async function del(id: string) { const ok = await dialog.confirm("Excluir este registro de férias?"); if (!ok) return; const res = await fetch(`/api/ponto/ferias/${id}/delete`, { method: "POST", credentials: "include" }); if (res.ok) load(); }
  const STATUS: Record<string, { l: string; c: string }> = { scheduled: { l: "agendada", c: "bg-amber-500/15 text-amber-200" }, taken: { l: "gozada", c: "bg-green-500/15 text-green-300" }, canceled: { l: "cancelada", c: "bg-line text-muted" } };
  const endOf = (s: string, d: number) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + d - 1); return x.toLocaleDateString("pt-BR", { timeZone: "UTC" }); };
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <option value="">Selecione o funcionário</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {bal && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-bg/60 p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Saldo de férias</p><p className={`mt-1 text-xl font-semibold ${bal.balanceDays != null && bal.balanceDays < 0 ? "text-red-300" : "text-green-300"}`}>{bal.balanceDays != null ? `${bal.balanceDays} dias` : "—"}</p></div>
          <div className="rounded-xl border border-line bg-bg/60 p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Direito acumulado</p><p className="mt-1 text-xl font-semibold">{bal.accruedDays != null ? `${bal.accruedDays} dias` : "—"}</p><p className="mt-0.5 text-[11px] text-muted">{bal.completedPeriods} período(s)</p></div>
          <div className="rounded-xl border border-line bg-bg/60 p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Já agendado/gozado</p><p className="mt-1 text-xl font-semibold">{bal.usedDays} dias</p></div>
          <div className="rounded-xl border border-line bg-bg/60 p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Próx. período vence</p><p className="mt-1 text-sm font-semibold">{bal.nextPeriodStart ? new Date(bal.nextPeriodStart).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"}</p>{!bal.admissionDate && <p className="mt-0.5 text-[11px] text-muted">sem admissão no cadastro</p>}</div>
        </div>
      )}
      {empId && (
        <div className="mb-4 rounded-xl border border-line bg-bg/60 p-4">
          <p className="mb-2 text-sm font-semibold">Agendar férias</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Inp label="Início" v={f.startDate} on={(v) => setF((s) => ({ ...s, startDate: v }))} />
            <Inp label="Dias (1–30)" v={f.days} on={(v) => setF((s) => ({ ...s, days: v }))} />
            <div className="sm:col-span-2"><Inp label="Observação" v={f.notes} on={(v) => setF((s) => ({ ...s, notes: v }))} /></div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.thirteenthAdvance} onChange={(e) => setF((s) => ({ ...s, thirteenthAdvance: e.target.checked }))} /> Adiantar 1ª parcela do 13º junto</label>
          <p className="mt-1 text-[11px] text-muted">Período: {f.startDate ? `${new Date(f.startDate + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })} até ${endOf(f.startDate, parseInt(f.days || "30", 10) || 30)}` : ""}.</p>
          <button onClick={add} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Agendar</button>
        </div>
      )}
      {items.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="table-cards w-full text-sm">
            <thead className="bg-bg/40 text-left text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">Período</th><th className="px-3 py-2">Dias</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-t border-line/60">
                  <td className="px-3 py-2">{new Date(v.startDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })} – {endOf(String(v.startDate).slice(0, 10), v.days)}{v.thirteenthAdvance && <span className="ml-2 text-[10px] uppercase text-muted">+13º</span>}</td>
                  <td className="px-3 py-2">{v.days}</td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${(STATUS[v.status] ?? STATUS.scheduled!).c}`}>{(STATUS[v.status] ?? STATUS.scheduled!).l}</span></td>
                  <td className="px-3 py-2 text-right">
                    <span className="flex items-center justify-end gap-3 text-xs">
                      <a href={`/api/ponto/ferias/${v.id}/recibo.pdf`} target="_blank" rel="noreferrer" className="text-brand hover:underline">recibo</a>
                      {v.status === "scheduled" && <button onClick={() => setStatus(v.id, "taken")} className="text-green-300 hover:underline">marcar gozada</button>}
                      {v.status !== "canceled" && <button onClick={() => setStatus(v.id, "canceled")} className="text-muted hover:text-fg">cancelar</button>}
                      <button onClick={() => del(v.id)} className="text-red-300 hover:underline">excluir</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {empId && items.length === 0 && <p className="text-sm text-muted">Nenhuma férias registrada para este funcionário.</p>}
    </section>
  );
}

function Fechamento({ dialog }: { dialog: any }) {
  const [ref, setRef] = useState(new Date().toISOString().slice(0, 7));
  const [sum, setSum] = useState<any>(null);
  const [closing, setClosing] = useState<any>(null);
  const [employers, setEmployers] = useState<any[]>([]);
  const [empFilter, setEmpFilter] = useState(""); // "" = consolidado (todas)
  const [layouts, setLayouts] = useState<any[]>([]);
  const [layout, setLayout] = useState("generic");
  const load = () => {
    const q = empFilter ? `?employerId=${empFilter}` : "";
    fetch(`/api/ponto/fechamento/${ref}/resumo${q}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setSum).catch(() => {});
    fetch(`/api/ponto/fechamento/${ref}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setClosing).catch(() => {});
  };
  useEffect(() => { load(); }, [ref, empFilter]);
  useEffect(() => { fetch("/api/ponto/employers", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setEmployers(d?.items ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/ponto/folha/layouts", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setLayouts(d?.items ?? [])).catch(() => {}); }, []);
  const multi = employers.length > 1;
  async function act(path: string, ok: string) {
    const res = await fetch(`/api/ponto/fechamento/${ref}/${path}`, { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast(ok, "success"); load();
  }
  async function baixarCsv() {
    const q = new URLSearchParams({ layout, ...(empFilter ? { employerId: empFilter } : {}) });
    const res = await fetch(`/api/ponto/fechamento/${ref}/export.csv?${q}`, { credentials: "include" });
    const d = await res.json().catch(() => null); if (!res.ok || !d) { dialog.toast("Falha", "error"); return; }
    const slug = empFilter ? "_" + (employers.find((e) => e.id === empFilter)?.name ?? "").replace(/[^\w]+/g, "_").slice(0, 24) : "_consolidado";
    const blob = new Blob(["﻿" + (d.content ?? "")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `folha-${ref}_${layout}${slug}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function baixarAej() {
    const r = sum; if (!r) return;
    const eq = empFilter ? `&employerId=${empFilter}` : "";
    const res = await fetch(`/api/ponto/aej?from=${r.from}&to=${r.to}${eq}`, { credentials: "include" });
    const d = await res.json().catch(() => null); if (!res.ok || !d) { dialog.toast(d?.error?.message ?? "Falha ao gerar AEJ", "error"); return; }
    const slug = (d.employer?.name ?? "").replace(/[^\w]+/g, "_").slice(0, 24);
    const blob = new Blob([d.content ?? ""], { type: "text/plain;charset=iso-8859-1" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `AEJ-${ref}${slug ? "_" + slug : ""}.txt`; a.click(); URL.revokeObjectURL(a.href);
    if (d.signed && d.p7s) {
      const bin = atob(d.p7s); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const sa = document.createElement("a"); sa.href = URL.createObjectURL(new Blob([bytes], { type: "application/pkcs7-signature" })); sa.download = `AEJ-${ref}.txt.p7s`; sa.click(); URL.revokeObjectURL(sa.href);
    }
    dialog.toast(`AEJ gerado${d.signed ? " + .p7s assinado" : " (sem assinatura)"}`, "success");
  }
  const st = closing?.status ?? "open";
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input type="month" value={ref} onChange={(e) => setRef(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        {multi && (
          <select value={empFilter} onChange={(e) => setEmpFilter(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" title="Consolidado (gerencial) ou por empresa (fiscal)">
            <option value="">Consolidado (todas)</option>
            {employers.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        )}
        <span className={`rounded-full px-3 py-1 text-xs ${st === "closed" ? "bg-green-500/15 text-green-300" : st === "manager" ? "bg-amber-500/15 text-amber-300" : "bg-bg/60 text-muted"}`}>{st === "closed" ? "fechado (RH)" : st === "manager" ? "aprovado pelo gestor" : "aberto"}</span>
        <div className="ml-auto flex gap-2">
          {st === "open" && <button onClick={() => act("aprovar-gestor", "Aprovado pelo gestor")} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Aprovar (gestor)</button>}
          {st === "manager" && <button onClick={() => act("fechar-rh", "Fechado pelo RH")} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Fechar (RH)</button>}
          {st !== "open" && <button onClick={() => act("reabrir", "Reaberto")} className="rounded-lg border border-line px-3 py-2 text-sm">Reabrir</button>}
          {layouts.length > 0 && (
            <select value={layout} onChange={(e) => setLayout(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" title="Leiaute do CSV para a folha">
              {layouts.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
          )}
          <button onClick={baixarCsv} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Export CSV</button>
          <button onClick={baixarAej} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Gerar AEJ</button>
        </div>
      </div>
      {sum?.rows?.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="table-cards w-full text-sm">
            <thead className="bg-bg/40 text-left text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">Funcionário</th>{multi && <th className="px-3 py-2">Empresa</th>}<th className="px-3 py-2">Prev.</th><th className="px-3 py-2">Trab.</th><th className="px-3 py-2">Extras</th><th className="px-3 py-2">Not.</th><th className="px-3 py-2">Atraso</th><th className="px-3 py-2">Faltas</th><th className="px-3 py-2">Saldo</th><th className="px-3 py-2">Banco</th></tr></thead>
            <tbody>
              {sum.rows.map((r: any) => (
                <tr key={r.employeeId} className="border-t border-line/60">
                  <td className="px-3 py-2">{r.name}</td>
                  {multi && <td className="px-3 py-2 text-xs text-muted">{r.employerName ?? "—"}</td>}
                  <td className="px-3 py-2">{hmMin(r.expectedMin)}</td>
                  <td className="px-3 py-2">{hmMin(r.workedMin)}</td>
                  <td className="px-3 py-2 text-green-300">{hmMin(r.extraMin)}</td>
                  <td className="px-3 py-2">{hmMin(r.nightMin)}</td>
                  <td className="px-3 py-2 text-amber-300">{hmMin(r.lateMin)}</td>
                  <td className="px-3 py-2 text-red-300">{hmMin(r.faltaMin)}</td>
                  <td className={`px-3 py-2 ${r.balanceMin >= 0 ? "text-green-300" : "text-red-300"}`}>{hmMin(r.balanceMin)}</td>
                  <td className="px-3 py-2">{hmMin(r.bankBalanceMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Sem dados no mês.</p>}
      <p className="mt-2 text-[11px] text-muted">Fluxo: gestor aprova → RH fecha → exporta. O <b>AEJ</b> sai assinado em .p7s se o certificado A1 estiver configurado. Conformidade final (DSR, leiaute) deve ser validada no verificador oficial + contador.</p>
    </section>
  );
}

function PontoCert({ dialog }: { dialog: any }) {
  const [st, setSt] = useState<any>({ configured: false });
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/ponto/cert", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setSt(d)).catch(() => {});
  useEffect(() => { load(); }, []);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!pwd.trim()) { dialog.toast("Digite a senha do certificado antes de subir", "error"); e.currentTarget.value = ""; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      const res = await fetch("/api/ponto/cert", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ pfx: reader.result, password: pwd }) });
      const d = await res.json().catch(() => null);
      setBusy(false); setPwd("");
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao validar o certificado", "error"); return; }
      dialog.toast("Certificado A1 carregado ✅", "success"); load();
    };
    reader.readAsDataURL(file);
  }
  async function remove() {
    const res = await fetch("/api/ponto/cert/remove", { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast("Certificado removido", "success"); load();
  }
  return (
    <div className="mt-6">
      <p className="mb-1 text-sm font-semibold">Certificado digital A1 (ICP-Brasil) — assinatura do AFD/AEJ</p>
      <p className="mb-3 text-[11px] text-muted">Envie o <b>e-CNPJ A1 (.pfx/.p12)</b> + senha. O arquivo fica cifrado no servidor e assina o AFD/AEJ em <b>.p7s</b> (PKCS#7). A senha nunca é exibida de volta.</p>
      {st.configured ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/40 p-3 text-sm">
          <span className={st.expired ? "text-red-300" : "text-green-300"}>{st.expired ? "⚠ vencido" : "✓ ativo"}</span>
          <span><b>{st.subject}</b></span>
          {st.notAfter && <span className="text-muted">válido até {new Date(st.notAfter).toLocaleDateString("pt-BR")}</span>}
          <button onClick={remove} className="ml-auto rounded-lg border border-red-500/50 px-3 py-1 text-xs text-red-300">Remover</button>
        </div>
      ) : <p className="text-[11px] text-muted">Nenhum certificado configurado — o AFD sai sem assinatura.</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Senha do certificado</span><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>
        <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">{busy ? "Validando…" : st.configured ? "Trocar .pfx" : "Subir .pfx"}<input type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={onFile} /></label>
      </div>
    </div>
  );
}

function Eventos({ dialog }: { dialog: any }) {
  const [info, setInfo] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [pushUrl, setPushUrl] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const loadInfo = () => fetch("/api/ponto/webhook", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setInfo(d); setPushUrl(d.pushUrl || ""); } }).catch(() => {});
  const loadFeed = () => fetch("/api/ponto/eventos?limit=50", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { loadInfo(); loadFeed(); const t = setInterval(loadFeed, 15000); return () => clearInterval(t); }, []);
  async function savePush() {
    const res = await fetch("/api/ponto/config", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ webhookUrl: pushUrl }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast("URL externa salva ✅", "success"); loadInfo();
  }
  async function regen() {
    const res = await fetch("/api/ponto/webhook/regenerate", { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast("Novo segredo gerado", "success"); loadInfo();
  }
  const copy = (s: string) => { navigator.clipboard?.writeText(s); dialog.toast("Copiado", "success"); };
  return (
    <section>
      <div className="mb-4 rounded-xl border border-line bg-bg/60 p-5">
        <p className="mb-1 text-sm font-semibold">Webhook de eventos — pronto pra esta empresa</p>
        <p className="mb-3 text-[11px] text-muted">Todo evento (ex.: ponto batido) já fica gravado aqui no feed abaixo — você <b>não precisa</b> de servidor externo. Se quiser empurrar pra outro sistema (ex.: seu ERP), informe uma URL externa.</p>
        <div className="grid gap-3">
          <div>
            <span className="mb-1 block text-[10px] uppercase text-muted">Segredo (HMAC) desta empresa</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs">{info?.secret ?? "…"}</code>
              <button onClick={() => info?.secret && copy(info.secret)} className="rounded-lg border border-line px-3 py-2 text-xs hover:border-brand">Copiar</button>
              <button onClick={regen} className="rounded-lg border border-line px-3 py-2 text-xs hover:border-brand">Gerar novo</button>
            </div>
            <p className="mt-1 text-[10px] text-muted">Assinatura enviada no header <code>x-ponto-signature = sha256(segredo + corpo)</code>.</p>
          </div>
          <div>
            <span className="mb-1 block text-[10px] uppercase text-muted">Consultar eventos (puxar do seu sistema)</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-bg/40 px-3 py-2 text-xs">GET {origin}/api/ponto/eventos</code>
              <button onClick={() => copy(`${origin}/api/ponto/eventos`)} className="rounded-lg border border-line px-3 py-2 text-xs hover:border-brand">Copiar</button>
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[10px] uppercase text-muted">URL externa (opcional — empurra cada evento via POST)</span>
            <div className="flex items-center gap-2">
              <input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="https://seu-sistema.com/webhook" className="flex-1 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
              <button onClick={savePush} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Salvar</button>
            </div>
            <p className="mt-1 text-[10px] text-muted">Pra testar grátis, gere uma URL em webhook.site e cole aqui.</p>
          </div>
        </div>
      </div>

      <p className="mb-2 text-sm font-semibold">Feed de eventos (atualiza sozinho)</p>
      {items.length === 0 ? <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum evento ainda. Bata um ponto e ele aparece aqui.</p> : (
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="table-cards w-full text-sm">
            <thead className="bg-bg/40 text-left text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-3 py-2">Quando</th><th className="px-3 py-2">Evento</th><th className="px-3 py-2">Dados</th><th className="px-3 py-2">Externo</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-t border-line/60">
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{new Date(e.createdAt).toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2"><code className="text-xs">{e.event}</code></td>
                  <td className="px-3 py-2 text-xs text-muted">{e.payload?.employeeName ?? ""}{e.payload?.nsr ? ` · NSR ${e.payload.nsr}` : ""}</td>
                  <td className="px-3 py-2 text-xs">{e.targetUrl ? (e.delivered ? <span className="text-green-300">entregue {e.statusCode ?? ""}</span> : <span className="text-red-300">falhou {e.statusCode ?? ""}</span>) : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FaceTestButton({ dialog }: { dialog: any }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">Testar reconhecimento</button>
      {open && <FaceTestModal onClose={() => setOpen(false)} dialog={dialog} />}
    </>
  );
}

function FaceTestModal({ onClose, dialog }: { onClose: () => void; dialog: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" } }).then((s) => { streamRef.current = s; if (videoRef.current) videoRef.current.srcObject = s; }).catch(() => dialog.toast("Câmera indisponível", "error"));
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);
  async function testar() {
    const v = videoRef.current; if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = 360; c.height = Math.round((v.videoHeight / v.videoWidth) * 360);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    setBusy(true); setRes(null);
    const r = await fetch("/api/ponto/face-test", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ selfie: c.toDataURL("image/jpeg", 0.8) }) });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) { dialog.toast(d?.error?.message ?? "Falha no teste", "error"); return; }
    setRes(d);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-sm font-semibold">Testar reconhecimento facial</p>
        <p className="mb-3 text-[11px] text-muted">Não bate ponto — só mostra quem o sistema reconhece e a pontuação ({res ? `${res.candidates} rostos cadastrados` : "calibração"}).</p>
        <video ref={videoRef} autoPlay playsInline muted className="aspect-square w-full rounded-xl bg-black object-cover" />
        {res && (
          <div className={`mt-3 rounded-xl border p-3 text-sm ${res.wouldMatch ? "border-green-500/40 bg-green-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            <p><b>{res.employeeName ?? "Ninguém"}</b> — similaridade <b>{res.score ?? "—"}</b> (limiar {res.threshold})</p>
            <p className="mt-1 text-[11px] text-muted">{res.wouldMatch ? "✅ Bateria ponto com esse limiar." : "⚠ NÃO bateria (abaixo do limiar)."}</p>
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-line py-2 text-sm">Fechar</button>
          <button disabled={busy} onClick={testar} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Analisando…" : "Capturar e testar"}</button>
        </div>
      </div>
    </div>
  );
}

function Inp({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">{label}</span><input value={v ?? ""} onChange={(e) => on(e.target.value)} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" /></label>;
}

// ============================================================================
// GRADE DE AJUSTE DE PONTO — portada do Norty RH.
//
// O modelo é o "Cartão Ponto" clássico: o período inteiro numa tabela, com os
// horários do dia já editáveis direto na célula (sem clicar em "editar" linha
// por linha antes), e a coluna Situação classificada por cor — BH+, BH−, HE,
// Abono, Falta, Ponto certo — com um mini-painel por linha para aplicar cada
// uma. Os horários salvam num lote só, e apenas os dias que mudaram; BH, HE e
// abono aplicam na hora, por dia.
//
// É a tela que o gestor usa para fechar o mês. A fila de inconsistências
// (`Inconsistencias.tsx`) abre esta grade já no funcionário, com só os dias
// pendentes à mostra, e o "Próximo" salva e pula para o seguinte.
// ============================================================================

const AJUSTE_COLS: { key: keyof PunchForm; label: string }[] = [
  { key: "entrada", label: "Entrada" }, { key: "saidaAlmoco", label: "Saída 1" }, { key: "voltaAlmoco", label: "Entrada 2" },
  { key: "saidaLanche", label: "Saída 2" }, { key: "voltaLanche", label: "Entrada 3" }, { key: "saida", label: "Saída 3" },
];
type SitTipo = "bh_mais" | "bh_menos" | "he" | "abono";
const SIT_LABEL: Record<SitTipo, string> = { bh_mais: "BH+", bh_menos: "BH−", he: "HE", abono: "Abono" };
const SIT_ACTIVE_CLS: Record<SitTipo, string> = {
  bh_mais: "border-green-500 bg-green-500/15 text-green-300",
  bh_menos: "border-yellow-500 bg-yellow-500/15 text-yellow-300",
  he: "border-blue-500 bg-blue-500/15 text-blue-300",
  abono: "border-purple-500 bg-purple-500/15 text-purple-300",
};
type Scope = "dia" | "horas";
const BH_NEG_CAP_MIN = 360;    // BH− não passa de -6:00 no saldo total da conta
const BH_NEG_PRAZO_DIAS = 10;  // janela pra compensar antes do fechamento da folha

function parseHm(s: string): number {
  const m = /^(-)?(\d{1,3}):(\d{2})$/.exec((s || "").trim());
  if (!m) return 0;
  return (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

/**
 * Quanto ainda falta EXPLICAR no dia, dos dois lados: o negativo (falta +
 * atraso + saída antecipada, que BH− e abono disputam) e o positivo (extra, que
 * BH+ e HE disputam). Cada lançamento e cada abono já feito consome desse
 * total — é o que impede aplicar abono de 5h E BH− de 8h num dia que só tem 8h
 * de divergência.
 */
function budgetsFor(d: any, moves: any[], justs: any[]): { neg: number; pos: number } {
  const rawNeg = (d.faltaMin || 0) + (d.lateMin || 0) + (d.earlyMin || 0);
  const rawPos = d.extraMin || 0;
  const fullDayAbono = justs.some((j) => !(j.proposed && Number.isFinite(Number(j.proposed.minutes))));
  let usedNeg = fullDayAbono ? rawNeg : justs.reduce((s, j) => s + (Number(j.proposed?.minutes) || 0), 0);
  let usedPos = 0;
  for (const m of moves) {
    if (m.kind === "he") usedPos += Math.abs(m.minutes);
    else if (m.minutes < 0) usedNeg += Math.abs(m.minutes);
    else usedPos += m.minutes;
  }
  return { neg: Math.max(0, rawNeg - usedNeg), pos: Math.max(0, rawPos - usedPos) };
}
function suggestionFor(t: SitTipo, budgets: { neg: number; pos: number }): string {
  return hmMin(t === "bh_mais" || t === "he" ? budgets.pos : budgets.neg);
}

/**
 * Chips da situação do dia. Pode haver mais de um — BH− de parte do atraso +
 * abono do restante é caso comum. Cada lançamento de banco vira um chip; cada
 * abono vira outro, já com as horas quando não é do dia inteiro; o que sobrar
 * sem classificar vira um chip próprio no fim.
 *
 * O ramo de `special` é do Vision, não do RH: feriado lançado, ponto
 * facultativo e folga premium zeram o esperado do dia por justificativa
 * aprovada. Sem ele esses dias apareceriam como "Folga" genérica e o gestor não
 * saberia por que o esperado é zero.
 */
function situacaoChips(d: any, moves: any[], justs: any[], hasSchedule: boolean): { label: string; cls: string; title?: string }[] {
  if (d.leave) return [{ label: `Afastamento${d.leaveType ? ` (${d.leaveType})` : ""}`, cls: "text-muted" }];
  if (d.future && d.isWorkDay && moves.length === 0 && justs.length === 0) {
    return [{ label: "Dia ainda não chegou", cls: "text-muted", title: "Não conta como falta nem entra no saldo" }];
  }
  if (d.special && moves.length === 0 && justs.length === 0) {
    return [{ label: d.specialReason ? `Dia especial — ${d.specialReason}` : "Dia especial", cls: "bg-purple-500/10 text-purple-300/80", title: "Esperado zerado por justificativa aprovada (feriado, ponto facultativo ou folga premium)" }];
  }
  if (!d.isWorkDay && moves.length === 0 && justs.length === 0) {
    const label = d.holiday ? `Feriado${d.holidayName ? ` — ${d.holidayName}` : ""}` : !hasSchedule ? "Fora de escala" : (d.dsrLost ? "Folga — DSR descontado" : "Folga");
    return [{ label, cls: "text-muted" }];
  }
  const chips: { label: string; cls: string; title?: string }[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const m of moves) {
    if (m.kind === "he") { chips.push({ label: `HE ${hmMin(Math.abs(m.minutes))}`, cls: "bg-blue-500/15 text-blue-300", title: m.reason }); continue; }
    if (m.minutes < 0) {
      const prazo = addDays(d.day, BH_NEG_PRAZO_DIAS);
      const vencido = prazo < today;
      chips.push({
        label: `BH− ${hmMin(Math.abs(m.minutes))} · prazo ${prazo.slice(8)}/${prazo.slice(5, 7)}${vencido ? " ⚠" : ""}`,
        cls: vencido ? "bg-red-500/20 text-red-300 ring-1 ring-red-400" : "bg-yellow-500/15 text-yellow-300",
        title: `${m.reason ?? ""} — compensar até ${prazo.split("-").reverse().join("/")} (${BH_NEG_PRAZO_DIAS} dias)`.trim(),
      });
      continue;
    }
    chips.push({ label: `BH+ ${hmMin(m.minutes)}`, cls: "bg-green-500/15 text-green-300", title: m.reason });
  }
  for (const j of justs) {
    const mins = j.proposed && Number.isFinite(Number(j.proposed.minutes)) ? Number(j.proposed.minutes) : null;
    const suf = j.status === "pending" ? " (pendente)" : "";
    chips.push({
      label: `Abono${mins != null ? ` ${hmMin(mins)}` : " (dia)"}${suf}`,
      cls: j.status === "approved" ? "bg-purple-500/15 text-purple-300" : "bg-purple-500/10 text-purple-300/70",
      title: j.reason,
    });
  }
  if (d.faltaMin && !d.justified) chips.push({ label: "Falta", cls: "bg-red-500/15 text-red-300" });
  else if (d.divergence) chips.push({ label: "Pendente", cls: "bg-orange-500/15 text-orange-300" });
  if (!chips.length && d.inProgress && d.isWorkDay) {
    chips.push({ label: "Hoje — em andamento", cls: "text-muted", title: "O que falta do dia só é cobrado depois que o dia terminar" });
  } else if (!chips.length && d.punches?.length) {
    chips.push({ label: "Ponto certo", cls: "bg-green-500/10 text-green-400" });
  }
  return chips;
}

/** Props da grade — a fila de inconsistências monta esta tela e passa a navegação dela. */
export type AjusteProps = {
  empId: string; data: any; range: { from: string; to: string }; dialog: any; onClose: () => void; onSaved: () => void;
  nav?: { pos: number; total: number; onPrev?: () => void; onNext?: () => void; nextName?: string | null };
  focusDays?: string[];
};

function EspelhoAjusteModal({ empId, data, range, dialog, onClose, onSaved, nav, focusDays }: AjusteProps) {
  const [rows, setRows] = useState<Record<string, PunchForm>>({});
  const [snackByDay, setSnackByDay] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [bankItems, setBankItems] = useState<any[]>([]);
  const [bankBalance, setBankBalance] = useState(0);
  const [justItems, setJustItems] = useState<any[]>([]);
  const [actionDay, setActionDay] = useState<string | null>(null);
  const [actionForm, setActionForm] = useState<{ tipo: SitTipo; horas: string; obs: string; scope: Scope }>({ tipo: "bh_mais", horas: "", obs: "", scope: "dia" });
  const [busyAction, setBusyAction] = useState(false);
  const hasSchedule = !!data?.schedule;
  // aberta pela fila de inconsistências: começa mostrando só os dias pendentes (congelados na abertura,
  // pra o dia corrigido não sumir da tela enquanto a pessoa ainda está nele)
  const [focus] = useState(() => new Set(focusDays ?? []));
  const [onlyFocus, setOnlyFocus] = useState(() => (focusDays ?? []).length > 0);
  const visibleDays = (data?.days ?? []).filter((d: any) => !onlyFocus || focus.has(d.day));
  useEffect(() => {
    const r: Record<string, PunchForm> = {}; const s: Record<string, boolean> = {};
    for (const d of data?.days ?? []) { const { form, snack } = punchesToForm(d.punches ?? []); r[d.day] = form; s[d.day] = snack; }
    setRows(r); setSnackByDay(s);
  }, [data]);
  const refreshAux = () => {
    fetch(`/api/ponto/banco?employeeId=${empId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((b) => { setBankItems(b?.items ?? []); setBankBalance(b?.balanceMin ?? 0); }).catch(() => {});
    fetch(`/api/ponto/justificativas?employeeId=${empId}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((j) => setJustItems(j?.items ?? [])).catch(() => {});
  };
  useEffect(() => { refreshAux(); }, [empId]);
  const bankByDay = new Map<string, any[]>();
  for (const m of bankItems) { const k = String(m.day).slice(0, 10); (bankByDay.get(k) ?? bankByDay.set(k, []).get(k)!).push(m); }
  const justsByDay = new Map<string, any[]>();
  for (const j of justItems) {
    if (j.kind !== "abono" || j.status === "rejected") continue;
    const k = String(j.day).slice(0, 10);
    (justsByDay.get(k) ?? justsByDay.set(k, []).get(k)!).push(j);
  }
  function setCell(day: string, key: keyof PunchForm, value: string) {
    setRows((s) => ({ ...s, [day]: { ...(s[day] ?? emptyPunchForm()), [key]: value } }));
    if (key === "saidaLanche" || key === "voltaLanche") setSnackByDay((s) => ({ ...s, [day]: true }));
  }
  async function salvar(quiet = false): Promise<boolean> {
    const original = new Map((data?.days ?? []).map((d: any) => [d.day, (d.punches ?? []).join(" ")]));
    const days: { day: string; times: string[] }[] = [];
    for (const d of data?.days ?? []) {
      const times = formToTimes(rows[d.day] ?? emptyPunchForm(), !!snackByDay[d.day]);
      if (times.join(" ") !== (original.get(d.day) ?? "")) days.push({ day: d.day, times });
    }
    if (!days.length) { if (!quiet) dialog.toast("Nada alterado", "error"); return true; }
    // dia que tinha batida e ficou sem nenhum horário: é permitido (bateu por engano), mas confirma antes
    const limpar = days.filter((d) => !d.times.length);
    if (limpar.length) {
      const quais = limpar.map((d) => `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`).join(", ");
      const um = limpar.length === 1;
      const ok = await dialog.confirm(`${um ? `O dia ${quais} vai` : `Os dias ${quais} vão`} ficar sem nenhum horário. As batidas ${um ? "desse dia" : "desses dias"} são anuladas (continuam no histórico, mas deixam de contar) e o dia passa a aparecer sem marcação. Confirmar?`);
      if (!ok) return false;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/punches/manual", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, days, replaceDay: true }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(j?.error?.message ?? "Falha ao salvar", "error"); return false; }
      dialog.toast(`${days.length} dia(s) atualizado(s) ✅${j?.voided ? ` · ${j.voided} batida(s) anteriores anuladas` : ""}`, "success");
      onSaved();
      return true;
    } finally { setBusy(false); }
  }
  /** Anterior / Próximo da fila: salva os horários que foram mexidos e só então troca de funcionário. */
  async function irPara(fn?: () => void) { if (!fn || busy) return; if (await salvar(true)) fn(); }
  useEffect(() => {
    if (!nav) return;
    const h = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "ArrowRight") { e.preventDefault(); void irPara(nav.onNext ?? onClose); }
      if (e.key === "ArrowLeft" && nav.onPrev) { e.preventDefault(); void irPara(nav.onPrev); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  function openAction(d: any) {
    if (actionDay === d.day) { setActionDay(null); return; }
    const moves = (bankByDay.get(d.day) ?? []).filter((m: any) => m.kind !== "expiry");
    const b = budgetsFor(d, moves, justsByDay.get(d.day) ?? []);
    setActionDay(d.day); setActionForm({ tipo: "bh_mais", horas: suggestionFor("bh_mais", b), obs: "", scope: "dia" });
  }
  function pickTipo(d: any, t: SitTipo) {
    const moves = (bankByDay.get(d.day) ?? []).filter((m: any) => m.kind !== "expiry");
    const b = budgetsFor(d, moves, justsByDay.get(d.day) ?? []);
    setActionForm((f) => ({ ...f, tipo: t, horas: suggestionFor(t, b), scope: "dia" }));
  }
  async function applyAction(d: any) {
    const { tipo, horas, obs, scope } = actionForm;
    const moves = (bankByDay.get(d.day) ?? []).filter((m: any) => m.kind !== "expiry");
    const b = budgetsFor(d, moves, justsByDay.get(d.day) ?? []);
    const budget = tipo === "bh_mais" || tipo === "he" ? b.pos : b.neg;
    const mins = scope === "dia" ? budget : parseHm(horas);
    if (!mins) { dialog.toast(scope === "dia" ? "Não sobra nada desse tipo pra lançar hoje" : (tipo === "abono" ? "Informe as horas do abono" : "Informe as horas"), "error"); return; }
    if (mins > budget) {
      if (!(await dialog.confirm({ title: "Passa do que falta explicar no dia", message: `Restam ${hmMin(budget)} desse tipo de divergência no dia — você está lançando ${hmMin(mins)}. Aplicar mesmo assim?` }))) return;
    }
    if (tipo === "bh_menos") {
      const wouldBe = bankBalance - mins;
      if (wouldBe < -BH_NEG_CAP_MIN) {
        dialog.alert(`O banco de horas negativo não pode passar de -${hmMin(BH_NEG_CAP_MIN)}. Esse funcionário está em ${hmMin(bankBalance)}; lançar ${hmMin(mins)} deixaria em ${hmMin(wouldBe)}. Reduza o valor, ou resolva parte com abono.`);
        return;
      }
    }
    if (tipo === "abono" && !obs.trim()) { dialog.toast("Informe a observação (motivo do abono)", "error"); return; }
    setBusyAction(true);
    try {
      if (tipo !== "abono") {
        const minutes = tipo === "bh_menos" ? -Math.abs(mins) : Math.abs(mins);
        const kind = tipo === "he" ? "he" : "inclusion";
        const reason = tipo === "bh_menos" ? `${obs || "ajuste"} — compensar até ${addDays(d.day, BH_NEG_PRAZO_DIAS).split("-").reverse().join("/")} (10 dias)` : (obs || (tipo === "he" ? "horas extras (grade de ajuste)" : "ajuste (grade de ajuste)"));
        const res = await fetch("/api/ponto/banco", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, day: d.day, minutes, kind, reason }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) { dialog.toast(j?.error?.message ?? "Falha ao aplicar", "error"); return; }
        dialog.toast("Aplicado ✅", "success");
      } else {
        const proposed = scope === "horas" ? { minutes: Math.abs(mins) } : undefined;
        const res = await fetch("/api/ponto/justificativas", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, day: d.day, kind: "abono", reason: obs.trim(), ...(proposed ? { proposed } : {}) }) });
        const j = await res.json().catch(() => null);
        if (!res.ok) { dialog.toast(j?.error?.message ?? "Falha ao aplicar", "error"); return; }
        const rev = await fetch(`/api/ponto/justificativas/${j.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ approve: true }) });
        dialog.toast(rev.ok ? "Abono aplicado ✅" : "Abono criado, mas falhou ao aprovar — revise na fila de justificativas", rev.ok ? "success" : "error");
      }
      setActionDay(null); refreshAux(); onSaved();
    } finally { setBusyAction(false); }
  }
  async function removeMov(id: string) {
    if (!(await dialog.confirm({ title: "Remover lançamento", message: "Remover este lançamento do banco/HE?", tone: "danger" }))) return;
    const res = await fetch(`/api/ponto/banco/${id}/delete`, { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Falha ao remover", "error"); return; }
    dialog.toast("Removido", "success"); refreshAux(); onSaved();
  }
  async function removeJust(id: string) {
    if (!(await dialog.confirm({ title: "Remover abono", message: "Remover este abono? A divergência volta a contar.", tone: "danger" }))) return;
    const res = await fetch(`/api/ponto/justificativas/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ approve: false }) });
    if (!res.ok) { dialog.toast("Falha ao remover", "error"); return; }
    dialog.toast("Removido", "success"); refreshAux(); onSaved();
  }
  const totalCols = AJUSTE_COLS.length + 7;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-4 py-3">
        <div>
          <p className="text-base font-semibold">Ajuste de ponto — {data.employee.name}{data.employee.cargo ? ` — ${data.employee.cargo}` : ""}</p>
          <p className="text-xs text-muted">{data.employer} · Período {range.from} a {range.to} · clique direto no horário pra editar, ou na Situação pra classificar{nav?.nextName ? ` · próximo: ${nav.nextName}` : ""}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {focus.size > 0 && <button onClick={() => setOnlyFocus((v) => !v)} className="rounded-lg border border-line px-3 py-2 text-xs hover:border-brand">{onlyFocus ? "Ver o período inteiro" : `Só os ${focus.size} dia(s) pendentes`}</button>}
          <button onClick={() => void salvar()} disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${nav ? "border border-line hover:border-brand" : "bg-brand text-white"}`}>{busy ? "Salvando…" : "Salvar horários alterados"}</button>
          {nav && (
            <div className="flex items-center gap-1 rounded-lg border border-line p-1">
              <button onClick={() => void irPara(nav.onPrev)} disabled={busy || !nav.onPrev} title="Funcionário anterior (Alt + ←) — salva o que foi alterado" className="rounded-md px-2.5 py-1 text-sm hover:bg-bg/80 disabled:opacity-30">◀ Anterior</button>
              <span className="px-1 text-xs tabular-nums text-muted">{nav.pos} de {nav.total}</span>
              <button onClick={() => void irPara(nav.onNext ?? onClose)} disabled={busy} title={nav.onNext ? "Próximo funcionário (Alt + →) — salva o que foi alterado" : "Último da fila — salva e fecha"} className="rounded-md bg-brand px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">{nav.onNext ? "Próximo ▶" : "Concluir ✓"}</button>
            </div>
          )}
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">Fechar</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/60 bg-bg/60 px-4 py-1.5 text-[10px] text-muted">
        <span className="font-semibold uppercase tracking-wider">Legenda</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-400" />BH+ / Ponto certo</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-yellow-400" />BH− (ajuste, não é erro)</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-blue-400" />HE</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-purple-400" />Abono</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-red-400" />Falta</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-orange-400" />Pendente de classificar</span>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <table data-sem-cartao="grade-ajuste-ponto" className="w-full min-w-[1200px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-bg text-left text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="whitespace-nowrap border border-line/60 px-2 py-1.5">Dia</th>
              <th className="whitespace-nowrap border border-line/60 px-2 py-1.5">Previsto</th>
              {AJUSTE_COLS.map((c) => <th key={c.key} className="border border-line/60 px-2 py-1.5">{c.label}</th>)}
              <th className="border border-line/60 px-2 py-1.5">Trab.</th>
              <th className="border border-line/60 px-2 py-1.5">Extra</th>
              <th className="border border-line/60 px-2 py-1.5">Falta</th>
              <th className="border border-line/60 px-2 py-1.5">Saldo</th>
              <th className="border border-line/60 px-2 py-1.5">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visibleDays.map((d: any) => {
              const isSunday = d.wd === 0;
              const moves = (bankByDay.get(d.day) ?? []).filter((m: any) => m.kind !== "expiry");
              const dayJusts = justsByDay.get(d.day) ?? [];
              const chips = situacaoChips(d, moves, dayJusts, hasSchedule);
              return (
                <Fragment key={d.day}>
                <tr className={isSunday || d.holiday ? "text-red-400" : !d.isWorkDay || d.future ? "text-muted" : ""}>
                  <td className="whitespace-nowrap border border-line/40 px-2 py-1 font-mono text-xs">{d.day.slice(8)}/{d.day.slice(5, 7)} <span className="text-[10px]">{WD[d.wd]}</span></td>
                  <td className="whitespace-nowrap border border-line/40 px-2 py-1 text-center font-mono text-[10px] text-muted" title={d.scheduleOrigin === "planilha" ? "escala da planilha" : d.scheduleOrigin === "troca" ? "troca de turno" : d.scheduleOrigin === "sem_escala" ? "sem escala cadastrada" : ""}>{(d.expectedSegs ?? []).length ? (d.expectedSegs as string[][]).map((x) => `${x[0]}–${x[1]}`).join(" · ") : d.scheduleOrigin === "sem_escala" ? "sem escala" : "—"}</td>
                  {AJUSTE_COLS.map((c) => (
                    <td key={c.key} className="border border-line/40 p-0.5">
                      <input type="time" value={rows[d.day]?.[c.key] ?? ""} onChange={(e) => setCell(d.day, c.key, e.target.value)}
                        className="w-full rounded-md border-0 bg-transparent px-1.5 py-1 text-center text-xs text-fg outline-none focus:bg-brand/10 focus:ring-1 focus:ring-brand" />
                    </td>
                  ))}
                  <td className="border border-line/40 px-2 py-1 text-center text-xs">{d.future ? "" : d.hm.workedMin}</td>
                  <td className="border border-line/40 px-2 py-1 text-center text-xs">{d.extraMin ? d.hm.extraMin : ""}</td>
                  <td className="border border-line/40 px-2 py-1 text-center text-xs">{d.faltaMin && !d.justified ? d.hm.faltaMin : ""}</td>
                  <td className={`border border-line/40 px-2 py-1 text-center text-xs ${d.future ? "" : d.balanceMin < 0 ? "text-red-400" : "text-green-400"}`}>{d.future ? "" : d.hm.balanceMin}</td>
                  <td className="border border-line/40 p-0.5">
                    <button onClick={() => openAction(d)} className="flex w-full flex-wrap items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-bg/80">
                      {chips.length ? chips.map((c, i) => (
                        <span key={i} title={c.title || ""} className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>{c.label}</span>
                      )) : <span className="px-1.5 py-0.5 text-[11px] text-muted">— classificar —</span>}
                    </button>
                  </td>
                </tr>
                {actionDay === d.day && (() => {
                  const budgets = budgetsFor(d, moves, dayJusts);
                  const budget = actionForm.tipo === "bh_mais" || actionForm.tipo === "he" ? budgets.pos : budgets.neg;
                  return (
                  <tr className="bg-bg/60">
                    <td colSpan={totalCols} className="border border-line/40 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {(["bh_mais", "bh_menos", "he", "abono"] as SitTipo[]).map((t) => (
                          <button key={t} onClick={() => pickTipo(d, t)} className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${actionForm.tipo === t ? SIT_ACTIVE_CLS[t] : "border-line text-muted hover:border-brand"}`}>{SIT_LABEL[t]}</button>
                        ))}
                        <div className="flex overflow-hidden rounded-lg border border-line">
                          <button onClick={() => setActionForm((f) => ({ ...f, scope: "dia", horas: suggestionFor(f.tipo, budgets) }))} className={`px-2.5 py-1 text-xs font-medium ${actionForm.scope === "dia" ? SIT_ACTIVE_CLS[actionForm.tipo] : "text-muted hover:bg-bg/60"}`}>Dia inteiro</button>
                          <button onClick={() => setActionForm((f) => ({ ...f, scope: "horas" }))} className={`px-2.5 py-1 text-xs font-medium ${actionForm.scope === "horas" ? SIT_ACTIVE_CLS[actionForm.tipo] : "text-muted hover:bg-bg/60"}`}>De horas</button>
                        </div>
                        {actionForm.scope === "horas" ? (
                          <input value={actionForm.horas} onChange={(e) => setActionForm((f) => ({ ...f, horas: e.target.value }))} placeholder="hh:mm" title="Quanto desse tipo você quer lançar — o resto do dia continua sem classificar" className="w-20 rounded-lg border border-line bg-bg/40 px-2 py-1 text-xs font-mono" />
                        ) : (
                          <span className="rounded-lg border border-line/60 bg-bg/40 px-2 py-1 text-xs font-mono text-muted">{hmMin(budget)}</span>
                        )}
                        <span className="text-[11px] text-muted">restam {hmMin(budget)} do dia</span>
                        <input value={actionForm.obs} onChange={(e) => setActionForm((f) => ({ ...f, obs: e.target.value }))} placeholder="Observação" className="min-w-[200px] flex-1 rounded-lg border border-line bg-bg/40 px-2 py-1 text-xs" />
                        <button onClick={() => applyAction(d)} disabled={busyAction} className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Aplicar</button>
                        <button onClick={() => setActionDay(null)} className="rounded-lg border border-line px-2 py-1 text-xs text-muted">Fechar</button>
                      </div>
                      <p className="mt-1 text-[10px] text-muted">"Dia inteiro" usa o que resta do dia pra esse tipo (some outras classificações já feitas). "De horas" deixa lançar só uma parte — dá pra combinar, ex.: 2h de BH− + o resto de abono. BH− não passa de -{hmMin(BH_NEG_CAP_MIN)} no saldo total, e tem prazo de {BH_NEG_PRAZO_DIAS} dias pra compensar.</p>
                      {(moves.length > 0 || dayJusts.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {moves.map((m: any) => (
                            <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-line/60 bg-bg px-2 py-0.5 text-[11px] text-muted">
                              {m.kind === "he" ? "HE" : m.minutes < 0 ? "BH−" : "BH+"} {hmMin(Math.abs(m.minutes))}{m.reason ? ` · ${m.reason}` : ""}
                              <button onClick={() => removeMov(m.id)} className="text-muted hover:text-red-400" title="remover">✕</button>
                            </span>
                          ))}
                          {dayJusts.map((j: any) => (
                            <span key={j.id} className="inline-flex items-center gap-1 rounded-full border border-line/60 bg-bg px-2 py-0.5 text-[11px] text-muted">
                              Abono{j.proposed?.minutes ? ` ${hmMin(Number(j.proposed.minutes))}` : " (dia)"}{j.status === "pending" ? " (pendente)" : ""}{j.reason ? ` · ${j.reason}` : ""}
                              <button onClick={() => removeJust(j.id)} className="text-muted hover:text-red-400" title="remover">✕</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                  ); })()}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">Reajustar horário substitui as batidas anteriores do dia (não duplica) — as anuladas ficam guardadas pra auditoria (Portaria 671, nada é apagado). BH/HE/Abono aplicam na hora, por dia.</p>
    </div>
  );
}

