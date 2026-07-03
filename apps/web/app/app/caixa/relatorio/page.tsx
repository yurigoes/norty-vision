import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/session";
import { apiFetch } from "../../../../lib/api";
import { PrintButton } from "../../agenda/relatorio/PrintButton";

export const dynamic = "force-dynamic";

interface Totals { cash: number; pix: number; cardCredit: number; cardDebit: number; card: number; credit: number; other: number; total: number; salesCount: number }
interface Register {
  id: string;
  storeName: string | null;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingFloatCents: number;
  closingCountedCents: number | null;
  expectedCashCents: number | null;
  totals: Totals;
  notes: string | null;
}

function brl(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function CaixaRelatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  const { id } = await searchParams;
  if (!id) redirect("/app/caixa");

  const [regRes, orgRes] = await Promise.all([
    apiFetch<{ register: Register }>(`/api/cash/${id}`),
    apiFetch<{ organization: { name: string; logoUrl: string | null } }>("/api/organizations/me"),
  ]);
  const r = regRes.data?.register;
  if (!r) redirect("/app/caixa");
  const org = orgRes.data?.organization;
  const t = r.totals ?? ({} as Totals);
  const diff = r.closingCountedCents != null && r.expectedCashCents != null ? r.closingCountedCents - r.expectedCashCents : null;

  const rows: Array<[string, number]> = [
    ["Dinheiro", t.cash],
    ["Pix", t.pix],
    ["Cartão de crédito", t.cardCredit],
    ["Cartão de débito", t.cardDebit],
    ...(t.card ? ([["Cartão (não especificado)", t.card]] as Array<[string, number]>) : []),
    ["Crediário", t.credit],
    ...(t.other ? ([["Outros", t.other]] as Array<[string, number]>) : []),
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <style dangerouslySetInnerHTML={{ __html: "@media print { @page { margin: 0; } html,body { background:#fff !important; } .report-card { padding: 14mm !important; } }" }} />
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="/app/caixa" className="text-sm text-muted hover:text-fg">← voltar</a>
        <PrintButton />
      </div>

      <div className="report-card rounded-xl border border-line bg-white p-8 text-black print:border-0">
        <header className="mb-6 flex items-center justify-between border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-xl font-bold">{org?.name ?? "Caixa"}</h1>
            <p className="text-sm text-gray-600">Fechamento de caixa{r.storeName ? ` · ${r.storeName}` : ""}</p>
            <p className="text-sm">
              Aberto: {new Date(r.openedAt).toLocaleString("pt-BR")}
              {r.closedAt ? ` · Fechado: ${new Date(r.closedAt).toLocaleString("pt-BR")}` : ""}
            </p>
          </div>
          {org?.logoUrl && <img src={org.logoUrl} alt="" className="h-14 w-auto max-w-[160px] object-contain" />}
        </header>

        <h2 className="mb-2 text-sm font-semibold uppercase text-gray-600">Recebido por meio de pagamento</h2>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, val]) => (
              <tr key={label} className="border-b border-gray-200">
                <td className="py-2">{label}</td>
                <td className="py-2 text-right font-medium">{brl(val)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-gray-400">
              <td className="py-2 font-semibold">Total de vendas</td>
              <td className="py-2 text-right font-bold">{brl(t.total)}</td>
            </tr>
          </tbody>
        </table>

        <h2 className="mb-2 mt-6 text-sm font-semibold uppercase text-gray-600">Conferência de dinheiro</h2>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-200"><td className="py-2">Troco inicial</td><td className="py-2 text-right">{brl(r.openingFloatCents)}</td></tr>
            <tr className="border-b border-gray-200"><td className="py-2">Vendas em dinheiro</td><td className="py-2 text-right">{brl(t.cash)}</td></tr>
            <tr className="border-b border-gray-200"><td className="py-2">Esperado na gaveta</td><td className="py-2 text-right font-medium">{brl(r.expectedCashCents)}</td></tr>
            <tr className="border-b border-gray-200"><td className="py-2">Contado</td><td className="py-2 text-right">{r.closingCountedCents != null ? brl(r.closingCountedCents) : "—"}</td></tr>
            {diff !== null && (
              <tr><td className="py-2 font-semibold">Diferença</td><td className="py-2 text-right font-bold">{diff === 0 ? "Confere ✓" : diff > 0 ? `Sobra ${brl(diff)}` : `Falta ${brl(-diff)}`}</td></tr>
            )}
          </tbody>
        </table>

        {r.notes && <p className="mt-4 text-sm text-gray-600">Obs.: {r.notes}</p>}
        <p className="mt-6 text-right text-xs text-gray-500">{t.salesCount ?? 0} venda(s) no período</p>
      </div>
    </div>
  );
}
