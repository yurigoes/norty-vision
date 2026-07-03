import { getPublicSettings } from "../lib/platform";

/**
 * Marca d'agua do dono do SaaS no canto inferior direito.
 * Usa a logo clara/escura conforme o tema (dark/white) e opacidade baixa
 * pra nao competir com o branding do contratante.
 *
 * Server component — le platform_settings cacheado.
 */
export async function SaasWatermark() {
  const s = await getPublicSettings();
  if (!s.logoUrl && !s.logoDarkUrl) return null;

  const light = s.logoUrl ?? s.logoDarkUrl!;
  const dark = s.logoDarkUrl ?? s.logoUrl!;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-3 right-4 z-10 select-none opacity-30 transition-opacity hover:opacity-50"
    >
      <img
        src={light}
        alt=""
        className="h-5 w-auto object-contain dark:hidden"
      />
      <img
        src={dark}
        alt=""
        className="hidden h-5 w-auto object-contain dark:block"
      />
    </div>
  );
}
