import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "../components/ThemeScript";
import { CompanyThemeScript } from "../components/CompanyThemeScript";
import { BackgroundArt } from "../components/BackgroundArt";
import { getPublicSettings } from "../lib/platform";
import { getOrgBrandingFromHost } from "../lib/orgBranding";

// Norty Vision — tipografia oficial (400–800), exposta como var CSS --font-sans
// e ligada ao Tailwind fontFamily.sans.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const [s, org] = await Promise.all([getPublicSettings(), getOrgBrandingFromHost()]);
  // Em subdomínio de empresa: título/favicon da EMPRESA, não da plataforma.
  // Apex: usa o branding da plataforma normalmente.
  const isOrgHost = !!org.slug;
  const titleDefault = isOrgHost
    ? `${org.name}`
    : s.tagline
      ? `${s.productName} — ${s.tagline}`
      : s.productName;
  const favicon = isOrgHost ? (org.faviconUrl ?? org.logoUrl) : s.faviconUrl;
  return {
    title: {
      default: titleDefault,
      template: isOrgHost ? `%s · ${org.name}` : `%s · ${s.productName}`,
    },
    description: isOrgHost
      ? `Portal ${org.name}`
      : s.tagline ?? "SaaS de agenda, leads e disparador para óticas, clínicas e consultórios.",
    icons: favicon
      ? { icon: favicon, shortcut: favicon, apple: favicon }
      : undefined,
    openGraph: !isOrgHost && s.ogImageUrl
      ? { images: [{ url: s.ogImageUrl }] }
      : undefined,
    robots: { index: !isOrgHost, follow: !isOrgHost },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#060a15" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={jakarta.variable}>
      <head>
        <ThemeScript />
      </head>
      <body className="relative min-h-screen font-sans isolate">
        <CompanyThemeScript />
        <BackgroundArt />
        <div className="relative" style={{ zIndex: 1 }}>
          {children}
        </div>
      </body>
    </html>
  );
}
