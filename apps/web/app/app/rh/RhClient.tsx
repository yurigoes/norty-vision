"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Modal em portal pro <body>: escapa de qualquer ancestral com transform/filter
 * (ex.: wrapper de animação de rota) que escopa o position:fixed e jogava o
 * modal "muito em cima". Painel com efeito vidro (translúcido + blur).
 */
function Modal({ onClose, children, maxWidth = "max-w-xl" }: { onClose: () => void; children: React.ReactNode; maxWidth?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${maxWidth} overflow-y-auto rounded-2xl border border-line/60 bg-bg/80 p-6 shadow-2xl backdrop-blur-xl`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface Store { id: string; name: string }
interface Employee {
  id: string; name: string; cpf: string | null; roleTitle: string | null;
  storeId: string | null; salaryCents: number | null; status: string;
  phone: string | null; whatsappPhone: string | null; email: string | null;
  admissionDate: string | null; photoUrl?: string | null;
}

function Boneco3D({ photoUrl, size = 36 }: { photoUrl: string | null | undefined; size?: number }) {
  if (photoUrl) return <img src={photoUrl} alt="" style={{ width: size, height: size }} className="rounded-full object-cover" />;
  return (
    <div style={{ width: size, height: size }} className="flex items-center justify-center rounded-full bg-brand/15">
      <svg viewBox="0 0 24 24" className="text-brand" style={{ width: size * 0.6, height: size * 0.6 }} fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1z" /></svg>
    </div>
  );
}

function brl(c: number | null | undefined): string {
  return ((Number(c) || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function onlyDigits(s: string) { return s.replace(/\D/g, ""); }

const KIND_LABEL: Record<string, string> = {
  vacation: "Férias", advance: "Vale/adiantamento", shift_swap: "Troca de horário", absence_justify: "Justificar falta", expense: "Reembolso de despesa",
};

export function RhClient({ initialEmployees, stores }: { initialEmployees: Employee[]; stores: Store[] }) {
  const [tab, setTab] = useState<"painel" | "funcionarios" | "holerite" | "emprestimos" | "solicitacoes" | "ponto" | "escala" | "mural" | "fechamento">("painel");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-line">
        <Tab active={tab === "painel"} onClick={() => setTab("painel")}>Painel</Tab>
        <Tab active={tab === "funcionarios"} onClick={() => setTab("funcionarios")}>Funcionários</Tab>
        <Tab active={tab === "holerite"} onClick={() => setTab("holerite")}>Holerite</Tab>
        <Tab active={tab === "emprestimos"} onClick={() => setTab("emprestimos")}>Empréstimos</Tab>
        <Tab active={tab === "solicitacoes"} onClick={() => setTab("solicitacoes")}>Solicitações</Tab>
        <Tab active={tab === "ponto"} onClick={() => setTab("ponto")}>Ponto</Tab>
        <Tab active={tab === "mural"} onClick={() => setTab("mural")}>Mural</Tab>
      </div>

      {tab === "painel" && <RhDashboard />}
      {tab === "funcionarios" && <Employees initialEmployees={initialEmployees} stores={stores} />}
      {tab === "holerite" && <HoleriteOrg employees={initialEmployees} />}
      {tab === "emprestimos" && <EmprestimosOrg employees={initialEmployees} />}
      {tab === "solicitacoes" && <Requests />}
      {tab === "ponto" && <PontoMoved />}
      {tab === "mural" && <Mural stores={stores} />}
    </div>
  );
}

function Fechamento() {
  const [s, setS] = useState<{ closingDay: number; paymentDay: number; dailyHours: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [folhaMes, setFolhaMes] = useState(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    fetch("/api/hr/settings", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => {
      const x = d.settings ?? {};
      setS({ closingDay: Number(x.closingDay ?? 30), paymentDay: Number(x.paymentDay ?? 5), dailyHours: Number(String(x.dailyHours ?? 8)) });
    });
  }, []);

  async function save() {
    if (!s) return;
    setMsg(null);
    const res = await fetch("/api/hr/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(s) });
    setMsg(res.ok ? "Salvo." : "Falha ao salvar.");
  }

  if (!s) return <p className="text-sm text-muted">Carregando...</p>;
  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-muted">
        Define a competência da folha: o espelho de ponto fecha do dia seguinte ao
        fechamento do mês anterior até o dia de fechamento deste mês.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Dia de fechamento</span>
          <input type="number" min={1} max={31} value={s.closingDay} onChange={(e) => setS({ ...s, closingDay: Number(e.target.value) })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Dia do pagamento</span>
          <input type="number" min={1} max={31} value={s.paymentDay} onChange={(e) => setS({ ...s, paymentDay: Number(e.target.value) })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
        </label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Jornada diária (h)</span>
          <input type="number" step="0.5" min={0} max={24} value={s.dailyHours} onChange={(e) => setS({ ...s, dailyHours: Number(e.target.value) })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
        </label>
      </div>
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <button onClick={save} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white">Salvar</button>

      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="text-sm font-medium">Folha de fechamento (PDF)</p>
        <p className="mt-1 text-xs text-muted">Consolidado do mês com horas trabalhadas, saldo, faltas, atestados e salário de todos os funcionários — com o logo e a cor da empresa.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Mês (competência)</span>
            <input type="month" value={folhaMes} onChange={(e) => setFolhaMes(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
          </label>
          <button
            onClick={() => window.open(`/api/hr/payroll/${folhaMes}/sheet`, "_blank")}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Baixar folha (PDF)
          </button>
        </div>
      </div>

      <Geocerca />
    </div>
  );
}

function Geocerca() {
  const [stores, setStores] = useState<any[]>([]);
  const [edit, setEdit] = useState<Record<string, { geoLat: string; geoLng: string; geoRadiusM: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/hr/geofences", { credentials: "include", cache: "no-store" });
    const d = await res.json();
    if (res.ok) {
      setStores(d.items ?? []);
      setEdit(Object.fromEntries((d.items ?? []).map((s: any) => [s.id, {
        geoLat: s.geoLat != null ? String(s.geoLat) : "", geoLng: s.geoLng != null ? String(s.geoLng) : "", geoRadiusM: s.geoRadiusM != null ? String(s.geoRadiusM) : "",
      }])));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function useMyLocation(id: string) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => {
      setEdit((e) => ({ ...e, [id]: { ...e[id]!, geoLat: p.coords.latitude.toFixed(6), geoLng: p.coords.longitude.toFixed(6) } }));
    });
  }

  async function save(id: string) {
    setMsg(null);
    const v = edit[id]!;
    const res = await fetch(`/api/hr/geofences/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ geoLat: v.geoLat ? Number(v.geoLat) : null, geoLng: v.geoLng ? Number(v.geoLng) : null, geoRadiusM: v.geoRadiusM ? Number(v.geoRadiusM) : null }),
    });
    setMsg(res.ok ? "Geocerca salva." : "Falha ao salvar.");
  }

  if (stores.length === 0) return null;
  return (
    <div className="mt-8 border-t border-line pt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Geocerca do ponto (raio por loja)</h3>
      <p className="mt-1 text-xs text-muted">Defina a localização da loja e o raio (m). Batidas fora do raio são <strong>sinalizadas</strong> (não bloqueadas).</p>
      <div className="mt-3 space-y-2">
        {stores.map((s) => {
          const v = edit[s.id] ?? { geoLat: "", geoLng: "", geoRadiusM: "" };
          return (
            <div key={s.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-bg/60 p-3">
              <span className="min-w-[120px] text-sm font-medium">{s.name}</span>
              <Inp label="Lat" value={v.geoLat} onChange={(val) => setEdit((e) => ({ ...e, [s.id]: { ...v, geoLat: val } }))} />
              <Inp label="Lng" value={v.geoLng} onChange={(val) => setEdit((e) => ({ ...e, [s.id]: { ...v, geoLng: val } }))} />
              <Inp label="Raio (m)" value={v.geoRadiusM} onChange={(val) => setEdit((e) => ({ ...e, [s.id]: { ...v, geoRadiusM: val } }))} />
              <button onClick={() => useMyLocation(s.id)} className="rounded border border-line px-3 py-1.5 text-xs hover:border-brand">usar minha localização</button>
              <button onClick={() => save(s.id)} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white">Salvar</button>
            </div>
          );
        })}
      </div>
      {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
    </div>
  );
}

// ============================== HOLERITE (visão da empresa) ==============================
function HoleriteOrg({ employees }: { employees: Employee[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ employeeId: employees[0]?.id ?? "", refMonth: new Date().toISOString().slice(0, 7), gross: "", net: "", fileUrl: "" });
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/hr/payslips", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const toCents = (s: string) => Math.round((parseFloat((s || "0").replace(/\./g, "").replace(",", ".")) || 0) * 100);
  async function upload(file: File) {
    setUploading(true);
    try { const fd = new FormData(); fd.append("file", file); fd.append("purpose", "holerite"); const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" }); const ud = await up.json(); if (up.ok) setF((s) => ({ ...s, fileUrl: ud.url })); } finally { setUploading(false); }
  }
  async function save() {
    if (!f.employeeId) return;
    const res = await fetch("/api/hr/payslips", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: f.employeeId, refMonth: f.refMonth + "-01", grossCents: toCents(f.gross) || null, netCents: toCents(f.net) || null, fileUrl: f.fileUrl || null }) });
    if (res.ok) { setF((s) => ({ ...s, gross: "", net: "", fileUrl: "" })); load(); }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-2 text-sm font-semibold">Lançar holerite</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Funcionário</span>
            <select value={f.employeeId} onChange={(e) => setF((s) => ({ ...s, employeeId: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <Inp label="Competência" type="month" value={f.refMonth} onChange={(v) => setF((s) => ({ ...s, refMonth: v }))} />
          <Inp label="Bruto (R$)" value={f.gross} onChange={(v) => setF((s) => ({ ...s, gross: v }))} />
          <Inp label="Líquido (R$)" value={f.net} onChange={(v) => setF((s) => ({ ...s, net: v }))} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs hover:border-brand">{uploading ? "Enviando..." : f.fileUrl ? "✓ PDF anexado" : "+ Anexar holerite (PDF)"}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ""; }} /></label>
          <button onClick={save} className="rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white">Salvar</button>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
            <span>{p.employeeName ?? "—"} · {new Date(p.refMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })}</span>
            <span className="flex items-center gap-3 text-xs">
              {p.netCents != null && <span>{brl(Number(p.netCents))}</span>}
              {p.acknowledgedAt ? <span className="text-green-300">ciente</span> : <span className="text-muted">aguarda ciência</span>}
              {p.fileUrl && !String(p.fileUrl).startsWith("priv:") && <a href={p.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver</a>}
            </span>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted">Nenhum holerite lançado.</p>}
      </div>
    </div>
  );
}

// ============================== EMPRÉSTIMOS (visão da empresa) ==============================
function EmprestimosOrg({ employees }: { employees: Employee[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ employeeId: employees[0]?.id ?? "", principal: "", count: "1", firstDueMonth: new Date().toISOString().slice(0, 7) });
  const load = useCallback(async () => {
    const res = await fetch("/api/hr/loans", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const toCents = (s: string) => Math.round((parseFloat((s || "0").replace(/\./g, "").replace(",", ".")) || 0) * 100);
  async function save() {
    const principalCents = toCents(f.principal); const installmentsCount = Math.max(1, parseInt(f.count || "1", 10) || 1);
    if (!f.employeeId || principalCents < 1) return;
    const res = await fetch("/api/hr/loans", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId: f.employeeId, principalCents, installmentsCount, firstDueMonth: f.firstDueMonth }) });
    if (res.ok) { setF((s) => ({ ...s, principal: "", count: "1" })); load(); }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-bg/60 p-4">
        <p className="mb-2 text-sm font-semibold">Novo empréstimo / adiantamento</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Funcionário</span>
            <select value={f.employeeId} onChange={(e) => setF((s) => ({ ...s, employeeId: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <Inp label="Valor (R$)" value={f.principal} onChange={(v) => setF((s) => ({ ...s, principal: v }))} />
          <Inp label="Parcelas" value={f.count} onChange={(v) => setF((s) => ({ ...s, count: v }))} />
          <Inp label="1ª parcela (mês)" type="month" value={f.firstDueMonth} onChange={(v) => setF((s) => ({ ...s, firstDueMonth: v }))} />
        </div>
        <button onClick={save} className="mt-2 rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white">Conceder</button>
      </div>
      <div className="space-y-1">
        {items.map((l) => {
          const paid = (l.installments ?? []).filter((i: any) => i.status === "paid").length;
          return (
            <div key={l.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <span>{l.employeeName ?? "—"} · {brl(Number(l.principalCents))} em {l.installmentsCount}x</span>
              <span className={`text-xs ${l.status === "paid" ? "text-green-300" : "text-muted"}`}>{l.status === "paid" ? "quitado" : `${paid}/${l.installmentsCount} pagas`}</span>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-sm text-muted">Nenhum empréstimo ativo.</p>}
      </div>
    </div>
  );
}

// ============================== PAINEL (DASHBOARD) ==============================
function RhDashboard() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/hr/dashboard", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <p className="text-sm text-muted">Carregando…</p>;
  if (!d) return <p className="text-sm text-muted">Sem dados.</p>;
  const KPI = ({ label, value, hint, tone }: { label: string; value: any; hint?: string; tone?: string }) => (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
  const mesNome = new Date().toLocaleDateString("pt-BR", { month: "long" });
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <KPI label="Funcionários ativos" value={d.headcount} hint="headcount atual" />
        <KPI label="Admissões (12m)" value={d.admissions12m} tone="text-green-300" />
        <KPI label="Desligamentos (12m)" value={d.terminations12m} tone="text-red-300" />
        <KPI label="Turnover (12m)" value={`${d.turnoverPct}%`} hint="deslig./headcount" />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <KPI label="ASO vencidos" value={d.aso.vencidos} tone={d.aso.vencidos ? "text-red-300" : ""} />
        <KPI label="ASO a vencer (30d)" value={d.aso.vencendo} tone={d.aso.vencendo ? "text-amber-200" : ""} />
        <KPI label="Advertências s/ ciência" value={d.warningsPending} tone={d.warningsPending ? "text-amber-200" : ""} />
        <KPI label="Solicitações de ponto" value={d.justificationsPending} hint="pendentes" tone={d.justificationsPending ? "text-amber-200" : ""} />
      </div>

      {d.treinamentos && (d.treinamentos.vencidos > 0 || d.treinamentos.vencendo > 0) && (
        <div className="grid gap-3 sm:grid-cols-4">
          <KPI label="Treinamentos vencidos" value={d.treinamentos.vencidos} tone={d.treinamentos.vencidos ? "text-red-300" : ""} />
          <KPI label="Treinamentos a vencer (30d)" value={d.treinamentos.vencendo} tone={d.treinamentos.vencendo ? "text-amber-200" : ""} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-bg/60 p-4">
          <h3 className="mb-2 text-sm font-semibold">🎂 Aniversariantes de {mesNome}</h3>
          {d.aniversariantes.length === 0 ? <p className="text-sm text-muted">Ninguém neste mês.</p> : (
            <div className="space-y-1">
              {d.aniversariantes.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  {a.photoUrl ? <img src={a.photoUrl} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-xs">🧑</span>}
                  <span className="flex-1">{a.name}{a.roleTitle ? <span className="text-xs text-muted"> · {a.roleTitle}</span> : null}</span>
                  <span className="text-xs font-semibold text-brand">dia {a.day}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-bg/60 p-4">
          <h3 className="mb-2 text-sm font-semibold">Headcount por loja</h3>
          {d.headcountByStore.length === 0 ? <p className="text-sm text-muted">—</p> : (
            <div className="space-y-1">
              {d.headcountByStore.map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm"><span>{s.store}</span><span className="font-semibold">{s.count}</span></div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-bg/60 p-4">
          <h3 className="mb-2 text-sm font-semibold">ASO — vencidos / a vencer</h3>
          {d.aso.items.length === 0 ? <p className="text-sm text-muted">Nenhum exame com vencimento próximo.</p> : (
            <div className="space-y-1">
              {d.aso.items.map((x: any) => (
                <div key={x.id} className="flex items-center justify-between text-sm">
                  <span>{x.employeeName}</span>
                  <span className={`text-xs ${x.overdue ? "text-red-300" : "text-muted"}`}>{x.dueDate ? new Date(x.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : ""}{x.overdue ? " · vencido" : ""}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-bg/60 p-4">
          <h3 className="mb-2 text-sm font-semibold">Próximas férias (60d)</h3>
          {d.vacationsUpcoming.length === 0 ? <p className="text-sm text-muted">Nenhuma férias agendada.</p> : (
            <div className="space-y-1">
              {d.vacationsUpcoming.map((v: any) => (
                <div key={v.id} className="flex items-center justify-between text-sm"><span>{v.name}</span><span className="text-xs text-muted">{new Date(v.startDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })} · {v.days}d</span></div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ============================== FUNCIONÁRIOS ==============================
function Employees({ initialEmployees, stores }: { initialEmployees: Employee[]; stores: Store[] }) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/hr/employees", { credentials: "include", cache: "no-store" });
    const data = await res.json();
    if (res.ok) setEmployees(data.items ?? []);
  }, []);

  async function sendCredentials(id: string) {
    setMsg(null);
    const res = await fetch(`/api/hr/employees/${id}/send-credentials`, { method: "POST", credentials: "include" });
    setMsg(res.ok ? "Credenciais enviadas (WhatsApp/email)." : "Falha ao enviar credenciais.");
  }

  const storeName = (id: string | null) => stores.find((s) => s.id === id)?.name ?? "—";

  return (
    <div className="space-y-3">
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <button onClick={() => setCreating(true)} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">+ Novo funcionário</button>

      {employees.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhum funcionário cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Nome</th><th className="px-4 py-3">Cargo</th>
                <th className="px-4 py-3">Loja</th><th className="px-4 py-3">Salário</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className="border-t border-line/50">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <Boneco3D photoUrl={e.photoUrl} />
                      <span>{e.name}<div className="font-mono text-[10px] text-muted">{e.cpf}</div></span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{e.roleTitle ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{storeName(e.storeId)}</td>
                  <td className="px-4 py-3">{e.salaryCents != null ? brl(e.salaryCents) : "—"}</td>
                  <td className="px-4 py-3"><StatusPill status={e.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => setEditing(e)} className="text-xs text-brand hover:underline">Editar</button>
                      <button onClick={() => sendCredentials(e.id)} className="text-xs text-brand hover:underline">Enviar acesso</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <EmployeeForm
          employee={editing}
          stores={stores}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function EmployeeForm({ employee, stores, onClose, onSaved }: { employee: Employee | null; stores: Store[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!employee;
  const [f, setF] = useState({
    name: employee?.name ?? "", cpf: employee?.cpf ?? "", roleTitle: employee?.roleTitle ?? "",
    storeId: employee?.storeId ?? "", salary: employee?.salaryCents != null ? String(employee.salaryCents / 100) : "",
    phone: employee?.phone ?? "", whatsappPhone: employee?.whatsappPhone ?? "", email: employee?.email ?? "",
    admissionDate: employee?.admissionDate ? employee.admissionDate.slice(0, 10) : "", status: employee?.status ?? "active",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"dados" | "holerite" | "docs" | "emprestimos" | "exames" | "treinamentos" | "advertencias" | "desligamento" | "admissao">("dados");
  // acesso ao sistema (só no cadastro)
  const [access, setAccess] = useState({ create: false, email: "", roleSlug: "", alsoProfessional: false });
  const [roles, setRoles] = useState<Array<{ slug: string; name: string }>>([]);
  useEffect(() => {
    if (isEdit) return;
    fetch("/api/users/roles", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => {
      const items = (d.items ?? d.roles ?? []).filter((x: any) => x.isActive !== false);
      setRoles(items.map((x: any) => ({ slug: x.slug, name: x.name })));
    }).catch(() => undefined);
  }, [isEdit]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const payload: any = {
        name: f.name.trim(), cpf: f.cpf ? onlyDigits(f.cpf) : null, roleTitle: f.roleTitle || null,
        storeId: f.storeId || null, salaryCents: f.salary ? Math.round(Number(f.salary.replace(",", ".")) * 100) : null,
        phone: f.phone || null, whatsappPhone: f.whatsappPhone || null, email: f.email || null,
        admissionDate: f.admissionDate || null, status: f.status,
      };
      if (!isEdit && access.create) {
        if (!access.email || !access.roleSlug) throw new Error("Para criar acesso, informe e-mail e papel.");
        payload.createSystemUser = true;
        payload.accessEmail = access.email.trim();
        payload.roleSlug = access.roleSlug;
        payload.alsoProfessional = access.alsoProfessional;
      }
      const res = await fetch(isEdit ? `/api/hr/employees/${employee!.id}` : "/api/hr/employees", {
        method: isEdit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Falha");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose}>
        <h2 className="text-lg font-semibold">{isEdit ? "Editar funcionário" : "Novo funcionário"}</h2>

        {isEdit && (
          <div className="mt-3 flex gap-2 border-b border-line">
            <Tab active={tab === "dados"} onClick={() => setTab("dados")}>Dados</Tab>
            <Tab active={tab === "holerite"} onClick={() => setTab("holerite")}>Holerite</Tab>
            <Tab active={tab === "docs"} onClick={() => setTab("docs")}>Documentos</Tab>
            <Tab active={tab === "emprestimos"} onClick={() => setTab("emprestimos")}>Empréstimos</Tab>
            <Tab active={tab === "exames"} onClick={() => setTab("exames")}>Exames (ASO)</Tab>
            <Tab active={tab === "treinamentos"} onClick={() => setTab("treinamentos")}>Treinamentos</Tab>
            <Tab active={tab === "advertencias"} onClick={() => setTab("advertencias")}>Advertências</Tab>
            <Tab active={tab === "desligamento"} onClick={() => setTab("desligamento")}>Desligamento</Tab>
            <Tab active={tab === "admissao"} onClick={() => setTab("admissao")}>Admissão</Tab>
          </div>
        )}

        {tab === "dados" && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Inp label="Nome" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
              <Inp label="CPF" value={f.cpf} onChange={(v) => setF({ ...f, cpf: v })} />
              <Inp label="Cargo" value={f.roleTitle} onChange={(v) => setF({ ...f, roleTitle: v })} />
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase text-muted">Loja</span>
                <select value={f.storeId} onChange={(e) => setF({ ...f, storeId: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
                  <option value="">—</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <Inp label="Salário (R$)" value={f.salary} onChange={(v) => setF({ ...f, salary: v })} />
              <Inp label="Admissão" type="date" value={f.admissionDate} onChange={(v) => setF({ ...f, admissionDate: v })} />
              <Inp label="Telefone" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
              <Inp label="WhatsApp" value={f.whatsappPhone} onChange={(v) => setF({ ...f, whatsappPhone: v })} />
              <Inp label="Email" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase text-muted">Status</span>
                <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
                  <option value="active">Ativo</option><option value="inactive">Inativo</option><option value="terminated">Desligado</option>
                </select>
              </label>
            </div>

            {!isEdit && (
              <div className="mt-4 rounded-lg border border-line bg-bg/40 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={access.create} onChange={(e) => setAccess({ ...access, create: e.target.checked, email: access.email || f.email })} className="h-4 w-4" />
                  Criar acesso ao sistema para este funcionário
                </label>
                {access.create && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Inp label="E-mail de acesso" value={access.email} onChange={(v) => setAccess({ ...access, email: v })} />
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase text-muted">Papel</span>
                      <select value={access.roleSlug} onChange={(e) => setAccess({ ...access, roleSlug: e.target.value })} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
                        <option value="">— selecione —</option>
                        {roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted sm:col-span-2">
                      <input type="checkbox" checked={access.alsoProfessional} onChange={(e) => setAccess({ ...access, alsoProfessional: e.target.checked })} /> também é profissional da agenda (atende exames)
                    </label>
                    <p className="text-[11px] text-muted sm:col-span-2">Cria o usuário com o papel escolhido, provisiona no Chatwoot/GLPI e envia as credenciais por e-mail/WhatsApp (troca de senha no 1º acesso).</p>
                  </div>
                )}
              </div>
            )}

            {err && <p className="mt-3 text-xs text-red-300">{err}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">Cancelar</button>
              <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Salvando..." : "Salvar"}</button>
            </div>
          </>
        )}

        {isEdit && tab === "holerite" && <Payslips employeeId={employee!.id} />}
        {isEdit && tab === "docs" && <EmpDocs employeeId={employee!.id} />}
        {isEdit && tab === "exames" && <EmpExams employeeId={employee!.id} />}
        {isEdit && tab === "treinamentos" && <EmpTrainings employeeId={employee!.id} />}
        {isEdit && tab === "advertencias" && <EmpWarnings employeeId={employee!.id} />}
        {isEdit && tab === "desligamento" && <EmpTermination employeeId={employee!.id} />}
        {isEdit && tab === "emprestimos" && <EmpLoans employeeId={employee!.id} salaryCents={employee!.salaryCents ?? null} />}
        {isEdit && tab === "admissao" && <Admissao employeeId={employee!.id} />}
    </Modal>
  );
}

function Admissao({ employeeId }: { employeeId: string }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/contracts/templates", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => setTemplates(d.items ?? []));
  }, []);

  async function generate() {
    if (!templateId) return;
    setBusy(true); setErr(null); setLink(null);
    try {
      const res = await fetch(`/api/hr/employees/${employeeId}/admission-contract`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ templateId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      const token = d.contract?.signerToken;
      setLink(token ? `${window.location.origin}/assinar/${token}` : null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-muted">Gere o contrato de trabalho/admissão a partir de um modelo, já com os dados do funcionário. Ele assina pelo link (assinatura eletrônica + selo).</p>
      {templates.length === 0 ? (
        <p className="text-sm text-muted">Nenhum modelo de contrato. Crie em <a href="/app/contratos/modelos" className="text-brand hover:underline">Contratos → Modelos</a>.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase text-muted">Modelo</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
              <option value="">— selecione —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
          <button onClick={generate} disabled={busy || !templateId} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gerando..." : "Gerar contrato"}</button>
        </div>
      )}
      {err && <p className="text-xs text-red-300">{err}</p>}
      {link && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3">
          <p className="text-xs font-semibold text-green-100">✓ Contrato gerado. Link de assinatura:</p>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={link} className="flex-1 rounded border border-line bg-bg/60 px-2 py-1.5 font-mono text-xs" />
            <button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white">{copied ? "✓" : "Copiar"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Payslips({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [refMonth, setRefMonth] = useState(new Date().toISOString().slice(0, 7));
  const [fileUrl, setFileUrl] = useState("");
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [openInst, setOpenInst] = useState<any[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/payslips?employeeId=${employeeId}`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
    const oi = await fetch(`/api/hr/loans/open-installments?employeeId=${employeeId}`, { credentials: "include", cache: "no-store" });
    const od = await oi.json(); if (oi.ok) setOpenInst(od.items ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function payInst(id: string) {
    await fetch(`/api/hr/loan-installments/${id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
    load();
  }

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "holerite");
      const res = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const d = await res.json(); if (res.ok) setFileUrl(d.url);
    } finally { setUploading(false); }
  }

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/hr/payslips", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ employeeId, refMonth: refMonth + "-01", fileUrl: fileUrl || null,
          grossCents: gross ? Math.round(Number(gross.replace(",", ".")) * 100) : null,
          netCents: net ? Math.round(Number(net.replace(",", ".")) * 100) : null }),
      });
      if (res.ok) { setFileUrl(""); setGross(""); setNet(""); load(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-line p-3">
        <p className="mb-2 text-xs font-medium uppercase text-muted">Lançar holerite</p>
        <div className="flex flex-wrap items-end gap-2">
          <Inp label="Mês" type="month" value={refMonth} onChange={setRefMonth} />
          <Inp label="Bruto (R$)" value={gross} onChange={setGross} />
          <Inp label="Líquido (R$)" value={net} onChange={setNet} />
          <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs hover:border-brand">
            {uploading ? "Enviando..." : fileUrl ? "✓ PDF" : "+ PDF"}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.currentTarget.value = ""; }} />
          </label>
          <button onClick={create} disabled={busy} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Salvar</button>
        </div>
      </div>

      {openInst.length > 0 && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-3">
          <p className="mb-2 text-xs font-medium uppercase text-orange-200">Empréstimos: parcelas em aberto (descontar no holerite)</p>
          <div className="space-y-1">
            {openInst.map((i) => (
              <div key={i.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">Parc. {i.number} · {new Date(i.dueMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })} · {brl(Number(i.amountCents))}</span>
                <button onClick={() => payInst(i.id)} className="text-xs text-brand hover:underline">marcar paga</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        {items.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded border border-line/60 px-3 py-2 text-sm">
            <span>{new Date(p.refMonth).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            <span className="text-muted">{p.netCents != null ? brl(Number(p.netCents)) : "—"} {p.acknowledgedAt ? "· ✓ ciente" : "· pend. ciência"}</span>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted">Sem holerites.</p>}
      </div>
    </div>
  );
}

function EmpTrainings({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState<any>({ name: "", provider: "", completedDate: "", dueDate: "", hours: "", notes: "", fileUrl: "" });
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/employees/${employeeId}/trainings`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "treinamento");
      const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (up.ok) setF((s: any) => ({ ...s, fileUrl: ud.url }));
    } finally { setUploading(false); }
  }
  async function add() {
    if (!f.name.trim()) { return; }
    const res = await fetch("/api/hr/trainings", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId, ...f, hours: f.hours ? Number(f.hours) : null }) });
    if (res.ok) { setF({ name: "", provider: "", completedDate: "", dueDate: "", hours: "", notes: "", fileUrl: "" }); load(); }
  }
  async function del(id: string) { if (!window.confirm("Excluir este treinamento?")) return; await fetch(`/api/hr/trainings/${id}`, { method: "DELETE", credentials: "include" }); load(); }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-line bg-bg/60 p-3">
        <p className="mb-2 text-sm font-semibold">Novo treinamento / certificação</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2"><Inp label="Nome (ex.: NR-35 Trabalho em Altura)" value={f.name} onChange={(v) => setF((s: any) => ({ ...s, name: v }))} /></div>
          <Inp label="Instrutor / empresa" value={f.provider} onChange={(v) => setF((s: any) => ({ ...s, provider: v }))} />
          <Inp label="Realização" type="date" value={f.completedDate} onChange={(v) => setF((s: any) => ({ ...s, completedDate: v }))} />
          <Inp label="Validade (vencimento)" type="date" value={f.dueDate} onChange={(v) => setF((s: any) => ({ ...s, dueDate: v }))} />
          <Inp label="Carga horária (h)" value={f.hours} onChange={(v) => setF((s: any) => ({ ...s, hours: v }))} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs hover:border-brand">{uploading ? "Enviando..." : f.fileUrl ? "✓ certificado anexado" : "+ Anexar certificado"}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ""; }} /></label>
          <button onClick={add} className="rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white">Salvar</button>
        </div>
      </div>
      <div className="space-y-1">
        {items.map((x) => {
          const due = x.dueDate ? String(x.dueDate).slice(0, 10) : null;
          const overdue = due && due < today;
          return (
            <div key={x.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{x.name}{x.hours ? <span className="ml-2 text-xs text-muted">{x.hours}h</span> : null}</p>
                <p className="text-xs text-muted">{x.completedDate ? `realizado ${new Date(x.completedDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}{due ? ` · vence ${new Date(due + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}{x.provider ? ` · ${x.provider}` : ""}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {overdue && <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-semibold text-red-300">vencido</span>}
                {x.fileUrl && <a href={x.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver</a>}
                <button onClick={() => del(x.id)} className="text-red-300 hover:underline">excluir</button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-xs text-muted">Sem treinamentos cadastrados.</p>}
      </div>
    </div>
  );
}

const EXAM_KIND: Record<string, string> = { admissional: "Admissional", periodico: "Periódico", demissional: "Demissional", retorno: "Retorno ao trabalho", mudanca_funcao: "Mudança de função" };
function EmpExams({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState<any>({ kind: "periodico", examDate: "", dueDate: "", result: "apto", doctor: "", notes: "", fileUrl: "" });
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/employees/${employeeId}/exams`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "aso");
      const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (up.ok) setF((s: any) => ({ ...s, fileUrl: ud.url }));
    } finally { setUploading(false); }
  }
  async function add() {
    if (!f.examDate && !f.dueDate) { return; }
    const res = await fetch("/api/hr/exams", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId, ...f }) });
    if (res.ok) { setF({ kind: "periodico", examDate: "", dueDate: "", result: "apto", doctor: "", notes: "", fileUrl: "" }); load(); }
  }
  async function del(id: string) { if (!window.confirm("Excluir este exame?")) return; await fetch(`/api/hr/exams/${id}`, { method: "DELETE", credentials: "include" }); load(); }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-line bg-bg/60 p-3">
        <p className="mb-2 text-sm font-semibold">Novo exame (ASO)</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
            <select value={f.kind} onChange={(e) => setF((s: any) => ({ ...s, kind: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">{Object.entries(EXAM_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <Inp label="Data do exame" type="date" value={f.examDate} onChange={(v) => setF((s: any) => ({ ...s, examDate: v }))} />
          <Inp label="Vencimento (próximo)" type="date" value={f.dueDate} onChange={(v) => setF((s: any) => ({ ...s, dueDate: v }))} />
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Resultado</span>
            <select value={f.result} onChange={(e) => setF((s: any) => ({ ...s, result: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm"><option value="apto">Apto</option><option value="apto_com_restricao">Apto c/ restrição</option><option value="inapto">Inapto</option></select></label>
          <Inp label="Médico/Clínica" value={f.doctor} onChange={(v) => setF((s: any) => ({ ...s, doctor: v }))} />
          <label className="cursor-pointer self-end rounded border border-line px-3 py-1.5 text-xs hover:border-brand">{uploading ? "Enviando..." : f.fileUrl ? "✓ ASO anexado" : "+ Anexar ASO"}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ""; }} /></label>
        </div>
        <button onClick={add} className="mt-2 rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white">Salvar exame</button>
      </div>
      <div className="space-y-1">
        {items.map((x) => {
          const due = x.dueDate ? String(x.dueDate).slice(0, 10) : null;
          const overdue = due && due < today;
          return (
            <div key={x.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{EXAM_KIND[x.kind] ?? x.kind}{x.result ? <span className="ml-2 text-xs text-muted">{x.result}</span> : null}</p>
                <p className="text-xs text-muted">{x.examDate ? `realizado ${new Date(x.examDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}{due ? ` · vence ${new Date(due + "T00:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}{x.doctor ? ` · ${x.doctor}` : ""}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {overdue && <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-semibold text-red-300">vencido</span>}
                {x.fileUrl && <a href={x.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver</a>}
                <button onClick={() => del(x.id)} className="text-red-300 hover:underline">excluir</button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <p className="text-xs text-muted">Sem exames cadastrados.</p>}
      </div>
    </div>
  );
}

const WARN_KIND: Record<string, string> = { advertencia_verbal: "Advertência verbal", advertencia_escrita: "Advertência escrita", suspensao: "Suspensão" };
function EmpWarnings({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState<any>({ kind: "advertencia_escrita", date: new Date().toISOString().slice(0, 10), reason: "", suspensionDays: "", fileUrl: "" });
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/employees/${employeeId}/warnings`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "advertencia");
      const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (up.ok) setF((s: any) => ({ ...s, fileUrl: ud.url }));
    } finally { setUploading(false); }
  }
  async function add() {
    if (f.reason.trim().length < 3) { return; }
    const res = await fetch("/api/hr/warnings", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId, ...f, suspensionDays: f.suspensionDays ? Number(f.suspensionDays) : null }) });
    if (res.ok) { setF({ kind: "advertencia_escrita", date: new Date().toISOString().slice(0, 10), reason: "", suspensionDays: "", fileUrl: "" }); load(); }
  }
  async function del(id: string) { if (!window.confirm("Excluir esta ocorrência?")) return; await fetch(`/api/hr/warnings/${id}`, { method: "DELETE", credentials: "include" }); load(); }
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-lg border border-line bg-bg/60 p-3">
        <p className="mb-2 text-sm font-semibold">Nova advertência / ocorrência</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
            <select value={f.kind} onChange={(e) => setF((s: any) => ({ ...s, kind: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">{Object.entries(WARN_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <Inp label="Data" type="date" value={f.date} onChange={(v) => setF((s: any) => ({ ...s, date: v }))} />
          {f.kind === "suspensao" && <Inp label="Dias de suspensão" value={f.suspensionDays} onChange={(v) => setF((s: any) => ({ ...s, suspensionDays: v }))} />}
        </div>
        <label className="mt-2 block"><span className="mb-1 block text-[10px] uppercase text-muted">Motivo</span>
          <textarea value={f.reason} onChange={(e) => setF((s: any) => ({ ...s, reason: e.target.value }))} rows={2} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" /></label>
        <div className="mt-2 flex items-center gap-2">
          <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs hover:border-brand">{uploading ? "Enviando..." : f.fileUrl ? "✓ documento anexado" : "+ Anexar documento"}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ""; }} /></label>
          <button onClick={add} className="rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white">Registrar</button>
        </div>
        <p className="mt-1 text-[11px] text-muted">O funcionário dá ciência (assinatura) pelo portal.</p>
      </div>
      <div className="space-y-1">
        {items.map((w) => (
          <div key={w.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
            <div>
              <p className="font-medium">{WARN_KIND[w.kind] ?? w.kind}{w.kind === "suspensao" && w.suspensionDays ? ` (${w.suspensionDays} dias)` : ""}</p>
              <p className="text-xs text-muted">{new Date(w.date).toLocaleDateString("pt-BR", { timeZone: "UTC" })} · {w.reason}</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {w.acknowledgedAt ? <span className="text-green-300">✓ ciente {new Date(w.acknowledgedAt).toLocaleDateString("pt-BR")}</span> : <span className="text-orange-300">aguarda ciência</span>}
              {w.fileUrl && <a href={w.fileUrl} target="_blank" rel="noreferrer" className="text-brand hover:underline">ver</a>}
              <button onClick={() => del(w.id)} className="text-red-300 hover:underline">excluir</button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted">Sem ocorrências.</p>}
      </div>
    </div>
  );
}

const TERM_KIND: Record<string, string> = { sem_justa_causa: "Dispensa sem justa causa", pedido_demissao: "Pedido de demissão", justa_causa: "Dispensa por justa causa", acordo: "Comum acordo (484-A)", fim_contrato: "Término de contrato", aposentadoria: "Aposentadoria" };
function EmpTermination({ employeeId }: { employeeId: string }) {
  const [t, setT] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [f, setF] = useState<any>({ kind: "sem_justa_causa", noticeType: "trabalhado", noticeDate: "", terminationDate: "", reason: "", asoDone: false, assetsReturned: false, accessRevoked: false, docsDelivered: false, termDocUrl: "" });
  const [uploading, setUploading] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/employees/${employeeId}/termination`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok && d.termination) { setT(d.termination); setF((s: any) => ({ ...s, ...d.termination, noticeDate: d.termination.noticeDate ? String(d.termination.noticeDate).slice(0, 10) : "", terminationDate: d.termination.terminationDate ? String(d.termination.terminationDate).slice(0, 10) : "", reason: d.termination.reason ?? "", termDocUrl: d.termination.termDocUrl ?? "" })); }
    setLoaded(true);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);
  const finalized = t?.status === "finalized";
  async function save() {
    const res = await fetch("/api/hr/termination", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ employeeId, ...f }) });
    if (res.ok) load();
  }
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "desligamento");
      const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (up.ok) { setF((s: any) => ({ ...s, termDocUrl: ud.url })); }
    } finally { setUploading(false); }
  }
  async function finalize() {
    if (!f.terminationDate) { window.alert("Informe a data de desligamento."); return; }
    if (!window.confirm("Finalizar o desligamento? O funcionário será inativado (perde acesso ao portal e ao ponto). Esta ação encerra o vínculo.")) return;
    await save();
    const res = await fetch(`/api/hr/termination/${employeeId}/finalize`, { method: "POST", credentials: "include" });
    if (res.ok) load(); else { const d = await res.json().catch(() => null); window.alert(d?.error?.message ?? "Falha"); }
  }
  if (!loaded) return <p className="mt-4 text-sm text-muted">Carregando…</p>;
  const Chk = ({ k, label }: { k: string; label: string }) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={finalized} checked={!!f[k]} onChange={(e) => setF((s: any) => ({ ...s, [k]: e.target.checked }))} /> {label}</label>
  );
  return (
    <div className="mt-4 space-y-3">
      {finalized && <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">Desligamento finalizado em {t.finalizedAt ? new Date(t.finalizedAt).toLocaleDateString("pt-BR") : ""}. Funcionário inativado.</div>}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Motivo</span>
          <select disabled={finalized} value={f.kind} onChange={(e) => setF((s: any) => ({ ...s, kind: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">{Object.entries(TERM_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Aviso prévio</span>
          <select disabled={finalized} value={f.noticeType} onChange={(e) => setF((s: any) => ({ ...s, noticeType: e.target.value }))} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm"><option value="trabalhado">Trabalhado</option><option value="indenizado">Indenizado</option><option value="dispensado">Dispensado</option></select></label>
        <Inp label="Início do aviso" type="date" value={f.noticeDate} onChange={(v) => setF((s: any) => ({ ...s, noticeDate: v }))} />
        <Inp label="Data do desligamento" type="date" value={f.terminationDate} onChange={(v) => setF((s: any) => ({ ...s, terminationDate: v }))} />
      </div>
      <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Observações</span>
        <textarea disabled={finalized} value={f.reason} onChange={(e) => setF((s: any) => ({ ...s, reason: e.target.value }))} rows={2} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" /></label>
      <div className="rounded-lg border border-line bg-bg/60 p-3">
        <p className="mb-2 text-sm font-semibold">Checklist de desligamento</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Chk k="asoDone" label="Exame demissional (ASO)" />
          <Chk k="assetsReturned" label="Devolução de EPI / uniforme / ativos" />
          <Chk k="accessRevoked" label="Baixa de acessos (sistemas / crachá)" />
          <Chk k="docsDelivered" label="Entrega de documentos (TRCT / guias)" />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs hover:border-brand">{uploading ? "Enviando..." : f.termDocUrl ? "✓ termo anexado" : "+ Anexar termo assinado"}<input type="file" accept="application/pdf,image/*" className="hidden" disabled={finalized} onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ""; }} /></label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!finalized && <button onClick={save} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-brand">Salvar</button>}
        <a href={`/api/hr/employees/${employeeId}/termination/pdf`} target="_blank" rel="noreferrer" className={`rounded-lg border border-line px-4 py-2 text-sm hover:border-brand ${!t ? "pointer-events-none opacity-40" : ""}`}>Comunicado (PDF)</a>
        {!finalized && <button onClick={finalize} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Finalizar desligamento</button>}
      </div>
    </div>
  );
}

function EmpDocs({ employeeId }: { employeeId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [docType, setDocType] = useState("contract");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/employees/${employeeId}/documents`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "doc-funcionario");
      const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (!up.ok) return;
      await fetch("/api/hr/documents", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ employeeId, docType, fileUrl: ud.url }),
      });
      load();
    } finally { setUploading(false); }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-muted">Tipo</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
            <option value="contract">Contrato</option><option value="ctps">CTPS</option><option value="rg">RG</option>
            <option value="cpf">CPF</option><option value="address">Comprovante</option><option value="aso">ASO</option><option value="other">Outro</option>
          </select>
        </label>
        <label className="cursor-pointer rounded border border-line px-3 py-1.5 text-xs hover:border-brand">
          {uploading ? "Enviando..." : "+ Anexar"}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
      </div>
      <div className="space-y-1">
        {items.map((d) => (
          <DocRow key={d.id} d={d} onChanged={load} />
        ))}
        {items.length === 0 && <p className="text-xs text-muted">Sem documentos.</p>}
      </div>
    </div>
  );
}

function DocRow({ d, onChanged }: { d: any; onChanged: () => void }) {
  async function review(status: "approved" | "rejected") {
    let note: string | null = null;
    if (status === "rejected") note = window.prompt("Motivo da recusa (opcional):") ?? null;
    await fetch(`/api/hr/documents/${d.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status, note }) });
    onChanged();
  }
  const map: Record<string, string> = { pending: "bg-orange-500/20 text-orange-300", approved: "bg-green-500/20 text-green-300", rejected: "bg-red-500/20 text-red-300" };
  const label: Record<string, string> = { pending: "pendente", approved: "aprovado", rejected: "recusado" };
  return (
    <div className="flex items-center justify-between rounded border border-line/60 px-3 py-2 text-sm">
      <span>{d.title ?? d.docType}{d.uploadedBy === "employee" ? " · enviado pelo funcionário" : ""}</span>
      <span className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${map[d.status] ?? "bg-line text-muted"}`}>{label[d.status] ?? d.status}</span>
        {d.status === "pending" && (
          <>
            <button onClick={() => review("approved")} className="text-xs text-green-300 hover:underline">aprovar</button>
            <button onClick={() => review("rejected")} className="text-xs text-muted hover:text-red-300">recusar</button>
          </>
        )}
        {!d.fileUrl?.startsWith("priv:") && <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">ver</a>}
      </span>
    </div>
  );
}

function PaymentProof({ requestId, proofUrl, onChanged }: { requestId: string; proofUrl: string | null; onChanged: () => void }) {
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("purpose", "comprovante-pagamento");
      const up = await fetch("/api/uploads/org", { method: "POST", body: fd, credentials: "include" });
      const ud = await up.json(); if (!up.ok) return;
      await fetch(`/api/hr/requests/${requestId}/payment-proof`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ proofUrl: ud.url }) });
      onChanged();
    } finally { setUploading(false); }
  }
  if (proofUrl) return <a href={proofUrl} target="_blank" rel="noreferrer" className="text-[11px] text-brand hover:underline">ver comprovante</a>;
  return (
    <label className="cursor-pointer text-[11px] text-brand hover:underline">
      {uploading ? "enviando..." : "+ comprovante de pagamento"}
      <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
    </label>
  );
}

function EmpLoans({ employeeId, salaryCents }: { employeeId: string; salaryCents: number | null }) {
  const [loans, setLoans] = useState<any[]>([]);
  const [principal, setPrincipal] = useState("");
  const [count, setCount] = useState("3");
  const [firstMonth, setFirstMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/loans?employeeId=${employeeId}`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setLoans(d.items ?? []);
  }, [employeeId]);
  useEffect(() => { load(); }, [load]);

  const principalCents = principal ? Math.round(Number(principal.replace(",", ".")) * 100) : 0;
  const n = Number(count) || 1;
  const parcela = principalCents ? Math.ceil(principalCents / n) : 0;
  const max30 = salaryCents != null ? Math.round(salaryCents * 0.3) : null;
  const exceeds = max30 != null && parcela > max30;

  async function create() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hr/loans", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ employeeId, principalCents, installmentsCount: n, firstDueMonth: firstMonth }),
      });
      const d = await res.json(); if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      setPrincipal(""); load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function payInst(id: string) {
    await fetch(`/api/hr/loan-installments/${id}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) });
    load();
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="space-y-2 rounded-lg border border-line p-3">
        <p className="text-sm font-medium">Novo empréstimo</p>
        <div className="flex flex-wrap items-end gap-2">
          <Inp label="Valor (R$)" value={principal} onChange={setPrincipal} />
          <Inp label="Parcelas" value={count} onChange={setCount} />
          <Inp label="1ª parcela (mês)" type="month" value={firstMonth} onChange={setFirstMonth} />
        </div>
        {principalCents > 0 && (
          <p className={`text-sm ${exceeds ? "font-semibold text-red-300" : "text-muted"}`}>
            Parcela: {brl(parcela)} {max30 != null && `· limite 30% do salário = ${brl(max30)}`}
            {exceeds && " — acima do limite, reduza o valor ou aumente as parcelas."}
          </p>
        )}
        {msg && <p className="text-xs text-red-300">{msg}</p>}
        <button onClick={create} disabled={busy || !principalCents || exceeds} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Conceder empréstimo</button>
      </div>
      {loans.map((l) => (
        <div key={l.id} className="rounded-lg border border-line/60 p-3">
          <p className="text-sm font-medium">{brl(Number(l.principalCents))} em {l.installmentsCount}x · {l.status === "paid" ? "quitado" : "ativo"}</p>
          <div className="mt-2 space-y-1">
            {(l.installments ?? []).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{i.number}. {new Date(i.dueMonth).toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric", timeZone: "UTC" })} · {brl(Number(i.amountCents))}</span>
                {i.status === "paid" ? <span className="text-xs text-green-300">pago</span> : <button onClick={() => payInst(i.id)} className="text-xs text-brand hover:underline">marcar pago</button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {loans.length === 0 && <p className="text-xs text-muted">Sem empréstimos.</p>}
    </div>
  );
}

// ============================== SOLICITAÇÕES ==============================
function Requests() {
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState("pending");

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/requests?status=${filter}`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function review(id: string, status: "approved" | "rejected") {
    await fetch(`/api/hr/requests/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status }) });
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {["pending", "approved", "rejected"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`rounded-full border px-3 py-1 text-xs ${filter === s ? "border-brand bg-brand/15 text-fg" : "border-line text-muted"}`}>
            {s === "pending" ? "Pendentes" : s === "approved" ? "Aprovadas" : "Recusadas"}
          </button>
        ))}
      </div>
      {items.length === 0 ? <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhuma solicitação.</p> : (
        <div className="space-y-2">
          {items.map((r) => (
            <div key={r.id} className="rounded-lg border border-line bg-bg/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{r.employeeName} · {KIND_LABEL[r.kind] ?? r.kind}
                    {r.amountCents != null && <span className="ml-2 text-brand">{brl(Number(r.amountCents))}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {new Date(r.createdAt).toLocaleString("pt-BR")}
                    {r.kind === "shift_swap" && r.colleagueName ? ` · assumir turno de ${r.colleagueName}${r.payload?.date ? ` em ${r.payload.date}` : ""}` : (r.payload?.from ? ` · ${r.payload.from}${r.payload.to ? ` a ${r.payload.to}` : ""}` : "")}
                    {r.payload?.reason ? ` · ${r.payload.reason}` : ""}
                    {r.kind === "advance" && r.employeeSalaryCents ? ` · teto 40% = ${brl(Math.round(Number(r.employeeSalaryCents) * 0.4))}` : ""}
                  </p>
                  <div className="flex items-center gap-3">
                    {r.attachmentUrl && <a href={r.attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">anexo</a>}
                    {r.kind === "shift_swap" && r.status === "approved" && <a href={`/api/hr/requests/${r.id}/swap-receipt`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">recibo de troca</a>}
                  </div>
                </div>
                {r.status === "pending" ? (
                  <div className="flex flex-col items-end gap-1">
                    {r.kind === "shift_swap" && r.colleagueDecision !== "accepted" && (
                      <span className="text-[10px] text-orange-300">aguardando aceite do colega</span>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => review(r.id, "approved")}
                        disabled={r.kind === "shift_swap" && r.colleagueDecision !== "accepted"}
                        className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                      >Aprovar</button>
                      <button onClick={() => review(r.id, "rejected")} className="rounded border border-line px-3 py-1 text-xs text-muted hover:text-red-300">Recusar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${r.status === "approved" ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>{r.status === "approved" ? "aprovada" : "recusada"}</span>
                    {r.status === "approved" && (r.kind === "advance" || r.kind === "expense") && (
                      <PaymentProof requestId={r.id} proofUrl={r.paymentProofUrl} onChanged={load} />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================== PONTO ==============================
// O ponto agora é UNIFICADO no Ponto Eletrônico oficial (Portaria 671), em
// /app/ponto. Esta aba só direciona pra lá — sem registro de ponto duplicado no RH.
function PontoMoved() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-brand/40 bg-brand/10 p-5">
        <p className="text-sm font-semibold">O controle de ponto agora é o Ponto Eletrônico oficial</p>
        <p className="mt-1 text-sm text-muted">
          Batidas, espelho, escalas, divergências, justificativas/atestados e o arquivo AFD (REP-A, Portaria 671/2021)
          ficam todos no módulo oficial. O portal do funcionário e os atestados também refletem esse ponto.
        </p>
        <a href="/app/ponto" className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Abrir Ponto Eletrônico →</a>
      </div>
      <p className="text-xs text-muted">
        Dica: cadastre/edite as <strong>escalas</strong> e revise as <strong>justificativas</strong> dentro do Ponto Eletrônico.
        O histórico antigo (sistema anterior) permanece preservado por exigência legal, somente leitura.
      </p>
    </div>
  );
}

// ============================== ESCALA ==============================
// 0=Dom..6=Sáb (ordem de exibição começa na segunda)
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WD_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
type WdCfg = { weekday: number; enabled: boolean; startTime: string; endTime: string; breakMinutes: number; lunchStart: string; lunchEnd: string };
function defaultWeek(): WdCfg[] {
  return WD_ORDER.map((wd) => ({ weekday: wd, enabled: wd !== 0, startTime: "08:00", endTime: wd === 6 ? "12:00" : "18:00", breakMinutes: wd === 6 ? 0 : 60, lunchStart: wd === 6 ? "" : "12:00", lunchEnd: wd === 6 ? "" : "13:00" }));
}

function Escala({ employees, stores }: { employees: Employee[]; stores: Store[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [week, setWeek] = useState<WdCfg[]>(defaultWeek());
  const [holidays, setHolidays] = useState<any[]>([]);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "", recurring: false });
  const [snackThreshold, setSnackThreshold] = useState(120);
  const [snackMinutes, setSnackMinutes] = useState(15);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hr/shifts?from=${month}-01&to=${month}-31`, { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  // carrega modelo padrão da empresa + feriados
  useEffect(() => {
    fetch("/api/hr/settings", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => {
      const ds = d.settings?.defaultSchedule;
      if (Array.isArray(ds) && ds.length) {
        const byWd = new Map(ds.map((x: any) => [x.weekday, x]));
        setWeek(WD_ORDER.map((wd) => {
          const x: any = byWd.get(wd);
          return x ? { weekday: wd, enabled: !!x.enabled, startTime: x.startTime ?? "08:00", endTime: x.endTime ?? "18:00", breakMinutes: x.breakMinutes ?? 0, lunchStart: x.lunchStart ?? "", lunchEnd: x.lunchEnd ?? "" } : { weekday: wd, enabled: false, startTime: "08:00", endTime: "18:00", breakMinutes: 0, lunchStart: "", lunchEnd: "" };
        }));
      }
      if (d.settings?.snackThresholdMinutes != null) setSnackThreshold(d.settings.snackThresholdMinutes);
      if (d.settings?.snackMinutes != null) setSnackMinutes(d.settings.snackMinutes);
    });
    fetch("/api/hr/holidays", { credentials: "include", cache: "no-store" }).then((r) => r.json()).then((d) => setHolidays(d.items ?? []));
  }, []);

  function setWd(wd: number, patch: Partial<WdCfg>) {
    setWeek((w) => w.map((x) => (x.weekday === wd ? { ...x, ...patch } : x)));
  }

  // o backend exige HH:MM ou null nos horários de almoço; "" (sábado/dia off)
  // quebrava a validação ("weekdays: Invalid"). Converte "" -> null.
  function cleanWeek(w: WdCfg[]) {
    return w.map((x) => ({ ...x, lunchStart: x.lunchStart || null, lunchEnd: x.lunchEnd || null }));
  }

  async function saveDefault() {
    setMsg(null);
    const res = await fetch("/api/hr/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ defaultSchedule: cleanWeek(week), snackThresholdMinutes: snackThreshold, snackMinutes }) });
    setMsg(res.ok ? "Modelo padrão da empresa salvo." : "Falha ao salvar modelo.");
  }

  async function generateMonth() {
    if (!employeeId) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hr/shifts/generate-month", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ employeeId, month, weekdays: cleanWeek(week) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error?.message ?? "Falha");
      const warns: string[] = d.warnings ?? [];
      setMsg(`Escala gerada: ${d.created} dia(s)${d.holidaysSkipped ? `, ${d.holidaysSkipped} feriado(s) pulado(s)` : ""}.${warns.length ? "\n⚠ " + warns.join("\n⚠ ") : ""}`); load();
    } catch (e: any) { setMsg(`Erro: ${e.message}`); } finally { setBusy(false); }
  }
  async function del(id: string) { await fetch(`/api/hr/shifts/${id}`, { method: "DELETE", credentials: "include" }); load(); }
  async function addHoliday() {
    if (!newHoliday.date) return;
    const res = await fetch("/api/hr/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ holidayDate: newHoliday.date, name: newHoliday.name || null, recurringAnnual: newHoliday.recurring }) });
    if (res.ok) { const d = await res.json(); setHolidays((h) => [...h, d.holiday]); setNewHoliday({ date: "", name: "", recurring: false }); }
  }
  async function delHoliday(id: string) { await fetch(`/api/hr/holidays/${id}`, { method: "DELETE", credentials: "include" }); setHolidays((h) => h.filter((x) => x.id !== id)); }
  const empName = (id: string) => employees.find((e) => e.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      {/* Configuração da jornada por dia da semana */}
      <div className="space-y-3 rounded-xl border border-line bg-bg/60 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Jornada por dia da semana</p>
          <button onClick={saveDefault} className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:border-brand">Salvar como padrão da empresa</button>
        </div>
        <p className="text-xs text-muted">Configure cada dia (ex.: sábado meio período). Dias desativados viram folga. Feriados abaixo também viram folga.</p>
        <div className="space-y-1.5">
          {week.map((c) => (
            <div key={c.weekday} className="flex flex-wrap items-center gap-2 rounded-lg border border-line/60 bg-bg/40 px-3 py-2">
              <label className="flex w-28 items-center gap-2 text-sm">
                <input type="checkbox" checked={c.enabled} onChange={(e) => setWd(c.weekday, { enabled: e.target.checked })} className="h-4 w-4" />
                {WD_LABEL[c.weekday]}
              </label>
              {c.enabled ? (
                <>
                  <input type="time" value={c.startTime} onChange={(e) => setWd(c.weekday, { startTime: e.target.value })} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
                  <span className="text-muted">→</span>
                  <input type="time" value={c.endTime} onChange={(e) => setWd(c.weekday, { endTime: e.target.value })} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
                  <label className="flex items-center gap-1 text-xs text-muted">almoço
                    <input type="time" value={c.lunchStart} onChange={(e) => setWd(c.weekday, { lunchStart: e.target.value })} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
                    <span>→</span>
                    <input type="time" value={c.lunchEnd} onChange={(e) => setWd(c.weekday, { lunchEnd: e.target.value })} className="rounded border border-line bg-bg/60 px-2 py-1 text-sm" />
                  </label>
                </>
              ) : <span className="text-xs text-muted">folga</span>}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted">O almoço é por horário fixo (saída/volta). Deixe em branco no dia sem almoço (ex.: meio período).</p>

        {/* Regra de lanche na hora extra */}
        <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <p className="w-full text-xs font-medium">Lanche na hora extra</p>
          <label className="flex items-center gap-1 text-xs text-muted">a partir de
            <input type="number" min={0} max={600} value={snackThreshold} onChange={(e) => setSnackThreshold(Number(e.target.value))} className="w-20 rounded border border-line bg-bg/60 px-2 py-1 text-sm" /> min de hora extra
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">duração
            <input type="number" min={0} max={120} value={snackMinutes} onChange={(e) => setSnackMinutes(Number(e.target.value))} className="w-16 rounded border border-line bg-bg/60 px-2 py-1 text-sm" /> min
          </label>
          <span className="text-[11px] text-muted">Padrão: 120 min (2h) → lanche de 15 min.</span>
        </div>
      </div>

      {/* Feriados da empresa */}
      <div className="space-y-2 rounded-xl border border-line bg-bg/60 p-4">
        <p className="text-sm font-medium">Feriados / folgas da empresa</p>
        <div className="flex flex-wrap items-end gap-2">
          <Inp label="Data" type="date" value={newHoliday.date} onChange={(v) => setNewHoliday({ ...newHoliday, date: v })} />
          <Inp label="Nome" value={newHoliday.name} onChange={(v) => setNewHoliday({ ...newHoliday, name: v })} />
          <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={newHoliday.recurring} onChange={(e) => setNewHoliday({ ...newHoliday, recurring: e.target.checked })} /> todo ano</label>
          <button onClick={addHoliday} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">+ Adicionar</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {holidays.map((h) => (
            <span key={h.id} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs">
              {new Date(h.holidayDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}{h.recurringAnnual ? " ↻" : ""}{h.name ? ` ${h.name}` : ""}
              <button onClick={() => delHoliday(h.id)} className="text-muted hover:text-red-300">×</button>
            </span>
          ))}
          {holidays.length === 0 && <span className="text-xs text-muted">Nenhum feriado cadastrado.</span>}
        </div>
      </div>

      {/* Gerar */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-bg/60 p-4">
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Funcionário</span>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="rounded border border-line bg-bg/60 px-2 py-1.5 text-sm">
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <Inp label="Mês" type="month" value={month} onChange={setMonth} />
        <button onClick={generateMonth} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Gerando..." : "Gerar escala do mês"}</button>
        {msg && <p className="w-full whitespace-pre-line text-xs text-muted">{msg}</p>}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Escala de {new Date(month + "-01T12:00:00Z").toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
        <div className="space-y-1">
          {items.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded border border-line/60 bg-bg/60 px-3 py-2 text-sm">
              <span>{new Date(s.shiftDate).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })} · {empName(s.employeeId)} · {s.startTime}–{s.endTime}{s.breakMinutes ? ` (almoço ${s.breakMinutes}min)` : ""}</span>
              <button onClick={() => del(s.id)} className="text-xs text-muted hover:text-red-300">remover</button>
            </div>
          ))}
          {items.length === 0 && <p className="text-xs text-muted">Sem escala nesse mês.</p>}
        </div>
      </div>
    </div>
  );
}

// ============================== MURAL ==============================
function Mural({ stores }: { stores: Store[] }) {
  const [items, setItems] = useState<any[]>([]);
  const [f, setF] = useState({ title: "", body: "", pinned: false, storeId: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/hr/notices", { credentials: "include", cache: "no-store" });
    const d = await res.json(); if (res.ok) setItems(d.items ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!f.title.trim() || !f.body.trim()) return;
    await fetch("/api/hr/notices", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...f, storeId: f.storeId || null }) });
    setF({ title: "", body: "", pinned: false, storeId: "" }); load();
  }
  async function del(id: string) { await fetch(`/api/hr/notices/${id}`, { method: "DELETE", credentials: "include" }); load(); }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border border-line p-3">
        <Inp label="Título" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
        <label className="block"><span className="mb-1 block text-[10px] uppercase text-muted">Mensagem</span>
          <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Fixar no topo</label>
        <button onClick={create} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white">Publicar</button>
      </div>
      <div className="space-y-2">
        {items.map((n) => (
          <div key={n.id} className="rounded-lg border border-line bg-bg/60 p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">{n.pinned ? "📌 " : ""}{n.title}</p>
              <button onClick={() => del(n.id)} className="text-xs text-muted hover:text-red-300">remover</button>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{n.body}</p>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted">Nenhum aviso publicado.</p>}
      </div>
    </div>
  );
}

// ============================== shared ==============================
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${active ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}>{children}</button>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = { active: "bg-green-500/20 text-green-300", inactive: "bg-line text-muted", terminated: "bg-red-500/20 text-red-300" };
  const label: Record<string, string> = { active: "ativo", inactive: "inativo", terminated: "desligado" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${map[status] ?? "bg-line text-muted"}`}>{label[status] ?? status}</span>;
}
function Inp({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase text-muted">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line bg-bg/60 px-2 py-1.5 text-sm" />
    </label>
  );
}
