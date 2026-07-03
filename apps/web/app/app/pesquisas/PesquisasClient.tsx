"use client";

import { useCallback, useEffect, useState } from "react";

type Preset = "semana" | "quinzena" | "mes" | "trimestre";

interface Metrics {
  sent: number; answered: number; nps: number | null;
  promoters: number; detractors: number; neutrals: number;
  avgSellerRating: number | null;
}
interface Item {
  id: string; kind: string; stage: string | null;
  npsScore: number | null; sellerRating: number | null;
  sellerName: string | null; comment: string | null;
  respondedAt: string | null; createdAt: string;
}

function range(p: Preset): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const d = new Date(now);
  if (p === "semana") d.setDate(d.getDate() - 7);
  else if (p === "quinzena") d.setDate(d.getDate() - 15);
  else if (p === "mes") d.setMonth(d.getMonth() - 1);
  else d.setMonth(d.getMonth() - 3);
  return { start: d.toISOString().slice(0, 10), end };
}

const KIND_LABEL: Record<string, string> = {
  lens_order: "Pedido de lente", sale: "Venda", appointment: "Agendamento", manual: "Manual",
};

export function PesquisasClient() {
  const [preset, setPreset] = useState<Preset>("mes");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: Preset) => {
    setLoading(true);
    try {
      const { start, end } = range(p);
      const res = await fetch(`/api/surveys?start=${start}&end=${end}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (res.ok) { setMetrics(data.metrics); setItems(data.items ?? []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(preset); }, [preset, load]);

  const npsColor = metrics?.nps == null ? "" : metrics.nps >= 50 ? "text-green-500" : metrics.nps >= 0 ? "text-orange-400" : "text-red-500";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {(["semana", "quinzena", "mes", "trimestre"] as Preset[]).map((p) => (
          <button key={p} onClick={() => setPreset(p)} className={`rounded-full border px-3 py-1 text-xs transition ${preset === p ? "border-brand bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"}`}>
            {p === "semana" ? "7 dias" : p === "quinzena" ? "15 dias" : p === "mes" ? "Mês" : "Trimestre"}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-brand/50 bg-brand/10 p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted">NPS</p>
          <p className={`mt-1 text-2xl font-semibold ${npsColor}`}>{metrics?.nps ?? "—"}</p>
        </div>
        <Card label="Respondidas" value={`${metrics?.answered ?? 0} / ${metrics?.sent ?? 0}`} />
        <Card label="Nota vendedor (méd.)" value={metrics?.avgSellerRating != null ? `${metrics.avgSellerRating} ★` : "—"} />
        <Card label="Promotores / Detratores" value={`${metrics?.promoters ?? 0} / ${metrics?.detractors ?? 0}`} />
      </div>

      {loading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-sm text-muted">Nenhuma pesquisa no período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-bg/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">NPS</th>
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Nota</th>
                <th className="px-4 py-3">Comentário</th>
                <th className="px-4 py-3">Quando</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-line/50">
                  <td className="px-4 py-3 text-xs text-muted">{KIND_LABEL[it.kind] ?? it.kind}</td>
                  <td className="px-4 py-3">
                    {it.npsScore == null ? (
                      <span className="text-xs text-muted">aguardando</span>
                    ) : (
                      <span className={`font-semibold ${it.npsScore >= 9 ? "text-green-500" : it.npsScore >= 7 ? "text-orange-400" : "text-red-500"}`}>{it.npsScore}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{it.sellerName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">{it.sellerRating != null ? `${it.sellerRating} ★` : "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted">{it.comment ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted">{new Date(it.respondedAt ?? it.createdAt).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg/60 p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
