import "../globals.css";
import type { Metadata } from "next";
import { RhPwa } from "./RhPwa";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal do Funcionário — yugochat",
  manifest: "/rh.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "RH yugochat" },
  icons: { apple: "/rh-icon.svg" },
};

export default function EmployeePortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <RhPwa />
      {children}
    </div>
  );
}
