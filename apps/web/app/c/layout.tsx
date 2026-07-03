import "../globals.css";
import type { Metadata } from "next";
import { LoadingProvider } from "../../components/Loading";
import { ClientPwa } from "./ClientPwa";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal do Cliente",
  manifest: "/c.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Portal do Cliente" },
  icons: { apple: "/brand/norty-n-azul.png" },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <LoadingProvider>
      <ClientPwa />
      <div className="min-h-screen">{children}</div>
    </LoadingProvider>
  );
}
