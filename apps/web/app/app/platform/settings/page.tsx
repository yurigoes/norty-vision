import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "../../../../lib/session";
import { SettingsForm } from "./SettingsForm";

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
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">
          Configurações da plataforma
        </p>
        <h1 className="mt-1 text-3xl font-semibold">Identidade do SaaS</h1>
        <p className="mt-2 text-muted">
          Edite o que aparece na landing pública e nos materiais legais.
          Salvar regrava a tabela <code className="font-mono text-xs">platform_settings</code> (id=1).
        </p>
      </header>

      <SettingsForm initial={settings} />
    </div>
  );
}
