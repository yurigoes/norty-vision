import { apiFetch } from "../../../../lib/api";
import { PageHeader } from "../../../../components/PageHeader";

interface GuideSection {
  id: string;
  parent_id: string | null;
  depth: number;
  path: string;
  slug: string;
  title: string;
  module: string;
  display_order: number;
}

export const dynamic = "force-dynamic";

export default async function GuiaPage() {
  const { data } = await apiFetch<{ sections: GuideSection[] }>(
    "/api/support/guide",
  );
  const sections = data?.sections ?? [];

  const byModule: Record<string, GuideSection[]> = {};
  for (const s of sections) {
    if (!byModule[s.module]) byModule[s.module] = [];
    byModule[s.module].push(s);
  }

  const moduleLabels: Record<string, string> = {
    overview: "Visão geral",
    agenda: "Agenda",
    leads: "Leads",
    disparador: "Disparador",
    platform: "Plataforma",
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Suporte · Guia do sistema"
        title="Como o sistema funciona"
        description={<>Documentação arquitetural de cada módulo. {sections.length} seções.</>}
      />

      <div className="space-y-8">
        {Object.entries(byModule).map(([mod, list]) => (
          <section key={mod}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              {moduleLabels[mod] ?? mod}
            </h2>
            <div className="space-y-2">
              {list.map((s) => (
                <a
                  key={s.id}
                  href={`/app/suporte/guia/${encodeURIComponent(s.path)}`}
                  className="card block"
                  style={{ paddingLeft: `${1 + s.depth * 1.5}rem` }}
                >
                  <h3 className="font-semibold">{s.title}</h3>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">{s.path}</p>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
