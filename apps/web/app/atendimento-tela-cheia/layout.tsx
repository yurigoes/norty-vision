import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { apiFetch } from "../../lib/api";
import { hexToRgbTriplet } from "../../lib/color";
import { DialogProvider } from "../../components/SystemDialog";
import { LoadingProvider } from "../../components/Loading";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Atendimento (tela cheia)",
};

/**
 * Layout do modo KIOSK do atendimento — tela cheia, sem sidebar.
 *
 * Compartilha cookies com o /app/* normal (mesmo domínio), então quem já
 * está logado abre direto. Sessão expirada → redirect /login (igual ao
 * /app/). Sessão limpa só os providers essenciais que AtendimentoClient
 * precisa (DialogProvider pra confirm/toast, LoadingProvider pro spinner
 * global) e injeta a cor da empresa via CSS vars.
 */
export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.authenticated) redirect("/login");
  if (session.user?.mustResetPassword && !session.impersonating) redirect("/trocar-senha");

  // Cor primária da empresa (mesma lógica do /app/layout)
  let brandRgb: string | null = null;
  if (session.user?.orgId) {
    const ores = await apiFetch<{ organization: any }>(`/api/organizations/me`);
    const org = ores.data?.organization;
    if (org?.primaryColor) brandRgb = hexToRgbTriplet(org.primaryColor);
  }
  const styleVar = brandRgb ? ({ ["--brand" as any]: brandRgb } as React.CSSProperties) : undefined;

  return (
    <LoadingProvider>
      <DialogProvider>
        <div className="flex h-screen flex-col bg-bg text-fg" style={styleVar}>
          {children}
        </div>
      </DialogProvider>
    </LoadingProvider>
  );
}
