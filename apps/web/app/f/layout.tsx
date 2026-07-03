import "../globals.css";

export const dynamic = "force-dynamic";

export default function SupplierPortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
