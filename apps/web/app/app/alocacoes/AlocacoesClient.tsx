"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

/**
 * ALOCAÇÕES / CESSÃO DE MÃO DE OBRA — portada do Norty RH.
 *
 * O serviço (`allocation.service.ts`) e as 10 rotas já vieram no porte do
 * ponto; só a tela ficou de fora. Backend sem tela é recurso que não existe.
 *
 * A assimetria das duas listas é a regra trabalhista, não decisão de layout:
 * quem CEDE manda (cria, encerra, fatura); quem RECEBE só lê. A folha, o AFD,
 * o AEJ e o eSocial ficam na empregadora — a tomadora acompanha horas.
 */

interface Emp { id: string; name: string; cargo: string | null }
interface Cedida {
  id: string; status: string; posto: string | null; startsAt: string; endsAt: string | null;
  reason: string | null; billRateCents: number | null; employeeName: string; cargo: string | null; borrowerName: string;
}
interface Recebida {
  id: string; posto: string | null; startsAt: string; endsAt: string | null;
  employeeName: string; cargo: string | null; employerName: string;
}

function dataBr(s: string | null) { return s ? new Date(s).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "—"; }
function hm(min: number) { const m = Math.round(min || 0); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`; }
const brl = (c: number | null) => (c == null ? "—" : `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
const hoje = () => new Date().toISOString().slice(0, 10);

export function AlocacoesClient() {
  const dialog = useDialog();
  const [emps, setEmps] = useState<Emp[]>([]);
  const [cedidas, setCedidas] = useState<Cedida[]>([]);
  const [recebidas, setRecebidas] = useState<Recebida[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ pontoEmployeeId: "", borrowerSlug: "", posto: "", startsAt: hoje(), endsAt: "", reason: "", billRate: "" });
  const [batidas, setBatidas] = useState<Record<string, { count: number; workedMin: number }>>({});
  const [de, setDe] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [ate, setAte] = useState(hoje());
  const [repCedidas, setRepCedidas] = useState<any>(null);
  const [repRecebidas, setRepRecebidas] = useState<any>(null);

  const carrega = useCallback(async () => {
    const opts = { credentials: "include" as const, headers: { "x-no-loading": "1" } };
    const vazio = { items: [] };
    const [e, c, r] = await Promise.all([
      fetch("/api/ponto/alocacoes/funcionarios", opts).then((x) => (x.ok ? x.json() : vazio)).catch(() => vazio),
      fetch("/api/ponto/alocacoes/cedidas", opts).then((x) => (x.ok ? x.json() : vazio)).catch(() => vazio),
      fetch("/api/ponto/alocacoes/recebidas", opts).then((x) => (x.ok ? x.json() : vazio)).catch(() => vazio),
    ]);
    setEmps(e.items ?? []); setCedidas(c.items ?? []); setRecebidas(r.items ?? []);
  }, []);
  useEffect(() => { carrega(); }, [carrega]);

  const carregaRelatorios = useCallback(async () => {
    const opts = { credentials: "include" as const, headers: { "x-no-loading": "1" } };
    const qs = `from=${de}&to=${ate}`;
    const [c, r] = await Promise.all([
      fetch(`/api/ponto/alocacoes/relatorio/cedidas?${qs}`, opts).then((x) => (x.ok ? x.json() : null)).catch(() => null),
      fetch(`/api/ponto/alocacoes/relatorio/recebidas?${qs}`, opts).then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    setRepCedidas(c); setRepRecebidas(r);
  }, [de, ate]);
  useEffect(() => { carregaRelatorios(); }, [carregaRelatorios]);

  async function alocar() {
    if (!form.pontoEmployeeId) { dialog.toast("Selecione o funcionário", "error"); return; }
    if (!form.borrowerSlug.trim()) { dialog.toast("Informe o identificador da empresa tomadora", "error"); return; }
    setBusy(true);
    try {
      const billRateCents = form.billRate.trim() ? Math.round(parseFloat(form.billRate.replace(",", ".")) * 100) : undefined;
      const r = await fetch("/api/ponto/alocacoes", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, billRateCents }) });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error?.message ?? "Falha ao alocar");
      dialog.toast(`Alocado em ${d?.borrowerName ?? "tomadora"} ✅`, "success");
      setForm({ ...form, pontoEmployeeId: "", borrowerSlug: "", posto: "", endsAt: "", reason: "" });
      carrega(); carregaRelatorios();
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setBusy(false); }
  }

  async function encerrar(a: Cedida) {
    if (!(await dialog.confirm({ title: "Encerrar alocação", message: `Encerrar a alocação de ${a.employeeName} em ${a.borrowerName}? A tomadora perde o acesso imediatamente.`, confirmLabel: "Encerrar", tone: "danger" }))) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/ponto/alocacoes/${a.id}/encerrar`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ended" }) });
      if (!r.ok) throw new Error("Falha ao encerrar");
      carrega(); carregaRelatorios();
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setBusy(false); }
  }

  async function verHoras(id: string) {
    const r = await fetch(`/api/ponto/alocacoes/${id}/batidas`, { credentials: "include", headers: { "x-no-loading": "1" } });
    const d = await r.json().catch(() => null);
    if (r.ok && d) setBatidas((m) => ({ ...m, [id]: { count: d.count, workedMin: d.workedMin } }));
  }

  const semRelatorio = (!repCedidas || repCedidas.rows.length === 0) && (!repRecebidas || repRecebidas.rows.length === 0);

  return (
    <div className="space-y-6">
      {/* ---- ceder (somos a empregadora) ---- */}
      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <h3 className="text-base font-semibold">Ceder funcionário para outra empresa</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase text-muted">Funcionário</span>
            <select value={form.pontoEmployeeId} onChange={(e) => setForm({ ...form, pontoEmployeeId: e.target.value })} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm">
              <option value="">Selecione…</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}{e.cargo ? ` — ${e.cargo}` : ""}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase text-muted">Empresa tomadora (identificador)</span>
            <input value={form.borrowerSlug} onChange={(e) => setForm({ ...form, borrowerSlug: e.target.value })} placeholder="ex.: empresa-b (subdomínio da tomadora)" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase text-muted">Posto / local (opcional)</span>
            <input value={form.posto} onChange={(e) => setForm({ ...form, posto: e.target.value })} placeholder="ex.: Recepção, Loja Shopping" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase text-muted">Início</span>
              <input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase text-muted">Fim (opcional)</span>
              <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase text-muted">Valor/hora a faturar (R$, opcional)</span>
            <input value={form.billRate} onChange={(e) => setForm({ ...form, billRate: e.target.value })} inputMode="decimal" placeholder="ex.: 25,00" className="w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" />
          </label>
        </div>
        <button onClick={alocar} disabled={busy} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Alocar</button>
      </section>

      {/* ---- cedidos por nós ---- */}
      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <h3 className="mb-3 text-base font-semibold">Cedidos por nós (somos a empregadora)</h3>
        {cedidas.length === 0 ? <p className="text-sm text-muted">Nenhuma alocação.</p> : (
          <div className="space-y-2">
            {cedidas.map((a) => (
              <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 ${a.status !== "active" ? "opacity-60" : ""}`}>
                <div>
                  <p className="text-sm font-medium">
                    {a.employeeName} → <span className="text-brand">{a.borrowerName}</span>
                    {a.status !== "active" && <span className="ml-1 rounded bg-line px-1.5 py-0.5 text-[10px] uppercase text-muted">{a.status === "ended" ? "encerrada" : "cancelada"}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {a.posto ? `${a.posto} · ` : ""}{dataBr(a.startsAt)} → {a.endsAt ? dataBr(a.endsAt) : "sem prazo"}{a.cargo ? ` · ${a.cargo}` : ""}
                    {a.billRateCents != null ? ` · ${brl(a.billRateCents)}/h` : ""}
                  </p>
                </div>
                {a.status === "active" && (
                  <button onClick={() => encerrar(a)} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-red-500/60 hover:text-red-300 disabled:opacity-50">Encerrar</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- alocados aqui ---- */}
      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <h3 className="mb-1 text-base font-semibold">Alocados aqui (somos a tomadora)</h3>
        <p className="mb-3 text-xs text-muted">Somente leitura — a folha e o ponto fiscal são da empregadora. Aqui só se acompanham as horas.</p>
        {recebidas.length === 0 ? <p className="text-sm text-muted">Nenhum funcionário alocado na sua empresa.</p> : (
          <div className="space-y-2">
            {recebidas.map((a) => (
              <div key={a.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{a.employeeName} <span className="text-xs text-muted">({a.employerName})</span></p>
                    <p className="text-xs text-muted">{a.posto ? `${a.posto} · ` : ""}{dataBr(a.startsAt)} → {a.endsAt ? dataBr(a.endsAt) : "sem prazo"}{a.cargo ? ` · ${a.cargo}` : ""}</p>
                  </div>
                  <button onClick={() => verHoras(a.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">Ver horas</button>
                </div>
                {batidas[a.id] && (
                  <p className="mt-2 text-xs text-muted">⏱ {batidas[a.id]!.count} marcações · total trabalhado ≈ <b>{hm(batidas[a.id]!.workedMin)}</b> (período da alocação)</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- relatório / faturamento ---- */}
      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <h3 className="mb-1 text-base font-semibold">Relatório de horas por tomador</h3>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase text-muted">De</span>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase text-muted">Até</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-lg border border-line bg-bg/60 px-2 py-1.5 text-sm" />
          </label>
          <a href={`/api/ponto/alocacoes/relatorio/cedidas.csv?from=${de}&to=${ate}`} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-brand">⬇ CSV (faturamento)</a>
        </div>

        {repCedidas && repCedidas.byBorrower?.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {repCedidas.byBorrower.map((g: any) => (
              <a key={g.borrowerOrgId} href={`/api/ponto/alocacoes/relatorio/fatura.pdf?borrowerOrgId=${g.borrowerOrgId}&from=${de}&to=${ate}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-brand">
                📄 Fatura — {g.borrowerName} ({hm(g.workedMin)}{g.hasBill ? ` · ${brl(g.billCents)}` : ""})
              </a>
            ))}
          </div>
        )}

        {repCedidas && repCedidas.rows.length > 0 && (
          <div className="mb-4">
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Cedidos por nós (faturar à tomadora)</p>
            <div className="overflow-x-auto">
              <table className="table-cards w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3">Tomadora</th><th className="pr-3">Funcionário</th><th className="pr-3">Posto</th>
                    <th className="pr-3">Horas</th><th className="pr-3">Valor/h</th><th className="pr-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {repCedidas.rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-line/50">
                      <td className="py-1.5 pr-3" data-label="Tomadora">{r.borrowerName}</td>
                      <td className="pr-3" data-label="Funcionário">{r.employeeName}</td>
                      <td className="pr-3 text-xs text-muted" data-label="Posto">{r.posto ?? "—"}</td>
                      <td className="pr-3" data-label="Horas">{hm(r.workedMin)}</td>
                      <td className="pr-3" data-label="Valor/h">{brl(r.billRateCents)}</td>
                      <td className="pr-3 font-medium" data-label="Total">{brl(r.billCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <td className="py-1.5 pr-3 font-semibold" colSpan={3} data-label="Total">TOTAL</td>
                    <td className="pr-3 font-semibold" data-label="Horas">{hm(repCedidas.totals.workedMin)}</td>
                    <td />
                    <td className="pr-3 font-semibold" data-label="Total">{brl(repCedidas.totals.billCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {repRecebidas && repRecebidas.rows.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Alocados aqui (horas no período)</p>
            <div className="overflow-x-auto">
              <table className="table-cards w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3">Funcionário</th><th className="pr-3">Empregadora</th>
                    <th className="pr-3">Posto</th><th className="pr-3">Marcações</th><th className="pr-3">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {repRecebidas.rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-line/50">
                      <td className="py-1.5 pr-3" data-label="Funcionário">{r.employeeName}</td>
                      <td className="pr-3 text-xs text-muted" data-label="Empregadora">{r.employerName}</td>
                      <td className="pr-3 text-xs text-muted" data-label="Posto">{r.posto ?? "—"}</td>
                      <td className="pr-3" data-label="Marcações">{r.count}</td>
                      <td className="pr-3 font-medium" data-label="Horas">{hm(r.workedMin)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <td className="py-1.5 pr-3 font-semibold" colSpan={4} data-label="Total">TOTAL</td>
                    <td className="pr-3 font-semibold" data-label="Horas">{hm(repRecebidas.totals.workedMin)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {semRelatorio && <p className="text-sm text-muted">Sem alocações no período.</p>}
      </section>
    </div>
  );
}
