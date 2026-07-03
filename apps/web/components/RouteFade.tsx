"use client";

import { usePathname } from "next/navigation";

/**
 * Anima a entrada do conteúdo a cada mudança de rota (fade + leve subida).
 * O `key` por pathname remonta o conteúdo, re-disparando a animação.
 */
export function RouteFade({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-route-fade">
      {children}
    </div>
  );
}
