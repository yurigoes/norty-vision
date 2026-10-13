import { redirect } from "next/navigation";
import { getSession } from "../../../lib/session";
import { apiFetch } from "../../../lib/api";
import { LensOrdersClient } from "./LensOrdersClient";
import { loginPath } from "../../../lib/tenantServer";
import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function PedidosLentePage() {
  const session = await getSession();
  if (!session.authenticated) redirect(await loginPath());
  // O porteiro desta tela é o `perm` dela no nav.ts (lib/acesso.ts, no layout
  // de /app). Não repetir a conta aqui: a trava da página roda depois e vence,
  // e foi assim que conceder a permissão passou a mostrar o item no menu sem
  // abrir a tela.

  // a tela não carrega mais cliente nenhum (eram 300 de 3.000, só pro seletor):
  // o seletor pergunta ao servidor conforme se digita
  // A lista de produtos saiu daqui: o seletor de produto busca no servidor,
  // então baixar até 500 produtos em toda abertura da tela era peso morto —
  // e, pior, era o teto que fazia produto fora do primeiro pedaço "não
  // existir" na hora de montar o pedido.
  const [ordersRes, supRes, batchRes] = await Promise.all([
    apiFetch<{ items: any[] }>("/api/optical/orders"),
    apiFetch<{ items: any[] }>("/api/suppliers?activeOnly=true"),
    apiFetch<{ items: any[] }>("/api/optical/batches"),
  ]);

  const suppliers = supRes.data?.items ?? [];

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Ótica"
        title="Pedidos de lente"
        description="Medidas, anexo do exame e acompanhamento do status (medido → solicitado → chegou → avisado → entregue) com lotes pro laboratório."
      />

      <LensOrdersClient
        initialOrders={ordersRes.data?.items ?? []}
        initialBatches={batchRes.data?.items ?? []}
        doctors={suppliers.filter((s) => s.type === "medico")}
        labs={suppliers.filter((s) => s.type === "laboratorio")}
      />
    </div>
  );
}
