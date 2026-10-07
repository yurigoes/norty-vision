"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialog } from "../../../components/SystemDialog";

/**
 * ASSIDUIDADE — portada do Norty RH.
 *
 * O serviço (`assiduidade.service.ts`) e as três rotas já vieram no porte do
 * ponto; só a tela ficou de fora, e sem tela o recurso não existe pra quem usa.
 *
 * UMA DIFERENÇA REAL EM RELAÇÃO AO RH, e ela está visível na tela de propósito:
 * a coluna "Medidas" mostra sempre 0. No RH o bônus é bloqueado por medida
 * disciplinar (advertência/suspensão), que vem do módulo de medidas — módulo
 * que NÃO foi portado, porque é RH, não ponto. O contador fica em zero até ele
 * existir. Esconder a coluna seria pior: quem conhece o RH procuraria por ela
 * e concluiria que a regra está valendo.
 */

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const brl = (c: number) => `R$ ${(c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

export function AssiduidadeClient() {
  const dialog = useDialog();
  const [refMonth, setRefMonth] = useState(mesAtual());
  const [data, setData] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const carregaRanking = useCallback(() => {
    fetch(`/api/ponto/assiduidade/ranking?refMonth=${refMonth}`, { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, [refMonth]);
  useEffect(() => { carregaRanking(); }, [carregaRanking]);
  useEffect(() => {
    fetch("/api/ponto/config", { credentials: "include", headers: { "x-no-loading": "1" } })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setCfg(d)).catch(() => {});
  }, []);

  async function salvarRegras() {
    setBusy(true);
    const body = {
      assidBonusCents: Math.round((parseFloat(String(cfg.assidBonusReais ?? cfg.assidBonusCents / 100).replace(",", ".")) || 0) * 100),
      assidMaxAtestadoDays: Number(cfg.assidMaxAtestadoDays),
      assidMaxLates: Number(cfg.assidMaxLates),
      assidBlockMeasure: !!cfg.assidBlockMeasure,
      assidBlockFalta: !!cfg.assidBlockFalta,
      assidProportional: !!cfg.assidProportional,
    };
    const res = await fetch("/api/ponto/config", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    dialog.toast(res.ok ? "Configuração salva ✅" : "Falha ao salvar", res.ok ? "success" : "error");
    carregaRanking();
  }

  async function liberar() {
    if (!(await dialog.confirm({ title: "Disponibilizar no portal", message: `Liberar os recibos de TODOS os elegíveis de ${refMonth} para assinatura no portal do colaborador?` }))) return;
    setBusy(true);
    const res = await fetch("/api/ponto/assiduidade/liberar", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refMonth }) });
    const d = await res.json().catch(() => null);
    setBusy(false);
    dialog.toast(res.ok ? `${d?.released ?? 0} recibo(s) disponibilizado(s) ✅` : "Falha", res.ok ? "success" : "error");
    carregaRanking();
  }

  const setC = (k: string, v: any) => setCfg((s: any) => ({ ...s, [k]: v }));
  const itens: any[] = data?.items ?? [];

  return (
    <div className="space-y-6">
      {cfg && (
        <section className="rounded-xl border border-line bg-bg/60 p-5">
          <p className="mb-3 text-sm font-semibold">Regras do bônus</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Valor do bônus (R$)</span>
              <input value={cfg.assidBonusReais ?? (cfg.assidBonusCents / 100).toString().replace(".", ",")} onChange={(e) => setC("assidBonusReais", e.target.value)} inputMode="decimal" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Máx. dias de atestado</span>
              <input value={cfg.assidMaxAtestadoDays ?? 2} onChange={(e) => setC("assidMaxAtestadoDays", e.target.value)} inputMode="numeric" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Máx. atrasos</span>
              <input value={cfg.assidMaxLates ?? 4} onChange={(e) => setC("assidMaxLates", e.target.value)} inputMode="numeric" className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="mt-3 grid gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.assidBlockMeasure !== false} onChange={(e) => setC("assidBlockMeasure", e.target.checked)} />
              Medida disciplinar no mês torna inelegível
              <span className="text-[11px] text-muted">(sem efeito: módulo de medidas não existe no Vision)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.assidBlockFalta !== false} onChange={(e) => setC("assidBlockFalta", e.target.checked)} />
              Falta injustificada torna inelegível
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cfg.assidProportional !== false} onChange={(e) => setC("assidProportional", e.target.checked)} />
              Valor proporcional (admissão no mês / retorno de férias)
            </label>
          </div>
          <button onClick={salvarRegras} disabled={busy} className="mt-3 rounded-lg border border-line px-4 py-2 text-sm hover:border-brand disabled:opacity-50">Salvar regras</button>
        </section>
      )}

      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase text-muted">Competência</span>
              <input type="month" value={refMonth} onChange={(e) => setRefMonth(e.target.value)} className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-sm" />
            </label>
            {data && (
              <span className="text-xs text-muted">
                {data.closed ? "✅ folha fechada" : "⚠ folha em aberto"} · elegíveis: <b>{data.totalEligible}</b> · total {brl(data.totalCents)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={liberar} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Disponibilizar no portal</button>
            <a href={`/api/ponto/assiduidade/recibos.pdf?refMonth=${refMonth}`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-sm hover:border-brand">📄 Recibos (PDF)</a>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-cards w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3">Funcionário</th>
                <th className="pr-3">Situação</th>
                <th className="pr-3">Atestado</th>
                <th className="pr-3">Atrasos</th>
                <th className="pr-3">Medidas</th>
                <th className="pr-3">Valor</th>
                <th className="pr-3">Portal</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i: any) => (
                <tr key={i.employeeId} className="border-t border-line/50">
                  <td className="py-1.5 pr-3" data-label="Funcionário">{i.name}</td>
                  <td className="pr-3" data-label="Situação">
                    {i.eligible ? <span className="text-green-300">Recebe</span> : <span className="text-red-300" title={i.reason}>Não recebe</span>}
                    {!i.eligible && i.reason ? <span className="block text-[11px] text-muted">{i.reason}</span> : null}
                  </td>
                  <td className="pr-3" data-label="Atestado">{i.atestadoDays}</td>
                  <td className="pr-3" data-label="Atrasos">{i.lateCount}</td>
                  <td className="pr-3" data-label="Medidas">{i.measures}</td>
                  <td className="pr-3 font-medium" data-label="Valor">{i.eligible ? brl(i.amountCents) + (i.proportional ? " *" : "") : "—"}</td>
                  <td className="pr-3 text-xs" data-label="Portal">
                    {i.released ? (i.signed ? <span className="text-green-300">assinado ✓</span> : <span className="text-amber-300">liberado</span>) : "—"}
                  </td>
                </tr>
              ))}
              {itens.length === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-muted">Sem dados nesta competência.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          * valor proporcional (admissão no mês ou retorno de férias). Atrasos = total de atrasos por segmento no mês
          (entrada, volta do almoço, etc.). <b>Medidas</b> fica sempre em 0: o módulo de medidas disciplinares é do RH e
          não foi portado para o Vision.
        </p>
      </section>
    </div>
  );
}
