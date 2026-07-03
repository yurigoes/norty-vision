export const dynamic = "force-dynamic";

export default function LeadsPage() {
  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Leads</p>
        <h1 className="mt-1 text-3xl font-semibold">Pipeline de leads</h1>
      </header>
      <div className="rounded-xl border border-line bg-bg/60 p-8 text-center">
        <p className="text-lg font-medium">Em breve</p>
        <p className="mt-2 text-sm text-muted">
          O módulo de leads (kanban, atribuição por vendedor e métricas de
          conversão) está em construção.
        </p>
      </div>
    </div>
  );
}
