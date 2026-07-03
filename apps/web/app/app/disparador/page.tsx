export const dynamic = "force-dynamic";

export default function DisparadorPage() {
  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Disparador</p>
        <h1 className="mt-1 text-3xl font-semibold">Campanhas em massa</h1>
        <p className="mt-2 text-muted">
          Campanhas com templates, segmentação por tags e opt-out automático.
        </p>
      </header>
      <div className="rounded-2xl border border-line bg-surface p-8 text-center">
        <p className="text-lg font-medium">Em breve</p>
        <p className="mt-2 text-sm text-muted">
          O disparador (campanhas com templates, segmentação por tags e opt-out
          automático) está em construção.
        </p>
      </div>
    </div>
  );
}
