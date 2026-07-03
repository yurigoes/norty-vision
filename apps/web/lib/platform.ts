import { cache } from "react";

export interface PublicPlatformSettings {
  productName: string;
  tagline: string | null;
  companyTradeName: string | null;
  primaryDomain: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
  supportEmail: string | null;
  defaultLocale: string;
  defaultTimezone: string;
  defaultCurrency: string;
}

const DEFAULTS: PublicPlatformSettings = {
  productName: "yugochat",
  tagline: null,
  companyTradeName: null,
  primaryDomain: "yugochat.com.br",
  primaryColor: null,
  secondaryColor: null,
  accentColor: null,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  ogImageUrl: null,
  supportEmail: null,
  defaultLocale: "pt-BR",
  defaultTimezone: "America/Sao_Paulo",
  defaultCurrency: "BRL",
};

/**
 * Le platform_settings publicos (logo, brand, etc). Cache durante o render
 * via React.cache pra nao chamar a API uma vez por componente.
 */
export const getPublicSettings = cache(
  async (): Promise<PublicPlatformSettings> => {
    const apiBase = process.env.API_INTERNAL_URL ?? "http://api:3001";
    try {
      const res = await fetch(`${apiBase}/api/platform/public`, {
        cache: "no-store",
      });
      if (!res.ok) return DEFAULTS;
      const data = (await res.json()) as { settings: Partial<PublicPlatformSettings> };
      return { ...DEFAULTS, ...data.settings };
    } catch {
      return DEFAULTS;
    }
  },
);
