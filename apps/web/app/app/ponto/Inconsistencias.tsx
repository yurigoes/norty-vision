"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";

type Kind = "incompleta" | "falta" | "atraso" | "saida" | "extra" | "folga";
type IncDay = { day: string; wd: number; kinds: Kind[]; punches: string[]; previsto: string; negMin: number; posMin: number };
type IncEmp = { id: string; name: string; cargo: string | null; storeId: string | null; semEscala: boolean; days: IncDay[]; counts: Partial<Record<Kind, number>> };
type IncData = { from: string; to: string; yesterday: string; employees: IncEmp[]; totals: { employees: number; days: number; byKind: Partial<Record<Kind, number>> }; checked: number };

/** A grade de ajuste em tela cheia mora na página do ponto; aqui ela chega pronta, com a navegação da fila. */
export type AjusteProps = {
  empId: string; data: any; range: { from: string; to: string }; dialog: any; onClose: () => void; onSaved: () => void;
  nav?: { pos: number; total: number; onPrev?: () => void; onNext?: () => void; nextName?: string | null };
  focusDays?: string[];
};

const KINDS: { key: Kind; label: string; cls: string }[] = [
  { key: "incompleta", label: "Batida incompleta", cls: "bg-orange-500/15 text-orange-500 border-orange-500/40" },
  { key: "falta", label: "Falta", cls: "bg-red-500/15 text-red-500 border-red-500/40" },
  { key: "atraso", label: "Atraso", cls: "bg-yellow-500/15 text-yellow-600 border-yellow-500/40" },
  { key: "saida", label: "Saída antecipada", cls: "bg-yellow-500/15 text-yellow-600 border-yellow-500/40" },
  { key: "extra", label: "Extra sem classificar", cls: "bg-blue-500/15 text-blue-500 border-blue-500/40" },
  { key: "folga", label: "Trabalhou na folga", cls: "bg-purple-500/15 text-purple-500 border-purple-500/40" },
];
const KIND_BY = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<Kind, (typeof KINDS)[number]>;
const WD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const br = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

/** Do dia 1º até ontem; nos primeiros dias do mês, o mês anterior inteiro (é quando se fecha o ponto). */
function defaultRange() {
  const now = new Date(); const y = new Date(now); y.setDate(y.getDate() - 1);
  const first = now.getDate() <= 5 ? new Date(now.getFullYear(), now.getMonth() - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: iso(first), to: iso(y) };
}

/**
 * FILA DE PONTOS INCONSISTENTES — portada do Norty RH.
 *
 * Só quem tem dia pendente de decisão. Abre a grade de ajuste já no
 * funcionário, e "Próximo" salva o que foi alterado e pula pro seguinte da
 * fila — sem voltar pra lista. Quem fica sem pendência sai da fila sozinho,
 * porque a pendência é DERIVADA do espelho, não um estado guardado: não há o
 * que sincronizar nem o que ficar velho.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * A fila é CONGELADA na abertura (`queue`). Se ela se reordenasse a cada
 * correção, a pessoa que você acabou de ajustar sairia do meio e o "Próximo"
 * pularia alguém.
 *
 * A resposta de espelho que chega DEPOIS de trocar de funcionário é descartada
 * (`curRef`). Sem isso, numa fila percorrida rápido, o espelho de quem você já
 * passou sobrescreve o de quem está na tela — e você edita o ponto errado.
 */
export function Inconsistencias({ dialog, Ajuste }: { dialog: any; Ajuste: ComponentType<AjusteProps> }) {
  const [range, setRange] = useState(defaultRange());
  const [stores, setStores] = useState<any[]>([]);
  const [storeId, setStoreId] = useState("");
  const [cargo, setCargo] = useState("");
  const [q, setQ] = useState("");
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ incompleta: true, falta: true, atraso: true, saida: true, extra: true, folga: true });
  const [order, setOrder] = useState<"nome" | "pendencias">("pendencias");
  const [data, setData] = useState<IncData | null>(null);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState<string[]>([]); // fila congelada no momento em que abriu (a ordem não muda no meio)
  const [cur, setCur] = useState<string | null>(null);
  const [esp, setEsp] = useState<any>(null);
  const [seen, setSeen] = useState<Record<string, boolean>>({}); // por quem já passei nesta sessão
  const reqRef = useRef(0);
  const curRef = useRef<string | null>(null); // resposta de espelho que chega depois de trocar de funcionário é descartada

  useEffect(() => { fetch("/api/stores", { credentials: "include", headers: { "x-no-loading": "1" } }).then((r) => (r.ok ? r.json() : null)).then((d) => setStores(d?.items ?? d ?? [])).catch(() => {}); }, []);
  const load = (quiet = false) => {
    if (!range.from || !range.to) return;
    const id = ++reqRef.current; if (!quiet) setLoading(true);
    fetch(`/api/ponto/inconsistencias?from=${range.from}&to=${range.to}${storeId ? `&storeId=${storeId}` : ""}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then(async (r) => { const d = await r.json().catch(() => null); if (id !== reqRef.current) return; if (!r.ok) { dialog.toast(d?.error?.message ?? "Não consegui calcular as inconsistências", "error"); return; } setData(d); })
      .catch(() => { if (id === reqRef.current) dialog.toast("Sem conexão com o servidor", "error"); })
      .finally(() => { if (id === reqRef.current) setLoading(false); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range.from, range.to, storeId]);

  const active = (d: IncDay) => d.kinds.some((k) => kinds[k]);
  const cargos = useMemo(() => [...new Set((data?.employees ?? []).map((e) => e.cargo).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")), [data]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rows = (data?.employees ?? [])
      .filter((e) => (!cargo || e.cargo === cargo) && (!term || e.name.toLowerCase().includes(term)))
      .map((e) => ({ ...e, days: e.days.filter(active) }))
      .filter((e) => e.days.length);
    rows.sort((a, b) => (order === "pendencias" ? b.days.length - a.days.length : 0) || a.name.localeCompare(b.name, "pt-BR"));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, cargo, q, kinds, order]);
  const totalDays = list.reduce((n, e) => n + e.days.length, 0);
  const storeName = (id: string | null) => stores.find((s: any) => s.id === id)?.name ?? "";
  const rangeEff = { from: data?.from ?? range.from, to: data?.to ?? range.to };

  // espelho do funcionário aberto (o mesmo que a aba Espelho usa)
  const loadEsp = (id: string) => fetch(`/api/ponto/espelho?employeeId=${id}&from=${rangeEff.from}&to=${rangeEff.to}`, { credentials: "include", headers: { "x-no-loading": "1" } })
    .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && curRef.current === id) setEsp(d); }).catch(() => {});
  useEffect(() => { curRef.current = cur; setEsp(null); if (cur) void loadEsp(cur); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cur]);

  function open(id: string) { setQueue(list.map((e) => e.id)); setSeen((s) => ({ ...s, [id]: true })); setCur(id); }
  function go(delta: number) {
    const i = queue.indexOf(cur ?? ""); const next = queue[i + delta];
    if (!next) { close(); return; }
    setSeen((s) => ({ ...s, [next]: true })); setCur(next); load(true);
  }
  function close() { setCur(null); setEsp(null); load(true); }

  const pos = cur ? queue.indexOf(cur) : -1;
  const curRow = cur ? (data?.employees ?? []).find((e) => e.id === cur) : null;
  const nextRow = pos >= 0 && queue[pos + 1] ? (data?.employees ?? []).find((e) => e.id === queue[pos + 1]) : null;
  const resolved = Object.keys(seen).filter((id) => !(data?.employees ?? []).some((e) => e.id === id)).length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">De <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" /></label>
        <label className="text-sm">Até <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="rounded-lg border border-line bg-bg/40 px-2 py-2 text-sm" /></label>
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <option value="">todas as lojas</option>
          {stores.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={cargo} onChange={(e) => setCargo(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm">
          <option value="">todos os cargos</option>
          {cargos.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nome…" className="min-w-[160px] flex-1 rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
        <button onClick={() => load()} disabled={loading} className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand disabled:opacity-50">{loading ? "Calculando…" : "Atualizar"}</button>
      </div>

      <div className="mb-3 rounded-xl border border-line bg-bg/60 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-2xl font-semibold leading-none">{loading && !data ? "…" : list.length}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">funcionário(s) com pendência</p>
          </div>
          <div>
            <p className="text-2xl font-semibold leading-none">{loading && !data ? "…" : totalDays}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-muted">dia(s) a resolver</p>
          </div>
          {resolved > 0 && <div><p className="text-2xl font-semibold leading-none text-green-500">{resolved}</p><p className="mt-1 text-[11px] uppercase tracking-wider text-muted">resolvido(s) agora</p></div>}
          <button onClick={() => list[0] && open(list[0].id)} disabled={!list.length} className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Começar pela fila ▶</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-muted">Mostrar</span>
          {KINDS.map((k) => (
            <button key={k.key} onClick={() => setKinds((s) => ({ ...s, [k.key]: !s[k.key] }))} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${kinds[k.key] ? k.cls : "border-line text-muted line-through opacity-60"}`}>
              {k.label} · {data?.totals.byKind[k.key] ?? 0}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1 text-xs text-muted">Ordem
            <select value={order} onChange={(e) => setOrder(e.target.value as any)} className="rounded-lg border border-line bg-bg/40 px-2 py-1 text-xs"><option value="pendencias">mais pendências primeiro</option><option value="nome">nome</option></select>
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {data ? `Período ${br(data.from)} a ${br(data.to)} · ${data.checked} funcionário(s) conferido(s). ` : ""}
          O dia de hoje não entra (quem ainda está trabalhando tem batida ímpar). Sai da fila o dia que você corrigir, abonar ou lançar em banco de horas / hora extra.
        </p>
      </div>

      {loading && !data && <p className="rounded-xl border border-line bg-bg/60 p-6 text-sm text-muted">Calculando o espelho de todos os funcionários…</p>}
      {data && !list.length && <p className="rounded-xl border border-green-500/30 bg-green-500/5 p-6 text-sm text-green-600">Nenhum ponto inconsistente nesse período e filtro. ✅</p>}

      <div className="space-y-2">
        {list.map((e) => (
          <div key={e.id} className={`rounded-xl border bg-bg/60 p-3 ${seen[e.id] ? "border-brand/40" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-semibold">{e.name}{seen[e.id] && <span className="ml-2 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">já aberto</span>}</p>
                <p className="text-[11px] text-muted">{[e.cargo, storeName(e.storeId), e.semEscala ? "sem escala cadastrada" : ""].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {KINDS.filter((k) => kinds[k.key] && e.days.some((d) => d.kinds.includes(k.key))).map((k) => (
                  <span key={k.key} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${k.cls}`}>{k.label} · {e.days.filter((d) => d.kinds.includes(k.key)).length}</span>
                ))}
              </div>
              <button onClick={() => open(e.id)} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">Ajustar</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {e.days.slice(0, 8).map((d) => (
                <span key={d.day} title={`Previsto: ${d.previsto || "folga"}`} className="rounded-lg border border-line/60 bg-bg/40 px-2 py-1 text-[11px]">
                  <b>{br(d.day)}</b> <span className="text-muted">{WD[d.wd]}</span> · {d.kinds.filter((k) => kinds[k]).map((k) => KIND_BY[k].label.toLowerCase()).join(", ")}
                  <span className="ml-1 font-mono text-muted">{d.punches.length ? d.punches.join(" ") : "sem batida"}</span>
                </span>
              ))}
              {e.days.length > 8 && <span className="px-1 py-1 text-[11px] text-muted">+{e.days.length - 8} dia(s)</span>}
            </div>
          </div>
        ))}
      </div>

      {cur && (esp ? (
        <Ajuste key={cur} empId={cur} data={esp} range={rangeEff} dialog={dialog} onClose={close} onSaved={() => { void loadEsp(cur); load(true); }}
          nav={{ pos: pos + 1, total: queue.length, onPrev: pos > 0 ? () => go(-1) : undefined, onNext: pos < queue.length - 1 ? () => go(1) : undefined, nextName: nextRow?.name ?? null }}
          focusDays={(curRow?.days ?? []).map((d) => d.day)} />
      ) : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg text-sm text-muted">Abrindo o ponto do funcionário…</div>
      ))}
    </section>
  );
}
