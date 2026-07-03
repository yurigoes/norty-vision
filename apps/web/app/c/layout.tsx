import "../globals.css";
import { LoadingProvider } from "../../components/Loading";

export const dynamic = "force-dynamic";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <LoadingProvider>
      <div className="min-h-screen">{children}</div>
    </LoadingProvider>
  );
}
