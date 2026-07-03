"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";
import { PUNCH_FIELDS, type PunchForm, emptyPunchForm, punchesToForm, formToTimes } from "../../../lib/punch";

type Emp = { id: string; name: string; cpf: string | null; pis: string | null; matricula: string | null; matEsocial: string | null; cargo: string | null; scheduleCode: string | null; active: boolean; faceEnrolled?: boolean; barcode?: string | null; hrEmployeeId?: string | null };
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
  const [tab, setTab] = useState<"bater" | "marcacoes" | "tempo" | "espelho" | "solicitacoes" | "escalas" | "banco" | "ferias" | "fechamento" | "eventos" | "funcionarios" | "dispositivos" | "avisos" | "config">("bater");
  const [emps, setEmps] = useState<Emp[]>([]);
  const load = () => fetch("/api/ponto/employees", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setEmps(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <main className="max-w-5xl">
      <header className="mb-6 print:hidden">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Pessoas · Ponto</p>
        <h1 className="mt-1 text-2xl font-semibold">Ponto eletrônico</h1>
        <p className="mt-1 text-muted">Marcação imutável (horário do servidor + NSR + hash) e jornada derivada — Portaria 671 (Fases 0–1).</p>
      </header>
      <nav className="mb-6 flex flex-wrap gap-1 rounded-xl border border-line bg-surface-2 p-1 text-sm print:hidden">
        {([["bater", "Bater ponto"], ["marcacoes", "Marcações"], ["tempo", "Tempo real"], ["espelho", "Espelho"], ["solicitacoes", "Solicitações"], ["escalas", "Escalas"], ["banco", "Banco de horas"], ["ferias", "Férias"], ["fechamento", "Fechamento"], ["eventos", "Eventos / Webhook"], ["funcionarios", "Funcionários (marcação)"], ["dispositivos", "Dispositivos"], ["avisos", "Avisos"], ["config", "Empregador"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1 ${tab === k ? "bg-brand text-white" : "text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </nav>

      {tab === "bater" && <Bater emps={emps} dialog={dialog} />}
      {tab === "marcacoes" && <Marcacoes emps={emps} dialog={dialog} />}
      {tab === "tempo" && <TempoReal dialog={dialog} />}
      {tab === "espelho" && <><EspelhosContabil dialog={dialog} /><Espelho emps={emps} dialog={dialog} /></>}
      {tab === "solicitacoes" && <SolicitacoesPonto dialog={dialog} />}
      {tab === "escalas" && <Escalas dialog={dialog} />}
      {tab === "banco" && <Banco emps={emps} dialog={dialog} />}
      {tab === "ferias" && <Ferias emps={emps} dialog={dialog} />}
      {tab === "fechamento" && <Fechamento dialog={dialog} />}
      {tab === "eventos" && <Eventos dialog={dialog} />}
      {tab === "funcionarios" && <Funcionarios emps={emps} onChanged={load} dialog={dialog} />}
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
function monthRange() { return monthShift(0); }
/** Janela de mês inteiro, deslocado em N meses (negativo = passado). Usa UTC pra não embaralhar TZ. */
function monthShift(months: number) {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth() + months;
  const firstDay = new Date(Date.UTC(y, m, 1)); const lastDay = new Date(Date.UTC(y, m + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(firstDay), to: iso(lastDay) };
}
function shiftLabel(months: number): string {
  const now = new Date(); const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + months, 1));
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(".", "");
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
    <section className="card">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-2"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Funcionário</span>
          <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base">
            <option value="">— selecione —</option>
            {emps.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}{e.matricula ? ` (${e.matricula})` : ""}</option>)}
          </select></label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">PIN (se exigido)</span>
          <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" className="input-base" /></label>
      </div>
      <button disabled={busy} onClick={punch} className="btn-grad mt-4 w-full py-3 text-base disabled:opacity-50">{busy ? "Registrando…" : "Registrar ponto"}</button>
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
  const nameOf = (id: string) => emps.find((e) => e.id === id)?.name ?? "—";
  useEffect(() => {
    const q = empId ? `?employeeId=${empId}` : "";
    fetch(`/api/ponto/punches${q}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  }, [empId]);
  async function baixarAfd() {
    const res = await fetch("/api/ponto/afd", { credentials: "include" });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) { dialog.toast("Falha ao gerar AFD", "error"); return; }
    const blob = new Blob([d.content ?? ""], { type: "text/plain;charset=iso-8859-1" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "AFD.txt"; a.click(); URL.revokeObjectURL(a.href);
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
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base w-auto">
          <option value="">Todos os funcionários</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button onClick={baixarAfd} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand" title="Registros tipo 7 do AFD (marcações)">Baixar AFD (tipo 7)</button>
      </div>
      {items.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Sem marcações.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><th className="px-4 py-3 font-medium">NSR</th><th className="px-4 py-3 font-medium">Funcionário</th><th className="px-4 py-3 font-medium">Data/hora</th><th className="px-4 py-3 font-medium">Origem</th><th className="px-4 py-3 font-medium">Verificação</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono">{p.nsr}</td>
                  <td className="px-4 py-3">{nameOf(p.employeeId)}</td>
                  <td className="px-4 py-3">{new Date(p.punchedAt).toLocaleString("pt-BR")}{p.offline ? " (offline)" : ""}</td>
                  <td className="px-4 py-3 text-muted">{p.origin}</td>
                  <td className="px-4 py-3 text-xs">
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
          <button onClick={dedupe} className="rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">Unir duplicados (CPF)</button>
          <button onClick={zerarMarcacoes} className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-400 hover:bg-red-500/10">Zerar marcações (migração)</button>
        </div>
      </div>
      <div className="card mb-4">
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
        <button onClick={save} className="btn-grad mt-3">Salvar</button>
      </div>
      <div className="space-y-2">
        {emps.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span>{e.name} <span className="text-xs text-muted">{e.cargo ?? ""}{e.matricula ? ` · mat ${e.matricula}` : ""}</span>{e.faceEnrolled && <span className="ml-2 text-[10px] text-green-300">rosto ✓</span>}</span>
            <div className="flex items-center gap-2">
              {!e.active && <span className="text-[10px] text-muted">inativo</span>}
              {e.barcode && <button onClick={() => printCracha(e, "")} className="rounded border border-line px-2 py-0.5 text-xs hover:border-brand">Crachá</button>}
              <button onClick={() => setEnrollFor(e)} className="rounded border border-line px-2 py-0.5 text-xs hover:border-brand">{e.faceEnrolled ? "Refazer rosto" : "Cadastrar rosto"}</button>
            </div>
          </div>
        ))}
      </div>
      {enrollFor && <FaceEnroll emp={enrollFor} onClose={() => setEnrollFor(null)} onDone={() => { setEnrollFor(null); onChanged(); }} dialog={dialog} />}
    </section>
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
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1 text-sm font-semibold">Cadastrar rosto — {emp.name}</p>
        <p className="mb-3 text-[11px] text-muted">Olhe para a câmera com o rosto bem iluminado e centralizado.</p>
        <video ref={videoRef} autoPlay playsInline muted className="aspect-square w-full rounded-xl bg-black object-cover" />
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-line py-2 text-sm">Cancelar</button>
          <button disabled={busy} onClick={capture} className="btn-grad flex-1 py-2 disabled:opacity-50">{busy ? "Salvando…" : "Capturar"}</button>
        </div>
      </div>
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
    <section className="card">
      <p className="mb-3 text-sm font-semibold">Dados do empregador (cabeçalho do AFD/AEJ)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Tipo</span>
          <select value={c.tpIdtEmpregador} onChange={(e) => set("tpIdtEmpregador", Number(e.target.value))} className="input-base"><option value={1}>CNPJ</option><option value={2}>CPF</option></select></label>
        <Inp label="CNPJ/CPF" v={c.idtEmpregador} on={(v) => set("idtEmpregador", v)} />
        <Inp label="Razão social / nome" v={c.razaoOuNome} on={(v) => set("razaoOuNome", v)} />
        <Inp label="Nº processo convenção/acordo (REP-A)" v={c.repAProcesso} on={(v) => set("repAProcesso", v)} />
        <Inp label="CAEPF (se houver)" v={c.caepf} on={(v) => set("caepf", v)} />
        <Inp label="CNO (se houver)" v={c.cno} on={(v) => set("cno", v)} />
        <Inp label="Local de prestação de serviços" v={c.localPrestacao} on={(v) => set("localPrestacao", v)} />
        <Inp label="CPF do responsável (inclusões/alterações)" v={c.responsavelCpf} on={(v) => set("responsavelCpf", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Tipo ident. desenvolvedor (PTRP)</span>
          <select value={c.devTpIdt ?? 1} onChange={(e) => set("devTpIdt", Number(e.target.value))} className="input-base"><option value={1}>CNPJ</option><option value={2}>CPF</option></select></label>
        <Inp label="CNPJ/CPF do desenvolvedor (yugochat)" v={c.devIdt} on={(v) => set("devIdt", v)} />
      </div>
      <p className="mt-2 text-[11px] text-muted">Se não houver convenção/acordo depositado, deixe em branco — o AFD/AEJ usa "9"×17 automaticamente. O CNPJ do desenvolvedor (PTRP) é o da yugochat e vai no cabeçalho do AFD.</p>

      <p className="mb-3 mt-6 text-sm font-semibold">Reconhecimento facial e prova de vida (Fase 3)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Provedor facial</span>
          <select value={c.faceProvider ?? "none"} onChange={(e) => set("faceProvider", e.target.value)} className="input-base"><option value="none">Desligado</option><option value="http">Serviço HTTP (self-hosted/adaptador)</option></select></label>
        <Inp label="URL do serviço facial" v={c.faceProviderUrl} on={(v) => set("faceProviderUrl", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Chave do serviço {c.faceProviderKeySet ? "(definida — deixe vazio p/ manter)" : ""}</span><input type="password" value={c.faceProviderKey ?? ""} onChange={(e) => set("faceProviderKey", e.target.value)} className="input-base" /></label>
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
      </div>
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
      <p className="mt-1 text-[11px] text-muted">O funcionário é avisado (WhatsApp/e-mail do cadastro) quando não registra a entrada ou esquece a saída. O gestor recebe um resumo diário das divergências e, às segundas, quem passou do limite de hora extra na semana.</p>

      <FaceTestButton dialog={dialog} />
      <p className="mt-1 text-[11px] text-muted">Use o teste pra calibrar a <b>Similaridade mínima</b>: capture o rosto de alguém cadastrado e veja a pontuação. Ajuste o limiar abaixo da pontuação de acertos e acima da de estranhos.</p>

      <PontoBackground c={c} dialog={dialog} onSaved={() => fetch("/api/ponto/config", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => r.json()).then(setC).catch(() => {})} />

      <PontoCert dialog={dialog} />

      <p className="mb-3 mt-6 text-sm font-semibold">Webhook de eventos (Fase 5)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Inp label="URL do webhook (POST a cada marcação)" v={c.webhookUrl} on={(v) => set("webhookUrl", v)} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Segredo {c.webhookSecretSet ? "(definido — vazio mantém)" : ""}</span><input type="password" value={c.webhookSecret ?? ""} onChange={(e) => set("webhookSecret", e.target.value)} className="input-base" /></label>
      </div>
      <p className="mt-2 text-[11px] text-muted">Enviamos um POST JSON {`{ event, orgId, at, data }`} a cada marcação, assinado em HMAC-SHA256 no header <b>x-ponto-signature</b>. Evento: <code>ponto.punch.created</code>.</p>

      <button onClick={save} className="btn-grad mt-3">Salvar</button>
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
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Exibir até (opcional)</span><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="input-base w-auto" /></label>
          <div className="flex gap-2">
            <label className="cursor-pointer rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">{busy ? "Enviando…" : "Subir imagem"}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} /></label>
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
  <table>
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

const JKIND: Record<string, string> = { atraso: "Atraso", falta: "Falta", saida_antecipada: "Saída antecipada", abono: "Abono / atestado", feriado: "Feriado", facultativo: "Ponto facultativo", folga_premium: "Folga premium", extra: "Hora extra", ajuste: "Ajuste de horário", outro: "Correção / outro" };
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
        {items.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nada por aqui.</p> : items.map((j) => (
          <div key={j.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
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
    <section className="card mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Espelhos do mês (contabilidade)</p>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input-base w-auto" />
        {data && <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">{data.signed}/{data.total} assinados</span>}
        <a href={`/api/ponto/espelho/lote.pdf?refMonth=${month}`} target="_blank" rel="noreferrer" className="ml-auto rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Baixar lote (PDF)</a>
        <button onClick={enviar} disabled={busy} className="btn-grad disabled:opacity-50">{busy ? "Enviando…" : "Enviar à contabilidade"}</button>
        <button onClick={() => setOpen((v) => !v)} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">{open ? "ocultar" : "ver lista"}</button>
      </div>
      <p className="mt-1 text-[11px] text-muted">Gera um PDF único com o espelho de todos os funcionários ativos (com carimbo de assinatura e hash). Configure o e-mail do contador no Empregador.</p>
      {open && data && (
        <div className="mt-3 space-y-1">
          {data.items.map((i: any) => (
            <div key={i.employeeId} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm">
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
  const [editMotivo, setEditMotivo] = useState("");          // motivo gravado junto da batida
  const [jKind, setJKind] = useState("abono");               // abono/motivo lançado no dia
  const [jReason, setJReason] = useState("");
  const [jHoras, setJHoras] = useState("");                  // abono PARCIAL de horas (ex.: 03:00 ou 3)
  const [bank, setBank] = useState<any>(null);
  // Pra "Lançar/ajustar batidas" (caixa abaixo do espelho): substitui as do dia
  // por padrão — antes era OFF e duplicava se você relançasse o mesmo dia.
  const [pReplace, setPReplace] = useState(true);
  const [bulkReplace, setBulkReplace] = useState(true);
  // Estado da busca: "idle" antes de selecionar funcionário; "loading" enquanto
  // carrega; "error" se o API devolveu erro (com a mensagem pra debugar); "ok"
  // quando temos data. Antes a UI mostrava "Selecione um funcionário..." pra
  // QUALQUER `data` falsy, escondendo erros de API.
  const [loadState, setLoadState] = useState<{ status: "idle" | "loading" | "ok" | "error"; error?: string }>({ status: "idle" });
  const load = async () => {
    if (!empId) { setData(null); setLoadState({ status: "idle" }); return; }
    setLoadState({ status: "loading" });
    try {
      const r = await fetch(`/api/ponto/espelho?employeeId=${empId}&from=${range.from}&to=${range.to}`, { credentials: "include", headers: { "x-no-loading": "1" } });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = j?.error?.message ?? j?.message ?? `HTTP ${r.status}`;
        setData(null);
        setLoadState({ status: "error", error: msg });
        return;
      }
      setData(j);
      setLoadState({ status: "ok" });
    } catch (e: any) {
      setData(null);
      setLoadState({ status: "error", error: e?.message ?? "erro de rede" });
    }
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
  function openEdit(d: any) { const { form, snack } = punchesToForm(d.punches ?? []); setEditDay(d.day); setEditForm(form); setEditSnack(snack); setEditMotivo(""); setJKind("abono"); setJReason(""); setJHoras(""); }
  // "03:00" ou "3" ou "3,5" → minutos
  function parseAbonoMin(s: string): number {
    const t = s.trim(); if (!t) return 0;
    if (t.includes(":")) { const [h, m] = t.split(":"); return (Number(h) || 0) * 60 + (Number(m) || 0); }
    return Math.round((Number(t.replace(",", ".")) || 0) * 60);
  }
  async function saveEdit() {
    const times = formToTimes(editForm, editSnack);
    if (!empId || !editDay || !times.length) { dialog.toast("Informe ao menos a entrada", "error"); return; }
    setBusy(true);
    try {
      // replaceDay: anula as batidas anteriores do dia (não duplica) e grava só esta edição.
      // motivo: opcional, fica gravado na batida pra auditoria.
      const res = await fetch("/api/ponto/punches/manual", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, days: [{ day: editDay, times }], replaceDay: true, motivo: editMotivo.trim() || undefined }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao alterar", "error"); return; }
      setEditDay(null); dialog.toast("Batidas atualizadas ✅", "success"); load();
    } finally { setBusy(false); }
  }
  // Lança um abono/motivo direto no dia (do editar-dia) — já entra APROVADO,
  // justificando a falta/ajuste na hora (sem precisar ir na aba de justificativas).
  async function lancarMotivoDia(day: string) {
    if (!empId || !jReason.trim()) { dialog.toast("Descreva o motivo", "error"); return; }
    // abono PARCIAL de horas: só quando o tipo é "abono" e informou horas
    const abonoMin = jKind === "abono" ? parseAbonoMin(jHoras) : 0;
    const proposed = abonoMin > 0 ? { abonoMinutes: abonoMin } : undefined;
    setBusy(true);
    try {
      const res = await fetch("/api/ponto/justificativas", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: empId, day, kind: jKind, reason: jReason.trim(), approve: true, proposed }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) { dialog.toast(d?.error?.message ?? "Falha ao lançar motivo", "error"); return; }
      setJReason(""); setJHoras("");
      dialog.toast(abonoMin > 0 ? `Abonado ${Math.floor(abonoMin / 60)}h${String(abonoMin % 60).padStart(2, "0")} ✅` : "Motivo lançado e dia justificado ✅", "success");
      load();
    } finally { setBusy(false); }
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base w-auto">
          <option value="">— funcionário —</option>
          {emps.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className="text-sm">De <input type="date" value={range.from} onChange={(e) => {
          const v = e.target.value; setRange((r) => ({ from: v, to: v && r.to && v > r.to ? v : r.to }));
        }} className="input-base w-auto" /></label>
        <label className="text-sm">Até <input type="date" value={range.to} onChange={(e) => {
          const v = e.target.value; setRange((r) => ({ from: v && r.from && v < r.from ? v : r.from, to: v }));
        }} className="input-base w-auto" /></label>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {[0, -1, -2].map((n) => (
            <button key={n} onClick={() => setRange(monthShift(n))} title={n === 0 ? "Mês atual" : n === -1 ? "Mês anterior" : `${-n} meses atrás`}
              className={`rounded-md border px-2 py-1 capitalize hover:border-brand ${range.from === monthShift(n).from && range.to === monthShift(n).to ? "border-brand bg-brand/10 text-brand" : "border-line text-muted"}`}>
              {n === 0 ? "Mês atual" : n === -1 ? "Anterior" : shiftLabel(n)}
            </button>
          ))}
        </div>
        {data && <button onClick={() => csvEspelho(data, range)} className="ml-auto rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">CSV</button>}
        {data && <button onClick={() => printEspelho(data, range)} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Imprimir / PDF</button>}
        {data && empId && <button onClick={() => {
          // Cache-buster por timestamp: o navegador (ou viewer inline de PDF) ama
          // cachear PDFs com URL idêntica. Cada clique abre uma URL diferente,
          // garantindo que se a funcionária reassinou, o PDF novo aparece.
          const ts = Math.floor(Date.now() / 1000);
          window.open(`/api/ponto/espelho/recibo.pdf?employeeId=${empId}&refMonth=${range.from.slice(0, 7)}&_ts=${ts}`, "_blank", "noreferrer");
        }} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Espelho assinado</button>}
      </div>

      {loadState.status === "loading" ? (
        <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Carregando espelho…</p>
      ) : loadState.status === "error" ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm">
          <p className="font-semibold text-red-300">Falha ao carregar o espelho</p>
          <p className="mt-1 text-muted">{loadState.error}</p>
          <p className="mt-2 text-[11px] text-muted">Se o erro menciona a coluna <code>voided</code>, aplique a migration <code>186_ponto_punch_voided.sql</code> no banco.</p>
        </div>
      ) : !data ? <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Selecione um funcionário e o período.</p> : (
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm print:border-0 print:bg-white print:text-black">
          <div className="mb-3">
            <p className="text-lg font-semibold">Espelho de ponto</p>
            <p className="text-sm text-muted print:text-black">{data.employer} · {data.employee.name}{data.employee.cargo ? ` — ${data.employee.cargo}` : ""}{data.schedule ? ` · escala ${data.schedule.name}` : " · sem escala"}</p>
            <p className="text-xs text-muted print:text-black">Período {range.from} a {range.to}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-muted print:text-black"><tr>
                <th className="px-2 py-1">Dia</th><th className="px-2 py-1">Marcações</th><th className="px-2 py-1">Prev.</th><th className="px-2 py-1">Trab.</th><th className="px-2 py-1">Extra</th><th className="px-2 py-1">Atraso</th><th className="px-2 py-1">Falta</th><th className="px-2 py-1">Not.</th><th className="px-2 py-1">Saldo</th><th className="px-2 py-1 print:hidden"></th>
              </tr></thead>
              <tbody>
                {data.days.map((d: any) => (
                  <Fragment key={d.day}>
                  <tr className={`border-t border-line/60 ${d.divergence ? "bg-amber-500/10" : ""} ${d.faltaMin && !d.justified && !d.isFuture ? "bg-red-500/5" : ""} ${!d.isWorkDay || d.isFuture ? "text-muted" : ""}`}>
                    <td className="px-2 py-1 whitespace-nowrap">{d.day.slice(8)}/{d.day.slice(5, 7)} <span className="text-[10px]">{WD[d.wd]}</span>{d.justified ? " ✅" : ""}{d.isFuture ? <span className="ml-1 text-[9px] text-muted">futuro</span> : null}{d.dsrLost ? <span title="DSR perdido (falta injustificada na semana)" className="ml-1 rounded bg-red-500/20 px-1 text-[9px] font-semibold text-red-300">DSR</span> : null}</td>
                    <td className="px-2 py-1 font-mono text-xs">{d.punches.join(" ") || (d.isFuture ? "·" : d.special ? <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] not-italic text-sky-300" title={d.specialReason || ""}>{d.specialReason || "abonado"}</span> : d.isWorkDay ? "—" : "folga")}{d.abonoMin > 0 ? <span className="ml-1 rounded bg-green-500/15 px-1 py-0.5 text-[9px] not-italic text-green-300" title="abono de horas (pago)">ab {d.hm.abonoMin}</span> : null}</td>
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
                    <tr className="border-t border-line/40 bg-surface-2 print:hidden">
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
                          <label className="text-[10px] uppercase text-muted">Motivo da batida (opcional)
                            <input value={editMotivo} onChange={(e) => setEditMotivo(e.target.value)} placeholder="ex.: esqueceu de bater" className="mt-0.5 block w-[200px] rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm outline-none focus:border-brand" />
                          </label>
                          <button onClick={saveEdit} disabled={busy} className="btn-grad ml-auto px-4 py-1.5 disabled:opacity-50">{busy ? "Salvando…" : "Alterar"}</button>
                        </div>
                        <p className="mt-1.5 text-[11px] text-muted">Reajustar substitui as batidas anteriores do dia (não duplica). As anuladas ficam guardadas para auditoria (Portaria 671 — nada é apagado).</p>

                        {/* Motivos / abonos do dia (#3): mostra os já lançados e permite lançar inline (já aprovado) */}
                        <div className="mt-2 border-t border-line/30 pt-2">
                          <p className="text-[11px] font-medium text-muted">Motivos / abonos deste dia</p>
                          {(d.justifications ?? []).length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {(d.justifications ?? []).map((j: any, idx: number) => (
                                <span key={idx} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${j.status === "approved" ? "bg-green-500/15 text-green-300" : j.status === "rejected" ? "bg-red-500/15 text-red-300" : "bg-line text-muted"}`}>
                                  <b>{JKIND[j.kind] ?? j.kind}</b>: {j.reason}{j.status !== "approved" ? ` (${j.status === "rejected" ? "recusado" : "pendente"})` : ""}
                                </span>
                              ))}
                            </div>
                          ) : <p className="mt-0.5 text-[11px] text-muted">Nenhum motivo lançado neste dia.</p>}
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            <select value={jKind} onChange={(e) => setJKind(e.target.value)} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm">
                              <option value="abono">Abono / atestado</option>
                              <option value="feriado">Feriado</option>
                              <option value="facultativo">Ponto facultativo</option>
                              <option value="folga_premium">Folga premium</option>
                              <option value="ajuste">Ajuste</option>
                              <option value="outro">Outro</option>
                            </select>
                            <input value={jReason} onChange={(e) => setJReason(e.target.value)} placeholder="Motivo (ex.: atestado, feriado municipal, ponte de feriado…)" className="min-w-[200px] flex-1 rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm outline-none focus:border-brand" />
                            {jKind === "abono" && (
                              <label className="text-[10px] uppercase text-muted">Abonar horas (opcional)
                                <input value={jHoras} onChange={(e) => setJHoras(e.target.value)} placeholder="ex.: 03:00 ou 3" className="mt-0.5 block w-[110px] rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm outline-none focus:border-brand" />
                              </label>
                            )}
                            <button onClick={() => lancarMotivoDia(d.day)} disabled={busy} className="rounded-lg border border-brand/50 px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/10 disabled:opacity-50">Lançar</button>
                          </div>
                          <p className="mt-1 text-[11px] text-muted">Já entra <b>aprovado</b>. <b>Abono</b> sem horas = dia inteiro abonado; <b>com horas</b> = abono parcial (ex.: trabalhou 08–13 e abona o resto) — paga o déficit e vai pra folha como abono.</p>
                        </div>
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
        <div className="card mt-4 print:hidden">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Lançar / ajustar batidas</p>
            <button onClick={() => setBulkOpen((v) => !v)} className="rounded-xl border border-line px-3 py-1.5 text-xs transition hover:border-brand/60 hover:text-brand">{bulkOpen ? "Fechar lançamento em massa" : "Lançamento em massa (migração)"}</button>
          </div>
          {!bulkOpen ? (
            <>
              <div className="grid gap-2 sm:grid-cols-4">
                <input type="date" value={pday} onChange={(e) => setPday(e.target.value)} className="input-base" />
                <input value={ptimes} onChange={(e) => setPtimes(e.target.value)} placeholder="Horários: 08:00 12:00 13:00 18:00" className="input-base sm:col-span-3" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={lancarDia} disabled={busy} className="btn-grad disabled:opacity-50">Lançar batidas do dia</button>
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
              <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={8} placeholder={"2026-05-01 08:00 12:00 13:00 18:00\n2026-05-02 08:00 12:00 13:00 18:00\n02/05/2026 08:00 12:00"} className="input-base font-mono text-xs" />
              {(() => { const dd = parseLancamentoMassa(bulkText); const tot = dd.reduce((n, d) => n + d.times.length, 0); return <p className="mt-1 text-[11px] text-muted">Prévia: {dd.length} dia(s), {tot} batida(s).</p>; })()}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={lancarMassa} disabled={busy} className="btn-grad disabled:opacity-50">Lançar em massa</button>
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
        <div className="card mt-4 print:hidden">
          <p className="mb-2 text-sm font-semibold">Justificar divergência</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <input type="date" value={just.day} onChange={(e) => setJust((j) => ({ ...j, day: e.target.value }))} className="input-base" />
            <select value={just.kind} onChange={(e) => setJust((j) => ({ ...j, kind: e.target.value }))} className="input-base">
              {["atraso", "falta", "saida_antecipada", "abono", "extra", "outro"].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={just.reason} onChange={(e) => setJust((j) => ({ ...j, reason: e.target.value }))} placeholder="Motivo" className="input-base sm:col-span-2" />
          </div>
          <button onClick={enviarJustificativa} className="btn-grad mt-2">Enviar justificativa</button>
          <JustList employeeId={empId} dialog={dialog} />
        </div>
      )}
    </section>
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
        <div key={j.id} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
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

function Escalas({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const empty = { id: "", code: "", name: "", kind: "fixa", toleranceMin: 10, nightStart: "22:00", nightEnd: "05:00", days: WD.map(() => ["", "", "", ""]) as string[][], anchor: "", anchorEnt: "07:00", anchorSai: "19:00", onDays: 1, offDays: 1, dailyHours: "8" };
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
    const body: any = { code: f.code, name: f.name, kind: f.kind, toleranceMin: Number(f.toleranceMin), nightStart: f.nightStart, nightEnd: f.nightEnd, pattern };
    if (f.id) body.id = f.id;
    const res = await fetch("/api/ponto/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    if (!res.ok) { const d = await res.json().catch(() => null); dialog.toast(d?.error?.message ?? "Falha", "error"); return; }
    setF(empty); load(); dialog.toast(f.id ? "Escala atualizada ✅" : "Escala salva ✅", "success");
  }
  function editar(s: any) {
    const p = s.pattern ?? {};
    const days = WD.map((_, wd) => { const segs = p[String(wd)] ?? []; return [segs[0]?.[0] ?? "", segs[0]?.[1] ?? "", segs[1]?.[0] ?? "", segs[1]?.[1] ?? ""]; });
    setF({
      id: s.id, code: s.code, name: s.name, kind: s.kind, toleranceMin: s.toleranceMin, nightStart: s.nightStart, nightEnd: s.nightEnd, days,
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
      <div className="card mb-4">
        <p className="mb-3 text-sm font-semibold">{f.id ? `Editar escala ${f.code}` : "Nova escala"}{f.id && <button onClick={() => setF(empty)} className="ml-2 text-xs text-muted hover:text-fg">(cancelar edição)</button>}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="Código (casa com o do funcionário)" v={f.code} on={(v) => setF((s: any) => ({ ...s, code: v }))} />
          <Inp label="Nome" v={f.name} on={(v) => setF((s: any) => ({ ...s, name: v }))} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Tipo</span>
            <select value={f.kind} onChange={(e) => setF((s: any) => ({ ...s, kind: e.target.value }))} className="input-base"><option value="fixa">Fixa (semanal)</option><option value="12x36">12x36</option><option value="plantao">Plantão (ciclo)</option><option value="home_office">Home office (flexível)</option><option value="intermitente">Intermitente</option></select></label>
          <Inp label="Tolerância (min)" v={String(f.toleranceMin)} on={(v) => setF((s: any) => ({ ...s, toleranceMin: v }))} />
          <Inp label="Início noturno" v={f.nightStart} on={(v) => setF((s: any) => ({ ...s, nightStart: v }))} />
          <Inp label="Fim noturno" v={f.nightEnd} on={(v) => setF((s: any) => ({ ...s, nightEnd: v }))} />
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
            <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Âncora (1º dia de trabalho)</span><input type="date" value={f.anchor} onChange={(e) => setF((s: any) => ({ ...s, anchor: e.target.value }))} className="input-base" /></label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Entrada</span><input type="time" value={f.anchorEnt} onChange={(e) => setF((s: any) => ({ ...s, anchorEnt: e.target.value }))} className="input-base" /></label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Saída</span><input type="time" value={f.anchorSai} onChange={(e) => setF((s: any) => ({ ...s, anchorSai: e.target.value }))} className="input-base" /></label>
            {f.kind === "plantao" && <><Inp label="Dias trabalhados (ciclo)" v={String(f.onDays)} on={(v) => setF((s: any) => ({ ...s, onDays: v }))} /><Inp label="Dias de folga (ciclo)" v={String(f.offDays)} on={(v) => setF((s: any) => ({ ...s, offDays: v }))} /></>}
          </div>
        )}
        <button onClick={save} className="btn-grad mt-3">{f.id ? "Atualizar escala" : "Salvar escala"}</button>
      </div>
      <div className="space-y-2">
        {items.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-sm">
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
    <div className="card mt-6">
      <p className="mb-1 text-sm font-semibold">Aplicar escala em massa</p>
      <p className="mb-3 text-[11px] text-muted">Filtre por loja/cargo, marque os funcionários e aplique a mesma escala a todos. "Sem escala" remove o vínculo.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Escala</span>
          <select value={code} onChange={(e) => setCode(e.target.value)} className="input-base">
            <option value="">— sem escala (remover) —</option>
            {schedules.filter((s) => s.active).map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Loja</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="input-base">
            <option value="">todas</option>
            {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Cargo</span>
          <select value={cargo} onChange={(e) => setCargo(e.target.value)} className="input-base">
            <option value="">todos</option>
            {cargos.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Buscar nome</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} className="input-base" /></label>
      </div>
      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line/60">
        <div className="flex items-center justify-between border-b border-line/60 bg-surface-2 px-3 py-2 text-xs">
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
      <button onClick={apply} className="btn-grad mt-3">Aplicar a {selIds.length} funcionário(s)</button>
    </div>
  );
}

function Feriados({ dialog }: { dialog: any }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ day: "", name: "", kind: "feriado", recurring: false });
  const load = () => fetch("/api/ponto/holidays", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function add() {
    if (!f.day || !f.name.trim()) { dialog.toast("Data e nome obrigatórios", "error"); return; }
    const res = await fetch("/api/ponto/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(f) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    setF({ day: "", name: "", kind: "feriado", recurring: false }); load(); dialog.toast("Salvo ✅", "success");
  }
  async function remove(id: string) { await fetch(`/api/ponto/holidays/${id}/delete`, { method: "POST", credentials: "include" }); load(); }
  return (
    <div className="card mt-6">
      <p className="mb-1 text-sm font-semibold">Feriados e pontos facultativos</p>
      <p className="mb-3 text-[11px] text-muted">Valem pra empresa/loja toda. No espelho viram dia abonado: não gera falta, não desconta, e o que for trabalhado conta como hora extra. Recorrente repete todo ano na mesma data. (Para folga premium de uma pessoa só, use "Lançar motivo" no editar-dia do espelho.)</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Data</span><input type="date" value={f.day} onChange={(e) => setF((s) => ({ ...s, day: e.target.value }))} className="input-base w-auto" /></label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Tipo</span>
          <select value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value }))} className="input-base w-auto">
            <option value="feriado">Feriado</option>
            <option value="facultativo">Ponto facultativo</option>
          </select>
        </label>
        <label className="block flex-1 min-w-[180px]"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Nome</span><input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="ex.: Natal, Quarta de cinzas" className="input-base" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.recurring} onChange={(e) => setF((s) => ({ ...s, recurring: e.target.checked }))} /> repete todo ano</label>
        <button onClick={add} className="btn-grad">+ Adicionar</button>
      </div>
      <div className="mt-3 space-y-1">
        {items.map((h) => (
          <div key={h.id} className="flex items-center justify-between rounded-lg border border-line/60 bg-surface-2 px-3 py-2 text-sm">
            <span>{new Date(h.day).toLocaleDateString("pt-BR", { timeZone: "UTC" })} — {h.name}<span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${h.kind === "facultativo" ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300"}`}>{h.kind === "facultativo" ? "facultativo" : "feriado"}</span>{h.recurring && <span className="ml-2 text-[10px] uppercase text-muted">anual</span>}</span>
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
  const [f, setF] = useState<any>({ name: "", geoLat: "", geoLng: "", geoRadiusM: 150, requireGeo: false, requireSelfie: false });
  const [newLink, setNewLink] = useState<string | null>(null);
  const load = () => fetch("/api/ponto/devices", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {});
  useEffect(() => { load(); }, []);
  async function create() {
    if (!f.name.trim()) { dialog.toast("Informe um nome", "error"); return; }
    const body: any = { name: f.name, requireGeo: f.requireGeo, requireSelfie: f.requireSelfie, geoRadiusM: Number(f.geoRadiusM) || 150 };
    if (f.geoLat && f.geoLng) { body.geoLat = Number(f.geoLat); body.geoLng = Number(f.geoLng); }
    const res = await fetch("/api/ponto/devices", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.token) { dialog.toast("Falha ao criar", "error"); return; }
    setNewLink(`${window.location.origin}/ponto-app?d=${d.token}`);
    setF({ name: "", geoLat: "", geoLng: "", geoRadiusM: 150, requireGeo: false, requireSelfie: false });
    load();
  }
  async function toggleRevoke(id: string, revoked: boolean) {
    const res = await fetch(`/api/ponto/devices/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ revoked: !revoked }) });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast(revoked ? "Reativado" : "Revogado", "success"); load();
  }
  function usarMinhaLocalizacao() {
    navigator.geolocation?.getCurrentPosition((p) => setF((s: any) => ({ ...s, geoLat: p.coords.latitude.toFixed(6), geoLng: p.coords.longitude.toFixed(6) })), () => dialog.toast("Não consegui obter a localização", "error"));
  }
  return (
    <section>
      <div className="card mb-4">
        <p className="mb-1 text-sm font-semibold">Novo dispositivo (tablet/celular no balcão)</p>
        <p className="mb-3 text-[11px] text-muted">Gera um link com token. Abra esse link no aparelho da filial e instale como app (PWA). O funcionário bate o ponto por PIN, sem login.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Inp label="Nome (ex.: Balcão Loja Centro)" v={f.name} on={(v) => setF((s: any) => ({ ...s, name: v }))} />
          <Inp label="Latitude da filial" v={String(f.geoLat)} on={(v) => setF((s: any) => ({ ...s, geoLat: v }))} />
          <Inp label="Longitude da filial" v={String(f.geoLng)} on={(v) => setF((s: any) => ({ ...s, geoLng: v }))} />
          <Inp label="Raio permitido (m)" v={String(f.geoRadiusM)} on={(v) => setF((s: any) => ({ ...s, geoRadiusM: v }))} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requireGeo} onChange={(e) => setF((s: any) => ({ ...s, requireGeo: e.target.checked }))} /> Exigir GPS dentro do raio</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requireSelfie} onChange={(e) => setF((s: any) => ({ ...s, requireSelfie: e.target.checked }))} /> Exigir selfie</label>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={usarMinhaLocalizacao} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Usar minha localização</button>
          <button onClick={create} className="btn-grad">Gerar dispositivo</button>
        </div>
        {newLink && (
          <div className="mt-3 rounded-xl border border-green-500/40 bg-green-500/10 p-3 text-sm">
            <p className="font-semibold text-green-200">Link do dispositivo (mostrado só agora):</p>
            <p className="mt-1 break-all font-mono text-xs">{newLink}</p>
            <button onClick={() => { navigator.clipboard?.writeText(newLink); dialog.toast("Link copiado", "success"); }} className="mt-2 rounded border border-line px-2 py-1 text-xs">Copiar link</button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {items.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span>{d.name} <span className="text-xs text-muted">{d.requireGeo ? "· GPS" : ""}{d.requireSelfie ? " · selfie" : ""}{d.lastSeenAt ? ` · visto ${new Date(d.lastSeenAt).toLocaleString("pt-BR")}` : " · nunca usado"}</span></span>
            <button onClick={() => toggleRevoke(d.id, d.revoked)} className={`rounded border px-2 py-0.5 text-xs ${d.revoked ? "border-green-500/50 text-green-300" : "border-red-500/50 text-red-300"}`}>{d.revoked ? "Reativar" : "Revogar"}</button>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhum dispositivo cadastrado.</p>}
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
      <div className="card mb-4">
        <p className="mb-1 text-sm font-semibold">Novo aviso ao bater o ponto</p>
        <p className="mb-3 text-[11px] text-muted">Aparece no painel quando o funcionário registra o ponto. Escolha um funcionário específico ou deixe "Geral" para todos.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Destinatário</span>
            <select value={f.employeeId} onChange={(e) => setF((s) => ({ ...s, employeeId: e.target.value }))} className="input-base">
              <option value="">Geral (todos)</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Exibir até (opcional)</span><input type="date" value={f.until} onChange={(e) => setF((s) => ({ ...s, until: e.target.value }))} className="input-base" /></label>
        </div>
        <textarea value={f.message} onChange={(e) => setF((s) => ({ ...s, message: e.target.value }))} rows={2} placeholder="Mensagem do aviso" className="input-base mt-3" />
        <button onClick={create} className="btn-grad mt-3">Publicar aviso</button>
      </div>
      <div className="space-y-2">
        {items.filter((n) => n.active).map((n) => (
          <div key={n.id} className="flex items-start justify-between rounded-xl border border-line bg-surface px-3 py-2 text-sm">
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
        <div className="card">
          <p className="mb-2 text-sm font-semibold">Trabalhando agora ({rt?.present?.length ?? 0})</p>
          {(rt?.present ?? []).length === 0 ? <p className="text-sm text-muted">Ninguém com ponto aberto.</p> : (
            <ul className="space-y-1 text-sm">{rt.present.map((p: any) => <li key={p.id} className="flex justify-between"><span>🟢 {p.name}</span><span className="text-muted">desde {new Date(p.since).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
          )}
        </div>
        <div className="card">
          <p className="mb-2 text-sm font-semibold">Últimas marcações</p>
          {(rt?.lastPunches ?? []).length === 0 ? <p className="text-sm text-muted">Sem marcações hoje.</p> : (
            <ul className="space-y-1 text-sm">{rt.lastPunches.map((p: any, i: number) => <li key={i} className="flex justify-between"><span>{p.name} <span className="text-[10px] text-muted">{p.origin}</span></span><span className="text-muted">{new Date(p.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></li>)}</ul>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">IA de absenteísmo — {ref}</p>
          <button onClick={carregarIa} className="rounded-xl border border-line px-3 py-1 text-sm transition hover:border-brand/60 hover:text-brand">Analisar com IA</button>
        </div>
        {abs?.loading && <p className="mt-2 text-sm text-muted">Analisando…</p>}
        {abs?.insight && <p className="mt-2 text-sm leading-relaxed">{abs.insight}</p>}
        {abs && !abs.loading && !abs.insight && <p className="mt-2 text-sm text-muted">{abs.ranked?.length ? "IA indisponível — mostrando ranking abaixo." : "Sem dados no mês."}</p>}
        {abs?.ranked?.length > 0 && (
          <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            {abs.ranked.slice(0, 8).map((r: any, i: number) => <div key={i} className="flex justify-between rounded-lg border border-line bg-surface-2 px-2 py-1"><span>{r.name}</span><span className="text-muted">{hmMin(r.faltaMin)} falta · {r.lateMin}min atraso</span></div>)}
          </div>
        )}
      </div>
    </section>
  );
}

function Kpi({ title, value, tone }: { title: string; value: string; tone?: "green" | "amber" }) {
  const c = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : "";
  return <div className="card"><p className="text-[10px] uppercase tracking-wider text-muted">{title}</p><p className={`mt-1 text-2xl font-semibold ${c}`}>{value}</p></div>;
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
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base w-auto">
          <option value="">Selecione o funcionário</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {data && <span className={`rounded-full px-3 py-1 text-sm font-semibold ${data.balanceMin >= 0 ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>Saldo: {hmMin(data.balanceMin)}</span>}
        {data && data.expiringMin > 0 && <><span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-200" title={`créditos anteriores a ${data.cutoff}`}>A vencer: {hmMin(data.expiringMin)}</span><button onClick={expirar} className="rounded-xl border border-line px-3 py-1 text-xs transition hover:border-brand/60 hover:text-brand">lançar baixa</button></>}
      </div>
      {empId && (
        <div className="card mb-4">
          <p className="mb-2 text-sm font-semibold">Lançar no banco de horas</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Inp label="Data" v={f.day} on={(v) => setF((s) => ({ ...s, day: v }))} />
            <Inp label="Horas (+créd / −débito)" v={f.hours} on={(v) => setF((s) => ({ ...s, hours: v }))} />
            <div className="sm:col-span-2"><Inp label="Motivo" v={f.reason} on={(v) => setF((s) => ({ ...s, reason: v }))} /></div>
          </div>
          <p className="mt-1 text-[11px] text-muted">Ex.: <b>1.5</b> = +1h30 (crédito); <b>-2</b> = compensou 2h (débito).</p>
          <button onClick={add} className="btn-grad mt-2">Adicionar</button>
        </div>
      )}
      {data?.items?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><th className="px-4 py-3 font-medium">Data</th><th className="px-4 py-3 font-medium">Horas</th><th className="px-4 py-3 font-medium">Tipo</th><th className="px-4 py-3 font-medium">Motivo</th><th className="px-4 py-3 font-medium"></th></tr></thead>
            <tbody>
              {data.items.map((m: any) => (
                <tr key={m.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3">{new Date(m.day).toLocaleDateString("pt-BR")}</td>
                  <td className={`px-4 py-3 ${m.minutes >= 0 ? "text-green-300" : "text-red-300"}`}>{hmMin(m.minutes)}</td>
                  <td className="px-4 py-3 text-muted">{m.kind}</td>
                  <td className="px-4 py-3 text-muted">{m.reason ?? ""}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => del(m.id)} className="text-xs text-red-300">remover</button></td>
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
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="input-base w-auto">
          <option value="">Selecione o funcionário</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {bal && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <div className="card"><p className="text-[10px] uppercase tracking-wider text-muted">Saldo de férias</p><p className={`mt-1 text-xl font-semibold ${bal.balanceDays != null && bal.balanceDays < 0 ? "text-danger" : "text-success"}`}>{bal.balanceDays != null ? `${bal.balanceDays} dias` : "—"}</p></div>
          <div className="card"><p className="text-[10px] uppercase tracking-wider text-muted">Direito acumulado</p><p className="mt-1 text-xl font-semibold">{bal.accruedDays != null ? `${bal.accruedDays} dias` : "—"}</p><p className="mt-0.5 text-[11px] text-muted">{bal.completedPeriods} período(s)</p></div>
          <div className="card"><p className="text-[10px] uppercase tracking-wider text-muted">Já agendado/gozado</p><p className="mt-1 text-xl font-semibold">{bal.usedDays} dias</p></div>
          <div className="card"><p className="text-[10px] uppercase tracking-wider text-muted">Próx. período vence</p><p className="mt-1 text-sm font-semibold">{bal.nextPeriodStart ? new Date(bal.nextPeriodStart).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"}</p>{!bal.admissionDate && <p className="mt-0.5 text-[11px] text-muted">sem admissão no cadastro</p>}</div>
        </div>
      )}
      {empId && (
        <div className="card mb-4">
          <p className="mb-2 text-sm font-semibold">Agendar férias</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Inp label="Início" v={f.startDate} on={(v) => setF((s) => ({ ...s, startDate: v }))} />
            <Inp label="Dias (1–30)" v={f.days} on={(v) => setF((s) => ({ ...s, days: v }))} />
            <div className="sm:col-span-2"><Inp label="Observação" v={f.notes} on={(v) => setF((s) => ({ ...s, notes: v }))} /></div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.thirteenthAdvance} onChange={(e) => setF((s) => ({ ...s, thirteenthAdvance: e.target.checked }))} /> Adiantar 1ª parcela do 13º junto</label>
          <p className="mt-1 text-[11px] text-muted">Período: {f.startDate ? `${new Date(f.startDate + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })} até ${endOf(f.startDate, parseInt(f.days || "30", 10) || 30)}` : ""}.</p>
          <button onClick={add} className="btn-grad mt-2">Agendar</button>
        </div>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><th className="px-4 py-3 font-medium">Período</th><th className="px-4 py-3 font-medium">Dias</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium"></th></tr></thead>
            <tbody>
              {items.map((v) => (
                <tr key={v.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3">{new Date(v.startDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })} – {endOf(String(v.startDate).slice(0, 10), v.days)}{v.thirteenthAdvance && <span className="ml-2 text-[10px] uppercase text-muted">+13º</span>}</td>
                  <td className="px-4 py-3">{v.days}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${(STATUS[v.status] ?? STATUS.scheduled!).c}`}>{(STATUS[v.status] ?? STATUS.scheduled!).l}</span></td>
                  <td className="px-4 py-3 text-right">
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
  const load = () => {
    fetch(`/api/ponto/fechamento/${ref}/resumo`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setSum).catch(() => {});
    fetch(`/api/ponto/fechamento/${ref}`, { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then(setClosing).catch(() => {});
  };
  useEffect(() => { load(); }, [ref]);
  async function act(path: string, ok: string) {
    const res = await fetch(`/api/ponto/fechamento/${ref}/${path}`, { method: "POST", credentials: "include" });
    if (!res.ok) { dialog.toast("Falha", "error"); return; }
    dialog.toast(ok, "success"); load();
  }
  async function baixarCsv() {
    const res = await fetch(`/api/ponto/fechamento/${ref}/export.csv`, { credentials: "include" });
    const d = await res.json().catch(() => null); if (!res.ok || !d) { dialog.toast("Falha", "error"); return; }
    const blob = new Blob(["﻿" + (d.content ?? "")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `folha-${ref}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  async function baixarAej() {
    const r = sum; if (!r) return;
    const res = await fetch(`/api/ponto/aej?from=${r.from}&to=${r.to}`, { credentials: "include" });
    const d = await res.json().catch(() => null); if (!res.ok || !d) { dialog.toast("Falha ao gerar AEJ", "error"); return; }
    const blob = new Blob([d.content ?? ""], { type: "text/plain;charset=iso-8859-1" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `AEJ-${ref}.txt`; a.click(); URL.revokeObjectURL(a.href);
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
        <input type="month" value={ref} onChange={(e) => setRef(e.target.value)} className="input-base w-auto" />
        <span className={`rounded-full px-3 py-1 text-xs ${st === "closed" ? "bg-green-500/15 text-green-300" : st === "manager" ? "bg-amber-500/15 text-amber-300" : "bg-surface-2 text-muted"}`}>{st === "closed" ? "fechado (RH)" : st === "manager" ? "aprovado pelo gestor" : "aberto"}</span>
        <div className="ml-auto flex gap-2">
          {st === "open" && <button onClick={() => act("aprovar-gestor", "Aprovado pelo gestor")} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Aprovar (gestor)</button>}
          {st === "manager" && <button onClick={() => act("fechar-rh", "Fechado pelo RH")} className="btn-grad px-3">Fechar (RH)</button>}
          {st !== "open" && <button onClick={() => act("reabrir", "Reaberto")} className="rounded-xl border border-line px-3 py-2 text-sm">Reabrir</button>}
          <button onClick={baixarCsv} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Export CSV</button>
          <button onClick={baixarAej} className="rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Gerar AEJ</button>
        </div>
      </div>
      {sum?.rows?.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><th className="px-4 py-3 font-medium">Funcionário</th><th className="px-4 py-3 font-medium">Prev.</th><th className="px-4 py-3 font-medium">Trab.</th><th className="px-4 py-3 font-medium">Extras</th><th className="px-4 py-3 font-medium">Not.</th><th className="px-4 py-3 font-medium">Atraso</th><th className="px-4 py-3 font-medium">Faltas</th><th className="px-4 py-3 font-medium">Saldo</th><th className="px-4 py-3 font-medium">Banco</th></tr></thead>
            <tbody>
              {sum.rows.map((r: any) => (
                <tr key={r.employeeId} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3">{hmMin(r.expectedMin)}</td>
                  <td className="px-4 py-3">{hmMin(r.workedMin)}</td>
                  <td className="px-4 py-3 text-green-300">{hmMin(r.extraMin)}</td>
                  <td className="px-4 py-3">{hmMin(r.nightMin)}</td>
                  <td className="px-4 py-3 text-amber-300">{hmMin(r.lateMin)}</td>
                  <td className="px-4 py-3 text-red-300">{hmMin(r.faltaMin)}</td>
                  <td className={`px-4 py-3 ${r.balanceMin >= 0 ? "text-green-300" : "text-red-300"}`}>{hmMin(r.balanceMin)}</td>
                  <td className="px-4 py-3">{hmMin(r.bankBalanceMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Sem dados no mês.</p>}
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
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <span className={st.expired ? "text-red-300" : "text-green-300"}>{st.expired ? "⚠ vencido" : "✓ ativo"}</span>
          <span><b>{st.subject}</b></span>
          {st.notAfter && <span className="text-muted">válido até {new Date(st.notAfter).toLocaleDateString("pt-BR")}</span>}
          <button onClick={remove} className="ml-auto rounded-lg border border-red-500/50 px-3 py-1 text-xs text-red-300">Remover</button>
        </div>
      ) : <p className="text-[11px] text-muted">Nenhum certificado configurado — o AFD sai sem assinatura.</p>}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Senha do certificado</span><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="input-base w-auto" /></label>
        <label className="cursor-pointer rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">{busy ? "Validando…" : st.configured ? "Trocar .pfx" : "Subir .pfx"}<input type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" onChange={onFile} /></label>
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
      <div className="card mb-4">
        <p className="mb-1 text-sm font-semibold">Webhook de eventos — pronto pra esta empresa</p>
        <p className="mb-3 text-[11px] text-muted">Todo evento (ex.: ponto batido) já fica gravado aqui no feed abaixo — você <b>não precisa</b> de servidor externo. Se quiser empurrar pra outro sistema (ex.: seu ERP), informe uma URL externa.</p>
        <div className="grid gap-3">
          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Segredo (HMAC) desta empresa</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">{info?.secret ?? "…"}</code>
              <button onClick={() => info?.secret && copy(info.secret)} className="rounded-xl border border-line px-3 py-2 text-xs transition hover:border-brand/60 hover:text-brand">Copiar</button>
              <button onClick={regen} className="rounded-xl border border-line px-3 py-2 text-xs transition hover:border-brand/60 hover:text-brand">Gerar novo</button>
            </div>
            <p className="mt-1 text-[10px] text-muted">Assinatura enviada no header <code>x-ponto-signature = sha256(segredo + corpo)</code>.</p>
          </div>
          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Consultar eventos (puxar do seu sistema)</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">GET {origin}/api/ponto/eventos</code>
              <button onClick={() => copy(`${origin}/api/ponto/eventos`)} className="rounded-xl border border-line px-3 py-2 text-xs transition hover:border-brand/60 hover:text-brand">Copiar</button>
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">URL externa (opcional — empurra cada evento via POST)</span>
            <div className="flex items-center gap-2">
              <input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="https://seu-sistema.com/webhook" className="input-base flex-1" />
              <button onClick={savePush} className="btn-grad">Salvar</button>
            </div>
            <p className="mt-1 text-[10px] text-muted">Pra testar grátis, gere uma URL em webhook.site e cole aqui.</p>
          </div>
        </div>
      </div>

      <p className="mb-2 text-sm font-semibold">Feed de eventos (atualiza sozinho)</p>
      {items.length === 0 ? <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Nenhum evento ainda. Bata um ponto e ele aparece aqui.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted"><th className="px-4 py-3 font-medium">Quando</th><th className="px-4 py-3 font-medium">Evento</th><th className="px-4 py-3 font-medium">Dados</th><th className="px-4 py-3 font-medium">Externo</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{new Date(e.createdAt).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3"><code className="text-xs">{e.event}</code></td>
                  <td className="px-4 py-3 text-xs text-muted">{e.payload?.employeeName ?? ""}{e.payload?.nsr ? ` · NSR ${e.payload.nsr}` : ""}</td>
                  <td className="px-4 py-3 text-xs">{e.targetUrl ? (e.delivered ? <span className="text-green-300">entregue {e.statusCode ?? ""}</span> : <span className="text-red-300">falhou {e.statusCode ?? ""}</span>) : <span className="text-muted">—</span>}</td>
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
      <button onClick={() => setOpen(true)} className="mt-3 rounded-xl border border-line px-3 py-2 text-sm transition hover:border-brand/60 hover:text-brand">Testar reconhecimento</button>
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
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
          <button disabled={busy} onClick={testar} className="btn-grad flex-1 py-2 disabled:opacity-50">{busy ? "Analisando…" : "Capturar e testar"}</button>
        </div>
      </div>
    </div>
  );
}

function Inp({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">{label}</span><input value={v ?? ""} onChange={(e) => on(e.target.value)} className="input-base" /></label>;
}
