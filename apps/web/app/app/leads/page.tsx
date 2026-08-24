import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default function LeadsPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Leads"
        title="Pipeline de leads"
      />
      <div className="card p-10 text-center">
        <p className="text-lg font-semibold">Em breve</p>
        <p className="mt-2 text-sm text-muted">
          O módulo de leads (kanban, atribuição por vendedor e métricas de
          conversão) está em construção.
        </p>
      </div>
    </div>
  );
}
