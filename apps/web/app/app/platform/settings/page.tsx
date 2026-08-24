import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "../../../../lib/session";
import { SettingsForm } from "./SettingsForm";
import { PageHeader } from "../../../../components/PageHeader";

export const dynamic = "force-dynamic";

export default async function PlatformSettingsPage() {
  const session = await getSession();
  if (!session.master) {
    redirect("/app");
  }

  // busca settings completos via API (com cookies do request RSC)
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";

  const res = await fetch(`${apiBase}/api/platform/settings`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  const data = (await res.json()) as { settings?: Record<string, unknown> };
  const settings = data.settings ?? {};

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Configurações da plataforma"
        title="Identidade do SaaS"
        description={<>Edite o que aparece na landing pública e nos materiais legais. Salvar regrava a tabela <code className="font-mono text-xs">platform_settings</code> (id=1).</>}
      />

      <SettingsForm initial={settings} />
    </div>
  );
}
