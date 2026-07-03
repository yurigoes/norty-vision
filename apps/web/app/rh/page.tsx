"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CLT_DOCS, cltDocLabel } from "../../lib/clt-docs";

function brl(c: number | null | undefined): string {
  return ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
const PONTO_LABEL: Record<string, string> = { in: "Entrada", out: "Saída", break_out: "Saída p/ almoço", break_in: "Volta do almoço", snack_out: "Saída p/ lanche", snack_in: "Volta do lanche" };
const KIND_LABEL: Record<string, string> = { vacation: "Férias", advance: "Vale", shift_swap: "Troca de horário", absence_justify: "Justificar falta", expense: "Reembolso" };

export default function EmployeePortal() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"home" | "dados" | "ponto" | "holerite" | "emprestimos" | "comissoes" | "solicitacoes" | "documentos">("home");

  const reload = useCallback(() => {
    fetch("/api/employee/me", { credentials: "include" })
      .then((r) => { if (r.status === 401) { router.push("/rh/login"); return null; } return r.json(); })
      .then((d) => {
        if (d) {
          if (d.employee?.mustResetPassword) { router.push("/rh/redefinir"); return; }
          setData(d);
          // aplica a cor da empresa
          const hex = d.brand?.primaryColor;
          if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
            const i = parseInt(hex.slice(1), 16);
            document.documentElement.style.setProperty("--brand", `${(i >> 16) & 255} ${(i >> 8) & 255} ${i & 255}`);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [router]);
  useEffect(() => { reload(); }, [reload]);

  async function logout() {
    await fetch("/api/employee/auth/logout", { method: "POST", credentials: "include" });
    router.push("/rh/login");
  }

  if (loading || !data) return <div className="flex min-h-screen items-center justify-center text-muted">Carregando...</div>;
  const e = data.employee;

  const brand = data.brand;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Marca: empresa do funcionário + yugo */}
      <div className="mb-5 flex items-center justify-between border-b border-line pb-3">
        {brand?.logoUrl ? (
          <img src={brand.logoUrl} alt={brand.name ?? ""} className="h-9 w-auto max-w-[160px] object-contain" />
        ) : (
          <span className="text-sm font-semibold">{brand?.name ?? "Portal do funcionário"}</span>
        )}
        <span className="text-[11px] text-muted">powered by <strong className="text-brand">yugo</strong></span>
      </div>

      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {e.photoUrl ? (
            <img src={e.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-bg/60 text-xl text-muted" aria-hidden>🧑</div>
          )}
          <div>
            <h1 className="text-2xl font-semibold">Olá, {String(e.name).split(" ")[0]}</h1>
            <p className="text-sm text-muted">{e.roleTitle ?? "Funcionário"}</p>
          </div>
        </div>
        <button onClick={logout} className="text-sm text-muted hover:text-red-300">Sair</button>
      </header>

      <nav className="mb-5 flex flex-wrap gap-2 border-b border-line">
        {([["home", "Início"], ["dados", "Meus dados"], ["ponto", "Ponto"], ["holerite", "Holerite"], ["emprestimos", "Empréstimos"], ["comissoes", "Comissões"], ["solicitacoes", "Solicitações"], ["documentos", "Documentos"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${tab === k ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </nav>

      {tab === "home" && <Home data={data} onGoDados={() => setTab("dados")} />}
      {tab === "dados" && <Dados data={data} onChanged={reload} />}
      {tab === "ponto" && <Ponto data={data} onChanged={reload} />}
      {tab === "holerite" && <Holerite />}
      {tab === "emprestimos" && <Emprestimos />}
      {tab === "comissoes" && <Comissoes />}
      {tab === "solicitacoes" && <Solicitacoes salaryCents={e.salaryCents} />}
      {tab === "documentos" && <Documentos />}
    </main>
  );
}

function Home({ data, onGoDados }: { data: any; onGoDados: () => void }) {
  const shifts: any[] = data.shifts ?? [];
  const notices: any[] = data.notices ?? [];
  const e = data.employee ?? {};
  const incompleto = !e.phone && !e.whatsappPhone || !e.email;
  return (
    <div className="space-y-6">
      {incompleto && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4">
          <p className="text-sm text-orange-200">⚠ Complete seu cadastro (contato e endereço) para o RH manter seus dados em dia.</p>
          <button onClick={onGoDados} className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Completar</button>
        </div>
      )}
      <ScheduleCalendar />
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Próximos turnos</h2>
        {shifts.length === 0 ? <p className="text-sm text-muted">Sem escala cadastrada.</p> : (
          <div className="space-y-1">
            {shifts.slice(0, 7).map((s) => (
              <div key={s.id} className="flex justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
                <span>{new Date(s.shiftDate).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })}</span>
                <span className="text-muted">{s.startTime}–{s.endTime}{s.lunchStart && s.lunchEnd ? ` · 🍴${s.lunchStart}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Mural</h2>
        {notices.length === 0 ? <p className="text-sm text-muted">Sem avisos.</p> : (
          <div className="space-y-2">
            {notices.map((n) => (
              <div key={n.id} className="rounded-lg border border-line bg-bg/60 p-4">
                <p className="font-medium">{n.pinned ? "📌 " : ""}{n.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ScheduleCalendar() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [days, setDays] = useState<any[] | null>(null);
  useEffect(() => {
    setDays(null);
    fetch(`/api/employee/attendance?month=${month}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDays(d?.days ?? []))
      .catch(() => setDays([]));
  }, [month]);
  const hasInfo = (days ?? []).some((d) => d.status && d.status !== "folga");

  const byDate = new Map<string, any>((days ?? []).map((d) => [d.date, d]));
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y!, m! - 1, 1));
  const daysInMonth = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const leading = first.getUTCDay(); // 0=dom
  const cells: Array<{ day: number; date: string } | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, date: `${month}-${String(d).padStart(2, "0")}` });

  const dot: Record<string, string> = { worked: "bg-green-500", agendado: "bg-brand", falta: "bg-red-500", atestado: "bg-blue-400", folga: "bg-transparent" };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Minha escala</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-xs" />
      </div>
      {days === null ? <p className="text-sm text-muted">Carregando...</p> : (
        <div className="rounded-xl border border-line bg-bg/60 p-3">
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-muted">
            {["D", "S", "T", "Q", "Q", "S", "S"].map((w, i) => <div key={i}>{w}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((c, i) => {
              if (!c) return <div key={i} />;
              const info = byDate.get(c.date);
              const sh = info?.shift;
              return (
                <div key={i} className="min-h-[52px] rounded-md border border-line/60 bg-bg/40 p-1 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium">{c.day}</span>
                    {info && <span className={`h-1.5 w-1.5 rounded-full ${dot[info.status] ?? "bg-transparent"}`} />}
                  </div>
                  {sh?.start ? (
                    <p className="mt-0.5 text-[9px] leading-tight text-muted">{sh.start}<br />{sh.end}</p>
                  ) : info && info.status !== "folga" ? (
                    <p className="mt-0.5 text-[9px] text-muted">{info.status === "falta" ? "falta" : info.status === "atestado" ? "atest." : ""}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-green-500" /> trabalhado</span>
            <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-brand" /> escala</span>
            <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-red-500" /> falta</span>
            <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-blue-400" /> atestado</span>
          </div>
          {!hasInfo && <p className="mt-2 text-[11px] text-muted">Sem escala definida nem batidas neste mês. Quando o RH definir sua escala (ou você registrar ponto no relógio), os dias aparecem aqui.</p>}
        </div>
      )}
    </section>
  );
}

function Ponto(_props: { data: any; onChanged: () => void }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-bg/60 p-4 text-sm text-muted">
        ⏱️ O registro de ponto é feito no <b>relógio (kiosk)</b> da empresa. Aqui você acompanha seu espelho, escala, banco de horas e férias — e pode <b>pedir correção/justificar</b> um dia no Espelho do mês.
      </div>
      <EspelhoMes />
      <EspelhoOficial />
      <BancoHoras />
      <MinhasFerias />
      <TimeSheets />
    </div>
  );
}

function EspelhoOficial() {
  // Default: MÊS ANTERIOR (caso típico — funcionário assina o mês que o RH
  // acabou de fechar). Antes era o mês corrente, que sempre está aberto e
  // não pode ser assinado.
  const [month, setMonth] = useState(() => {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    return prev.toISOString().slice(0, 7);
  });
  const [sig, setSig] = useState<any>(null);
  const [closing, setClosing] = useState<{ status: string; hrAt: string | null } | null>(null);
  const [canSign, setCanSign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true); setErr(null);
    fetch(`/api/employee/espelho/signature?month=${month}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setSig(d?.signature ?? null); setClosing(d?.closing ?? null); setCanSign(!!d?.canSign); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [month]);
  useEffect(() => { load(); }, [load]);
  async function assinar() {
    if (!canSign) return;
    if (!window.confirm("Confirmo que conferi meu espelho de ponto deste mês e assino eletronicamente. Sua assinatura fica registrada com data, hora e IP (e certificado digital da empresa, se disponível).")) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/employee/espelho/sign", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ month }) });
      const j = await res.json().catch(() => null);
      if (res.ok) load();
      else setErr(j?.error?.message ?? "Falha ao assinar");
    } finally { setBusy(false); }
  }
  const monthLabel = month.slice(5, 7) + "/" + month.slice(0, 4);
  const isOpen = closing && closing.status !== "closed";
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Espelho oficial (assinatura)</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-xs" />
      </div>
      <div className="rounded-xl border border-line bg-bg/60 p-4 text-sm">
        {loading ? <p className="text-muted">Carregando…</p> : sig ? (
          <div className="space-y-2">
            <p className="text-green-300">✓ Assinado em {new Date(sig.signedAt).toLocaleString("pt-BR")}{sig.a1Signed ? " · certificado digital (ICP-Brasil)" : " · assinatura eletrônica"}</p>
            <p className="break-all text-[10px] text-muted">SHA-256: {sig.contentHash}</p>
            <a href={`/api/employee/espelho/pdf?month=${month}`} target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Ver PDF assinado</a>
          </div>
        ) : isOpen ? (
          <div className="space-y-2">
            <p className="text-amber-300">⏳ A folha de <b>{monthLabel}</b> ainda não foi fechada pelo RH.</p>
            <p className="text-xs text-muted">Você só pode assinar o espelho depois que o RH encerrar o mês. Normalmente é o mês anterior — escolha o seletor acima.</p>
            <a href={`/api/employee/espelho/pdf?month=${month}`} target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Conferir PDF (sem assinar)</a>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-muted">Você ainda não assinou o espelho de <b>{monthLabel}</b>.</p>
            <div className="flex gap-2">
              <a href={`/api/employee/espelho/pdf?month=${month}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Conferir PDF</a>
              <button onClick={assinar} disabled={busy || !canSign} className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Assinando…" : "Assinar espelho"}</button>
            </div>
            {err && <p className="text-xs text-red-300">{err}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function hmMin(min: number): string { const a = Math.abs(Math.round(min)); return `${min < 0 ? "-" : ""}${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}`; }

function BancoHoras() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/employee/bank", { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}); }, []);
  if (!data || (data.items?.length ?? 0) === 0) return null;
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Banco de horas</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${data.balanceMin >= 0 ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>Saldo: {hmMin(data.balanceMin)}</span>
      </div>
      <div className="space-y-1">
        {data.items.slice(0, 30).map((m: any) => (
          <div key={m.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
            <span>{new Date(m.day).toLocaleDateString("pt-BR", { timeZone: "UTC" })}{m.reason ? ` · ${m.reason}` : ""}</span>
            <span className={m.minutes >= 0 ? "text-green-300" : "text-red-300"}>{hmMin(m.minutes)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MinhasFerias() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/employee/vacations", { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {}); }, []);
  if (!data) return null;
  const b = data.balance;
  const items: any[] = data.items ?? [];
  if (!b?.admissionDate && items.length === 0) return null;
  const STATUS: Record<string, string> = { scheduled: "agendada", taken: "gozada", canceled: "cancelada" };
  const endOf = (s: string, d: number) => { const x = new Date(String(s).slice(0, 10) + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + d - 1); return x.toLocaleDateString("pt-BR", { timeZone: "UTC" }); };
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Minhas férias</h2>
      {b?.balanceDays != null && (
        <div className="mb-2 flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg border border-line bg-bg/60 px-3 py-2">Saldo: <b className={b.balanceDays < 0 ? "text-red-300" : "text-green-300"}>{b.balanceDays} dias</b></span>
          {b.nextPeriodStart && <span className="rounded-lg border border-line bg-bg/60 px-3 py-2 text-muted">Próx. período vence em {new Date(b.nextPeriodStart).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>}
        </div>
      )}
      {items.length === 0 ? <p className="text-sm text-muted">Nenhuma férias agendada. Solicite na aba Solicitações.</p> : (
        <div className="space-y-1">
          {items.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <span>{new Date(v.startDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })} – {endOf(v.startDate, v.days)} ({v.days} dias)</span>
              <span className="text-xs text-muted">{STATUS[v.status] ?? v.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const SIT_BADGE: Record<string, { label: string; cls: string }> = {
  worked: { label: "OK", cls: "bg-green-500/20 text-green-300" },
  falta: { label: "FALTA", cls: "bg-red-500/20 text-red-300" },
  atestado: { label: "Atestado", cls: "bg-brand/20 text-brand" },
  agendado: { label: "Agendado", cls: "bg-line text-muted" },
  folga: { label: "Folga", cls: "bg-line text-muted" },
};

function EspelhoMes() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [summary, setSummary] = useState<any>(null);
  const [justify, setJustify] = useState<string | null>(null); // data sendo justificada

  const load = useCallback(async () => {
    const res = await fetch(`/api/employee/attendance?month=${month}`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setSummary(d);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const days: any[] = summary?.days ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Espelho do mês</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-xs" />
      </div>
      {days.length === 0 ? <p className="text-sm text-muted">Carregando...</p> : (
        <div className="space-y-1">
          {days.filter((d) => d.status !== "folga" || d.marks?.in).map((d) => {
            const badge = SIT_BADGE[d.status] ?? SIT_BADGE.folga!;
            const canJustify = (d.status === "falta") || (d.status === "worked" && d.date <= today && (!d.marks?.in || !d.marks?.out));
            return (
              <div key={d.date} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
                <div>
                  <span className="font-mono text-xs">{new Date(d.date + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })}</span>
                  {d.shift && <span className="ml-2 text-xs text-muted">escala {d.shift.start}–{d.shift.end}</span>}
                  {d.marks?.in && <span className="ml-2 text-xs">· {d.marks.in}{d.marks.out ? `–${d.marks.out}` : ""}</span>}
                  {d.internalCode && <span className="ml-2 text-[10px] text-brand">{d.internalCode}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>{badge.label}</span>
                  {d.justification?.status === "pending" ? <span className="text-[10px] text-orange-300">em análise</span>
                    : canJustify && <button onClick={() => setJustify(d.date)} className="text-xs text-brand hover:underline">justificar</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {justify && <JustifyModal date={justify} onClose={() => setJustify(null)} onDone={() => { setJustify(null); load(); }} />}
    </section>
  );
}

function JustifyModal({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"forgot_punch" | "medical">("forgot_punch");
  const [times, setTimes] = useState({ in: "08:00", break_in: "12:00", break_out: "13:00", out: "17:00" });
  const [daysCount, setDaysCount] = useState("1");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function uploadDoc(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/employee/upload", { method: "POST", body: fd, credentials: "include" });
      const d = await res.json(); if (res.ok) setAttachmentUrl(d.url);
    } finally { setUploading(false); }
  }

  async function submit() {
    setErr(null); setBusy(true);
    try {
      const body: any = { refDate: date, kind, note: note || null };
      if (kind === "forgot_punch") body.proposed = times;
      if (kind === "medical") { body.attachmentUrl = attachmentUrl; body.daysCount = Number(daysCount) || 1; }
      const res = await fetch("/api/employee/justifications", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const d = await res.json(); if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg/90 p-6 backdrop-blur-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Justificar {new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}</h3>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setKind("forgot_punch")} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${kind === "forgot_punch" ? "border-brand bg-brand/15" : "border-line text-muted"}`}>Esqueci de bater</button>
          <button onClick={() => setKind("medical")} className={`flex-1 rounded-lg border px-3 py-2 text-sm ${kind === "medical" ? "border-brand bg-brand/15" : "border-line text-muted"}`}>Atestado</button>
        </div>

        {kind === "forgot_punch" ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(["in", "break_in", "break_out", "out"] as const).map((k) => (
              <label key={k} className="block"><span className="mb-1 block text-[10px] uppercase text-muted">{PONTO_LABEL[k]}</span>
                <input type="time" value={(times as any)[k]} onChange={(e) => setTimes({ ...times, [k]: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
              </label>
            ))}
            <p className="col-span-2 text-[11px] text-muted">Os horários ficam pendentes de aprovação da supervisão.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Dias de atestado</span>
              <input type="number" min={1} max={60} value={daysCount} onChange={(e) => setDaysCount(e.target.value)} className="w-24 rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
            </label>
            <label className="inline-block cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">
              {uploading ? "Enviando..." : attachmentUrl ? "✓ atestado anexado" : "+ Anexar atestado"}
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.currentTarget.value = ""; }} />
            </label>
            <p className="text-[11px] text-muted">Ex.: 2 dias a partir de {new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}. Após aprovação, os dias entram como atestado com código interno.</p>
          </div>
        )}

        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional)" className="mt-3 w-full rounded border border-line bg-bg/60 px-3 py-2 text-sm" />
        {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
          <button onClick={submit} disabled={busy || (kind === "medical" && !attachmentUrl)} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Enviando..." : "Enviar justificativa"}</button>
        </div>
      </div>
    </div>
  );
}

function PontoEntry({ t, onChanged }: { t: any; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function request() {
    if (!to || reason.trim().length < 2) { setMsg("Informe o horário e o motivo."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/employee/time-entries/${t.id}/request-edit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ requestedTo: new Date(to).toISOString(), reason }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      setOpen(false); onChanged();
    } catch (e: any) { setMsg(`Erro: ${e.message}`); } finally { setBusy(false); }
  }

  return (
    <div className="rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <span>{PONTO_LABEL[t.kind] ?? t.kind}</span>
        <span className="flex items-center gap-2 text-muted">
          {new Date(t.happenedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{t.selfieUrl ? " · 📷" : ""}{t.lat != null ? " · 📍" : ""}
          {t.editStatus === "pending" ? <span className="text-orange-300">edição pendente</span>
            : t.editStatus === "approved" ? <span className="text-green-300">ajustado</span>
            : <button onClick={() => setOpen((v) => !v)} className="text-brand hover:underline">corrigir</button>}
        </span>
      </div>
      {open && t.editStatus !== "pending" && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-line/40 pt-2">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Horário correto</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" /></label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" className="flex-1 rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
          <button onClick={request} disabled={busy} className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Enviar p/ supervisão</button>
          {msg && <span className="text-xs text-red-300">{msg}</span>}
        </div>
      )}
    </div>
  );
}

function TimeSheets() {
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(async () => {
    const res = await fetch("/api/employee/time-sheets", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function sign(id: string) {
    // assinatura simples: gera uma imagem-marca a partir do nome (sem canvas elaborado aqui)
    const blob = await new Promise<Blob | null>((resolve) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 80;
      const ctx = c.getContext("2d")!; ctx.fillStyle = "#111"; ctx.font = "20px serif";
      ctx.fillText("Assinado eletronicamente", 10, 45); c.toBlob(resolve, "image/png");
    });
    if (!blob) return;
    const fd = new FormData(); fd.append("file", new File([blob], "sign.png", { type: "image/png" }));
    const up = await fetch("/api/employee/upload", { method: "POST", body: fd, credentials: "include" });
    const ud = await up.json(); if (!up.ok) return;
    await fetch(`/api/employee/time-sheets/${id}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ signatureImageUrl: ud.url }) });
    load();
  }

  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Espelho de ponto</h2>
      <div className="space-y-1">
        {items.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
            <span>{new Date(s.refMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            <div className="flex items-center gap-3">
              <a href={`/api/employee/time-sheets/${s.id}/sheet`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">PDF</a>
              {s.status === "signed" ? <span className="text-green-300">✓ assinado</span> :
                <button onClick={() => sign(s.id)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white">Assinar</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Holerite() {
  const [items, setItems] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const load = useCallback(async () => {
    const res = await fetch("/api/employee/payslips", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
    const lr = await fetch("/api/employee/loans", { credentials: "include", cache: "no-store" });
    const ld = await lr.json(); if (lr.ok) setLoans((ld.items ?? []).filter((l: any) => l.status !== "paid"));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function ack(id: string) {
    await fetch(`/api/employee/payslips/${id}/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
    load();
  }

  return (
    <div className="space-y-3">
      {/* Empréstimos ativos: descontos que entram no holerite */}
      {loans.length > 0 && (
        <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-4">
          <p className="text-sm font-semibold">Empréstimos em andamento (descontados na folha)</p>
          {loans.map((l) => {
            const next = (l.installments ?? []).find((i: any) => i.status !== "paid");
            const paid = (l.installments ?? []).filter((i: any) => i.status === "paid").length;
            return (
              <p key={l.id} className="mt-1 text-xs text-muted">
                {brl(Number(l.principalCents))} em {l.installmentsCount}x · {paid}/{l.installmentsCount} pagas
                {next ? ` · próxima: ${brl(Number(next.amountCents))} (${new Date(next.dueMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })})` : ""}
              </p>
            );
          })}
          <p className="mt-1 text-[11px] text-muted">Acompanhe cada parcela na aba Empréstimos.</p>
        </div>
      )}

      {items.length === 0 ? <p className="text-sm text-muted">Nenhum holerite disponível.</p> :
      items.map((p) => (
        <div key={p.id} className="rounded-lg border border-line bg-bg/60 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{new Date(p.refMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
            <span className="text-sm">{p.netCents != null ? brl(Number(p.netCents)) : ""}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            {p.fileUrl && !String(p.fileUrl).startsWith("priv:") && <a href={p.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">ver holerite</a>}
            {p.acknowledgedAt ? <span className="text-xs text-green-300">✓ ciência em {new Date(p.acknowledgedAt).toLocaleDateString("pt-BR")}</span> :
              <button onClick={() => ack(p.id)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white">Dar ciência</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Comissoes() {
  const [items, setItems] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/employee/commissions", { credentials: "include", cache: "no-store" })
      .then((r) => r.json()).then((d) => setItems(d.items ?? [])).finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="text-sm text-muted">Carregando...</p>;
  if (items.length === 0) return <p className="text-sm text-muted">Nenhuma comissão registrada. (Aparece aqui quando o RH gera/paga seu repasse de comissão.)</p>;
  return (
    <div className="space-y-2">
      {items.map((c) => (
        <div key={c.id} className="rounded-lg border border-line bg-bg/60 p-4">
          <div className="flex items-center justify-between">
            <p className="font-medium">{brl(Number(c.totalCents))}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${c.status === "paid" ? "bg-green-500/20 text-green-300" : "bg-orange-500/20 text-orange-300"}`}>{c.status === "paid" ? "pago" : "pendente"}</span>
            </p>
            <span className="text-xs text-muted">{c.paidAt ? `pago em ${new Date(c.paidAt).toLocaleDateString("pt-BR")}` : new Date(c.createdAt).toLocaleDateString("pt-BR")}</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            {c.periodStart ? `${new Date(c.periodStart).toLocaleDateString("pt-BR")} a ${c.periodEnd ? new Date(c.periodEnd).toLocaleDateString("pt-BR") : "—"}` : ""}
            {c.salesCount ? ` · ${c.salesCount} venda(s)` : ""}{c.commissionPct != null ? ` · ${c.commissionPct}%` : ""}
            {c.paymentMethod ? ` · ${c.paymentMethod}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function Solicitacoes({ salaryCents }: { salaryCents: number | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState<any[]>([]);
  const [kind, setKind] = useState<"vacation" | "advance" | "shift_swap" | "absence_justify" | "expense" | "atestado">("vacation");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  // prévia do período do atestado (início + dias, inclusivo)
  const atestadoEnd = (() => {
    const s = new Date((from || today) + "T12:00:00Z");
    s.setUTCDate(s.getUTCDate() + (Number(days) || 1) - 1);
    return s.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  })();
  // troca de horário
  const [coworkers, setCoworkers] = useState<any[]>([]);
  const [coworkerId, setCoworkerId] = useState("");
  const [coworkerShifts, setCoworkerShifts] = useState<any[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/employee/requests", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (kind !== "shift_swap" || coworkers.length) return;
    fetch("/api/employee/coworkers", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => setCoworkers(d.items ?? []));
  }, [kind, coworkers.length]);

  useEffect(() => {
    if (kind !== "shift_swap" || !coworkerId || !from) { setCoworkerShifts([]); return; }
    fetch(`/api/employee/coworkers/${coworkerId}/shifts?date=${from}`, { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => setCoworkerShifts(d.items ?? []));
  }, [kind, coworkerId, from]);

  const maxAdvance = salaryCents != null ? Math.round(salaryCents * 0.4) : null;

  async function uploadAttachment(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/employee/upload", { method: "POST", body: fd, credentials: "include" });
      const d = await res.json(); if (res.ok) setAttachmentUrl(d.url);
    } finally { setUploading(false); }
  }

  async function create() {
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      // Atestado médico: vai pra justificativa de ponto (kind medical), começando
      // no dia informado (padrão hoje) + N dias; fica "em análise" pro RH aprovar.
      if (kind === "atestado") {
        if (!attachmentUrl) throw new Error("Anexe o atestado (PDF ou foto).");
        const refDate = from || today;
        const res = await fetch("/api/employee/justifications", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ refDate, kind: "medical", attachmentUrl, daysCount: Number(days) || 1, note: reason || null }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
        setReason(""); setFrom(""); setDays("1"); setAttachmentUrl("");
        setOkMsg(`Atestado enviado (${Number(days) || 1} dia(s), até ${atestadoEnd}). Em análise pelo RH.`);
        return;
      }
      const payload: any = { reason };
      if (kind === "vacation" || kind === "absence_justify") { payload.from = from; payload.to = to; }
      if (kind === "shift_swap") {
        if (!coworkerId || !from) throw new Error("Escolha o colega e a data do turno.");
        payload.withEmployeeId = coworkerId; payload.date = from;
      }
      const body: any = { kind, payload };
      if (kind === "advance" || kind === "expense") body.amountCents = amount ? Math.round(Number(amount.replace(",", ".")) * 100) : 0;
      if ((kind === "expense" || kind === "absence_justify") && attachmentUrl) body.attachmentUrl = attachmentUrl;
      const res = await fetch("/api/employee/requests", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      setReason(""); setAmount(""); setFrom(""); setTo(""); setAttachmentUrl(""); setCoworkerId(""); setCoworkerShifts([]); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function cancel(id: string) { await fetch(`/api/employee/requests/${id}/cancel`, { method: "POST", credentials: "include" }); load(); }

  return (
    <div className="space-y-5">
      <SwapsToAccept />

      <div className="space-y-3 rounded-xl border border-line bg-bg/60 p-4">
        <p className="text-sm font-medium">Nova solicitação</p>
        <select value={kind} onChange={(e) => setKind(e.target.value as any)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
          <option value="vacation">Férias</option><option value="advance">Vale/adiantamento</option>
          <option value="shift_swap">Troca de horário</option><option value="absence_justify">Justificar falta</option>
          <option value="atestado">Atestado médico</option>
          <option value="expense">Reembolso de despesa</option>
        </select>
        {kind === "atestado" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <label className="block flex-1"><span className="mb-1 block text-[10px] uppercase text-muted">Início (1º dia)</span>
                <input type="date" value={from || today} onChange={(e) => setFrom(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
              </label>
              <label className="block w-28"><span className="mb-1 block text-[10px] uppercase text-muted">Dias</span>
                <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
              </label>
            </div>
            <p className="text-[11px] text-muted">Período: {new Date((from || today) + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })} até <b>{atestadoEnd}</b> ({Number(days) || 1} dia(s)). Fica em análise pro RH aprovar.</p>
            <label className="inline-block cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">
              {uploading ? "Enviando..." : attachmentUrl ? "✓ atestado anexado" : "+ Anexar atestado"}
              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.currentTarget.value = ""; }} />
            </label>
          </div>
        )}
        {(kind === "vacation" || kind === "absence_justify") && (
          <div className="flex gap-2">
            <label className="block flex-1"><span className="mb-1 block text-[10px] uppercase text-muted">De</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" /></label>
            <label className="block flex-1"><span className="mb-1 block text-[10px] uppercase text-muted">Até</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" /></label>
          </div>
        )}
        {kind === "shift_swap" && (
          <div className="space-y-2">
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Colega (cujo turno você quer assumir)</span>
              <select value={coworkerId} onChange={(e) => setCoworkerId(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
                <option value="">— selecione —</option>
                {coworkers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Data do turno</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
            </label>
            {coworkerId && from && (
              coworkerShifts.length > 0
                ? <p className="text-xs text-green-300">Turno do colega nesse dia: {coworkerShifts.map((s) => `${s.startTime}–${s.endTime}`).join(", ")}</p>
                : <p className="text-xs text-muted">O colega não tem turno cadastrado nesse dia (a troca ainda pode ser solicitada).</p>
            )}
          </div>
        )}
        {kind === "advance" && (
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Valor (R$){maxAdvance != null ? ` · máx ${brl(maxAdvance)}` : ""}</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
          </label>
        )}
        {kind === "expense" && (
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Valor (R$)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
          </label>
        )}
        {(kind === "expense" || kind === "absence_justify") && (
          <label className="inline-block cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">
            {uploading ? "Enviando..." : attachmentUrl ? "✓ anexo (nota/atestado)" : "+ Anexar nota/atestado"}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f); e.currentTarget.value = ""; }} />
          </label>
        )}
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Observação</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
        </label>
        {err && <p className="text-xs text-red-300">{err}</p>}
        {okMsg && <p className="text-xs text-green-300">{okMsg}</p>}
        <button onClick={create} disabled={busy || (kind === "atestado" && !attachmentUrl)} className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Enviando..." : kind === "atestado" ? "Enviar atestado" : "Enviar solicitação"}</button>
      </div>

      <div className="space-y-2">
        {items.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/60 p-3 text-sm">
            <div>
              <p className="font-medium">{KIND_LABEL[r.kind] ?? r.kind}{r.amountCents != null ? ` · ${brl(Number(r.amountCents))}` : ""}</p>
              <p className="text-xs text-muted">
                {new Date(r.createdAt).toLocaleDateString("pt-BR")}
                {r.kind === "shift_swap" && r.payload?.date ? ` · turno de ${r.payload?.date}` : (r.payload?.from ? ` · ${r.payload.from}${r.payload.to ? ` a ${r.payload.to}` : ""}` : "")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={r.status} />
              {r.kind === "shift_swap" && r.status === "approved" && (
                <a href={`/api/hr/requests/${r.id}/swap-receipt`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">recibo</a>
              )}
              {r.status === "pending" && <button onClick={() => cancel(r.id)} className="text-xs text-muted hover:text-red-300">cancelar</button>}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhuma solicitação.</p>}
      </div>
    </div>
  );
}

function SwapsToAccept() {
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(() => {
    fetch("/api/employee/swaps-to-accept", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, accept: boolean) {
    await fetch(`/api/employee/swaps/${id}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ accept }) });
    load();
  }

  if (items.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-orange-500/40 bg-orange-500/10 p-4">
      <p className="text-sm font-medium">Trocas de horário aguardando seu de acordo</p>
      {items.map((s) => (
        <div key={s.id} className="flex items-center justify-between rounded-lg border border-line bg-bg/60 p-3 text-sm">
          <div>
            <p className="font-medium">{s.requesterName} quer assumir seu turno{s.date ? ` em ${new Date(s.date + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}</p>
            {s.reason && <p className="text-xs text-muted">{s.reason}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => decide(s.id, true)} className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white">Aceitar</button>
            <button onClick={() => decide(s.id, false)} className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-red-300">Recusar</button>
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted">Após seu de acordo, a gestão ainda precisa aprovar.</p>
    </div>
  );
}

function Boneco3D({ photoUrl }: { photoUrl: string | null }) {
  if (photoUrl) return <img src={photoUrl} alt="" className="h-20 w-20 rounded-full object-cover" />;
  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/15">
      <svg viewBox="0 0 24 24" className="h-12 w-12 text-brand" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1z" /></svg>
    </div>
  );
}

function Dados({ data, onChanged }: { data: any; onChanged: () => void }) {
  const e = data.employee ?? {};
  const [f, setF] = useState({
    phone: e.phone ?? "", whatsappPhone: e.whatsappPhone ?? "", email: e.email ?? "",
    addressLine: e.addressLine ?? "", addressNumber: e.addressNumber ?? "", addressComplement: e.addressComplement ?? "",
    neighborhood: e.neighborhood ?? "", city: e.city ?? "", state: e.state ?? "", postalCode: e.postalCode ?? "",
  });
  const [photoUrl, setPhotoUrl] = useState<string | null>(e.photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/employee/upload", { method: "POST", body: fd, credentials: "include" });
      const d = await res.json(); if (res.ok) { setPhotoUrl(d.url); await save({ photoUrl: d.url }); }
    } finally { setUploading(false); }
  }

  async function save(extra?: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/employee/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...f, ...(extra ?? {}) }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d?.error?.message ?? "Falha"); }
      setMsg("Dados salvos."); onChanged();
    } catch (e: any) { setMsg(`Erro: ${e.message}`); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Boneco3D photoUrl={photoUrl} />
        <label className="cursor-pointer rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">
          {uploading ? "Enviando..." : photoUrl ? "Trocar foto" : "Adicionar foto"}
          <input type="file" accept="image/*" capture="user" className="hidden" onChange={(ev) => { const file = ev.target.files?.[0]; if (file) uploadPhoto(file); ev.currentTarget.value = ""; }} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telefone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
        <Field label="WhatsApp" value={f.whatsappPhone} onChange={(v) => setF({ ...f, whatsappPhone: v })} />
        <Field label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
        <Field label="CEP" value={f.postalCode} onChange={(v) => setF({ ...f, postalCode: v })} />
        <Field label="Endereço" value={f.addressLine} onChange={(v) => setF({ ...f, addressLine: v })} />
        <Field label="Número" value={f.addressNumber} onChange={(v) => setF({ ...f, addressNumber: v })} />
        <Field label="Complemento" value={f.addressComplement} onChange={(v) => setF({ ...f, addressComplement: v })} />
        <Field label="Bairro" value={f.neighborhood} onChange={(v) => setF({ ...f, neighborhood: v })} />
        <Field label="Cidade" value={f.city} onChange={(v) => setF({ ...f, city: v })} />
        <Field label="UF" value={f.state} onChange={(v) => setF({ ...f, state: v })} />
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <button onClick={() => save()} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando..." : "Salvar dados"}</button>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-3 py-2 text-sm" />
    </label>
  );
}

function Emprestimos() {
  const [loans, setLoans] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/employee/loans", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => setLoans(d.items ?? [])).finally(() => setLoaded(true));
  }, []);
  if (!loaded) return <p className="text-sm text-muted">Carregando...</p>;
  if (loans.length === 0) return <p className="text-sm text-muted">Nenhum empréstimo contratado.</p>;
  return (
    <div className="space-y-4">
      {loans.map((l) => {
        const paid = (l.installments ?? []).filter((i: any) => i.status === "paid").length;
        return (
          <div key={l.id} className="rounded-xl border border-line bg-bg/60 p-5">
            <div className="flex items-center justify-between">
              <p className="font-medium">{brl(Number(l.principalCents))} em {l.installmentsCount}x de {brl(Number(l.installmentCents))}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${l.status === "paid" ? "bg-green-500/20 text-green-300" : "bg-orange-500/20 text-orange-300"}`}>{l.status === "paid" ? "quitado" : `${paid}/${l.installmentsCount} pagas`}</span>
            </div>
            <div className="mt-3 space-y-1">
              {(l.installments ?? []).map((i: any) => (
                <div key={i.id} className="flex items-center justify-between border-b border-line/40 py-1.5 text-sm last:border-0">
                  <span className="font-mono text-xs">{i.number}. {new Date(i.dueMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })}</span>
                  <span>{brl(Number(i.amountCents))}</span>
                  <span className={`text-xs ${i.status === "paid" ? "text-green-300" : "text-muted"}`}>{i.status === "paid" ? `pago ${i.paidAt ? new Date(i.paidAt).toLocaleDateString("pt-BR") : ""}` : "em aberto"}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const WARN_LBL: Record<string, string> = { advertencia_verbal: "Advertência verbal", advertencia_escrita: "Advertência escrita", suspensao: "Suspensão" };
function MinhasAdvertencias() {
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(() => { fetch("/api/employee/warnings", { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  async function ack(id: string) {
    if (!window.confirm("Confirmar ciência desta advertência? Sua ciência fica registrada com data e hora.")) return;
    await fetch(`/api/employee/warnings/${id}/acknowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
    load();
  }
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Advertências / ocorrências</h2>
      <div className="space-y-2">
        {items.map((w) => (
          <div key={w.id} className={`rounded-lg border p-3 text-sm ${!w.acknowledgedAt ? "border-orange-500/40 bg-orange-500/10" : "border-line bg-bg/60"}`}>
            <div className="flex items-center justify-between">
              <p className="font-medium">{WARN_LBL[w.kind] ?? w.kind}{w.kind === "suspensao" && w.suspensionDays ? ` (${w.suspensionDays} dias)` : ""}</p>
              <span className="text-xs text-muted">{new Date(w.date).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{w.reason}</p>
            <div className="mt-2 flex items-center gap-3">
              {w.fileUrl && <a href={w.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">ver documento</a>}
              {w.acknowledgedAt ? <span className="text-xs text-green-300">✓ ciência em {new Date(w.acknowledgedAt).toLocaleDateString("pt-BR")}</span> : <button onClick={() => ack(w.id)} className="rounded bg-brand px-3 py-1 text-xs font-semibold text-white">Dar ciência</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const EXAM_LBL: Record<string, string> = { admissional: "Admissional", periodico: "Periódico", demissional: "Demissional", retorno: "Retorno", mudanca_funcao: "Mudança de função" };
function MeusExames() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { fetch("/api/employee/exams", { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {}); }, []);
  if (items.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Exames ocupacionais (ASO)</h2>
      <div className="space-y-1">
        {items.map((x) => {
          const due = x.dueDate ? String(x.dueDate).slice(0, 10) : null;
          return (
            <div key={x.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <span>{EXAM_LBL[x.kind] ?? x.kind}{x.examDate ? ` · ${new Date(x.examDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}{x.result ? ` · ${x.result}` : ""}</span>
              <span className="flex items-center gap-3 text-xs">
                {due && <span className={due < today ? "text-red-300" : "text-muted"}>vence {new Date(due + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>}
                {x.fileUrl && <a href={x.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver</a>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MeusTreinamentos() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { fetch("/api/employee/trainings", { credentials: "include", cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setItems(d?.items ?? [])).catch(() => {}); }, []);
  if (items.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Treinamentos / certificações</h2>
      <div className="space-y-1">
        {items.map((x) => {
          const due = x.dueDate ? String(x.dueDate).slice(0, 10) : null;
          return (
            <div key={x.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <span>{x.name}{x.completedDate ? ` · ${new Date(x.completedDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}{x.hours ? ` · ${x.hours}h` : ""}</span>
              <span className="flex items-center gap-3 text-xs">
                {due && <span className={due < today ? "text-red-300" : "text-muted"}>vence {new Date(due + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>}
                {x.fileUrl && <a href={x.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver</a>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Documentos() {
  const [items, setItems] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState(CLT_DOCS[0]?.key ?? "outro");
  const load = useCallback(async () => {
    const res = await fetch("/api/employee/documents", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await fetch("/api/employee/upload", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (!up.ok) return;
      await fetch("/api/employee/documents", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ docType, title: cltDocLabel(docType), fileUrl: ud.url }) });
      load();
    } finally { setUploading(false); }
  }

  return (
    <div className="space-y-5">
      <MinhasAdvertencias />
      <MeusExames />
      <MeusTreinamentos />
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-bg/60 p-3">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo do documento</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
            {CLT_DOCS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label className="cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          {uploading ? "Enviando..." : "+ Enviar"}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
        <span className="text-[11px] text-muted">O RH analisa e aprova/recusa cada documento.</span>
      </div>
      <div className="space-y-1">
        {items.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
            <span>{cltDocLabel(d.docType)}{d.title && d.title !== cltDocLabel(d.docType) ? ` · ${d.title}` : ""}</span>
            <span className="flex items-center gap-3">
              <StatusPill status={d.status} />
              {d.status === "rejected" && d.reviewNote && <span className="text-[11px] text-red-300" title={d.reviewNote}>motivo</span>}
              {!String(d.fileUrl).startsWith("priv:") && <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">ver</a>}
            </span>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhum documento.</p>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { pending: "bg-orange-500/20 text-orange-300", approved: "bg-green-500/20 text-green-300", rejected: "bg-red-500/20 text-red-300", canceled: "bg-line text-muted" };
  const label: Record<string, string> = { pending: "pendente", approved: "aprovada", rejected: "recusada", canceled: "cancelada" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${map[status] ?? "bg-line text-muted"}`}>{label[status] ?? status}</span>;
}
