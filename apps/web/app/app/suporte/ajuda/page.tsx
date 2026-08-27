import Link from "next/link";
import { apiFetch } from "../../../../lib/api";
import { PageHeader } from "../../../../components/PageHeader";

interface HelpItem {
  id: string;
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
}

export const dynamic = "force-dynamic";

export default async function AjudaPage() {
  const { data } = await apiFetch<{ items: HelpItem[] }>("/api/support/help");
  const items = data?.items ?? [];

  const byCategory: Record<string, HelpItem[]> = {};
  for (const item of items) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push(item);
  }

  const categoryLabels: Record<string, string> = {
    geral: "Geral",
    agenda: "Agenda",
    leads: "Leads",
    disparador: "Disparador",
    config: "Configurações",
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Suporte · Ajuda"
        title="Passo a passo"
        description={<>Artigos sobre como usar cada parte do sistema. {items.length} artigos.</>}
      />

      {items.length === 0 ? (
        <p className="card text-muted">
          Nenhum artigo publicado ainda.
        </p>
      ) : (
        <div className="space-y-8">
          {Object.entries(byCategory).map(([cat, list]) => (
            <section key={cat}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                {categoryLabels[cat] ?? cat}
              </h2>
              <div className="space-y-2">
                {list.map((item) => (
                  <Link
                    key={item.id}
                    href={`/app/suporte/ajuda/${item.slug}`}
                    className="card block"
                  >
                    <h3 className="font-semibold">{item.title}</h3>
                    {item.summary && (
                      <p className="mt-1 text-sm text-muted">{item.summary}</p>
                    )}
                    {item.tags && item.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
