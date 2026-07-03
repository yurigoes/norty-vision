"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { useLoading } from "./Loading";
import { useSidebarCount } from "./SidebarCounts";

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/**
 * Item de menu da sidebar com destaque "vidro" quando ativo: o item da aba
 * atual ganha fundo translucido com blur e borda sutil na cor da marca.
 */
export function SidebarLink({
  href,
  children,
  locked,
}: {
  href: string;
  children: React.ReactNode;
  /** Módulo não incluído no plano: mostra cadeado e leva pra Assinatura. */
  locked?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { begin, end } = useLoading();
  const wasPending = useRef(false);
  const count = useSidebarCount(href);

  // navegação pendente → liga/desliga o loading global (some quando a rota carrega)
  useEffect(() => {
    if (pending && !wasPending.current) { wasPending.current = true; begin(); }
    else if (!pending && wasPending.current) { wasPending.current = false; end(); }
  }, [pending, begin, end]);

  if (locked) {
    return (
      <Link
        href="/app/billing"
        title="Disponível em um plano superior"
        className="flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-muted/70 transition hover:bg-line/60"
      >
        <span className="truncate">{children}</span>
        <span aria-hidden className="ml-2 shrink-0 text-xs">🔒</span>
      </Link>
    );
  }

  // ativo = match exato, ou prefixo (mas "/app" so casa exato pra nao pegar tudo)
  const active =
    href === "/app"
      ? pathname === "/app"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        // preserva ctrl/cmd/shift/middle-click (abrir em nova aba)
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        if (active) return; // já está na rota
        e.preventDefault();
        startTransition(() => router.push(href));
      }}
      className={
        active
          ? "flex items-center justify-between rounded-md border border-brand/40 bg-brand/15 px-3 py-2 font-medium text-fg shadow-sm backdrop-blur-md transition"
          : "flex items-center justify-between rounded-md border border-transparent px-3 py-2 text-fg transition hover:bg-line"
      }
    >
      <span className="truncate">{children}</span>
      <CountBadge n={count} />
    </Link>
  );
}
