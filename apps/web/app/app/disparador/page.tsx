import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default function DisparadorPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Disparador"
        title="Campanhas em massa"
        description="Campanhas com templates, segmentação por tags e opt-out automático."
      />
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
