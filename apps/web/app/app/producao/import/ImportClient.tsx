"use client";

// Upload de .xlsx legado (planilha de pedidos da gráfica). 2 etapas:
//   1) Preview (dry-run): parser server-side mostra 15 primeiras linhas.
//   2) Importar: cria customer + supplier(costureira) + production_order.
//
// + Seção de LIMPEZA da base (apaga pedidos/clientes/conversas/etc) com
// confirmação por slug pra evitar acidente.

import { useEffect, useState } from "react";
import { useDialog } from "../../../../components/SystemDialog";

type Preview = { totalRows: number; preview: RawRow[] };
type Summary = {
  totalRowsParsed: number;
  imported: number;
  skippedDup: number;
  errors: Array<{ aba: string; linha: number; motivo: string; nome?: string | null }>;
  costureirasCriadas: string[];
  clientesCriados: number;
};
interface RawRow {
  nome: string | null;
  contato: string | null;
  pecas: number | null;
  tipo: string | null;
  fechamento: string | null;
  entrega: string | null;
  costureira: string | null;
  status: string | null;
  valorPedido: number | null;
  pagamento: string | null;
  formaPgto: string | null;
  _aba: string;
  _linhaOriginal: number;
}

function brl(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ImportClient() {
  const dialog = useDialog();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [createMissing, setCreateMissing] = useState(true);

  async function doPreview() {
    if (!file) return;
    setBusy("preview"); setPreview(null); setSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/production/import/preview", { method: "POST", credentials: "include", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Falha");
      setPreview(d);
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setBusy(null); }
  }

  async function doImport() {
    if (!file) return;
    if (!(await dialog.confirm({ message: `Importar ${preview?.totalRows ?? "?"} linhas? Cliente novos serão cadastrados${createMissing ? " e costureiras novas também" : ""}.`, confirmLabel: "Importar" }))) return;
    setBusy("run"); setSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("createCostureiraIfMissing", createMissing ? "true" : "false");
      const r = await fetch("/api/production/import/run", { method: "POST", credentials: "include", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Falha");
      setSummary(d);
      dialog.toast(`Importadas ${d.imported} OS ✅`, "success");
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <WipeSection />
      <section className="rounded-xl border border-line bg-bg/60 p-5">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-muted">Arquivo .xlsx</span>
          <input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setSummary(null); }} className="w-full text-sm" />
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
          Cadastrar costureiras novas automaticamente (se aparecer um nome na planilha que ainda não está em Fornecedores)
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button disabled={!file || busy !== null} onClick={doPreview} className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/10 disabled:opacity-50">{busy === "preview" ? "Lendo…" : "1) Visualizar"}</button>
          <button disabled={!file || !preview || busy !== null} onClick={doImport} className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "run" ? "Importando…" : "2) Importar tudo"}</button>
        </div>
      </section>

      {preview && (
        <section className="rounded-xl border border-line bg-bg/60 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Pré-visualização ({preview.totalRows} linhas detectadas)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-muted">
                <tr>
                  <th className="px-2 py-1 text-left">Aba/Linha</th>
                  <th className="px-2 py-1 text-left">Cliente</th>
                  <th className="px-2 py-1 text-left">Contato</th>
                  <th className="px-2 py-1 text-right">Pç</th>
                  <th className="px-2 py-1 text-left">Tipo</th>
                  <th className="px-2 py-1 text-left">Costureira</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-right">Valor</th>
                  <th className="px-2 py-1 text-left">Pgto</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((r, i) => (
                  <tr key={i} className="border-t border-line/50">
                    <td className="px-2 py-1 font-mono text-muted">{r._aba}/{r._linhaOriginal}</td>
                    <td className="px-2 py-1">{r.nome}</td>
                    <td className="px-2 py-1 font-mono text-muted">{r.contato ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{r.pecas ?? "—"}</td>
                    <td className="px-2 py-1">{r.tipo ?? "—"}</td>
                    <td className="px-2 py-1">{r.costureira ?? "—"}</td>
                    <td className="px-2 py-1"><span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px]">{r.status}</span></td>
                    <td className="px-2 py-1 text-right font-semibold">{brl(r.valorPedido)}</td>
                    <td className="px-2 py-1 text-muted">{r.pagamento ?? "—"} / {r.formaPgto ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">Mostrando {preview.preview.length} de {preview.totalRows} linhas válidas. As outras serão processadas no import.</p>
        </section>
      )}

      {summary && (
        <section className="rounded-xl border border-green-500/40 bg-green-500/5 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-green-300">Importação concluída</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Importadas" value={summary.imported} tone="green" />
            <Stat label="Duplicadas (puladas)" value={summary.skippedDup} tone="amber" />
            <Stat label="Erros" value={summary.errors.length} tone={summary.errors.length > 0 ? "red" : undefined} />
            <Stat label="Clientes cadastrados" value={summary.clientesCriados} />
          </div>
          {summary.costureirasCriadas.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Costureiras criadas: <strong>{summary.costureirasCriadas.join(", ")}</strong>. Vá em /app/fornecedores → tipo Costureira pra completar telefone, CPF, Pix e <strong>valor por peça</strong>.
            </p>
          )}
          {summary.errors.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-red-300">{summary.errors.length} erros — clique pra ver</summary>
              <ul className="mt-2 space-y-1">
                {summary.errors.slice(0, 50).map((e, i) => (
                  <li key={i} className="rounded bg-bg/40 px-2 py-1 font-mono text-[11px]">{e.aba}/{e.linha}: {e.nome ?? ""} — {e.motivo}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" }) {
  const cls = tone === "green" ? "text-green-300" : tone === "amber" ? "text-amber-300" : tone === "red" ? "text-red-300" : "text-fg";
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  );
}

interface WipeScope {
  production: boolean; quotes: boolean; conversations: boolean; leads: boolean;
  appointments: boolean; credit: boolean; lens: boolean; broadcast: boolean; customers: boolean;
}

function WipeSection() {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [orgSlug, setOrgSlug] = useState<string>("");
  const [confirmSlug, setConfirmSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ deleted: Record<string, number>; saleCustomerNulled: number } | null>(null);
  const [scope, setScope] = useState<WipeScope>({
    production: true, quotes: true, conversations: true, leads: true,
    appointments: true, credit: true, lens: false, broadcast: true, customers: true,
  });

  useEffect(() => {
    fetch("/api/organizations/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrgSlug(d?.organization?.slug ?? ""))
      .catch(() => undefined);
  }, []);

  const can = confirmSlug.trim().toLowerCase() === orgSlug.toLowerCase() && orgSlug.length > 0;
  const anyChecked = Object.values(scope).some(Boolean);

  async function doWipe() {
    if (!can) { dialog.toast(`Digite "${orgSlug}" pra confirmar`, "error"); return; }
    if (!anyChecked) { dialog.toast("Selecione ao menos um bloco", "error"); return; }
    if (!(await dialog.confirm({ message: `ÚLTIMA CONFIRMAÇÃO: vai apagar permanentemente os dados marcados da org ${orgSlug}. PDV (vendas) e produtos NÃO serão tocados. Confirma?`, confirmLabel: "Apagar agora", tone: "danger" }))) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch("/api/production/wipe-data", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ confirmSlug, scope }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? "Falha");
      setResult(d);
      dialog.toast("Base limpa ✅", "success");
    } catch (e: any) { dialog.toast(e.message, "error"); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-200">Limpar a base ANTES de importar</p>
            <p className="mt-1 text-xs text-amber-200/80">Se você quer começar do zero — apagar pedidos antigos, clientes, conversas, leads etc — abra essa seção. <b>Vendas do PDV e produtos não são tocados.</b></p>
            <button onClick={() => setOpen(true)} className="mt-3 rounded-lg border border-amber-500/60 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/10">Abrir opções de limpeza</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border-2 border-red-500/40 bg-red-500/5 p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-red-200">⚠️ Limpar base de dados</p>
          <p className="text-xs text-red-200/80">Operação irreversível. Marque o que quer apagar.</p>
        </div>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-fg">fechar</button>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Check label="🏭 Pedidos de produção (e arte, ficha, pagamentos)" k="production" scope={scope} setScope={setScope} />
        <Check label="👤 Clientes (NULL nos pedidos do PDV existentes)" k="customers" scope={scope} setScope={setScope} />
        <Check label="💬 Conversas / Atendimento (WhatsApp, chat)" k="conversations" scope={scope} setScope={setScope} />
        <Check label="🎯 Leads / CRM (e interações, tarefas)" k="leads" scope={scope} setScope={setScope} />
        <Check label="📅 Agendamentos" k="appointments" scope={scope} setScope={setScope} />
        <Check label="📋 Orçamentos" k="quotes" scope={scope} setScope={setScope} />
        <Check label="💳 Crediário (contas, parcelas, solicitações)" k="credit" scope={scope} setScope={setScope} />
        <Check label="📢 Mala direta (broadcast)" k="broadcast" scope={scope} setScope={setScope} />
        <Check label="👓 Pedidos de lente (ótica)" k="lens" scope={scope} setScope={setScope} />
      </div>

      <p className="mt-4 text-xs text-amber-200">
        Pra confirmar, digite o slug da sua org: <code className="rounded bg-bg/60 px-2 py-0.5 font-bold">{orgSlug || "(carregando…)"}</code>
      </p>
      <input
        value={confirmSlug}
        onChange={(e) => setConfirmSlug(e.target.value)}
        placeholder={`digite "${orgSlug}"`}
        className="mt-1 w-full max-w-xs rounded border border-line bg-bg/60 px-3 py-2 text-sm font-mono"
      />

      <button
        disabled={!can || !anyChecked || busy}
        onClick={doWipe}
        className="mt-4 rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Apagando…" : "Apagar selecionados"}
      </button>

      {result && (
        <div className="mt-4 rounded-lg border border-green-500/40 bg-green-500/5 p-3 text-xs">
          <p className="font-semibold text-green-300">Limpeza concluída.</p>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(result.deleted).map(([k, v]) => v > 0 && (
              <li key={k}><code className="text-muted">{k}</code>: <b>{v}</b></li>
            ))}
            {result.saleCustomerNulled > 0 && <li>Vendas com cliente removido (mantidas): <b>{result.saleCustomerNulled}</b></li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function Check({ label, k, scope, setScope }: { label: string; k: keyof WipeScope; scope: WipeScope; setScope: React.Dispatch<React.SetStateAction<WipeScope>> }) {
  return (
    <label className="flex items-center gap-2 rounded border border-line bg-bg/40 px-3 py-2 text-xs">
      <input type="checkbox" checked={scope[k]} onChange={(e) => setScope((s) => ({ ...s, [k]: e.target.checked }))} className="accent-red-500" />
      <span>{label}</span>
    </label>
  );
}
