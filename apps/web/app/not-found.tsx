// Página 404 que respeita o branding da empresa quando em subdomínio.
// Renderizada pelo Next quando notFound() é chamado ou rota não existe.

import Link from "next/link";
import { getOrgBrandingFromHost } from "../lib/orgBranding";

export default async function NotFound() {
  const org = await getOrgBrandingFromHost();
  const isOrgHost = !!org.slug;
  const name = isOrgHost ? org.name : "yugochat";
  const brand = org.primaryColor ?? "#7c3aed";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-bg/80 p-8 text-center backdrop-blur">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt={name} className="mx-auto mb-4 h-16 w-auto max-w-[200px] object-contain" />
        ) : (
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl font-bold text-white" style={{ background: brand }}>
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}

        <p className="text-xs uppercase tracking-wider text-muted">404</p>
        <h1 className="mt-1 text-xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted">
          O link que você abriu não existe ou foi movido. Volte ao início do {name}.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ background: brand }}
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
