import { redirect } from "next/navigation";
import { getSession, can } from "../../../../lib/session";
import { MacrosClient } from "./MacrosClient";

export const dynamic = "force-dynamic";

export default async function MacrosAdminPage() {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (!can(session, "templates.manage")) {
    return (
      <div className="max-w-3xl">
        <p className="rounded-lg border border-line bg-bg/60 p-6 text-muted">
          Sem permissão para gerenciar macros (precisa de <code>templates.manage</code>).
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Atendimento</p>
        <h1 className="mt-1 text-3xl font-semibold">Macros</h1>
        <p className="mt-2 text-muted">
          Sequências de ações disparadas em 1 clique numa conversa. Ex.: "Receber pedido" → envia
          mensagem + atribui ao vendedor + adiciona label "novo pedido". Variáveis <code>{"{{cliente.nome}}"}</code>
          são substituídas automaticamente.
        </p>
      </header>
      <MacrosClient />
    </div>
  );
}
